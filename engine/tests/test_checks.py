import os

import pytest

from pathlib import Path

from conftest import needs_bwrap, needs_marp
from memory_engine.checks import MARP_DIR, MARP_CLI
from memory_engine.checks import (
    CheckUnavailable,
    TargetError,
    check_deck,
    check_markdown,
    check_python,
    check_scene,
    check_slide,
    render_deck,
    resolve_target,
)


@pytest.mark.parametrize("target, message", [
    ("/etc/notes.md", "must be a path inside the workspace"),
    ("../notes.md", "must be a path inside the workspace"),
    ("", "must be a path inside the workspace"),
    ("INDEX.md", "router's own files"),
    ("chunk_003.md", "router's own files"),
    (".git/notes.md", "router's own files"),
    ("notes/x.txt", "only .md and .py"),
])
def test_bad_targets_are_refused(tmp_path, target, message):
    with pytest.raises(TargetError, match=message):
        resolve_target(tmp_path, target, set())


def test_symlink_out_of_the_workspace_is_refused(tmp_path):
    workspace, outside = tmp_path / "ws", tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "link").symlink_to(outside)
    with pytest.raises(TargetError, match="goes through a link"):
        resolve_target(workspace, "link/x.md", set())


def test_existing_files_are_only_replaced_when_the_doctor_wrote_them(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "mine.md").write_text("Mine.")
    with pytest.raises(TargetError, match="was not written by the Doctor"):
        resolve_target(tmp_path, "notes/mine.md", set())
    assert resolve_target(tmp_path, "notes/mine.md", {"notes/mine.md"}) == (tmp_path / "notes" / "mine.md").resolve()
    assert resolve_target(tmp_path, "notes/new.md", set()) == (tmp_path / "notes" / "new.md").resolve()


GOOD_MD = "---\ntitle: Krebs cycle\n---\nEight steps in the matrix.\n"


def test_good_markdown_passes():
    assert check_markdown(GOOD_MD) == []


@pytest.mark.parametrize("content, trace", [
    ("Eight steps.", "the file needs a YAML header with a title"),
    ("---\nauthor: me\n---\nText.", "the YAML header needs a title"),
    ("---\ntitle: [x\n---\nText.", "the YAML header can't be read"),
    ("---\ntitle: T\n---\n<div>x</div>", "HTML tags are not allowed: <div>"),
])
def test_markdown_problems(content, trace):
    problems = check_markdown(content)
    assert problems[0].kind == "format" and trace in problems[0].trace


def test_long_slide_is_reported():
    deck = "---\ntitle: Deck\nmarp: true\n---\n# One\nShort.\n\n---\n\n# Two\n" + "word " * 81
    assert [p.trace for p in check_markdown(deck)] == ["slide 2 has 82 words; the limit is 80"]  # "Two" + 81 words


def test_slide_rule_only_applies_to_decks():
    assert check_markdown("---\ntitle: Notes\n---\n" + "word " * 200) == []


@needs_bwrap
@pytest.mark.parametrize("content, kind, check, trace", [
    ("def f(:\n    pass\n", "compile", "py_compile", "SyntaxError"),
    ("import os\n\ndef f() -> int:\n    return 1\n", "lint", "ruff", "F401"),
    ("def f(x: int) -> str:\n    return x\n", "lint", "mypy", "Incompatible return value type"),
])


def test_python_problems(tmp_path, content, kind, check, trace):
    problems = check_python(tmp_path, "calc.py", content)
    assert [(p.kind, p.check) for p in problems] == [(kind, check)] and trace in problems[0].trace


