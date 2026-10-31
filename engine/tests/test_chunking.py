from memory_engine.chunking import estimate_tokens, split_markdown, truncate_to_tokens


def test_frontmatter_is_dropped():
    chunks = split_markdown("---\ntitle: X\n---\nHello there")
    assert [c.text for c in chunks] == ["Hello there"]


def test_sections_follow_headings():
    chunks = split_markdown("Intro\n# Krebs cycle\nRuns in the matrix.\n## Steps\nEight steps.")
    assert [(c.heading, c.text) for c in chunks] == [
        (None, "Intro"), ("Krebs cycle", "Runs in the matrix."), ("Steps", "Eight steps.")]
    assert [c.ordinal for c in chunks] == [0, 1, 2]


def test_hash_inside_code_fence_is_not_a_heading():
    chunks = split_markdown("# Code\n```python\n# not a heading\nx = 1\n```")
    assert len(chunks) == 1 and "# not a heading" in chunks[0].text


def test_long_section_is_split_within_limit():
    body = "\n\n".join(["word " * 60] * 10)
    chunks = split_markdown("# Long\n" + body, max_tokens=100)
    assert len(chunks) > 1
    assert all(c.token_estimate <= 100 for c in chunks)
    assert all(c.heading == "Long" for c in chunks)


def test_chunks_are_at_most_200_tokens_by_default():
    body = "\n\n".join(["word " * 60] * 10)
    assert estimate_tokens(body) > 1000
    chunks = split_markdown("# Long\n" + body)
    assert len(chunks) > 4
    assert all(c.token_estimate <= 200 for c in chunks)


def test_empty_document_has_no_chunks():
    assert split_markdown("   \n\n") == []


def test_non_latin_text_is_not_undercounted():
    assert estimate_tokens("Ωμέγα " * 100) >= 300


def test_long_greek_section_is_split_within_limit():
    chunks = split_markdown("# Λόγος\n" + "Ωμέγα " * 400, max_tokens=100)
    assert len(chunks) > 1
    assert all(estimate_tokens(c.text) <= 100 for c in chunks)


def test_digits_count_as_one_token_each():
    assert estimate_tokens("2026-10-06 " * 100) >= 800


def test_truncating_numbers_keeps_within_the_budget():
    cut = truncate_to_tokens("1234567890" * 100, 50)
    assert estimate_tokens(cut) <= 50 and len(cut) == 50
