import http.client
import json
import re
import shutil
from pathlib import Path

import pytest

from memory_engine.__main__ import main
from memory_engine.chat import ChatError, ScriptedModel
from memory_engine.embeddings import EmbeddingError, FakeEmbedder
from memory_engine.index_file import Index, Step
from memory_engine.router import RunReport
from memory_engine.smoke import (
    DEFAULT_GOALS,
    RunStats,
    load_goals,
    model_available,
    smoke,
    summarize,
)


def work(**fields):
    reply = {"scratchpad": "", "search": "", "chunk_title": "", "chunk_body": "", "step_done": False}
    return reply | fields


def finished_run(title="Krebs"):
    """The replies of a run with one step that finishes at once."""
    return [{"steps": ["Write the note"]}, work(chunk_title=title, chunk_body="Citrate is made first.", step_done=True)]


def model_line(step, reply=None):
    return {"event": "model", "step": step, "messages": [], "reply": reply if reply is not None else work()}


def test_summary_counts_turns_checks_stuck_and_grounding():
    index = Index(goal="G", status="stuck", steps=(Step("First", "done"), Step("Second", "stuck")),
                  contents=(), extra="")
    body = work(chunk_title="T", chunk_body="Citrate with oxaloacetate in the mitochondria and pyruvate.")
    lines = [
        model_line(None, {"steps": ["First", "Second"]}),  # the plan is not a step turn
        {"event": "search", "step": 0, "query": "q", "hits": [
            {"source": "Study", "path": "a.md", "heading": None, "text": "Citrate and the Mitochondria work together."},
            {"source": "Study", "path": "b.md", "heading": None, "text": "Unrelated words, such as zebra."}]},
        model_line(0), model_line(0, body),
        model_line(1), model_line(1), model_line(1), model_line(1, "the reply was not valid JSON: x"),
        {"event": "doctor", "target": "notes/a.md", "ok": True, "fixes": 0, "message": ""},
        {"event": "doctor", "target": "notes/b.md", "ok": False, "fixes": 3, "message": "still broken"},
    ]
    stats = summarize(lines, index, RunReport("stuck", 1, 7, stuck_step="Second"))
    # 6 step turns over 2 steps; 1 of 2 checks passed; 1 of 2 steps stuck; the body has 4 content words
    # (citrate, oxaloacetate, mitochondria, pyruvate) and the hits hold 2 of them.
    assert stats == RunStats(status="stuck", steps_done=1, steps_total=2, turns_per_step=3.0, doctor_pass_rate=0.5,
                             doctor_blocked=0, stuck_share=0.5, grounding=0.5)


def test_summary_of_an_empty_log_has_no_rates():
    index = Index(goal="G", status="planning", steps=(), contents=(), extra="")
    assert summarize([], index, RunReport("paused", 0, 0)) == RunStats("paused", 0, 0, 0.0, None, 0, None, None)


def test_a_plan_that_never_succeeds_shows_as_stuck():
    index = Index(goal="G", status="stuck", steps=(), contents=(), extra="")
    lines = [model_line(None, "the plan had no steps")] * 8
    stats = summarize(lines, index, RunReport("stuck", 0, 8, stuck_step="plan", reason="the plan had no steps"))
    assert stats.status == "stuck" and (stats.steps_done, stats.steps_total) == (0, 0)
    assert stats.stuck_share is None  # not "0% stuck"


def test_paused_and_blocked_runs_are_told_apart():
    index = Index(goal="G", status="working", steps=(Step("First", "todo"),), contents=(), extra="")
    assert summarize([], index, RunReport("paused", 0, 40)).status == "paused"
    assert summarize([], index, RunReport("blocked", 0, 1, stuck_step="First")).status == "blocked"


def test_blocked_doctor_results_are_not_failed_checks():
    index = Index(goal="G", status="blocked", steps=(Step("First", "todo"),), contents=(), extra="")
    lines = [{"event": "doctor", "target": "a.md", "ok": True, "fixes": 0, "message": "", "blocked": False},
             {"event": "doctor", "target": "src/a.py", "ok": False, "fixes": 0, "blocked": True,
              "message": "bubblewrap (bwrap) is not installed"}]
    stats = summarize(lines, index, RunReport("blocked", 0, 1, stuck_step="First"))
    assert stats.doctor_pass_rate == 1.0 and stats.doctor_blocked == 1


def test_smoke_runs_each_goal_and_cleans_up(tmp_path, fake):
    base = tmp_path / "base"
    base.mkdir()
    models = [ScriptedModel(finished_run()), ScriptedModel(finished_run("Second"))]
    rows = smoke([("notes", "First goal"), ("notes", "Second goal")], base, fake, lambda: models.pop(0), keep=False)
    assert [goal for goal, _ in rows] == ["First goal", "Second goal"]
    assert all(isinstance(stats, RunStats) and stats.turns_per_step == 1.0 for _, stats in rows)
    assert list(base.iterdir()) == []


