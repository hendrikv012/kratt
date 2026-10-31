"""Open the SQLite database and create the schema."""

import sqlite3
from importlib import resources
from pathlib import Path
from urllib.parse import quote

import sqlite_vec

from memory_engine.config import Settings

# Bump when the text sent to the embedder changes (for example task prefixes), so old vectors get rebuilt.
EMBEDDING_FORMAT = 2


def connect(settings: Settings) -> sqlite3.Connection:
    """Open the database in WAL mode with mmap on and the sqlite-vec extension loaded.

    The database's folder is created if needed; a ValueError says when the file can't be opened.
    """
    path = Path(settings.db_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
    except (OSError, sqlite3.Error) as err:
        raise ValueError(f"{path} could not be opened: {err}") from err
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(f"PRAGMA mmap_size={int(settings.mmap_size)}")
    conn.enable_load_extension(True)
    try:
        sqlite_vec.load(conn)
    finally:
        conn.enable_load_extension(False)
    return conn


def connect_readonly(path: Path, settings: Settings) -> sqlite3.Connection:
    """Open an existing index so that nothing can be written to it, and no file appears beside it.

    An index at rest holds everything in its main file, so it is opened immutable: SQLite then
    creates no -shm or -wal file and works from a read-only folder. A -wal file means a reindex
    is running (or crashed), whose newest rows live there; the index is then opened plainly
    read-only so those rows are seen, and if that cannot be done the index is busy.
    """
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"no index at {path}")
    busy = path.with_name(path.name + "-wal").exists()
    conn = sqlite3.connect(f"file:{quote(str(path))}?mode=ro" + ("" if busy else "&immutable=1"), uri=True)
    conn.row_factory = sqlite3.Row
    try:
        conn.enable_load_extension(True)
        try:
            sqlite_vec.load(conn)
        finally:
            conn.enable_load_extension(False)
    except sqlite3.Error as err:
        conn.close()
        raise ValueError(f"sqlite-vec could not be loaded to read {path}: {err}") from err
    try:
        conn.execute(f"PRAGMA mmap_size={int(settings.mmap_size)}")
        if busy:
            conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchall()
    except sqlite3.OperationalError as err:
        conn.close()
        raise ValueError(f"{path} is being written by another process; try again when its reindex finishes") from err
    except sqlite3.DatabaseError as err:
        conn.close()
        raise ValueError(f"{path} is not a memory-engine index: {err}") from err
    return conn


def _create_vector_table(conn: sqlite3.Connection, settings: Settings) -> None:
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0("
        f"chunk_id INTEGER PRIMARY KEY, embedding int8[{int(settings.embed_dims)}] distance_metric=cosine)"
    )


def init_schema(conn: sqlite3.Connection, settings: Settings) -> None:
    """Create every table, index and trigger. Safe to run more than once."""
    conn.executescript(resources.files("memory_engine").joinpath("schema.sql").read_text())
    with conn:
        _create_vector_table(conn, settings)
        conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('embedding', ?)", (embedding_signature(settings),))


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row is not None else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def embedding_signature(settings: Settings) -> str:
    return (f"{settings.embed_model}, {settings.embed_dims} dimensions, input format {EMBEDDING_FORMAT}, "
            f"chunks {settings.chunk_tokens} tokens")


def check_embedding(conn: sqlite3.Connection, settings: Settings, rebuild: bool = False) -> bool:
    """Make sure stored vectors came from the current embedding settings.

    Vectors from another model, size or input format can't be compared with new ones. With
    rebuild=True every document is dropped so the next reindex embeds it again (the web cache
    and learned repairs are kept); otherwise a mismatch raises ValueError. Returns True if it rebuilt.
    """
    stored, current = get_meta(conn, "embedding"), embedding_signature(settings)
    if stored == current:
        return False
    if not rebuild:
        raise ValueError(f"this index was built with {stored}, but the settings use {current}; run reindex to rebuild it")
    with conn:
        conn.execute("DELETE FROM documents")
        conn.execute("DROP TABLE chunks_vec")
        _create_vector_table(conn, settings)
        set_meta(conn, "embedding", current)
    return True
