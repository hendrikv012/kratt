import os
import sqlite3

import pytest

from memory_engine import db as db_module
from memory_engine import search as search_module
from memory_engine.__main__ import main
from memory_engine.chat import ScriptedModel
from memory_engine.config import Settings
from memory_engine.context import build_work_prompt
from memory_engine.db import connect, connect_readonly, init_schema, set_meta
from memory_engine.index_file import Index, Step
from memory_engine.reindex import reindex_folder
from memory_engine.router import run
from memory_engine.search import hybrid_search, open_sources, search_sources
from memory_engine.store import index_markdown

GOOD = "---\ntitle: Krebs cycle\n---\nEight steps.\n"


def build_source(tmp_path, fake, name="notes", text="# Krebs\nKrebs cycle staging.\n", root=None):
    """An index of a folder of notes, the way `reindex` leaves it; returns the database path."""
    folder = tmp_path / name
    folder.mkdir()
    (folder / "krebs.md").write_text(text, encoding="utf-8")
    settings = Settings(db_path=tmp_path / f"{name}.db")
    source = connect(settings)
    init_schema(source, settings)
    reindex_folder(source, folder, fake)
    if root is not None:
        with source:
            set_meta(source, "root", root)
    source.close()
    return settings.db_path


def work_index():
    return Index("Goal", "working", (Step("Explain krebs", "todo"),), (), "")


def listing(folder):
    return sorted(str(path.relative_to(folder)) for path in folder.rglob("*"))


@pytest.fixture
def locked(tmp_path):
    """Make a folder read-only for the test, then restore it so tmp_path can be cleaned up."""
    if os.geteuid() == 0:
        pytest.skip("root ignores folder permissions")
    folders = []

    def lock(folder):
        folder.chmod(0o555)
        folders.append(folder)

    yield lock
    for folder in folders:
        folder.chmod(0o755)


def test_a_source_index_is_read_only(tmp_path, fake):
    box = tmp_path / "box"
    box.mkdir()
    db = build_source(box, fake)
    before, files = db.read_bytes(), listing(box)
    settings = Settings(db_path=tmp_path / "other.db")
    source = connect_readonly(db, settings)
    with pytest.raises(sqlite3.OperationalError):
        source.execute("DELETE FROM chunks")
    source.close()

    workspace = tmp_path / "project"
    workspace.mkdir()
    conn = connect(Settings(db_path=workspace / "memory.db"))
    init_schema(conn, settings)
    model = ScriptedModel([{"steps": ["Write the note"]},
                           {"scratchpad": "", "search": "krebs", "chunk_title": "Krebs", "chunk_body": GOOD,
                            "target": "notes/krebs.md", "step_done": True}])
    sources = open_sources([db], settings)
    run(workspace, conn, fake, model, goal="Krebs", sources=sources)
    assert listing(box) == files  # no -shm or -wal file while the source is open ...
    for item in sources:
        item.conn.close()
    conn.close()
    assert db.read_bytes() == before
    assert listing(box) == files  # ... or after it is closed


def test_an_index_in_a_read_only_folder_works_as_a_source(tmp_path, conn, fake, settings, locked):
    box = tmp_path / "box"
    box.mkdir()
    db = build_source(box, fake, root="/x/Study")
    files = listing(box)
    locked(box)
    sources = open_sources([db], settings)
    hits = search_sources(conn, sources, "krebs", fake, limit=5, max_tokens=1000)
    sources[0].conn.close()
    assert [hit.source for hit in hits] == ["Study"] and listing(box) == files


def test_an_index_with_a_wal_file_in_a_read_only_folder_is_busy(tmp_path, fake, settings, locked):
    box = tmp_path / "box"
    box.mkdir()
    db = build_source(box, fake)
    (box / "notes.db-wal").write_bytes(b"")  # a reindex is running, or died
    locked(box)
    with pytest.raises(ValueError, match="being written by another process; try again when its reindex finishes"):
        open_sources([db], settings)


