import pytest

from memory_engine.frontmatter import split_frontmatter
from memory_engine.workfiles import (
    ChunkFormatError,
    append_scratchpad,
    chunks_for_step,
    read_scratchpad,
    wipe_scratchpad,
    write_chunk,
)


def test_scratchpad_append_and_read(tmp_path):
    append_scratchpad(tmp_path, "List the steps", "First idea.")
    append_scratchpad(tmp_path, "List the steps", "Second idea.")
    assert read_scratchpad(tmp_path, "List the steps") == "First idea.\n\nSecond idea."
    assert split_frontmatter((tmp_path / "SCRATCHPAD.md").read_text())[0] == {"step": "List the steps"}


def test_scratchpad_belongs_to_one_step(tmp_path):
    append_scratchpad(tmp_path, "A", "About A.")
    assert read_scratchpad(tmp_path, "B") == ""
    append_scratchpad(tmp_path, "B", "About B.")
    assert read_scratchpad(tmp_path, "B") == "About B."


def test_wipe_scratchpad(tmp_path):
    append_scratchpad(tmp_path, "A", "Notes.")
    wipe_scratchpad(tmp_path, "B")
    assert read_scratchpad(tmp_path, "B") == "" and split_frontmatter((tmp_path / "SCRATCHPAD.md").read_text()) == ({"step": "B"}, "")


def test_missing_scratchpad_reads_empty(tmp_path):
    assert read_scratchpad(tmp_path, "A") == ""


def test_chunks_are_numbered_with_frontmatter(tmp_path):
    assert write_chunk(tmp_path, "List the steps", "Eight steps", "1. Citrate\n2. Isocitrate") == "chunk_001.md"
    assert write_chunk(tmp_path, "Explain", "Location", "In the matrix.") == "chunk_002.md"
    meta, body = split_frontmatter((tmp_path / "chunk_001.md").read_text())
    assert (meta["title"], meta["step"], body.strip()) == ("Eight steps", "List the steps", "1. Citrate\n2. Isocitrate")


def test_numbering_continues_after_the_highest(tmp_path):
    (tmp_path / "chunk_007.md").write_text("---\ntitle: old\nstep: x\n---\nOld.")
    assert write_chunk(tmp_path, "s", "t", "New.") == "chunk_008.md"


def test_html_in_a_chunk_is_refused(tmp_path):
    with pytest.raises(ChunkFormatError, match="HTML tags are not allowed: <div>"):
        write_chunk(tmp_path, "s", "t", "Intro\n<div>hi</div>")
    assert list(tmp_path.glob("chunk_*.md")) == []


def test_angle_brackets_in_code_are_allowed(tmp_path):
    write_chunk(tmp_path, "s", "Generics", "Use `List<int>` here.\n\n```java\nMap<String, Integer> m;\n```\n\n2 < 3 and 5 > 4.")


def test_model_frontmatter_is_replaced(tmp_path):
    name = write_chunk(tmp_path, "s", "Real title", "---\ntitle: Fake\n---\nText.")
    meta, body = split_frontmatter((tmp_path / name).read_text())
    assert meta["title"] == "Real title" and body.strip() == "Text."


def test_empty_chunk_is_refused(tmp_path):
    with pytest.raises(ChunkFormatError, match="empty"):
        write_chunk(tmp_path, "s", "t", "  \n")


def test_chunks_for_step(tmp_path):
    write_chunk(tmp_path, "A", "t1", "One.")
    write_chunk(tmp_path, "B", "t2", "Two.")
    write_chunk(tmp_path, "A", "t3", "Three.")
    assert chunks_for_step(tmp_path, "A") == ["chunk_001.md", "chunk_003.md"]


@pytest.mark.parametrize("tag", ["<br/>", "<hr/>"])
def test_self_closing_html_is_refused(tmp_path, tag):
    with pytest.raises(ChunkFormatError, match=tag):
        write_chunk(tmp_path, "s", "t", f"Line one{tag}Line two")