@needs_bwrap
def test_failing_project_test_is_reported_and_passing_code_is_clean(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n")
    broken = check_python(tmp_path, "calc.py", "def add(a: int, b: int) -> int:\n    return a - b\n")
    assert [(p.kind, p.check) for p in broken] == [("test", "pytest")] and "assert -1 == 3" in broken[0].trace
    assert check_python(tmp_path, "calc.py", "def add(a: int, b: int) -> int:\n    return a + b\n") == []
    assert not (tmp_path / "calc.py").exists()


def test_too_big_workspace_is_explained(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.checks.COPY_LIMIT", 10)
    (tmp_path / "big.md").write_text("x" * 100)
    with pytest.raises(CheckUnavailable, match="too big to check"):
        check_python(tmp_path, "calc.py", "x = 1\n")


@pytest.mark.parametrize("target", ["yaml.py", "json.py", "os.py", "mypy.py", "json/__init__.py"])
def test_names_that_would_hide_a_python_module_are_refused(tmp_path, target):
    with pytest.raises(TargetError, match="would hide the Python module"):
        resolve_target(tmp_path, target, set())


def test_ordinary_python_names_are_allowed(tmp_path):
    assert resolve_target(tmp_path, "calc.py", set()) == (tmp_path / "calc.py").resolve()
    assert resolve_target(tmp_path, "src/yaml.py", set()) == (tmp_path / "src" / "yaml.py").resolve()


@pytest.mark.parametrize("target, message", [
    ("*.md", "characters that aren't allowed"),
    ("notes/a?.md", "characters that aren't allowed"),
    ("no\x00te.md", "characters that aren't allowed"),
    ("notes:x.md", "characters that aren't allowed"),
    ("-v.py", "may not start with -"),
    ("x" * 120 + ".md", "too long"),
])
def test_odd_names_are_refused(tmp_path, target, message):
    with pytest.raises(TargetError, match=message):
        resolve_target(tmp_path, target, set())


def test_a_link_in_the_path_is_refused(tmp_path):
    (tmp_path / "real").mkdir()
    (tmp_path / "lib").symlink_to(tmp_path / "real")
    with pytest.raises(TargetError, match="goes through a link"):
        resolve_target(tmp_path, "lib/x.py", set())
    (tmp_path / "mine.md").write_text("Mine.")
    (tmp_path / "k.md").symlink_to(tmp_path / "mine.md")
    with pytest.raises(TargetError, match="goes through a link"):
        resolve_target(tmp_path, "k.md", {"k.md"})


def test_a_file_in_place_of_a_folder_is_refused(tmp_path):
    (tmp_path / "notes.md").write_text("x")
    with pytest.raises(TargetError, match="is a file, not a folder"):
        resolve_target(tmp_path, "notes.md/x.md", set())


def test_deeply_nested_yaml_is_a_problem_not_a_crash():
    problems = check_markdown("---\ntitle: " + "[" * 600 + "\n---\nText.")
    assert problems and "can't be read" in problems[0].trace


@needs_bwrap
def test_special_and_unreadable_files_are_left_out_of_the_copy(tmp_path):
    os.mkfifo(tmp_path / "pipe")
    locked = tmp_path / "locked.txt"
    locked.write_text("x")
    locked.chmod(0)
    try:
        assert check_python(tmp_path, "calc.py", "x = 1\n") == []
    finally:
        locked.chmod(0o600)


@needs_bwrap
def test_missing_check_tools_are_explained(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.checks.TOOL_MODULES", ("ruff", "no_such_tool_xyz"))
    monkeypatch.setattr("memory_engine.checks._tools_ready", {})
    with pytest.raises(CheckUnavailable, match="checking tools can't run"):
        check_python(tmp_path, "calc.py", "x = 1\n")


@needs_bwrap
def test_the_workspace_cannot_replace_a_check_tool(tmp_path):
    (tmp_path / "mypy.py").write_text("raise SystemExit(0)\n")
    problems = check_python(tmp_path, "calc.py", "def f(x: int) -> str:\n    return x\n")
    assert [(p.kind, p.check) for p in problems] == [("lint", "mypy")]


@needs_bwrap
def test_tests_that_switch_themselves_off_do_not_count_as_passing(tmp_path):
    (tmp_path / "conftest.py").write_text('collect_ignore_glob = ["*"]\n')
    (tmp_path / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n")
    problems = check_python(tmp_path, "calc.py", "def add(a: int, b: int) -> int:\n    return a - b\n")
    assert [(p.kind, p.check) for p in problems] == [("test", "pytest")] and "no tests" in problems[0].trace



SCENE = ("---\ntitle: Arrival\nscene_number: 1\nlocation: University lab, night\ncamera_angle: Wide shot, slow push-in\n"
         "lighting: Cold fluorescent light\n---\n## Visual prompt\nA quiet lab at night.\n\n## Voiceover\nIt began here.\n")


def test_a_good_scene_passes():
    assert check_scene(SCENE) == []


@pytest.mark.parametrize("change, trace", [
    (("location: University lab, night\n", ""), "the YAML header needs location"),
    (("lighting: Cold fluorescent light", "lighting: ''"), "the YAML header needs lighting"),
    (("scene_number: 1", "scene_number: first"), "scene_number must be a whole number from 1 up"),
    (("camera_angle: Wide shot, slow push-in", "camera_angle: " + "x" * 121), "camera_angle must be at most 120 characters"),
    (("## Voiceover\nIt began here.\n", ""), 'the scene needs exactly two sections: "## Visual prompt" and "## Voiceover"'),
    (("It began here.", ""), "the Voiceover section is empty"),
    (("A quiet lab at night.", "A <b>quiet</b> lab."), "HTML tags are not allowed: <b>"),
])
def test_scene_problems(change, trace):
    assert trace in [p.trace for p in check_scene(SCENE.replace(*change))]


DECK = "---\nmarp: true\ntitle: Krebs\npaginate: true\n---\n# One\nShort.\n\n---\n\n# Two\nMore.\n"


@pytest.mark.parametrize("rule", ["***", "___", "- - -"])
def test_a_line_marp_reads_as_a_break_is_refused(rule):
    traces = [p.trace for p in check_deck(DECK.replace("More.", f"More.\n\n{rule}\n\nEven more."))]
    assert traces == [f"slide 2 has a line of {rule}, which Marp reads as a new slide"]


def test_a_deck_needs_the_marp_header():
    assert "the YAML header needs marp: true" in [p.trace for p in check_deck(DECK.replace("marp: true\n", ""))]


@needs_marp
def test_a_good_deck_renders():
    assert check_deck(DECK) == [] and render_deck(DECK) == 2


@needs_marp
def test_marp_counts_its_own_breaks():
    assert render_deck(DECK.replace("More.", "More.\n\n***\n\nEven more.")) == 3


def test_a_missing_marp_tool_is_explained(monkeypatch):
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", Path("/nonexistent/marp-cli.js"))
    with pytest.raises(CheckUnavailable, match="npm ci --prefix tools/marp"):
        check_deck(DECK)


@pytest.mark.parametrize("slide, trace", [
    ("# Steps\nA.\n\n---\n\nB.", "the slide has a line of ---, which starts a new slide; put one slide in each step"),
    ("# Code\n```\nprint(1)", "the slide opens a code block without closing it"),
    ("Steps\nA.", 'the slide must start with a "# heading" line'),
    ("# Steps\nA.\n\n***\n\nB.", "the slide has a line of ***, which Marp reads as a new slide"),
    ("# Steps\n" + "word " * 81, "the slide has 82 words; the limit is 80"),
])
def test_a_slide_must_be_one_clean_slide(slide, trace):
    assert trace in [p.trace for p in check_slide(slide)]


def test_a_good_slide_passes():
    assert check_slide("# Steps\nEight of them.") == []


@needs_marp
def test_background_images_count_as_one_slide():
    deck = DECK.replace("Short.", "![bg](x.png)\nShort.")
    assert render_deck(deck) == 2 and check_deck(deck) == []


@needs_marp
def test_marp_works_from_a_folder_with_a_space(tmp_path, monkeypatch):
    spaced = tmp_path / "marp tools"
    spaced.symlink_to(MARP_DIR)
    monkeypatch.setattr("memory_engine.checks.MARP_DIR", spaced)
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", spaced / MARP_CLI.relative_to(MARP_DIR))
    monkeypatch.setattr("memory_engine.checks._marp_ready", {})
    assert render_deck(DECK) == 2


@needs_marp
def test_a_broken_marp_tool_is_explained(tmp_path, monkeypatch):
    fake = tmp_path / "marp"
    (fake / "bin").mkdir(parents=True)
    (fake / "bin" / "marp-cli.js").write_text("throw new Error('half installed')\n")
    monkeypatch.setattr("memory_engine.checks.MARP_DIR", fake)
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", fake / "bin" / "marp-cli.js")
    monkeypatch.setattr("memory_engine.checks._marp_ready", {})
    with pytest.raises(CheckUnavailable, match="the Marp tool doesn't work"):
        check_deck(DECK)


@pytest.mark.parametrize("change, trace", [
    (("location: University lab, night", "location: [lab, night]"), "location must be text"),
    (("title: Arrival", "title: " + "x" * 121), "title must be at most 120 characters"),
])
def test_scene_fields_must_be_short_text(change, trace):
    assert trace in [p.trace for p in check_scene(SCENE.replace(*change))]
