import json

import pytest

from memory_engine.__main__ import main
from memory_engine.chat import ModelReplyError, ScriptedModel
from memory_engine.router import run
from memory_engine.runlog import RunLog

GOOD = "---\ntitle: Krebs cycle\n---\nEight steps.\n"


def work(**fields):
    reply = {"scratchpad": "", "search": "", "chunk_title": "", "chunk_body": "", "step_done": False}
    return reply | fields


@pytest.fixture
def workspace(tmp_path):
    folder = tmp_path / "project"
    folder.mkdir()
    return folder


def scripted():
    return ScriptedModel([
        {"steps": ["Write the note"]},
        work(chunk_title="Krebs", chunk_body=GOOD, target="notes/krebs.md", step_done=True),
    ])


def test_a_logged_run_writes_each_prompt_reply_search_and_check(workspace, conn, fake):
    path = workspace / "run.jsonl"
    assert run(workspace, conn, fake, scripted(), goal="Study the Krebs cycle", log=RunLog(path)).status == "done"
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [line["event"] for line in lines] == ["search", "model", "search", "model", "doctor"]
    assert [line.get("step") for line in lines[:4]] == [None, None, 0, 0]
    plan_model, work_model = lines[1], lines[3]
    assert plan_model["reply"] == {"steps": ["Write the note"]}
    assert plan_model["messages"][0]["role"] == "system"
    assert work_model["reply"]["target"] == "notes/krebs.md"
    assert lines[0]["query"] == "Study the Krebs cycle" and lines[0]["hits"] == []
    assert lines[4]["target"] == "notes/krebs.md" and lines[4]["ok"] is True and lines[4]["blocked"] is False


def test_search_lines_carry_the_hits_sent_to_the_model(workspace, conn, fake):
    (workspace / "krebs.md").write_text("# Krebs\nCitrate is made first.\n", encoding="utf-8")
    path = workspace / "run.jsonl"
    run(workspace, conn, fake, scripted(), goal="Citrate", log=RunLog(path))
    first = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert first["event"] == "search" and first["step"] is None
    hit = first["hits"][0]
    assert hit["source"] is None and hit["path"] == "krebs.md" and "Citrate is made first." in hit["text"]


def test_a_model_error_is_logged_as_the_error_text(workspace, conn, fake):
    path = workspace / "run.jsonl"
    model = ScriptedModel([{"steps": ["Only"]}, ModelReplyError("the reply was not valid JSON: x"),
                           work(chunk_title="T", chunk_body="R.", step_done=True)])
    run(workspace, conn, fake, model, goal="G", log=RunLog(path))
    replies = [json.loads(line)["reply"] for line in path.read_text(encoding="utf-8").splitlines()
               if json.loads(line)["event"] == "model"]
    assert replies[1] == "the reply was not valid JSON: x"


def test_an_unwritable_log_warns_once_and_the_run_goes_on(workspace, conn, fake, capsys):
    blocked = workspace / "run.jsonl"
    blocked.mkdir()
    assert run(workspace, conn, fake, scripted(), goal="G", log=RunLog(blocked)).status == "done"
    err = capsys.readouterr().err
    assert err.count("warning: run log not written:") == 1


def test_no_log_changes_nothing(workspace, conn, fake):
    assert run(workspace, conn, fake, scripted(), goal="G").status == "done"
    assert not (workspace / "run.jsonl").exists()


def test_the_log_flag_writes_run_jsonl_in_the_workspace(workspace, fake):
    assert main(["run", str(workspace), "--goal", "G", "--log"], embedder=fake, model=scripted()) == 0
    assert (workspace / "run.jsonl").read_text(encoding="utf-8").count("\n") == 5
    assert main(["run", str(workspace.parent / "other"), "--goal", "G"], embedder=fake, model=scripted()) == 0
    assert not (workspace.parent / "other" / "run.jsonl").exists()


def test_the_doctors_fix_prompts_replies_and_reasons_are_logged(workspace, conn, fake):
    path = workspace / "run.jsonl"
    model = ScriptedModel([
        {"steps": ["Write the note"]},
        work(chunk_title="Krebs", chunk_body="---\nauthor: me\n---\nEight steps.\n", target="notes/krebs.md",
             step_done=True),
        {"find": "nope", "replace": "x"},
        ModelReplyError("the reply was not valid JSON: x"),
        {"find": "author: me", "replace": "title: Krebs cycle"},
    ])
    assert run(workspace, conn, fake, model, goal="G", log=RunLog(path)).status == "done"
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    fixes = [line for line in lines if line["event"] == "fix"]
    assert [line["problem"] for line in fixes] == ["the text to change isn't in the file",
                                                    "the reply was not valid JSON: x", ""]
    assert fixes[0]["reply"] == {"find": "nope", "replace": "x"}
    assert fixes[1]["reply"] == "the reply was not valid JSON: x"
    assert all(line["target"] == "notes/krebs.md" and line["step"] == 0 for line in fixes)
    assert fixes[0]["messages"][0]["role"] == "system"
    assert [line["event"] for line in lines][-4:] == ["fix", "fix", "fix", "doctor"]
