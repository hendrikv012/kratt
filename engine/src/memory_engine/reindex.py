"""Keep the index in step with a folder of Markdown and Python files (the files are the truth)."""

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from memory_engine.chunking import CHUNK_TOKENS
from memory_engine.codegraph import index_code
from memory_engine.db import get_meta, set_meta
from memory_engine.embeddings import Embedder, EmbeddingError
from memory_engine.store import content_hash, index_markdown, remove_document

INDEXERS = {".md": index_markdown, ".py": index_code}
SKIPPED_DIRS = {".venv", ".git", "__pycache__"}
SKIPPED_FILES = {"INDEX.md", "SCRATCHPAD.md"}  # the router's working files, never searched


@dataclass(frozen=True)
class ReindexReport:
    indexed: int
    unchanged: int
    removed: int
    failed: tuple[tuple[str, str], ...] = ()  # (path, reason); these files keep their previous index


def _database_inside(conn: sqlite3.Connection, root: Path) -> bool:
    database = conn.execute("PRAGMA database_list").fetchone()[2]
    return bool(database) and Path(database).resolve().is_relative_to(root.resolve())


def _files(root: Path):
    for folder, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIPPED_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if Path(folder) == root and name in SKIPPED_FILES:
                continue
            if Path(name).suffix in INDEXERS:
                yield Path(folder) / name


def reindex_folder(conn: sqlite3.Connection, root: Path, embedder: Embedder, chunk_tokens: int = CHUNK_TOKENS) -> ReindexReport:
    """Index new and changed files, and drop documents whose files are gone.

    A file that fails to embed is reported and skipped, so one bad file never blocks the rest.
    `chunk_tokens` is the largest Markdown chunk; code files are split by the code graph instead.
    """
    root = Path(root)
    if not root.is_dir():
        # A wrong path would otherwise look like an empty folder and remove every document.
        raise ValueError(f"not a folder: {root}")
    # Paths are stored relative to the folder, so one index can only mirror one folder.
    folder, owner = str(root.resolve()), get_meta(conn, "root")
    if owner is not None and owner != folder and _database_inside(conn, root):
        owner = None  # the folder was moved or renamed together with its index; paths are relative
    if owner is not None and owner != folder:
        raise ValueError(f"this index belongs to {owner}; use another --db file for {folder}")
    if owner != folder:
        with conn:
            set_meta(conn, "root", folder)
    known = {row[0]: row[1] for row in conn.execute("SELECT path, content_hash FROM documents")}
    seen: set[str] = set()
    indexed = unchanged = 0
    failed: list[tuple[str, str]] = []
    for file in _files(root):
        path = file.relative_to(root).as_posix()
        seen.add(path)
        try:
            text = file.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if known.get(path) == content_hash(text):
            unchanged += 1
            continue
        options = {"chunk_tokens": chunk_tokens} if file.suffix == ".md" else {}
        try:
            INDEXERS[file.suffix](conn, path, text, embedder, **options)
        except EmbeddingError as err:
            failed.append((path, str(err)))
            continue
        indexed += 1
    removed = sum(remove_document(conn, path) for path in known.keys() - seen)
    return ReindexReport(indexed, unchanged, removed, tuple(failed))
