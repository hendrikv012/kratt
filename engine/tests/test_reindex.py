import subprocess
import sys
from pathlib import Path

import pytest

from memory_engine.__main__ import main
from memory_engine.chat import ChatError, ScriptedModel
from memory_engine.db import connect, init_schema
from memory_engine.embeddings import EmbeddingError, FakeEmbedder
from memory_engine.index_file import read_index
from memory_engine.reindex import ReindexReport, reindex_folder
from memory_engine.search import hybrid_search


def test_reindex_syncs_with_files(tmp_path, conn, fake):
    (tmp_path / "a.md").write_text("# A\nMatrix notes.")
    (tmp_path / "b.py").write_text("def f():\n    return 1\n")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "x.md").write_text("ignored")
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=2, unchanged=0, removed=0)
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=0, unchanged=2, removed=0)
    (tmp_path / "a.md").unlink()
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=0, unchanged=1, removed=1)


def test_index_is_rebuildable_from_files(tmp_path, settings, fake):
    (tmp_path / "a.md").write_text("# A\nThe citric acid cycle.")
    first = connect(settings)
    init_schema(first, settings)
    reindex_folder(first, tmp_path, fake)
    first.close()
    for f in tmp_path.glob("memory.db*"):
        f.unlink()
    second = connect(settings)
    init_schema(second, settings)
    reindex_folder(second, tmp_path, fake)
    assert hybrid_search(second, "citric", fake)[0].path == "a.md"
    second.close()


def test_reindex_refuses_missing_folder(tmp_path, conn, fake):
    (tmp_path / "a.md").write_text("# A\nMatrix notes.")
    reindex_folder(conn, tmp_path, fake)
    with pytest.raises(ValueError, match="not a folder"):
        reindex_folder(conn, tmp_path / "typo", fake)
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 1


def test_cli_reindex_and_search(tmp_path, fake, capsys):
    (tmp_path / "a.md").write_text("# Krebs\nThe citric acid cycle.")
    db = str(tmp_path / "m.db")
    assert main(["--db", db, "reindex", str(tmp_path)], embedder=fake) == 0
    assert "indexed 1, unchanged 0, removed 0" in capsys.readouterr().out
    assert main(["--db", db, "search", "citric"], embedder=fake) == 0
    assert "a.md" in capsys.readouterr().out


class OllamaDown:
    dims = 768

    def embed(self, texts):
        raise EmbeddingError("Ollama not reachable at http://localhost:11434: connection refused")


def test_cli_reports_missing_ollama(tmp_path, capsys):
    assert main(["--db", str(tmp_path / "m.db"), "search", "citric"], embedder=OllamaDown()) == 1
    assert "Ollama not reachable" in capsys.readouterr().err


class FailsOnPoison(FakeEmbedder):
    def embed(self, texts):
        if any("POISON" in t for t in texts):
            raise EmbeddingError("too slow")
        return super().embed(texts)


def test_one_failing_file_does_not_stop_the_rest(tmp_path, conn, fake):
    (tmp_path / "c.md").write_text("# C\nkept")
    (tmp_path / "gone.md").write_text("# G\nold")
    reindex_folder(conn, tmp_path, fake)
    (tmp_path / "gone.md").unlink()
    (tmp_path / "a.md").write_text("# A\nPOISON")
    (tmp_path / "b.md").write_text("# B\nfine")
    report = reindex_folder(conn, tmp_path, FailsOnPoison())
    assert report == ReindexReport(indexed=1, unchanged=1, removed=1, failed=(("a.md", "too slow"),))
    assert {r[0] for r in conn.execute("SELECT path FROM documents")} == {"b.md", "c.md"}


def test_cli_lists_failed_files(tmp_path, capsys):
    (tmp_path / "a.md").write_text("# A\nPOISON")
    assert main(["--db", str(tmp_path / "m.db"), "reindex", str(tmp_path)], embedder=FailsOnPoison()) == 1
    assert "a.md: too slow" in capsys.readouterr().err


