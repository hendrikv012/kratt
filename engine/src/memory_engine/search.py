"""Hybrid search: FTS5 keyword ranks and sqlite-vec meaning ranks fused with Reciprocal Rank Fusion."""

import json
import re
import sqlite3
import string
from dataclasses import dataclass, replace
from pathlib import Path

from memory_engine.chunking import estimate_tokens, truncate_to_tokens
from memory_engine.config import Settings
from memory_engine.db import check_embedding, connect_readonly, get_meta
from memory_engine.embeddings import Embedder, normalize

# Common English words that carry no topic; counting them as shared would flatter any overlap.
STOPWORDS = frozenset("""
a about after all also an and any are as at be been but by can could did do does for from had has have her him his
how if in into is it its more most not of on one or our she should some than that the their them then there these
they this those to was we were what when where which who will with would you your
""".split())


# nomic-embed-text is trained with a task prefix; documents get theirs in store.py.
QUERY_PREFIX = "search_query: "


@dataclass(frozen=True)
class SearchHit:
    chunk_id: int
    path: str
    heading: str | None
    text: str
    score: float
    source: str | None = None  # the label of the source index it came from; None for the workspace


def format_hit(hit: SearchHit) -> str:
    """How a hit is shown to a person or put into the model's context."""
    title = f"{hit.path} — {hit.heading}" if hit.heading else hit.path
    label = f"[{hit.source}] " if hit.source else ""
    return f"{label}{title}\n{hit.text}"


def fts_search(conn: sqlite3.Connection, query: str, limit: int = 20) -> list[int]:
    """Chunk ids by bm25. Trigram FTS needs 3+ characters, so shorter words are dropped.

    Stopwords are dropped too (punctuation around a word doesn't hide one), unless the query is nothing but stopwords.
    """
    words = [w for w in query.split() if len(w) >= 3]
    words = [w for w in words if w.lower().strip(string.punctuation) not in STOPWORDS] or words
    if not words:
        return []
    expression = " OR ".join('"' + w.replace('"', '""') + '"' for w in words)
    return [row[0] for row in conn.execute(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?",
        (expression, limit),
    )]


def vector_search(conn: sqlite3.Connection, query: str, embedder: Embedder, limit: int = 20) -> list[int]:
    vector = normalize(embedder.embed([QUERY_PREFIX + query])[0])
    return [row[0] for row in conn.execute(
        "SELECT chunk_id FROM chunks_vec WHERE embedding MATCH vec_quantize_int8(?, 'unit') AND k = ?"
        " ORDER BY distance",
        (json.dumps(vector), limit),
    )]


def rrf(rankings: list[list[int]], k: int = 60, weights: list[float] | None = None) -> list[tuple[int, float]]:
    """score = sum of weight / (k + rank) over the rankings, ranks starting at 1; a weight defaults to 1.0."""
    scores: dict[int, float] = {}
    for index, ranking in enumerate(rankings):
        weight = weights[index] if weights is not None else 1.0
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + weight / (k + rank)
    # sorted() is stable and dicts keep insertion order, so ties stay in first-appearance order.
    return sorted(scores.items(), key=lambda pair: -pair[1])


def hybrid_search(
    conn: sqlite3.Connection,
    query: str,
    embedder: Embedder,
    limit: int = 5,
    max_tokens: int = 1800,
    regex: str | None = None,
    keyword_weight: float = 1.0,
    meaning_weight: float = 1.0,
) -> list[SearchHit]:
    """Best chunks for `query`, packed so that format_hit() of all hits stays within `max_tokens`."""
    try:
        pattern = re.compile(regex) if regex is not None else None
    except re.error as err:
        raise ValueError(f"invalid regex: {err}") from err

    weights = [keyword_weight, meaning_weight]
    rankings = [fts_search(conn, query, limit * 4), vector_search(conn, query, embedder, limit * 4)]
    if pattern is not None:
        # FTS5 can't run a regex, and a match may rank below both top lists, so scan for matches
        # too; ones the rankers also found still come first.
        conn.create_function("matches_search_regex", 1, lambda text: pattern.search(text) is not None)
        rankings.append([row[0] for row in conn.execute(
            "SELECT id FROM chunks WHERE matches_search_regex(text) ORDER BY id LIMIT ?", (limit * 4,)
        )])
        weights.append(1.0)
    fused = rrf(rankings, weights=weights)
    if not fused:
        return []
    ids = [chunk_id for chunk_id, _ in fused]
    rows = {row["id"]: row for row in conn.execute(
        "SELECT c.id, d.path, c.heading, c.text FROM chunks c JOIN documents d ON d.id = c.document_id"
        f" WHERE c.id IN ({','.join('?' * len(ids))})",
        ids,
    )}

    candidates: list[SearchHit] = []
    for chunk_id, score in fused:
        row = rows.get(chunk_id)
        if row is None or (pattern is not None and not pattern.search(row["text"])):
            continue
        candidates.append(SearchHit(chunk_id, row["path"], row["heading"], row["text"], score))
    return _pack(candidates, limit, max_tokens)


