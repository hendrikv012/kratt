"""Measure search: recall@k and MRR of the keyword, meaning and merged rankings on a folder of notes."""

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from memory_engine.config import Settings
from memory_engine.db import connect, init_schema
from memory_engine.embeddings import Embedder
from memory_engine.reindex import reindex_folder
from memory_engine.search import fts_search, hybrid_search, vector_search

RANKINGS = ("keyword", "meaning", "merged")


@dataclass(frozen=True)
class Relevant:
    path: str  # relative to the corpus folder
    heading: str | None = None  # when set, the hit's heading must contain it


@dataclass(frozen=True)
class EvalQuery:
    query: str
    relevant: tuple[Relevant, ...]
    line: int = 0  # its line in the queries file, for error messages


@dataclass(frozen=True)
class Metrics:
    recall: float  # share of the relevant entries found in the top k, averaged over the queries
    mrr: float  # 1 / rank of the first relevant hit in the top k (0 if none), averaged over the queries
    queries: int


Ranked = Callable[[str], list[tuple[str, str | None]]]  # query -> (path, heading) per hit, best first


def _relevant_from(data, line: int) -> Relevant:
    if not isinstance(data, dict) or not isinstance(data.get("path"), str) or not data["path"]:
        raise ValueError(f'line {line}: each "relevant" entry needs a "path"')
    heading = data.get("heading")
    if heading is not None and not isinstance(heading, str):
        raise ValueError(f'line {line}: "heading" must be text')
    return Relevant(data["path"], heading)


def load_queries(path: Path) -> list[EvalQuery]:
    """Read a JSON Lines file: {"query": "...", "relevant": [{"path": "A/B.md", "heading": "Part"}]} per line."""
    queries: list[EvalQuery] = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError as err:
            raise ValueError(f"line {number}: not valid JSON ({err.msg})") from err
        if not isinstance(data, dict) or not isinstance(data.get("query"), str) or not data["query"].strip():
            raise ValueError(f'line {number}: needs a "query"')
        relevant = data.get("relevant")
        if not isinstance(relevant, list) or not relevant:
            raise ValueError(f'line {number}: needs a non-empty "relevant" list')
        queries.append(EvalQuery(data["query"], tuple(_relevant_from(item, number) for item in relevant), number))
    if not queries:
        raise ValueError(f"{path} has no queries")
    return queries


def _matches(relevant: Relevant, path: str, heading: str | None) -> bool:
    return relevant.path == path and (relevant.heading is None or relevant.heading in (heading or ""))


def score(queries: list[EvalQuery], ranked: Ranked, k: int = 5) -> Metrics:
    recall = mrr = 0.0
    for query in queries:
        hits = ranked(query.query)[:k]
        found = sum(any(_matches(r, *hit) for hit in hits) for r in query.relevant)
        recall += found / len(query.relevant)
        mrr += next((1 / rank for rank, hit in enumerate(hits, start=1)
                     if any(_matches(r, *hit) for r in query.relevant)), 0.0)
    if not queries:
        return Metrics(0.0, 0.0, 0)
    return Metrics(recall / len(queries), mrr / len(queries), len(queries))


def evaluate(queries: list[EvalQuery], corpus: Path, embedder: Embedder, chunk_tokens: int,
             k: int = 5, keyword_weight: float = 1.0, meaning_weight: float = 1.0) -> dict[str, Metrics]:
    """Index `corpus` in a throwaway database and score each ranking; the folder itself is not touched."""
    with tempfile.TemporaryDirectory() as scratch:
        settings = Settings(db_path=Path(scratch) / "memory.db", embed_dims=embedder.dims)
        conn = connect(settings)
        try:
            init_schema(conn, settings)
            reindex_folder(conn, Path(corpus), embedder, chunk_tokens=chunk_tokens)
            indexed = {row[0] for row in conn.execute("SELECT path FROM documents")}
            for query in queries:
                for relevant in query.relevant:
                    if relevant.path not in indexed:
                        raise ValueError(f"line {query.line}: {relevant.path} isn't in the corpus")

            def located(ids: list[int]) -> list[tuple[str, str | None]]:
                rows = {row["id"]: (row["path"], row["heading"]) for row in conn.execute(
                    "SELECT c.id, d.path, c.heading FROM chunks c JOIN documents d ON d.id = c.document_id"
                    f" WHERE c.id IN ({','.join('?' * len(ids))})", ids)}
                return [rows[i] for i in ids if i in rows]

            rankers: dict[str, Ranked] = {
                "keyword": lambda q: located(fts_search(conn, q, k * 4)),
                "meaning": lambda q: located(vector_search(conn, q, embedder, k * 4)),
                "merged": lambda q: [(hit.path, hit.heading) for hit in hybrid_search(
                    conn, q, embedder, limit=k, keyword_weight=keyword_weight, meaning_weight=meaning_weight)],
            }
            return {name: score(queries, ranker, k) for name, ranker in rankers.items()}
        finally:
            conn.close()