def test_reindex_refuses_a_second_folder(tmp_path, conn, fake):
    (tmp_path / "notes").mkdir()
    (tmp_path / "code").mkdir()
    (tmp_path / "notes" / "README.md").write_text("# Notes\nKrebs.")
    (tmp_path / "code" / "README.md").write_text("# Code\nParser.")
    reindex_folder(conn, tmp_path / "notes", fake)
    with pytest.raises(ValueError, match="belongs to .*notes"):
        reindex_folder(conn, tmp_path / "code", fake)
    assert hybrid_search(conn, "Krebs", fake)[0].heading == "Notes"


def test_cli_rebuilds_after_embedding_change(tmp_path, fake, capsys, monkeypatch):
    (tmp_path / "a.md").write_text("# Krebs\nThe citric acid cycle.")
    db = str(tmp_path / "m.db")
    main(["--db", db, "reindex", str(tmp_path)], embedder=fake)
    monkeypatch.setattr("memory_engine.db.EMBEDDING_FORMAT", 3)
    capsys.readouterr()
    assert main(["--db", db, "search", "citric"], embedder=fake) == 1
    assert "run reindex" in capsys.readouterr().err
    assert main(["--db", db, "reindex", str(tmp_path)], embedder=fake) == 0
    out = capsys.readouterr().out
    assert "rebuilding the index" in out and "indexed 1" in out


