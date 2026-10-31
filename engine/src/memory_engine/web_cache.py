"""Cache fetched pages as Markdown, keyed by a normalized URL hash, so nothing is downloaded twice."""

import hashlib
import sqlite3
from urllib.parse import urlsplit, urlunsplit

from memory_engine.store import now_iso


def url_hash(url: str) -> str:
    """sha256 of the URL with scheme and host lowercased, no fragment and no trailing slash."""
    parts = urlsplit(url.strip())
    path = parts.path.removesuffix("/")
    normalized = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))
    return hashlib.sha256(normalized.encode()).hexdigest()


def cache_get(conn: sqlite3.Connection, url: str) -> str | None:
    row = conn.execute("SELECT markdown FROM web_cache WHERE url_hash = ?", (url_hash(url),)).fetchone()
    return row[0] if row is not None else None


def cache_put(conn: sqlite3.Connection, url: str, markdown: str) -> None:
    with conn:
        conn.execute(
            "INSERT INTO web_cache(url_hash, url, markdown, fetched_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(url_hash) DO UPDATE SET url = excluded.url, markdown = excluded.markdown,"
            " fetched_at = excluded.fetched_at",
            (url_hash(url), url, markdown, now_iso()),
        )
