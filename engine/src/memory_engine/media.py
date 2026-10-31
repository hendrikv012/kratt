"""Film scenes and slide decks: how the router composes the files the Doctor then checks."""

import re
from pathlib import Path

import yaml

from memory_engine.checks import _slides
from memory_engine.frontmatter import join_frontmatter, split_frontmatter

DECK_NAME = "deck.md"
SCENES_DIR = "scenes"
_SCENE_FILE = re.compile(r"^scene_(\d+)\.md$")


def next_scene_number(workspace: Path) -> int:
    """One more than the highest scene number in scenes/, from file names or scene_number headers."""
    numbers = [0]
    for path in (Path(workspace) / SCENES_DIR).glob("*.md"):
        if match := _SCENE_FILE.match(path.name):
            numbers.append(int(match.group(1)))
        try:
            value = split_frontmatter(path.read_text(encoding="utf-8"))[0].get("scene_number")
        except (OSError, yaml.YAMLError, RecursionError, ValueError):
            continue
        if isinstance(value, int) and not isinstance(value, bool):
            numbers.append(value)
    return max(numbers) + 1


def compose_scene(number: int, title: str, location: str, camera_angle: str, lighting: str,
                  visual_prompt: str, voiceover: str) -> str:
    """A scene file: the spec's YAML keys, then the visual prompt and the voiceover."""
    meta = {
        "title": title.strip() or f"Scene {number}",
        "scene_number": number,
        "location": location.strip(),
        "camera_angle": camera_angle.strip(),
        "lighting": lighting.strip(),
    }
    return join_frontmatter(meta, f"## Visual prompt\n{visual_prompt.strip()}\n\n## Voiceover\n{voiceover.strip()}\n")


def deck_from(base: str | None, goal: str, slide: str) -> str:
    """`base` (a deck's text, or None for a new deck) with `slide` added as its last slide."""
    meta: dict = {"marp": True, "title": goal.strip()[:120], "paginate": True}
    slides: list[str] = []
    if base is not None:
        meta, body = split_frontmatter(base)
        slides = [s.strip() for s in _slides(body) if s.strip()]
    return join_frontmatter(meta, "\n\n---\n\n".join(slides + [slide.strip()]) + "\n")


def deck_with(workspace: Path, goal: str, slide: str) -> str:
    """The current deck.md (if any) with `slide` added as its last slide."""
    path = Path(workspace) / DECK_NAME
    return deck_from(path.read_text(encoding="utf-8") if path.exists() else None, goal, slide)
