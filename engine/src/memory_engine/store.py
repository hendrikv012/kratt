"""Write a document's chunks, full-text rows and int8 vectors, and remove them again."""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime

from memory_engine.chunking import CHUNK_TOKENS, Chunk, split_markdown
from memory_engine.embeddings import Embedder, normalize


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def upsert_document(conn: sqlite3.Connection, path: str, kind: str, text: str) -> tuple[int, bool]:
    """Return (id, changed). An unchanged file writes nothing."""
    digest = content_hash(text)
    row = conn.execute("SELECT id, content_hash FROM documents WHERE path = ?", (path,)).fetchone()
    if row is not None and row["content_hash"] == digest:
        return row["id"], False
    if row is not None:
        conn.execute(
            "UPDATE documents SET kind = ?, content_hash = ?, updated_at = ? WHERE id = ?",
            (kind, digest, now_iso(), row["id"]),
        )
        return row["id"], True
    cursor = conn.execute(
        "INSERT INTO documents(path, kind, content_hash, updated_at) VALUES (?, ?, ?, ?)",
        (path, kind, digest, now_iso()),
    )
    return cursor.lastrowid, True


# nomic-embed-text is trained with a task prefix; queries get theirs in search.py.
DOCUMENT_PREFIX = "search_document: "


def _embedding_input(chunk: Chunk) -> str:
    body = f"{chunk.heading}\n{chunk.text}" if chunk.heading else chunk.text
    return DOCUMENT_PREFIX + body


def replace_chunks(conn: sqlite3.Connection, document_id: int, chunks: list[Chunk], embedder: Embedder) -> None:
    """Swap a document's chunks for new ones. Runs inside the caller's transaction."""
    vectors = embedder.embed([_embedding_input(c) for c in chunks]) if chunks else []
    conn.execute(
        "DELETE FROM chunks_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)", (document_id,)
    )
    conn.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
    for chunk, vector in zip(chunks, vectors, strict=True):
        cursor = conn.execute(
            "INSERT INTO chunks(document_id, ordinal, heading, text, token_estimate) VALUES (?, ?, ?, ?, ?)",
            (document_id, chunk.ordinal, chunk.heading, chunk.text, chunk.token_estimate),
        )
        conn.execute(
            "INSERT INTO chunks_vec(chunk_id, embedding) VALUES (?, vec_quantize_int8(?, 'unit'))",
            (cursor.lastrowid, json.dumps(normalize(vector))),
        )


def index_markdown(conn: sqlite3.Connection, path: str, text: str, embedder: Embedder, chunk_tokens: int = CHUNK_TOKENS) -> int:
    with conn:
        document_id, changed = upsert_document(conn, path, "markdown", text)
        if changed:
            replace_chunks(conn, document_id, split_markdown(text, chunk_tokens), embedder)
    return document_id


def remove_document(conn: sqlite3.Connection, path: str) -> bool:
    """Delete a document; its vectors go first because vec0 rows don't cascade."""
    with conn:
        row = conn.execute("SELECT id FROM documents WHERE path = ?", (path,)).fetchone()
        if row is None:
            return False
        conn.execute(
            "DELETE FROM chunks_vec WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)", (row["id"],)
        )
        conn.execute("DELETE FROM documents WHERE id = ?", (row["id"],))
    return True