def test_cli_run_finishes_a_plan(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    model = ScriptedModel([{"steps": ["Write it"]}, {"scratchpad": "", "search": "", "chunk_title": "Note",
                                                     "chunk_body": "Text.", "step_done": True}])
    assert main(["run", str(workspace), "--goal", "Write a note"], embedder=fake, model=model) == 0
    assert "done: 1 step finished in 2 turns" in capsys.readouterr().out
    assert (workspace / "memory.db").exists() and (workspace / "chunk_001.md").exists()


def test_cli_run_reports_a_stuck_step(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    thinking = {"scratchpad": "Hmm.", "search": "", "chunk_title": "", "chunk_body": "", "step_done": False}
    assert main(["run", str(workspace), "--goal", "G"], embedder=fake,
                model=ScriptedModel([{"steps": ["Hard"]}] + [thinking] * 8)) == 1
    err = capsys.readouterr().err
    assert 'stuck on "Hard": the step was never finished' in err and "SCRATCHPAD.md" in err


def test_cli_run_explains_a_missing_chat_model(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    missing = ScriptedModel([ChatError("Ollama does not have the model qwen3:8b: run `ollama pull qwen3:8b`")])
    assert main(["run", str(workspace), "--goal", "G"], embedder=fake, model=missing) == 1
    assert "ollama pull qwen3:8b" in capsys.readouterr().err


def test_cli_run_prints_progress(tmp_path, fake, capsys):
    model = ScriptedModel([{"steps": ["Write it"]}, {"scratchpad": "", "search": "", "chunk_title": "Note",
                                                     "chunk_body": "Text.", "step_done": True}])
    assert main(["run", str(tmp_path / "ws"), "--goal", "G"], embedder=fake, model=model) == 0
    assert 'step 1/1 "Write it": saved chunk_001.md, finished' in capsys.readouterr().err


def test_cli_run_explains_a_stuck_plan(tmp_path, fake, capsys):
    assert main(["run", str(tmp_path / "ws"), "--goal", "G"], embedder=fake,
                model=ScriptedModel([{"steps": []}] * 8)) == 1
    assert "stuck while planning: the plan had no steps" in capsys.readouterr().err


def test_cli_run_can_be_interrupted(tmp_path, fake, capsys):
    assert main(["run", str(tmp_path / "ws"), "--goal", "G"], embedder=fake,
                model=ScriptedModel([KeyboardInterrupt()])) == 130
    assert "interrupted: run again to continue" in capsys.readouterr().err


def test_cli_run_timeout_is_configurable(tmp_path, fake, monkeypatch):
    made = []

    class Recorder:
        def __init__(self, *args, **kwargs):
            made.append(kwargs.get("timeout"))

        def complete(self, messages, schema):
            raise ChatError("stop here")

    monkeypatch.setattr("memory_engine.__main__.OllamaChat", Recorder)
    main(["run", str(tmp_path / "a"), "--goal", "G"], embedder=fake)
    main(["run", str(tmp_path / "b"), "--goal", "G", "--timeout", "900"], embedder=fake)
    assert made == [600.0, 900.0]


def test_index_inside_its_folder_follows_a_move(tmp_path, fake):
    old = tmp_path / "old"
    old.mkdir()
    (old / "a.md").write_text("# A\nMatrix notes.")
    assert main(["--db", str(old / "memory.db"), "reindex", str(old)], embedder=fake) == 0
    new = tmp_path / "new"
    old.rename(new)
    assert main(["--db", str(new / "memory.db"), "reindex", str(new)], embedder=fake) == 0


def test_modules_in_the_current_folder_are_never_imported(tmp_path):
    marker = tmp_path / "ran.txt"
    (tmp_path / "yaml.py").write_text(f"open({str(marker)!r}, 'w').write('ran')\n")
    subprocess.run([sys.executable, "-m", "memory_engine", "--help"], cwd=tmp_path, capture_output=True)
    assert not marker.exists()


def test_the_memory_engine_command_is_installed():
    command = Path(sys.executable).parent / "memory-engine"
    assert subprocess.run([str(command), "--help"], capture_output=True).returncode == 0



def test_cli_run_sets_the_kind(tmp_path, fake):
    main(["run", str(tmp_path / "ws"), "--goal", "G", "--kind", "slides"], embedder=fake,
         model=ScriptedModel([ChatError("stop here")]))
    assert read_index(tmp_path / "ws" / "INDEX.md").kind == "slides"


def test_cli_explains_a_blocked_run(tmp_path, fake, capsys, monkeypatch):
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", tmp_path / "missing.js")
    model = ScriptedModel([{"steps": ["Intro"]}, {"scratchpad": "", "search": "", "chunk_title": "Intro",
                                                  "chunk_body": "# Intro\nShort.", "step_done": True}])
    assert main(["run", str(tmp_path / "ws"), "--goal", "G", "--kind", "slides"], embedder=fake, model=model) == 1
    assert "stopped: " in capsys.readouterr().err


def test_chunk_tokens_sets_the_largest_markdown_chunk(tmp_path, conn, fake):
    (tmp_path / "a.md").write_text("# A\n" + "\n\n".join(f"Paragraph {i} about the citric acid cycle." for i in range(30)))
    reindex_folder(conn, tmp_path, fake)
    default = conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
    (tmp_path / "b.md").write_text((tmp_path / "a.md").read_text())
    reindex_folder(conn, tmp_path, fake, chunk_tokens=50)
    small = conn.execute("SELECT count(*) FROM chunks WHERE document_id = (SELECT id FROM documents WHERE path = 'b.md')").fetchone()[0]
    assert small > default


def test_cli_creates_the_database_folder(tmp_path, fake):
    notes = tmp_path / "Study"
    notes.mkdir()
    (notes / "a.md").write_text("# A\nCitric acid.\n", encoding="utf-8")
    db = notes / ".study" / "memory.db"
    assert main(["--db", str(db), "reindex", str(notes)], embedder=fake) == 0
    assert db.is_file()


def test_cli_reports_a_database_that_cannot_be_made(tmp_path, fake, capsys):
    blocker = tmp_path / "file"
    blocker.write_text("not a folder", encoding="utf-8")
    assert main(["--db", str(blocker / "memory.db"), "reindex", str(tmp_path)], embedder=fake) == 1
    assert f"error: {blocker / 'memory.db'}" in capsys.readouterr().err
