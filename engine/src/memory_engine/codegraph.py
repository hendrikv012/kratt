"""Parse Python with tree-sitter into symbols, references and searchable code chunks."""

import re
import sqlite3
from bisect import bisect_right
from dataclasses import dataclass

import tree_sitter_python
from tree_sitter import Language, Node, Parser, Query, QueryCursor

from memory_engine.chunking import Chunk, estimate_tokens, split_code
from memory_engine.embeddings import Embedder
from memory_engine.store import replace_chunks, upsert_document

PY = Language(tree_sitter_python.language())
PARSER = Parser(PY)
QUERY = Query(
    PY,
    """
    (class_definition) @symbol
    (function_definition) @symbol
    (call function: (_) @callee)
    (import_statement) @import
    (import_from_statement) @import
    """,
)
CODE_CHUNK_TOKENS = 400  # the Markdown chunk size


@dataclass(frozen=True)
class SymbolRow:
    id: int
    path: str
    name: str
    kind: str
    signature: str
    start_line: int
    end_line: int


def _key(node: Node) -> tuple[int, int, str]:
    return node.start_byte, node.end_byte, node.type


def _text(source: bytes, node: Node) -> str:
    return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")


class _Lines:
    """1-based line numbers from byte offsets.

    tree-sitter 0.26's Point.row mis-counts references to rows above 256, which corrupts
    the heap and crashes the process, so line numbers never come from start_point/end_point.
    """

    def __init__(self, data: bytes):
        self.starts = [0] + [m.end() for m in re.finditer(b"\n", data)]

    def first(self, node: Node) -> int:
        return bisect_right(self.starts, node.start_byte)

    def last(self, node: Node) -> int:
        return bisect_right(self.starts, max(node.start_byte, node.end_byte - 1))


def _owning_class(node: Node) -> Node | None:
    """The class a function_definition is a method of, looking through a decorator wrapper."""
    parent = node.parent
    if parent is not None and parent.type == "decorated_definition":
        parent = parent.parent
    if parent is not None and parent.type == "block" and parent.parent is not None:
        if parent.parent.type == "class_definition":
            return parent.parent
    return None


def _signature(source: bytes, node: Node) -> str:
    body = node.child_by_field_name("body")
    end = body.start_byte if body is not None else node.end_byte
    header = source[node.start_byte:end].decode("utf-8", errors="replace").rstrip()
    return header.removesuffix(":").rstrip() if body is not None else header.splitlines()[0]


def _outer(node: Node) -> Node:
    """The node including its decorators."""
    parent = node.parent
    return parent if parent is not None and parent.type == "decorated_definition" else node


def _parent_symbol(node: Node, symbol_keys: set) -> tuple[int, int, str] | None:
    parent = node.parent
    while parent is not None:
        if _key(parent) in symbol_keys:
            return _key(parent)
        parent = parent.parent
    return None


def _outline(data: bytes, start: int, end: int, children: list[tuple[int, int, str]]) -> str:
    """data[start:end] with each nested definition replaced by its one-line signature."""
    out, position = [], start
    for child_start, child_end, signature in sorted(children):
        out += [data[position:child_start], f"{signature}: ...".encode()]
        position = child_end
    out.append(data[position:end])
    return b"".join(out).decode("utf-8", errors="replace")


def _enclosing(node: Node, symbol_ids: dict) -> int | None:
    parent = node.parent
    while parent is not None:
        if _key(parent) in symbol_ids:
            return symbol_ids[_key(parent)]
        parent = parent.parent
    return None


def _imported_modules(source: bytes, node: Node) -> list[str]:
    if node.type == "import_from_statement":
        module = node.child_by_field_name("module_name")
        return [_text(source, module)] if module is not None else []
    names = []
    for name in node.children_by_field_name("name"):
        if name.type == "aliased_import":
            name = name.child_by_field_name("name")
        names.append(_text(source, name))
    return names


