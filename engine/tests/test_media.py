from memory_engine.frontmatter import split_frontmatter
from memory_engine.media import compose_scene, deck_with, next_scene_number



def test_compose_scene_writes_the_spec_keys():
    meta, body = split_frontmatter(compose_scene(3, "", " Lab ", "Wide", "Cold", "A lab.", "It began."))
    assert meta == {"title": "Scene 3", "scene_number": 3, "location": "Lab", "camera_angle": "Wide", "lighting": "Cold"}
    assert body == "## Visual prompt\nA lab.\n\n## Voiceover\nIt began.\n"


def test_scene_numbers_continue_after_the_highest(tmp_path):
    assert next_scene_number(tmp_path) == 1
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_07.md").write_text(compose_scene(7, "T", "L", "C", "Li", "V", "O"))
    (tmp_path / "scenes" / "broken.md").write_text("---\nscene_number: first\n---\n")
    assert next_scene_number(tmp_path) == 8


def test_deck_with_starts_and_extends_a_deck(tmp_path):
    first = deck_with(tmp_path, "Krebs cycle", "# One\nShort.")
    assert split_frontmatter(first)[0] == {"marp": True, "title": "Krebs cycle", "paginate": True}
    (tmp_path / "deck.md").write_text(first)
    assert split_frontmatter(deck_with(tmp_path, "ignored", "# Two\nMore."))[1] == "# One\nShort.\n\n---\n\n# Two\nMore.\n"
