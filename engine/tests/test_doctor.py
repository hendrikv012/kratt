import subprocess

import pytest
from conftest import needs_bwrap, needs_marp
from memory_engine.chat import ModelReplyError, ScriptedModel
from memory_engine.checks import CheckUnavailable, Problem
from memory_engine.doctor import DOCTOR_SYSTEM, apply_edit, commit_file, promote
from memory_engine.repairs import find_repairs, record_repair


GOOD = "---\ntitle: Krebs cycle\n---\nEight steps.\n"
ADD_HEADER = {"find": "Eight steps.", "replace": GOOD}  # turns the bare draft "Eight steps." into GOOD


def git_log(workspace):
    return subprocess.run(["git", "-C", str(workspace), "log", "--format=%s"], capture_output=True, text=True).stdout.splitlines()


def test_clean_file_is_written_and_committed(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/krebs.md", GOOD)
    assert result.ok and result.fixes == 0 and result.message == "checked notes/krebs.md, committed"
    assert (tmp_path / "notes" / "krebs.md").read_text() == GOOD
    assert git_log(tmp_path) == ["Write notes/krebs.md (checked by the Doctor)"]
    assert conn.execute("SELECT count(*) FROM learned_repairs").fetchone()[0] == 0


def test_only_the_trace_and_the_draft_go_back(tmp_path, conn):
    model = ScriptedModel([ADD_HEADER])
    promote(tmp_path, conn, model, "notes/krebs.md", "Eight steps.")
    system, user = model.prompts[0]
    assert system["content"] == DOCTOR_SYSTEM
    assert user["content"] == "# File\nnotes/krebs.md\n\n# Check that failed\nmarkdown: the file needs a YAML header with a title\n\n# The file\nEight steps."


def test_fix_is_recorded_as_a_learned_repair(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([ADD_HEADER]), "notes/krebs.md", "Eight steps.")
    assert result.ok and result.fixes == 1 and result.message == "checked notes/krebs.md after 1 fix, committed"
    repair = find_repairs(conn, "markdown: the file needs a YAML header with a title")[0]
    assert (repair.kind, repair.file_path) == ("format", "notes/krebs.md") and "+title: Krebs cycle" in repair.fix_diff


def test_a_past_fix_is_offered_and_counted(tmp_path, conn):
    rid = record_repair(conn, "format", "markdown: the YAML header needs a title", "+title: Something")
    model = ScriptedModel([{"find": "author: me", "replace": "title: Krebs cycle"}])
    assert promote(tmp_path, conn, model, "notes/k.md", "---\nauthor: me\n---\nText.").ok
    assert "# A fix that worked before\n+title: Something" in model.prompts[0][1]["content"]
    assert conn.execute("SELECT times_used FROM learned_repairs WHERE id = ?", (rid,)).fetchone()[0] == 1


def test_gives_up_after_three_fixes(tmp_path, conn):
    model = ScriptedModel([{"find": "No header.", "replace": "Header 1."}, {"find": "Header 1.", "replace": "Header 2."},
                           {"find": "Header 2.", "replace": "Header 3."}])
    result = promote(tmp_path, conn, model, "notes/k.md", "No header.")
    assert not result.ok and "notes/k.md still fails markdown after 3 fixes" in result.message
    assert result.fixes == 3 and "last fix:" not in result.message
    assert not (tmp_path / "notes" / "k.md").exists() and not (tmp_path / ".git").exists()


def test_a_broken_fix_reply_uses_up_an_attempt(tmp_path, conn):
    model = ScriptedModel([ModelReplyError("the reply was not valid JSON: x"), {"find": "No header.", "replace": GOOD}])
    assert promote(tmp_path, conn, model, "notes/k.md", "No header.").fixes == 1


def test_refused_target_writes_nothing(tmp_path, conn):
    (tmp_path / "mine.md").write_text("Mine.")
    result = promote(tmp_path, conn, ScriptedModel([]), "mine.md", GOOD)
    assert not result.ok and "was not written by the Doctor" in result.message and (tmp_path / "mine.md").read_text() == "Mine."


def test_the_doctor_may_replace_its_own_file(tmp_path, conn):
    assert promote(tmp_path, conn, ScriptedModel([]), "notes/krebs.md", GOOD).ok
    second = promote(tmp_path, conn, ScriptedModel([]), "notes/krebs.md", GOOD.replace("Eight", "8"))
    assert second.ok and second.commit and (tmp_path / "notes" / "krebs.md").read_text() == GOOD.replace("Eight", "8")


def test_unchanged_file_and_missing_identity_still_succeed(tmp_path, conn, monkeypatch):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "no-gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    first = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    second = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    assert first.commit and second.ok and second.commit is None and second.message == "checked notes/k.md"


def test_too_long_draft_is_refused(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", "No header. " * 600)
    assert not result.ok and "too long for the Doctor to fix" in result.message


@needs_bwrap
def test_python_lint_error_is_fixed(tmp_path, conn):
    fixed = "def f() -> int:\n    return 1\n"
    model = ScriptedModel([{"find": "import os\n\n", "replace": ""}])
    result = promote(tmp_path, conn, model, "src/f.py", "import os\n\n" + fixed)
    assert result.ok and (tmp_path / "src" / "f.py").read_text() == fixed
    assert "ruff: " in model.prompts[0][1]["content"] and "F401" in model.prompts[0][1]["content"]


def test_each_workspace_gets_its_own_repository(tmp_path, conn):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    workspace = tmp_path / "ws"
    workspace.mkdir()
    assert promote(workspace, conn, ScriptedModel([]), "notes/k.md", GOOD).commit
    assert (workspace / ".git").is_dir() and git_log(workspace) == ["Write notes/k.md (checked by the Doctor)"]
    assert subprocess.run(["git", "-C", str(tmp_path), "log"], capture_output=True).returncode != 0


def test_a_commit_never_takes_other_files(tmp_path):
    (tmp_path / "*.md").write_text(GOOD)
    (tmp_path / "other.md").write_text("Other.")
    assert commit_file(tmp_path, "*.md", "Write *.md")
    shown = subprocess.run(["git", "-C", str(tmp_path), "show", "--name-only", "--format="], capture_output=True, text=True)
    assert shown.stdout.split() == ["*.md"]


def test_hand_edits_are_never_overwritten(tmp_path, conn):
    assert promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD).ok
    (tmp_path / "notes" / "k.md").write_text(GOOD + "\nMy own paragraph.\n")
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD.replace("Eight", "8"))
    assert not result.ok and "changed since the Doctor wrote it" in result.message
    assert "My own paragraph." in (tmp_path / "notes" / "k.md").read_text()


