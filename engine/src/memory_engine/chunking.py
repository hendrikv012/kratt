"""Split Markdown into heading sections small enough for an 8B model's context."""

import math
import re
from dataclasses import dataclass

HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
BLANK_LINES = re.compile(r"\n[ \t]*\n")
CHUNK_TOKENS = 200  # the largest Markdown chunk: small enough that several different notes fit in a prompt


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    heading: str | None
    text: str
    token_estimate: int


def estimate_tokens(text: str) -> int:
    """A deliberately high token estimate: each digit is a token, every other 3 UTF-8 bytes are one.

    Plain English runs about 4 characters per token, but code and non-Latin scripts use far
    more tokens per character, and Qwen tokenizers split numbers into single digits.
    """
    digits = sum(text.count(d) for d in "0123456789")
    return math.ceil((len(text.encode("utf-8")) - digits) / 3) + digits


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """The longest prefix of `text` whose estimate is at most `max_tokens`."""
    if estimate_tokens(text) <= max_tokens:
        return text
    low, high = 0, len(text)  # estimate_tokens grows with length, so search for the cut
    while low < high:
        middle = (low + high + 1) // 2
        if estimate_tokens(text[:middle]) <= max_tokens:
            low = middle
        else:
            high = middle - 1
    return text[:low]


def newest_to_tokens(text: str, max_tokens: int) -> str:
    """The longest suffix of `text` whose estimate is at most `max_tokens`."""
    if estimate_tokens(text) <= max_tokens:
        return text
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if estimate_tokens(text[len(text) - middle:]) <= max_tokens:
            low = middle
        else:
            high = middle - 1
    return text[len(text) - low:]


def strip_frontmatter(text: str) -> str:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip() != "---":
        return text
    for i, line in enumerate(lines[1:], start=1):
        if line.rstrip() in ("---", "..."):
            return "".join(lines[i + 1:])
    return text


def _sections(text: str) -> list[tuple[str | None, str]]:
    sections: list[tuple[str | None, list[str]]] = [(None, [])]
    fence: str | None = None
    for line in text.splitlines():
        marker = FENCE.match(line)
        if fence is None and marker:
            fence = marker.group(1)
        elif fence is not None and marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
            fence = None
        elif fence is None and (heading := HEADING.match(line)):
            title = (heading.group(1) or "").rstrip("#").strip()
            sections.append((title or None, []))
            continue
        sections[-1][1].append(line)
    return [(heading, "\n".join(lines).strip()) for heading, lines in sections]


def pack(parts: list[str], max_tokens: int, joiner: str) -> list[str]:
    """Join consecutive parts while they fit in max_tokens; a part too big on its own is cut."""
    pieces: list[str] = []
    current: str | None = None
    for part in parts:
        joined = part if current is None else f"{current}{joiner}{part}"
        if estimate_tokens(joined) <= max_tokens:
            current = joined
            continue
        if current is not None:
            pieces.append(current)
        while estimate_tokens(part) > max_tokens:
            head = truncate_to_tokens(part, max_tokens) or part[0]
            pieces.append(head)
            part = part[len(head):]
        current = part
    if current is not None:
        pieces.append(current)
    return pieces


def _pieces(body: str, max_tokens: int) -> list[str]:
    if estimate_tokens(body) <= max_tokens:
        return [body]
    return pack([p.strip() for p in BLANK_LINES.split(body) if p.strip()], max_tokens, "\n\n")


def split_code(text: str, max_tokens: int) -> list[str]:
    """Split source at line ends into pieces within max_tokens, keeping indentation."""
    pieces = (piece.strip("\n").rstrip() for piece in pack(text.split("\n"), max_tokens, "\n"))
    return [piece for piece in pieces if piece.strip()]


def split_markdown(text: str, max_tokens: int = CHUNK_TOKENS) -> list[Chunk]:
    """Split at headings (ignoring code fences), then at blank lines, so no chunk exceeds max_tokens."""
    chunks: list[Chunk] = []
    for heading, body in _sections(strip_frontmatter(text)):
        for piece in _pieces(body, max_tokens):
            piece = piece.strip()
            if piece:
                chunks.append(Chunk(len(chunks), heading, piece, estimate_tokens(piece)))
    return chunks
