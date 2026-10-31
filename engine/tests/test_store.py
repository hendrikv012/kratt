import pytest

from memory_engine.embeddings import FakeEmbedder
from memory_engine.store import index_markdown, remove_document

DOC = "# Krebs cycle\nRuns in the mitochondrial matrix.\n# Glycolysis\nSplits glucose in the cytoplasm."


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        super().__init__(dims=768)
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        return super().embed(texts)


@pytest.fixture
def counting():
    return CountingEmbedder()


def counts(conn):
    return tuple(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("chunks", "chunks_vec"))


def test_index_creates_chunks_fts_and_vectors(conn, fake):
    index_markdown(conn, "notes/bio.md", DOC, fake)
    assert counts(conn) == (2, 2)
    hit = conn.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH '\"mitochondri\"'").fetchall()
    assert len(hit) == 1


def test_unchanged_file_is_not_reembedded(conn, counting):
    index_markdown(conn, "notes/bio.md", DOC, counting)
    index_markdown(conn, "notes/bio.md", DOC, counting)
    assert counting.calls == 1


def test_changed_file_leaves_nothing_stale(conn, fake):
    index_markdown(conn, "notes/bio.md", DOC, fake)
    index_markdown(conn, "notes/bio.md", "# Only\nPhotosynthesis.", fake)
    assert counts(conn) == (1, 1)
    assert conn.execute("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH '\"mitochondri\"'").fetchone()[0] == 0


def test_remove_document_removes_vectors_too(conn, fake):
    index_markdown(conn, "notes/bio.md", DOC, fake)
    assert remove_document(conn, "notes/bio.md") is True
    assert counts(conn) == (0, 0)
    assert remove_document(conn, "notes/bio.md") is False
