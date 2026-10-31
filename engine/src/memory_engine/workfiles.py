"""SCRATCHPAD.md (one step's working notes) and chunk_NNN.md (each step's saved results)."""

import re
from pathlib import Path

import yaml

from memory_engine.chunking import FENCE, strip_frontmatter
from memory_engine.frontmatter import atomic_write, join_frontmatter, split_frontmatter
from memory_engine.store import now_iso

SCRATCHPAD_NAME = "SCRATCHPAD.md"
CHUNK_PATTERN = "chunk_*.md"
MAX_TITLE = 120
_CHUNK_NAME = re.compile(r"^chunk_(\d+)\.md$")
_HTML_TAG = re.compile(r"<(?:[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?|/[A-Za-z][A-Za-z0-9-]*\s*)>|<!--")
_INLINE_CODE = re.compile(r"(`+).*?\1")


class ChunkFormatError(ValueError):
    pass


def _read_meta(path: Path) -> tuple[dict, str]:
    try:
        return split_frontmatter(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}, ""


def read_scratchpad(workspace: Path, step: str) -> str:
    """The notes for `step`; notes left from another step don't count."""
    meta, body = _read_meta(Path(workspace) / SCRATCHPAD_NAME)
    return body.strip() if meta.get("step") == step else ""


def append_scratchpad(workspace: Path, step: str, text: str) -> None:
    text = text.strip()
    if not text:
        return
    notes = read_scratchpad(workspace, step)
    atomic_write(Path(workspace) / SCRATCHPAD_NAME,
                 join_frontmatter({"step": step}, (f"{notes}\n\n{text}" if notes else text) + "\n"))


def wipe_scratchpad(workspace: Path, step: str) -> None:
    atomic_write(Path(workspace) / SCRATCHPAD_NAME, join_frontmatter({"step": step}, ""))


def html_tag(body: str) -> str | None:
    """The first HTML tag outside code blocks and inline code, or None."""
    fence: str | None = None
    for line in body.splitlines():
        marker = FENCE.match(line)
        if fence is None and marker:
            fence = marker.group(1)
            continue
        if fence is not None:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
            continue
        tag = _HTML_TAG.search(_INLINE_CODE.sub(" ", line))
        if tag:
            return tag.group(0)
    return None


def write_chunk(workspace: Path, step: str, title: str, body: str, target: str = "",
                extra_meta: dict | None = None) -> str:
    """Save one result as the next chunk_NNN.md and return its file name.

    `target` records the project file the Doctor wrote from this result.
    """
    workspace = Path(workspace)
    body = strip_frontmatter(body).strip()
    if not body:
        raise ChunkFormatError("the chunk is empty")
    tag = html_tag(body)
    if tag is not None:
        raise ChunkFormatError(f"HTML tags are not allowed: {tag}")
    title = " ".join(title.split())[:MAX_TITLE] or body.splitlines()[0].lstrip("#").strip()[:60]
    numbers = [int(m.group(1)) for p in workspace.glob(CHUNK_PATTERN) if (m := _CHUNK_NAME.match(p.name))]
    name = f"chunk_{max(numbers, default=0) + 1:03d}.md"
    meta = {"title": title, "step": step, "created": now_iso()}
    if target:
        meta["target"] = target
    meta.update(extra_meta or {})
    atomic_write(workspace / name, join_frontmatter(meta, body + "\n"))
    return name


def chunks_for_step(workspace: Path, step: str) -> list[str]:
    return sorted(p.name for p in Path(workspace).glob(CHUNK_PATTERN)
                  if _CHUNK_NAME.match(p.name) and _read_meta(p)[0].get("step") == step)