def test_a_folder_that_cannot_be_written_is_reported(tmp_path, conn):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes").chmod(0o500)
    try:
        result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    finally:
        (tmp_path / "notes").chmod(0o700)
    assert not result.ok and "could not be written" in result.message


def test_a_slow_git_hook_does_not_hang_the_run(tmp_path, conn, monkeypatch):
    monkeypatch.setattr("memory_engine.doctor.GIT_TIMEOUT", 1)
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    hook = tmp_path / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\nsleep 5\n")
    hook.chmod(0o755)
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    assert result.ok and result.commit is None and "did not finish within 1 s" in result.message



def deck_with(slide):
    return "---\nmarp: true\ntitle: Krebs\npaginate: true\n---\n# One\nShort.\n\n---\n\n" + slide + "\n"


@needs_marp
def test_a_slide_fix_edits_only_the_slide(tmp_path, conn):
    model = ScriptedModel([{"find": "word " * 90, "replace": "Short enough."}])
    result = promote(tmp_path, conn, model, "notes/deck.md", "# Two\n" + "word " * 90, rules="", assemble=deck_with)
    user = model.prompts[0][1]["content"]
    assert "# Your part of the file\n# Two\nword" in user and "# One" not in user
    assert result.ok and result.content == "# Two\nShort enough."
    assert (tmp_path / "notes" / "deck.md").read_text() == deck_with("# Two\nShort enough.")


def test_scene_rules_apply_when_asked(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([{"find": "No sections.", "replace": "Still none."}, {"find": "Still none.", "replace": "None."},
                                           {"find": "None.", "replace": "Nothing."}]),
                     "scenes/scene_01.md", "---\ntitle: T\n---\nNo sections.", rules="scene")
    assert not result.ok and "still fails scene" in result.message


@needs_marp
def test_a_long_deck_still_fits_the_fix_prompt(tmp_path, conn):
    long_deck = lambda slide: deck_with("\n\n---\n\n".join([f"# S{i}\n" + "word " * 70 for i in range(30)] + [slide]))
    model = ScriptedModel([{"find": "word " * 90, "replace": "Short."}])
    assert promote(tmp_path, conn, model, "notes/deck.md", "# New\n" + "word " * 90, assemble=long_deck).ok


