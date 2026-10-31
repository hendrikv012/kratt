import pytest

from memory_engine.codegraph import callees_of, callers_of, find_symbol, index_code

SRC = """import os
from pathlib import Path

class A:
    def m(self, x: int) -> int:
        return helper(x)

def helper(y):
    os.path.join('a')
    return y
"""


def test_symbols_and_kinds(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    got = {(s.name, s.kind) for s in find_symbol(conn, "m") + find_symbol(conn, "A") + find_symbol(conn, "helper")}
    assert got == {("m", "method"), ("A", "class"), ("helper", "function")}


def test_signature_and_lines(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    m = find_symbol(conn, "m")[0]
    assert m.signature == "def m(self, x: int) -> int" and (m.start_line, m.end_line) == (5, 6)


def test_callers_and_callees(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    assert [s.name for s in callers_of(conn, "helper")] == ["m"]
    assert callees_of(conn, find_symbol(conn, "helper")[0].id) == ["os.path.join"]


def test_imports_recorded(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    names = {r[0] for r in conn.execute("SELECT to_name FROM \"references\" WHERE kind='import'")}
    assert names == {"os", "pathlib"}


def test_syntax_error_still_indexes_valid_parts(conn, fake):
    index_code(conn, "pkg/b.py", "def ok():\n    return 1\n\ndef broken(:\n", fake)
    assert [s.name for s in find_symbol(conn, "ok")] == ["ok"]


def test_decorated_method_is_a_method(conn, fake):
    index_code(conn, "pkg/d.py", "class B:\n    @property\n    def size(self):\n        return 1\n", fake)
    assert [(s.name, s.kind) for s in find_symbol(conn, "size")] == [("size", "method")]


def test_unsupported_file_type(conn, fake):
    with pytest.raises(ValueError, match="unsupported file type"):
        index_code(conn, "pkg/a.rs", "fn main() {}", fake)


def test_line_numbers_past_line_256(conn, fake):
    src = "x = 1\n" * 300 + "def late():\n    return helper()\n"
    index_code(conn, "pkg/long.py", src, fake)
    late = find_symbol(conn, "late")[0]
    assert (late.start_line, late.end_line) == (301, 302)
    assert conn.execute('SELECT line FROM "references" WHERE to_name = ?', ("helper",)).fetchone()[0] == 302


def test_large_file_indexes(conn, fake):
    src = "".join(f"def f{i}():\n    return g{i}()\n\n" for i in range(800))
    index_code(conn, "pkg/big.py", src, fake)
    assert find_symbol(conn, "f799")[0].start_line == 2398


def chunks_containing(conn, needle):
    return conn.execute("SELECT heading, text FROM chunks WHERE instr(text, ?) > 0", (needle,)).fetchall()


def test_module_level_code_is_searchable(conn, fake):
    index_code(conn, "pkg/c.py", "CODE_CHUNK_TOKENS = 400\n\ndef f():\n    return 1\n", fake)
    assert len(chunks_containing(conn, "CODE_CHUNK_TOKENS = 400")) == 1


def test_script_without_functions_is_searchable(conn, fake):
    index_code(conn, "pkg/s.py", "print('hello script')\n", fake)
    assert len(chunks_containing(conn, "hello script")) == 1


def test_long_function_is_searchable_to_its_end(conn, fake):
    body = "".join(f"    value_{i} = {i}\n" for i in range(300)) + "    return unique_tail_marker\n"
    index_code(conn, "pkg/l.py", "def long():\n" + body, fake)
    tail = chunks_containing(conn, "unique_tail_marker")
    assert len(tail) == 1 and tail[0]["heading"] == "def long()"
    assert all(r[0] <= 400 for r in conn.execute("SELECT token_estimate FROM chunks"))


def test_class_chunk_is_an_outline_without_method_bodies(conn, fake):
    index_code(conn, "pkg/k.py", "class A:\n    '''Doc.'''\n    def m(self):\n        return BODY_MARKER\n", fake)
    assert [r["heading"] for r in chunks_containing(conn, "BODY_MARKER")] == ["def m(self)"]
    outline = conn.execute("SELECT text FROM chunks WHERE heading = 'class A'").fetchone()[0]
    assert "def m(self): ..." in outline and "Doc." in outline
