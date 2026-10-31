import json
import sqlite3
from dataclasses import replace

import pytest

from memory_engine.config import Settings
from memory_engine.db import check_embedding, connect, init_schema, set_meta
from memory_engine.store import index_markdown


def test_wal_mode(conn):
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_mmap_enabled(conn):
    assert conn.execute("PRAGMA mmap_size").fetchone()[0] == 2147418112


def test_foreign_keys_on(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_sqlite_vec_loaded(conn):
    assert conn.execute("SELECT vec_version()").fetchone()[0].startswith("v0.1")


def test_all_tables_exist(conn):
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"documents", "chunks", "chunks_fts", "chunks_vec", "symbols", "references",
            "web_cache", "learned_repairs", "learned_repairs_fts"} <= names


def test_init_schema_is_idempotent(conn, settings):
    init_schema(conn, settings)
    init_schema(conn, settings)


def test_vector_size_comes_from_settings(conn):
    with pytest.raises(sqlite3.OperationalError):
        conn.execute(
            "INSERT INTO chunks_vec(chunk_id, embedding) VALUES (1, vec_quantize_int8(?, 'unit'))",
            (json.dumps([0.5] * 4),),
        )


@pytest.mark.parametrize("statement", [
    'DELETE FROM "references" WHERE document_id = 1',
    'DELETE FROM "references" WHERE from_symbol_id = 1',
    "DELETE FROM symbols WHERE document_id = 1",
    "DELETE FROM symbols WHERE parent_id = 1",
])
def test_child_rows_are_found_by_index(conn, statement):
    plan = " ".join(row[-1] for row in conn.execute("EXPLAIN QUERY PLAN " + statement))
    assert "SCAN" not in plan


def test_changed_embedding_settings_are_refused(conn, settings):
    assert check_embedding(conn, settings) is False
    with pytest.raises(ValueError, match="built with nomic-embed-text, 768 dimensions"):
        check_embedding(conn, replace(settings, embed_model="other-model"))


def test_changed_embedding_settings_can_rebuild(conn, settings, fake):
    index_markdown(conn, "a.md", "# A\nMatrix.", fake)
    smaller = replace(settings, embed_dims=4)
    assert check_embedding(conn, smaller, rebuild=True) is True
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
    conn.execute("INSERT INTO chunks_vec(chunk_id, embedding) VALUES (1, vec_quantize_int8(?, 'unit'))",
                 (json.dumps([0.5] * 4),))
    assert check_embedding(conn, smaller) is False


def test_a_chunk_size_change_rebuilds_the_index(tmp_path, fake):
    old = Settings(db_path=tmp_path / "other.db", chunk_tokens=400)
    conn = connect(old)
    init_schema(conn, old)
    index_markdown(conn, "a.md", "# A\nMatrix.", fake)
    assert check_embedding(conn, Settings(db_path=old.db_path, chunk_tokens=200), rebuild=True) is True
    assert conn.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
    conn.close()


def test_an_old_index_must_be_rebuilt(conn, settings):
    set_meta(conn, "embedding", "nomic-embed-text, 768 dimensions, input format 1")
    with pytest.raises(ValueError, match="run reindex"):
        check_embedding(conn, settings)