def test_smoke_keeps_the_workspaces_on_request(tmp_path, fake):
    rows = smoke([("notes", "Goal")], tmp_path, fake, lambda: ScriptedModel(finished_run()), keep=True)
    assert len(rows) == 1
    (workspace,) = tmp_path.iterdir()
    assert (workspace / "run.jsonl").exists() and (workspace / "INDEX.md").exists()


def test_smoke_cleans_up_when_a_run_fails(tmp_path, fake):
    with pytest.raises(RuntimeError):
        smoke([("notes", "Goal")], tmp_path, fake, lambda: ScriptedModel([]), keep=False)
    assert list(tmp_path.iterdir()) == []


def test_an_interrupted_smoke_returns_the_finished_goals(tmp_path, fake):
    models = [ScriptedModel(finished_run()), None]

    def factory():
        model = models.pop(0)
        if model is None:
            raise KeyboardInterrupt
        return model

    rows = smoke([("notes", "One"), ("notes", "Two")], tmp_path, fake, factory, keep=False)
    assert [goal for goal, _ in rows] == ["One"]
    assert list(tmp_path.iterdir()) == []


def test_an_interrupted_smoke_keeps_the_finished_summary(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "One"}\n{"kind": "notes", "goal": "Two"}\n', encoding="utf-8")
    model = ScriptedModel([*finished_run(), KeyboardInterrupt()])
    assert main(["smoke", "--goals", str(goals)], embedder=FakeEmbedder(), model=model) == 130
    (written,) = tmp_path.glob("smoke-*.json")
    saved = json.loads(written.read_text(encoding="utf-8"))
    assert [row["goal"] for row in saved["results"]] == ["One"]
    assert saved["results"][0]["turns_per_step"] == 1.0
    out = capsys.readouterr().out
    assert "One" in out and "grounding counts shared words: compare runs with each other, not with a fixed bar" in out


def test_the_cli_prints_a_row_per_goal_and_writes_the_summary(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "One"}\n\n{"kind": "slides", "goal": "Two"}\n', encoding="utf-8")
    slide = [{"steps": ["Slide one"]}, work(chunk_title="Slide", chunk_body="# Slide\nCitrate.", step_done=True)]
    model = ScriptedModel([*finished_run(), *slide])
    assert main(["smoke", "--goals", str(goals)], embedder=FakeEmbedder(), model=model) == 0
    out = capsys.readouterr().out
    assert "One" in out and "Two" in out
    assert out.count("done  steps 1/1") == 2
    (written,) = tmp_path.glob("smoke-*.json")
    assert len(json.loads(written.read_text(encoding="utf-8"))["results"]) == 2