def test_hits_from_a_source_are_labelled_and_merged(tmp_path, conn, fake, settings):
    index_markdown(conn, "mine.md", "# Mine\nKrebs workspace note", fake)
    db = build_source(tmp_path, fake, text="# Cycle\nKrebs cycle staging\n", root="/x/Study")
    sources = open_sources([db], settings)
    content = build_work_prompt(conn, fake, work_index(), 0, "", "krebs", "", sources=sources)[-1]["content"]
    assert "[Study] krebs.md" in content
    assert "Krebs cycle staging" in content and "Krebs workspace note" in content
    assert "[Study] mine.md" not in content


def test_equal_chunk_ids_from_two_indexes_stay_apart(tmp_path, conn, fake, settings):
    index_markdown(conn, "mine.md", "# Mine\nKrebs workspace note", fake)
    db = build_source(tmp_path, fake, text="# Cycle\nKrebs cycle staging\n")
    sources = open_sources([db], settings)
    assert conn.execute("SELECT MIN(id) FROM chunks").fetchone()[0] == sources[0].conn.execute(
        "SELECT MIN(id) FROM chunks").fetchone()[0]
    hits = search_sources(conn, sources, "krebs", fake, limit=5, max_tokens=1000)
    texts = " ".join(hit.text for hit in hits)
    assert "Krebs workspace note" in texts and "Krebs cycle staging" in texts
    assert {hit.source for hit in hits} == {None, "notes"}


def test_the_label_falls_back_to_a_number(tmp_path, fake, settings):
    db = build_source(tmp_path, fake)
    other = connect(Settings(db_path=tmp_path / "bare.db"))
    init_schema(other, settings)
    other.close()
    labels = [item.label for item in open_sources([db, tmp_path / "bare.db"], settings)]
    assert labels == ["notes", "source 2"]


def test_a_source_with_other_settings_is_refused(tmp_path, fake, settings):
    db = build_source(tmp_path, fake)
    old = connect(Settings(db_path=db))
    with old:
        set_meta(old, "embedding", "nomic-embed-text, 768 dimensions, input format 1")
    old.close()
    with pytest.raises(ValueError, match="run memory-engine reindex") as err:
        open_sources([db], settings)
    assert str(db) in str(err.value)


def test_a_missing_source_is_a_clear_error(tmp_path, settings):
    missing = tmp_path / "nope.db"
    with pytest.raises(ValueError, match=f"no index at {missing}"):
        connect_readonly(missing, settings)
    assert not missing.exists()
    with pytest.raises(ValueError, match="no index at"):
        open_sources([missing], settings)


def test_without_sources_search_is_unchanged(conn, fake):
    index_markdown(conn, "mine.md", "# Mine\nKrebs workspace note", fake)
    assert search_sources(conn, [], "krebs", fake, limit=5, max_tokens=1000) == hybrid_search(
        conn, "krebs", fake, limit=5, max_tokens=1000)


def test_the_command_takes_source_db_more_than_once(tmp_path, fake):
    one = build_source(tmp_path, fake, name="one")
    two = build_source(tmp_path, fake, name="two")
    workspace = tmp_path / "project"
    model = ScriptedModel([{"steps": ["Write the note"]},
                           {"scratchpad": "", "search": "krebs", "chunk_title": "Krebs", "chunk_body": GOOD,
                            "target": "notes/krebs.md", "step_done": True}])
    code = main(["run", str(workspace), "--goal", "Krebs", "--log", "--source-db", str(one), "--source-db", str(two)],
                embedder=fake, model=model)
    assert code == 0
    assert '"source": "one"' in (workspace / "run.jsonl").read_text(encoding="utf-8")


def test_the_command_reports_a_missing_source(tmp_path, fake, capsys):
    code = main(["run", str(tmp_path / "project"), "--goal", "G", "--source-db", str(tmp_path / "nope.db")],
                embedder=fake, model=ScriptedModel([]))
    assert code == 1 and "no index at" in capsys.readouterr().err


def test_a_source_reindexed_during_a_run_is_reopened(tmp_path, conn, fake, settings):
    db = build_source(tmp_path, fake, text="# Krebs\nKrebs cycle staging.\n")
    sources = open_sources([db], settings)
    assert "staging" in " ".join(h.text for h in search_sources(conn, sources, "krebs", fake, 5, 1000))
    (tmp_path / "notes" / "krebs.md").write_text("# Krebs\nKrebs cycle rewritten entirely.\n", encoding="utf-8")
    (tmp_path / "notes" / "more.md").write_text("# More\nKrebs extra page.\n" * 40, encoding="utf-8")
    writer = connect(Settings(db_path=db))
    reindex_folder(writer, tmp_path / "notes", fake)
    writer.close()
    texts = " ".join(h.text for h in search_sources(conn, sources, "krebs", fake, 5, 1000))
    sources[0].conn.close()
    assert "rewritten entirely" in texts and "staging" not in texts


