"""INDEX.md: the goal, the flat list of steps with their state, and the table of contents."""

import re
from dataclasses import dataclass, field, replace
from pathlib import Path

import yaml

from memory_engine.frontmatter import atomic_write, join_frontmatter, split_frontmatter
from memory_engine.store import now_iso

INDEX_NAME = "INDEX.md"
STATUSES = ("planning", "working", "done", "stuck")
KINDS = ("notes", "film", "slides")
_STATE_OF_MARK = {" ": "todo", "x": "done", "X": "done", "!": "stuck"}
_MARK_OF_STATE = {"todo": " ", "done": "x", "stuck": "!"}
_STEP_LINE = re.compile(r"^- \[([ xX!])\] (\S.*)$")
_CONTENTS_LINE = re.compile(r"^- ([^:\s][^:]*):[ \t]*(.*)$")


_OWN_KEYS = ("goal", "status", "kind", "updated")


def _flat(text: str) -> str:
    """One line with single spaces, so a title reads back exactly as it was written."""
    return " ".join(text.split())


class IndexFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Step:
    title: str
    state: str  # "todo", "done" or "stuck"


@dataclass(frozen=True)
class Index:
    goal: str
    status: str
    steps: tuple[Step, ...]
    contents: tuple[tuple[str, str], ...]
    extra: str  # every section the router doesn't own, kept verbatim
    updated: str = ""
    preamble: str = ""  # text above "## Steps", such as a "# Title" line, kept verbatim
    other_meta: dict = field(default_factory=dict)  # frontmatter keys a person added, such as tags
    kind: str = "notes"  # what each step produces: notes, film scenes or slides


def new_index(goal: str, kind: str = "notes") -> Index:
    return Index(goal=goal, status="planning", steps=(), contents=(), extra="", kind=kind)


def parse_index(text: str) -> Index:
    try:
        meta, body = split_frontmatter(text)
    except yaml.YAMLError as err:
        raise IndexFormatError(f"INDEX.md: the YAML header can't be read: {err}") from err
    goal = meta.get("goal")
    if not goal:
        raise IndexFormatError("INDEX.md: the YAML header needs a goal")

    first_body_line = text[:len(text) - len(body)].count("\n") + 1
    steps: list[Step] = []
    contents: list[tuple[str, str]] = []
    preamble: list[str] = []
    extra: list[str] = []
    section = "preamble"
    for number, line in enumerate(body.splitlines(), start=first_body_line):
        if line.startswith("## "):
            name = line[3:].strip().lower()
            section = name if name in ("steps", "contents") else "extra"
            if section == "extra":
                extra.append(line)
            continue
        if section == "preamble":
            preamble.append(line)
        elif section == "extra":
            extra.append(line)
        elif not line.strip():
            continue
        elif section == "steps":
            match = _STEP_LINE.match(line)
            if match is None:
                raise IndexFormatError(f"INDEX.md line {number}: steps must be flat '- [ ] text' lines")
            steps.append(Step(_flat(match.group(2)), _STATE_OF_MARK[match.group(1)]))
        else:
            match = _CONTENTS_LINE.match(line)
            if match is None:
                raise IndexFormatError(f"INDEX.md line {number}: contents lines must be '- file: title'")
            contents.append((_flat(match.group(1)), _flat(match.group(2))))

    status = meta.get("status") or ("working" if steps else "planning")
    if status not in STATUSES:
        raise IndexFormatError(f"INDEX.md: unknown status {status!r}; use planning, working, done or stuck")
    kind = meta.get("kind") or "notes"
    if kind not in KINDS:
        raise IndexFormatError(f"INDEX.md: unknown kind {kind!r}; use notes, film or slides")
    updated = meta.get("updated")
    other = {key: value for key, value in meta.items() if key not in _OWN_KEYS}
    return Index(str(goal), status, tuple(steps), tuple(contents), "\n".join(extra).strip(),
                 "" if updated is None else str(updated), "\n".join(preamble).strip(), other, kind)


def render_index(index: Index) -> str:
    steps = "".join(f"- [{_MARK_OF_STATE[s.state]}] {_flat(s.title)}\n" for s in index.steps)
    contents = "".join(f"- {_flat(name)}: {_flat(title)}\n" for name, title in index.contents)
    sections = [f"## Steps\n{steps}", f"## Contents\n{contents}"]
    if index.preamble:
        sections.insert(0, index.preamble + "\n")
    if index.extra:
        sections.append(index.extra + "\n")
    meta = {"goal": index.goal, "status": index.status, "kind": index.kind, "updated": index.updated,
            **index.other_meta}
    return join_frontmatter(meta, "\n".join(sections))


def read_index(path: Path) -> Index:
    return parse_index(Path(path).read_text(encoding="utf-8"))


def write_index(path: Path, index: Index) -> None:
    atomic_write(Path(path), render_index(replace(index, updated=now_iso())))