def _pack(hits: list[SearchHit], limit: int, max_tokens: int) -> list[SearchHit]:
    """The best hits that fit: at most `limit`, with format_hit() of all of them within `max_tokens`."""
    packed: list[SearchHit] = []
    used = 0
    for hit in hits:
        tokens = estimate_tokens(format_hit(hit))
        if not packed and tokens > max_tokens:
            # Cut an oversized best hit so it still fits, title included.
            room = max_tokens - estimate_tokens(format_hit(replace(hit, text="")))
            if room > 0:
                packed.append(replace(hit, text=truncate_to_tokens(hit.text, room)))
            break
        if used + tokens > max_tokens:
            break
        packed.append(hit)
        used += tokens
        if len(packed) == limit:
            break
    return packed


def _stamp(path: Path) -> tuple[int, int, int] | None:
    """What changes when a file is rewritten in place or replaced: inode, size and modification time."""
    try:
        info = path.stat()
    except OSError:
        return None
    return info.st_ino, info.st_size, info.st_mtime_ns


@dataclass
class Source:
    """An index of the person's own notes that a run reads from and never writes to.

    It is opened immutable, which is only safe while nobody rewrites it, so `path`, `settings` and
    `stamp` let a search notice a reindex and open it again.
    """
    label: str
    conn: sqlite3.Connection
    path: Path | None = None
    settings: Settings | None = None
    stamp: tuple[int, int, int] | None = None


def _open_source(path: Path, settings: Settings, label: str | None, number: int) -> Source:
    stamp = _stamp(Path(path))
    conn = connect_readonly(path, settings)
    try:
        check_embedding(conn, settings)
        root = get_meta(conn, "root")
    except ValueError as err:
        conn.close()
        raise ValueError(f"{path} was built with other settings; run memory-engine reindex on its folder") from err
    except sqlite3.Error as err:
        conn.close()
        raise ValueError(f"{path} is not a memory-engine index: {err}") from err
    if label is None:
        label = Path(root).name if root else f"source {number}"
    return Source(label, conn, Path(path), settings, stamp)


def open_sources(paths: list[Path], settings: Settings) -> list[Source]:
    """Open each index read-only, labelled by the last part of the folder it was built from."""
    sources: list[Source] = []
    try:
        for number, path in enumerate(paths, start=1):
            sources.append(_open_source(path, settings, None, number))
    except ValueError:
        for source in sources:
            source.conn.close()
        raise
    return sources


def _refresh(source: Source) -> None:
    """Open the source again if its file changed since it was opened (a reindex ran)."""
    if source.path is None or source.settings is None or _stamp(source.path) == source.stamp:
        return
    source.conn.close()
    fresh = _open_source(source.path, source.settings, source.label, 0)
    source.conn, source.stamp = fresh.conn, fresh.stamp


def _search_source(source: Source, query: str, embedder: Embedder, limit: int, max_tokens: int) -> list[SearchHit]:
    try:
        _refresh(source)
        hits = hybrid_search(source.conn, query, embedder, limit=limit, max_tokens=max_tokens)
    except sqlite3.DatabaseError as err:
        name = source.path or source.label
        raise ValueError(f"{name} could not be read ({err}); if its folder is being reindexed, "
                         "run again when that finishes") from err
    return [replace(hit, source=source.label) for hit in hits]


def search_sources(
    workspace_conn: sqlite3.Connection,
    sources: list[Source],
    query: str,
    embedder: Embedder,
    limit: int = 5,
    max_tokens: int = 1800,
) -> list[SearchHit]:
    """Search the workspace and every source, then merge the lists by rank into one packed list."""
    own = hybrid_search(workspace_conn, query, embedder, limit=limit, max_tokens=max_tokens)
    if not sources:
        return own
    lists = [own] + [_search_source(source, query, embedder, limit, max_tokens) for source in sources]
    # Chunk ids repeat from one index to the next, so a hit is keyed by its index's position too.
    by_key = {(position, hit.chunk_id): hit for position, hits in enumerate(lists) for hit in hits}
    rankings = [[(position, hit.chunk_id) for hit in hits] for position, hits in enumerate(lists)]
    fused = [replace(by_key[key], score=score) for key, score in rrf(rankings)]
    return _pack(fused, limit, max_tokens)