def test_smoke_without_the_model_says_how_to_get_it(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("memory_engine.__main__.model_available", lambda url, model: False)
    assert main(["smoke"], embedder=FakeEmbedder()) == 1
    assert "error: qwen3:8b isn't available in Ollama (ollama pull qwen3:8b)" in capsys.readouterr().err
    assert list(tmp_path.glob("smoke-*.json")) == []


def test_model_available_reads_the_tag_list():
    tags = {"models": [{"name": "nomic-embed-text:latest", "model": "nomic-embed-text:latest"},
                       {"name": "qwen3:8b", "model": "qwen3:8b"}]}
    assert model_available("http://x", "qwen3:8b", fetch=lambda url: tags) is True
    assert model_available("http://x", "nomic-embed-text", fetch=lambda url: tags) is True
    assert model_available("http://x", "qwen3:14b", fetch=lambda url: tags) is False


def test_model_available_is_false_when_ollama_cannot_be_asked():
    def down(url):
        raise OSError("connection refused")

    assert model_available("http://x", "qwen3:8b", fetch=down) is False
    assert model_available("http://x", "qwen3:8b", fetch=lambda url: {"unexpected": 1}) is False


def test_model_available_asks_the_tags_endpoint():
    asked = []
    model_available("http://host:1/", "qwen3:8b", fetch=lambda url: asked.append(url) or {"models": []})
    assert asked == ["http://host:1/api/tags"]


def test_bad_goal_lines_name_their_line(tmp_path):
    path = tmp_path / "goals.jsonl"
    path.write_text('{"kind": "notes", "goal": "ok"}\n{"kind": "poem", "goal": "x"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="line 2"):
        load_goals(path)


def test_the_default_goals_are_the_four_fixed_ones():
    assert [kind for kind, _ in DEFAULT_GOALS] == ["notes", "film", "slides", "notes"]
    assert DEFAULT_GOALS[0][1] == "Explain the Krebs cycle for a first-year biology exam"


class BrokenEmbedder(FakeEmbedder):
    def embed(self, texts):
        raise EmbeddingError("Ollama does not have the model nomic-embed-text: run `ollama pull nomic-embed-text`")


def test_an_embedding_failure_is_reported_not_raised(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "One"}\n', encoding="utf-8")
    assert main(["smoke", "--goals", str(goals)], embedder=BrokenEmbedder(), model=ScriptedModel([])) == 1
    assert "error: Ollama does not have the model nomic-embed-text" in capsys.readouterr().err
    (written,) = tmp_path.glob("smoke-*.json")
    assert json.loads(written.read_text(encoding="utf-8"))["results"] == []


def test_a_model_failure_keeps_the_goals_that_finished(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "One"}\n{"kind": "notes", "goal": "Two"}\n', encoding="utf-8")
    model = ScriptedModel([*finished_run(), ChatError("Ollama not reachable at http://localhost:11434")])
    assert main(["smoke", "--goals", str(goals)], embedder=FakeEmbedder(), model=model) == 1
    assert "error: Ollama not reachable" in capsys.readouterr().err
    (written,) = tmp_path.glob("smoke-*.json")
    assert [row["goal"] for row in json.loads(written.read_text(encoding="utf-8"))["results"]] == ["One"]


def test_an_empty_goals_file_is_an_error(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text("\n\n", encoding="utf-8")
    with pytest.raises(ValueError, match="has no goals"):
        load_goals(goals)
    assert main(["smoke", "--goals", str(goals)], embedder=FakeEmbedder(), model=ScriptedModel([])) == 1
    assert "has no goals" in capsys.readouterr().err


def test_model_available_is_false_on_a_broken_http_answer():
    def broken(url):
        raise http.client.RemoteDisconnected("Remote end closed connection without response")

    def bad_status_line(url):
        raise http.client.BadStatusLine("garbage")

    assert model_available("http://x", "qwen3:8b", fetch=broken) is False
    assert model_available("http://x", "qwen3:8b", fetch=bad_status_line) is False


def test_the_summary_name_has_seconds(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "One"}\n', encoding="utf-8")
    assert main(["smoke", "--goals", str(goals)], embedder=FakeEmbedder(), model=ScriptedModel(finished_run())) == 0
    (written,) = tmp_path.glob("smoke-*.json")
    assert re.fullmatch(r"smoke-\d{4}-\d{2}-\d{2}-\d{6}\.json", written.name)


def test_grounding_counts_only_searches_made_before_the_reply():
    index = Index(goal="G", status="done", steps=(Step("First", "done"),), contents=(), extra="")
    body = work(chunk_title="T", chunk_body="Citrate oxaloacetate.")
    later = {"event": "search", "step": 0, "query": "q", "hits": [
        {"source": "Study", "path": "a.md", "heading": None, "text": "Citrate oxaloacetate."}]}
    stats = summarize([model_line(0, body), later], index, RunReport("done", 1, 1))
    assert stats.grounding == 0.0


def test_grounding_ignores_hits_from_the_workspace_itself():
    index = Index(goal="G", status="done", steps=(Step("First", "done"),), contents=(), extra="")
    body = work(chunk_title="T", chunk_body="Citrate oxaloacetate.")
    own = {"event": "search", "step": 0, "query": "q", "hits": [
        {"source": None, "path": "chunk_001.md", "heading": None, "text": "Citrate oxaloacetate."},
        {"source": "Study", "path": "a.md", "heading": None, "text": "Citrate is made first."}]}
    stats = summarize([own, model_line(0, body)], index, RunReport("done", 1, 1))
    assert stats.grounding == 0.5


def kept_logs(out):
    base = Path(out.split("workspaces kept in ")[1].splitlines()[0])
    return [path.read_text(encoding="utf-8") for path in base.glob("*/run.jsonl")], base


def test_smoke_searches_the_fixture_notes_by_default(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "Explain the Krebs cycle"}\n', encoding="utf-8")
    assert main(["smoke", "--goals", str(goals), "--keep"], embedder=FakeEmbedder(),
                model=ScriptedModel(finished_run())) == 0
    (log,), base = kept_logs(capsys.readouterr().out)
    shutil.rmtree(base)
    assert '"source": "fixture"' in log


def test_smoke_passes_source_db_to_its_runs(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    notes = tmp_path / "Mine"
    notes.mkdir()
    (notes / "krebs.md").write_text("# Krebs\nKrebs cycle staging.\n", encoding="utf-8")
    db = tmp_path / "mine.db"
    assert main(["--db", str(db), "reindex", str(notes)], embedder=FakeEmbedder()) == 0
    goals = tmp_path / "goals.jsonl"
    goals.write_text('{"kind": "notes", "goal": "Explain the Krebs cycle"}\n', encoding="utf-8")
    assert main(["smoke", "--goals", str(goals), "--keep", "--source-db", str(db)], embedder=FakeEmbedder(),
                model=ScriptedModel(finished_run())) == 0
    (log,), base = kept_logs(capsys.readouterr().out)
    shutil.rmtree(base)
    assert '"source": "Mine"' in log and '"source": "fixture"' not in log