def index_code(conn: sqlite3.Connection, path: str, source: str, embedder: Embedder) -> int:
    if not path.endswith(".py"):
        raise ValueError(f"unsupported file type: {path}")
    with conn:
        document_id, changed = upsert_document(conn, path, "code", source)
        if not changed:
            return document_id
        data = source.encode("utf-8")
        captures = QueryCursor(QUERY).captures(PARSER.parse(data).root_node)
        lines = _Lines(data)
        conn.execute('DELETE FROM "references" WHERE document_id = ?', (document_id,))
        conn.execute("DELETE FROM symbols WHERE document_id = ?", (document_id,))

        nodes = sorted(
            (n for n in captures.get("symbol", []) if n.child_by_field_name("name") is not None),
            key=lambda n: n.start_byte,
        )
        symbol_keys = {_key(n) for n in nodes}
        symbol_ids: dict[tuple[int, int, str], int] = {}
        signatures: dict[tuple[int, int, str], str] = {}
        children: dict[tuple[int, int, str] | None, list[tuple[int, int, str]]] = {}
        for node in nodes:
            name = node.child_by_field_name("name")
            owner = _owning_class(node) if node.type == "function_definition" else None
            kind = "class" if node.type == "class_definition" else ("method" if owner is not None else "function")
            signature = _signature(data, node)
            cursor = conn.execute(
                "INSERT INTO symbols(document_id, parent_id, name, kind, signature, start_line, end_line)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (document_id, symbol_ids.get(_key(owner)) if owner is not None else None, _text(data, name),
                 kind, signature, lines.first(node), lines.last(node)),
            )
            symbol_ids[_key(node)] = cursor.lastrowid
            signatures[_key(node)] = signature
            outer = _outer(node)
            children.setdefault(_parent_symbol(node, symbol_keys), []).append(
                (outer.start_byte, outer.end_byte, signature))

        # Every line of the file lands in exactly one chunk: module-level code first, then each
        # definition with its nested definitions shown as one-line signatures.
        chunks: list[Chunk] = []
        regions = [(None, 0, len(data))] + [(signatures[_key(n)], n.start_byte, n.end_byte) for n in nodes]
        for (heading, start, end), key in zip(regions, [None] + [_key(n) for n in nodes]):
            for piece in split_code(_outline(data, start, end, children.get(key, [])), CODE_CHUNK_TOKENS):
                chunks.append(Chunk(len(chunks), heading, piece, estimate_tokens(piece)))

        references = [(n, "call", [_text(data, n)]) for n in captures.get("callee", [])]
        references += [(n, "import", _imported_modules(data, n)) for n in captures.get("import", [])]
        for node, kind, names in sorted(references, key=lambda r: r[0].start_byte):
            for to_name in names:
                conn.execute(
                    'INSERT INTO "references"(document_id, from_symbol_id, to_name, kind, line) VALUES (?, ?, ?, ?, ?)',
                    (document_id, _enclosing(node, symbol_ids), to_name, kind, lines.first(node)),
                )

        replace_chunks(conn, document_id, chunks, embedder)
    return document_id


_SYMBOL_COLUMNS = "s.id, d.path, s.name, s.kind, s.signature, s.start_line, s.end_line"


def _rows(cursor) -> list[SymbolRow]:
    return [SymbolRow(*row) for row in cursor.fetchall()]


def find_symbol(conn: sqlite3.Connection, name: str) -> list[SymbolRow]:
    return _rows(conn.execute(
        f"SELECT {_SYMBOL_COLUMNS} FROM symbols s JOIN documents d ON d.id = s.document_id"
        " WHERE s.name = ? ORDER BY d.path, s.start_line",
        (name,),
    ))


def callers_of(conn: sqlite3.Connection, name: str) -> list[SymbolRow]:
    """Symbols that call `name`, directly or as the last part of a dotted call like `mod.name`."""
    return _rows(conn.execute(
        f"SELECT DISTINCT {_SYMBOL_COLUMNS} FROM \"references\" r"
        " JOIN symbols s ON s.id = r.from_symbol_id JOIN documents d ON d.id = s.document_id"
        " WHERE r.kind = 'call' AND (r.to_name = :name"
        " OR substr(r.to_name, length(r.to_name) - length(:name)) = '.' || :name)"
        " ORDER BY d.path, s.start_line",
        {"name": name},
    ))


def callees_of(conn: sqlite3.Connection, symbol_id: int) -> list[str]:
    return [row[0] for row in conn.execute(
        "SELECT to_name FROM \"references\" WHERE from_symbol_id = ? AND kind = 'call' ORDER BY line, id",
        (symbol_id,),
    )]