def test_problems_in_the_piece_come_first(tmp_path, conn):
    model = ScriptedModel([{"find": "bad", "replace": "fine"}])
    piece_rule = lambda text: [Problem("format", "slide", "say fine")] if text != "fine" else []
    result = promote(tmp_path, conn, model, "notes/k.md", "bad", check_piece=piece_rule,
                     assemble=lambda piece: GOOD.replace("Eight steps.", piece))
    assert result.ok and "slide: say fine" in model.prompts[0][1]["content"]


def test_environment_failures_block_instead_of_asking_for_a_fix(tmp_path, conn, monkeypatch):
    def unavailable(*args, **kwargs):
        raise CheckUnavailable("install the tool")
    monkeypatch.setattr("memory_engine.doctor.check_file", unavailable)
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    assert not result.ok and result.blocked and "install the tool" in result.message


def test_a_fixed_target_that_is_refused_blocks(tmp_path, conn):
    (tmp_path / "real").mkdir()
    (tmp_path / "scenes").symlink_to(tmp_path / "real")
    result = promote(tmp_path, conn, ScriptedModel([]), "scenes/scene_01.md", GOOD, fixed_target=True)
    assert not result.ok and result.blocked


def test_kept_edits_are_committed_before_the_doctor_builds_on_them(tmp_path, conn):
    assert promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD).ok
    (tmp_path / "notes" / "k.md").write_text(GOOD.replace("Eight", "8"))
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD.replace("Eight", "8").replace("steps.", "steps, all."),
                     keep_edits=True)
    assert result.ok and git_log(tmp_path)[:2] == ["Write notes/k.md (checked by the Doctor)",
                                                    "Keep the person's edits to notes/k.md"]


def test_an_edit_is_applied_once():
    assert apply_edit("a = 1\nb = 2\n", "b = 2", "b = 3") == "a = 1\nb = 3\n"


@pytest.mark.parametrize("content, find, reason", [
    ("a = 1\n", "", "the edit had nothing to find"),
    ("a = 1\n", "b = 2", "the text to change isn't in the file"),
    ("a = 1\na = 1\n", "a = 1", "the text to change appears 2 times; include more of it"),
    ("x = 'aaa'\n", "aa", "the text to change appears 2 times; include more of it"),  # overlapping matches
])
def test_edit_failures_say_why(content, find, reason):
    with pytest.raises(ValueError) as err:
        apply_edit(content, find, "x")
    assert str(err.value) == reason


def test_a_failed_fix_counts_and_its_reason_reaches_the_next_prompt(tmp_path, conn):
    model = ScriptedModel([{"find": "nope", "replace": "x"}, {"find": "def f(:", "replace": "def f():"}])
    result = promote(tmp_path, conn, model, "src/f.py", "def f(:\n    return 1\n")
    assert result.ok and result.fixes == 1
    assert "Problem with your last fix" not in model.prompts[0][1]["content"]
    second = model.prompts[1][1]["content"]
    assert "# Problem with your last fix\nthe text to change isn't in the file" in second


def test_a_cut_off_reply_is_a_failed_fix_with_its_reason(tmp_path, conn):
    cut = ModelReplyError("the reply was cut off at 450 tokens; ask for less")
    result = promote(tmp_path, conn, ScriptedModel([cut, cut, cut]), "notes/k.md", "No header.")
    assert not result.ok and result.fixes == 0
    assert result.message.endswith("; last fix: the reply was cut off at 450 tokens; ask for less")


def test_an_edit_that_changes_nothing_is_a_failed_fix(tmp_path, conn):
    same = {"find": "No header.", "replace": "No header."}
    result = promote(tmp_path, conn, ScriptedModel([same, same, same]), "notes/k.md", "No header.")
    assert not result.ok and result.fixes == 0 and result.message.endswith("; last fix: the edit changed nothing")


@pytest.mark.parametrize("replace", ["", "  \n"])
def test_an_edit_that_empties_the_file_is_a_failed_fix(tmp_path, conn, replace):
    empty = {"find": "No header.", "replace": replace}
    result = promote(tmp_path, conn, ScriptedModel([empty, empty, empty]), "notes/k.md", "No header.")
    assert not result.ok and result.fixes == 0 and result.message.endswith("; last fix: the edit left the file empty")
    assert conn.execute("SELECT count(*) FROM learned_repairs").fetchone()[0] == 0
