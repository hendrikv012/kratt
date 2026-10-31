from pathlib import Path

import pytest

from memory_engine.__main__ import main
from memory_engine.embeddings import FakeEmbedder
from memory_engine.evals import (
    EvalQuery,
    Metrics,
    Relevant,
    evaluate,
    load_queries,
    score,
)

FIXTURE = Path(__file__).resolve().parent.parent / "evals" / "fixture"


def test_a_hit_counts_by_path_and_heading():
    queries = [EvalQuery("krebs", (Relevant("Biology/Krebs.md", "Staging"),))]
    metrics = score(queries, lambda q: [("Biology/Other.md", None), ("Biology/Krebs.md", "Krebs › Staging")])
    assert metrics.recall == 1.0 and metrics.mrr == 0.5 and metrics.queries == 1


def test_a_miss_scores_zero():
    queries = [EvalQuery("x", (Relevant("A.md", None),))]
    assert score(queries, lambda q: [("B.md", None)]) == Metrics(0.0, 0.0, 1)


def test_bad_lines_name_their_line(tmp_path):
    (tmp_path / "q.jsonl").write_text('{"query": "a", "relevant": [{"path": "A.md"}]}\nnot json\n')
    with pytest.raises(ValueError, match="line 2"):
        load_queries(tmp_path / "q.jsonl")


def test_eval_search_runs_on_the_fixture(capsys):
    assert main(["eval-search", str(FIXTURE / "../fixture.jsonl"), "--corpus", str(FIXTURE)], embedder=FakeEmbedder()) == 0
    lines = capsys.readouterr().out.splitlines()
    assert [line.split()[0] for line in lines[:3]] == ["keyword", "meaning", "merged"]
    assert all(0.0 <= float(value) <= 1.0 for line in lines[:3] for value in line.split()[2::2])


def test_every_fixture_query_names_a_real_note():
    queries = load_queries(FIXTURE.parent / "fixture.jsonl")
    assert len(queries) >= 10
    for query in queries:
        for relevant in query.relevant:
            note = FIXTURE / relevant.path
            assert note.is_file(), relevant.path
            if relevant.heading:
                assert relevant.heading in note.read_text(), (relevant.path, relevant.heading)


def test_a_relevant_note_missing_from_the_corpus_names_its_line(tmp_path):
    corpus = tmp_path / "notes"
    corpus.mkdir()
    (corpus / "A.md").write_text("# A\nCitric acid.\n", encoding="utf-8")
    (tmp_path / "q.jsonl").write_text('{"query": "citric", "relevant": [{"path": "A.md"}]}\n'
                                      '{"query": "krebs", "relevant": [{"path": "Biology/Krebs.md"}]}\n')
    with pytest.raises(ValueError, match="line 2: Biology/Krebs.md isn't in the corpus"):
        evaluate(load_queries(tmp_path / "q.jsonl"), corpus, FakeEmbedder(), 200)


def test_an_empty_queries_file_is_an_error(tmp_path, capsys):
    (tmp_path / "q.jsonl").write_text("\n\n", encoding="utf-8")
    assert main(["eval-search", str(tmp_path / "q.jsonl"), "--corpus", str(FIXTURE)], embedder=FakeEmbedder()) == 1
    assert "has no queries" in capsys.readouterr().err
