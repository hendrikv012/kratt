"""YAML frontmatter for Markdown files, and writes that never leave a file half-written."""

import os
import secrets
import stat
from pathlib import Path

import yaml


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Return (frontmatter, body). Text without a leading `---` block has an empty frontmatter."""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip() != "---":
        return {}, text
    for i, line in enumerate(lines[1:], start=1):
        if line.rstrip() in ("---", "..."):
            meta = yaml.safe_load("".join(lines[1:i]))
            if meta is None:
                meta = {}
            if not isinstance(meta, dict):
                raise yaml.YAMLError("the header is not a list of 'key: value' lines")
            return meta, "".join(lines[i + 1:])
    return {}, text


def join_frontmatter(meta: dict, body: str) -> str:
    return "---\n" + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True) + "---\n" + body


def atomic_write(path: Path, text: str) -> None:
    """Write through a temp file in the same folder, so readers see the old file or the new one."""
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Like atomic_write, for bytes. A file that exists keeps its mode; a new one gets the
    usual mode for new files (0666 less the umask)."""
    path = Path(path)
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except FileNotFoundError:
        mode = None
    temp = path.parent / f".{path.name}.{secrets.token_hex(6)}.tmp"
    handle = os.fdopen(os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666), "wb")
    try:
        with handle:
            handle.write(data)
            handle.flush()
            if mode is not None:
                os.fchmod(handle.fileno(), mode)
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