def test_a_source_replaced_by_a_non_index_is_a_clear_error(tmp_path, conn, fake, settings):
    db = build_source(tmp_path, fake)
    sources = open_sources([db], settings)
    replacement = tmp_path / "junk"
    replacement.write_bytes(b"not a database at all" * 100)
    os.replace(replacement, db)
    with pytest.raises(ValueError, match="is not a memory-engine index") as err:
        search_sources(conn, sources, "krebs", fake, 5, 1000)
    assert str(db) in str(err.value)
    sources[0].conn.close()


def test_a_broken_read_of_a_source_names_the_file(tmp_path, conn, fake, settings, monkeypatch):
    db = build_source(tmp_path, fake)
    sources = open_sources([db], settings)
    real = search_module.hybrid_search

    def broken(c, *args, **kwargs):
        if c is sources[0].conn:
            raise sqlite3.DatabaseError("database disk image is malformed")
        return real(c, *args, **kwargs)

    monkeypatch.setattr(search_module, "hybrid_search", broken)
    with pytest.raises(ValueError, match="database disk image is malformed") as err:
        search_sources(conn, sources, "krebs", fake, 5, 1000)
    assert str(db) in str(err.value)
    sources[0].conn.close()


def test_a_broken_source_during_a_run_is_an_error_not_a_traceback(tmp_path, fake, monkeypatch, capsys):
    db = build_source(tmp_path, fake)
    real = search_module.hybrid_search

    def broken(c, *args, **kwargs):
        if c.execute("PRAGMA database_list").fetchone()[2] == str(db):
            raise sqlite3.DatabaseError("database disk image is malformed")
        return real(c, *args, **kwargs)

    monkeypatch.setattr(search_module, "hybrid_search", broken)
    model = ScriptedModel([{"steps": ["Write the note"]}])
    code = main(["run", str(tmp_path / "project"), "--goal", "G", "--source-db", str(db)], embedder=fake, model=model)
    assert code == 1 and f"error: {db}" in capsys.readouterr().err


def test_a_broken_extension_is_not_called_a_busy_index(tmp_path, fake, settings, monkeypatch):
    db = build_source(tmp_path, fake)

    def broken(conn):
        raise sqlite3.OperationalError("cannot open shared object file")

    monkeypatch.setattr(db_module.sqlite_vec, "load", broken)
    with pytest.raises(ValueError, match="sqlite-vec could not be loaded") as err:
        connect_readonly(db, settings)
    assert "another process" not in str(err.value)


def test_a_non_database_with_a_wal_file_is_not_an_index(tmp_path, settings):
    junk = tmp_path / "junk.db"
    junk.write_bytes(b"not a database at all" * 100)
    (tmp_path / "junk.db-wal").write_bytes(b"")
    with pytest.raises(ValueError, match="is not a memory-engine index"):
        open_sources([junk], settings)


def test_a_bad_source_fails_before_the_workspace_index_is_rebuilt(tmp_path, fake, capsys):
    workspace = tmp_path / "project"
    workspace.mkdir()
    old = connect(Settings(db_path=workspace / "memory.db"))
    init_schema(old, Settings(db_path=workspace / "memory.db"))
    index_markdown(old, "mine.md", "# Mine\nKrebs workspace note", fake)
    with old:
        set_meta(old, "embedding", "nomic-embed-text, 768 dimensions, input format 1")
    old.close()
    code = main(["run", str(workspace), "--goal", "G", "--source-db", str(tmp_path / "nope.db")],
                embedder=fake, model=ScriptedModel([]))
    captured = capsys.readouterr()
    assert code == 1 and "no index at" in captured.err and "rebuilding" not in captured.out
    check = sqlite3.connect(workspace / "memory.db")
    assert check.execute("SELECT count(*) FROM documents").fetchone()[0] == 1
    check.close()
