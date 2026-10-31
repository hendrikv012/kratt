from dataclasses import replace

import pytest

from memory_engine.frontmatter import atomic_write, join_frontmatter, split_frontmatter
from memory_engine.index_file import IndexFormatError, Step, new_index, read_index, write_index

INDEX = """---
goal: Write a study guide on the Krebs cycle
status: working
updated: '2026-10-06T12:00:00+00:00'
---
## Steps
- [x] List the eight steps
- [ ] Explain where it happens
- [!] Draw the cycle

## Contents
- chunk_001.md: The eight steps

## Notes
Keep it under one page.
"""


def test_frontmatter_round_trip():
    assert split_frontmatter(join_frontmatter({"title": "A: b", "step": "x"}, "Body\n")) == ({"title": "A: b", "step": "x"}, "Body\n")


def test_text_without_frontmatter():
    assert split_frontmatter("Just text") == ({}, "Just text")


def test_atomic_write_leaves_only_the_file(tmp_path):
    atomic_write(tmp_path / "a.md", "old")
    atomic_write(tmp_path / "a.md", "new")
    assert [p.name for p in tmp_path.iterdir()] == ["a.md"] and (tmp_path / "a.md").read_text() == "new"


def test_read_index(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    assert index.goal == "Write a study guide on the Krebs cycle" and index.status == "working"
    assert [(s.title, s.state) for s in index.steps] == [
        ("List the eight steps", "done"), ("Explain where it happens", "todo"), ("Draw the cycle", "stuck")]
    assert index.contents == (("chunk_001.md", "The eight steps"),)
    assert index.extra == "## Notes\nKeep it under one page."


def test_write_then_read_round_trips(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    write_index(tmp_path / "INDEX.md", index)
    assert replace(read_index(tmp_path / "INDEX.md"), updated="") == replace(index, updated="")


def test_user_sections_survive_a_rewrite(tmp_path):                   
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    write_index(tmp_path / "INDEX.md", replace(index, steps=index.steps + (Step("Quiz yourself", "todo"),)))
    text = (tmp_path / "INDEX.md").read_text()
    assert "## Notes\nKeep it under one page." in text and "- [ ] Quiz yourself" in text


def test_nested_steps_are_refused(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("- [ ] Explain", "  - [ ] Explain"))
    with pytest.raises(IndexFormatError, match="INDEX.md line 8: steps must be flat"):
        read_index(tmp_path / "INDEX.md")


def test_bad_yaml_is_a_readable_error(tmp_path):
    (tmp_path / "INDEX.md").write_text("---\ngoal: [unclosed\n---\n## Steps\n")
    with pytest.raises(IndexFormatError, match="INDEX.md"):
        read_index(tmp_path / "INDEX.md")


def test_new_index_renders_flat_sections(tmp_path):
    write_index(tmp_path / "INDEX.md", new_index("Learn: the cycle"))
    meta, body = split_frontmatter((tmp_path / "INDEX.md").read_text())
    assert meta["goal"] == "Learn: the cycle" and meta["status"] == "planning"
    assert body.startswith("## Steps\n") and "## Contents\n" in body


@pytest.mark.parametrize("preamble", ["# Krebs study plan", "Just a sentence about the plan.",
                                      "- Read: chapter 3\n- Ask: the teacher"])
def test_text_above_the_steps_survives_round_trips(tmp_path, preamble):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("---\n## Steps", f"---\n{preamble}\n\n## Steps"))
    first = read_index(tmp_path / "INDEX.md")
    assert first.contents == (("chunk_001.md", "The eight steps"),)
    write_index(tmp_path / "INDEX.md", first)
    assert replace(read_index(tmp_path / "INDEX.md"), updated="") == replace(first, updated="")
    assert (tmp_path / "INDEX.md").read_text().split("---\n", 2)[2].startswith(preamble + "\n")


def test_step_titles_are_normalised_when_read(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("Explain where it happens", "Explain  where   it happens "))
    assert read_index(tmp_path / "INDEX.md").steps[1].title == "Explain where it happens"


def test_person_frontmatter_keys_survive(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("status: working\n", "status: working\ntags: [biology, exam]\n"))
    write_index(tmp_path / "INDEX.md", read_index(tmp_path / "INDEX.md"))
    assert split_frontmatter((tmp_path / "INDEX.md").read_text())[0]["tags"] == ["biology", "exam"]



def test_kind_defaults_to_notes_and_round_trips(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    assert read_index(tmp_path / "INDEX.md").kind == "notes"
    write_index(tmp_path / "INDEX.md", new_index("Film it", kind="film"))
    assert read_index(tmp_path / "INDEX.md").kind == "film"
    assert split_frontmatter((tmp_path / "INDEX.md").read_text())[0]["kind"] == "film"


def test_unknown_kind_is_a_readable_error(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("status: working\n", "status: working\nkind: opera\n"))
    with pytest.raises(IndexFormatError, match="unknown kind 'opera'"):
        read_index(tmp_path / "INDEX.md")
