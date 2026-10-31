import pytest

from memory_engine.chunking import estimate_tokens
from memory_engine.codegraph import index_code
from memory_engine.embeddings import FakeEmbedder
from memory_engine.search import format_hit, fts_search, hybrid_search, rrf
from memory_engine.store import index_markdown


def seed(conn, fake):
    index_markdown(conn, "a.md", "# Krebs\nThe citric acid cycle runs in the mitochondrial matrix.", fake)
    index_markdown(conn, "b.md", "# Tax\nThe tax law of 1820 changed tariffs.", fake)
    index_code(conn, "c.py", "def parse_header(line):\n    return line.split(':')\n", fake)


def test_rrf_math():
    assert rrf([[1, 2], [1, 3]]) == [(1, 2 / 61), (2, 1 / 62), (3, 1 / 62)]


def test_keyword_hit(conn, fake):
    seed(conn, fake)
    assert hybrid_search(conn, "parse_header", fake)[0].path == "c.py"


def test_misspelled_query_found_by_vectors(conn, fake):
    seed(conn, fake)
    assert fts_search(conn, "mitokondrial matrx") == []
    assert hybrid_search(conn, "mitokondrial matrx", fake, limit=1)[0].path == "a.md"


def test_short_query_falls_back_to_vectors(conn, fake):
    seed(conn, fake)
    assert fts_search(conn, "ab") == []
    assert len(hybrid_search(conn, "ab", fake)) > 0


def test_regex_filter(conn, fake):
    seed(conn, fake)
    hits = hybrid_search(conn, "the", fake, regex=r"\b18\d\d\b")
    assert [h.path for h in hits] == ["b.md"]


def test_invalid_regex(conn, fake):
    seed(conn, fake)
    with pytest.raises(ValueError, match="invalid regex"):
        hybrid_search(conn, "the", fake, regex="(")


def test_token_budget(conn, fake):
    index_markdown(conn, "big.md", "# Big\n" + "matrix " * 3000, fake)
    hits = hybrid_search(conn, "matrix", fake, max_tokens=200)
    assert sum(estimate_tokens(h.text) for h in hits) <= 200


def test_empty_index(conn, fake):
    assert hybrid_search(conn, "anything", fake) == []


def test_token_budget_counts_path_and_heading(conn, fake):
    for i in range(6):
        index_code(conn, f"pkg/m{i}.py", f"def handler_{i}(request, response, session, retries: int = 3) -> None:\n"
                   + "    pass\n" * 60, fake)
    hits = hybrid_search(conn, "handler", fake, limit=6, max_tokens=300)
    assert hits and sum(estimate_tokens(format_hit(h)) for h in hits) <= 300


def test_oversized_first_hit_fits_with_its_heading(conn, fake):
    index_markdown(conn, "big.md", "# A heading that also takes up room\n" + "matrix " * 3000, fake)
    hits = hybrid_search(conn, "matrix", fake, max_tokens=200)
    assert len(hits) == 1 and estimate_tokens(format_hit(hits[0])) <= 200


def test_regex_finds_matches_outside_the_top_candidates(conn, fake):
    for i in range(60):
        index_markdown(conn, f"n{i}.md", f"# Note {i}\nThe cycle repeats, part {i}.", fake)
    index_markdown(conn, "law.md", "# Law\nTariff law of 1820.", fake)
    assert [h.path for h in hybrid_search(conn, "the cycle", fake, regex=r"\b18\d\d\b")] == ["law.md"]


def test_documents_and_queries_carry_nomic_task_prefixes(conn, settings):
    seen = []

    class Recording(FakeEmbedder):
        def embed(self, texts):
            seen.extend(texts)
            return super().embed(texts)

    index_markdown(conn, "a.md", "# Krebs\nCitrate.", Recording())
    hybrid_search(conn, "citrate", Recording())
    assert seen[0].startswith("search_document: ") and seen[-1] == "search_query: citrate"


def test_weights_scale_each_ranking():
    assert rrf([[1, 2], [2, 1]], weights=[2.0, 1.0])[0][0] == 1
    # The mirror: with weights ignored the tie keeps first-appearance order and 1 would still lead.
    assert rrf([[1, 2], [2, 1]], weights=[1.0, 2.0])[0][0] == 2


def test_keyword_search_ignores_stopwords(conn, fake):
    index_markdown(conn, "a.md", "the the the", fake)
    index_markdown(conn, "b.md", "matrix of cells", fake)
    second = conn.execute(
        "SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = 'b.md'"
    ).fetchone()[0]
    assert fts_search(conn, "the matrix") == [second]


def test_a_stopword_with_punctuation_is_still_a_stopword(conn, fake):
    index_markdown(conn, "a.md", "the, the, the,", fake)
    index_markdown(conn, "b.md", "matrix of cells", fake)
    second = conn.execute(
        "SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = 'b.md'"
    ).fetchone()[0]
    assert fts_search(conn, "The, matrix") == [second]


def test_a_query_of_only_stopwords_still_searches(conn, fake):
    index_markdown(conn, "a.md", "the the the", fake)
    index_markdown(conn, "b.md", "matrix of cells", fake)
    first = conn.execute(
        "SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.path = 'a.md'"
    ).fetchone()[0]
    assert fts_search(conn, "the the") == [first]
