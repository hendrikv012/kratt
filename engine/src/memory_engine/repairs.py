"""Remember which fix solved which error, and find past fixes for a new error."""

import re
import sqlite3
from dataclasses import dataclass

from memory_engine.store import now_iso

WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")
MAX_WORDS = 32
TRACE_PATH = re.compile(r'File "[^"]*"')
BOILERPLATE = {"traceback", "most", "recent", "call", "last", "file", "line", "module"}


@dataclass(frozen=True)
class Repair:
    id: int
    kind: str
    error_trace: str
    fix_diff: str
    file_path: str | None
    times_used: int


def record_repair(
    conn: sqlite3.Connection, kind: str, error_trace: str, fix_diff: str, file_path: str | None = None
) -> int:
    with conn:
        cursor = conn.execute(
            "INSERT INTO learned_repairs(kind, error_trace, fix_diff, file_path, created_at) VALUES (?, ?, ?, ?, ?)",
            (kind, error_trace, fix_diff, file_path, now_iso()),
        )
    return cursor.lastrowid


def _words(text: str) -> list[str]:
    """Distinctive words, without file paths or traceback boilerplate."""
    return [w for w in WORD.findall(TRACE_PATH.sub(" ", text)) if w.lower() not in BOILERPLATE]


def _search(conn: sqlite3.Connection, words: list[str], limit: int) -> list[Repair]:
    words = list(dict.fromkeys(words))[:MAX_WORDS]
    if not words:
        return []
    expression = " OR ".join(f'"{w}"' for w in words)
    return [Repair(*row) for row in conn.execute(
        "SELECT r.id, r.kind, r.error_trace, r.fix_diff, r.file_path, r.times_used"
        " FROM learned_repairs_fts JOIN learned_repairs r ON r.id = learned_repairs_fts.rowid"
        " WHERE learned_repairs_fts MATCH ? ORDER BY bm25(learned_repairs_fts) LIMIT ?",
        (expression, limit),
    )]


def find_repairs(conn: sqlite3.Connection, error_trace: str, limit: int = 3) -> list[Repair]:
    """Past repairs for this error: ones matching its last line (the error itself) first,
    then ones sharing the most words with the rest of the trace, read from the end."""
    lines = [line for line in error_trace.splitlines() if line.strip()]
    if not lines:
        return []
    found: dict[int, Repair] = {}
    for words in (_words(lines[-1]), [w for line in reversed(lines) for w in _words(line)]):
        for repair in _search(conn, words, limit):
            found.setdefault(repair.id, repair)
    return list(found.values())[:limit]


def mark_used(conn: sqlite3.Connection, repair_id: int) -> None:
    with conn:
        conn.execute("UPDATE learned_repairs SET times_used = times_used + 1 WHERE id = ?", (repair_id,))
