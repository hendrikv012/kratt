import sqlite3

import pytest

from memory_engine.repairs import find_repairs, mark_used, record_repair

TRACE = 'File "app.py", line 12, in run\nKeyError: \'user_id\''


def test_find_similar_repair(conn):
    rid = record_repair(conn, "test", TRACE, "- d['user_id']\n+ d.get('user_id')", "app.py")
    record_repair(conn, "lint", "E501 line too long (120 > 100 characters)", "wrap line")
    hits = find_repairs(conn, 'File "app.py", line 40, in run\nKeyError: \'user_id\'')
    assert hits[0].id == rid


def test_unrelated_trace_finds_nothing(conn):
    record_repair(conn, "test", TRACE, "fix")
    assert find_repairs(conn, "ZeroDivisionError: division by zero") == []


def test_mark_used_and_bad_kind(conn):
    rid = record_repair(conn, "format", "missing yaml key: title", "add title")
    mark_used(conn, rid)
    assert find_repairs(conn, "missing yaml key: title")[0].times_used == 1
    with pytest.raises(sqlite3.IntegrityError):
        record_repair(conn, "magic", "x", "y")


def frames(n, error):
    lines = ["Traceback (most recent call last):"]
    for i in range(n):
        lines += [f'  File "/srv/project/app/module_{i}.py", line {10 + i}, in handler_{i}',
                  f"    result = step_{i}(payload)"]
    return "\n".join(lines + [error])


def test_long_traceback_matches_on_its_error_line(conn):
    rid = record_repair(conn, "test", "KeyError: 'user_id'", "use d.get('user_id')")
    assert [r.id for r in find_repairs(conn, frames(8, "KeyError: 'user_id'"))][:1] == [rid]


def test_error_line_outranks_shared_frames(conn):
    zero = record_repair(conn, "test", frames(6, "ZeroDivisionError: division by zero"), "guard the divisor")
    key = record_repair(conn, "test", "KeyError: 'user_id'", "use d.get('user_id')")
    assert [r.id for r in find_repairs(conn, frames(6, "KeyError: 'user_id'"))] == [key, zero]
