"""Build the model's prompt from INDEX.md, the scratchpad and search hits, within a fixed token budget.

The spec keeps the 8B model's window strictly below 2,000 tokens: a prompt of at most
PROMPT_BUDGET plus a reply of at most Settings.reply_tokens (450) stays at 1,950.
"""

import sqlite3
from collections.abc import Callable, Sequence

from memory_engine.chunking import estimate_tokens, newest_to_tokens, truncate_to_tokens
from memory_engine.embeddings import Embedder
from memory_engine.index_file import Index
from memory_engine.search import SearchHit, Source, format_hit, search_sources

PROMPT_BUDGET = 1500
INDEX_BUDGET = 250
SCRATCHPAD_BUDGET = 350
ERROR_BUDGET = 100
SEARCH_LIMIT = 5
GOAL_IN_VIEW_TOKENS = 80
CURRENT_STEP_TOKENS = 120
NOTHING_FOUND = "(nothing found)"

PLAN_SCHEMA = {
    "type": "object",
    "properties": {"steps": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 8}},
    "required": ["steps"],
}
WORK_SCHEMA = {
    "type": "object",
    "properties": {
        "scratchpad": {"type": "string"},
        "search": {"type": "string"},
        "chunk_title": {"type": "string"},
        "chunk_body": {"type": "string"},
        "step_done": {"type": "boolean"},
        "target": {"type": "string"},  # optional: only results meant to become project files have one
    },
    "required": ["scratchpad", "search", "chunk_title", "chunk_body", "step_done"],
}

_PLAN_STEP = {
    "notes": "Each step produces one short piece: a note of at most about 200 words, or code of at most about 40 lines.",
    "film": "Each step is one scene of the film: one place, one camera set-up, a short visual prompt and a short voiceover.",
    "slides": "Each step is one slide of at most 80 words.",
}


def plan_system(kind: str) -> str:
    return ("You plan work for a small local assistant. Break the goal into 3 to 8 short steps.\n"
            f"{_PLAN_STEP[kind]}\n"
            'Reply with JSON: {"steps": ["...", "..."]}.')


PLAN_SYSTEM = plan_system("notes")

WORK_SYSTEM = """You are working through a plan one step at a time. Reply with one JSON object:
- scratchpad: short working notes for this step, kept until the step is done, or "".
- search: words to look up in the project next turn, or "".
- chunk_title and chunk_body: when you have this step's result, its title and its Markdown text (at most about 200 words or 40 lines of code, no HTML tags, no YAML header); otherwise "".
- target: the project file this result should become (like notes/krebs.md or src/parse.py), or "" to keep it as a note. It is checked before it is written.
- step_done: true in the reply that saves this step's result as a chunk, or once a result is listed as saved for this step.
Use only facts from the context and your notes. Be brief."""

SLIDES_WORK_SYSTEM = """You are making a slide deck one slide at a time. Reply with one JSON object:
- scratchpad: short working notes for this slide, or "".
- search: words to look up in the project next turn, or "".
- chunk_title and chunk_body: when the slide is ready, its title and its Markdown (a "# heading" line and at most 80 words; no HTML tags, no YAML header, no lines of --- or ***); otherwise "".
- step_done: true in the reply that saves this slide, or once a slide is listed as saved for this step.
Use only facts from the context and your notes."""

FILM_WORK_SYSTEM = """You are writing a film one scene at a time. Reply with one JSON object:
- scratchpad: short working notes for this scene, or "".
- search: words to look up in the project next turn, or "".
- chunk_title: the scene's title.
- location, camera_angle, lighting: one short phrase each.
- visual_prompt: what the camera shows, for an image or video generator (at most about 80 words), or "" until the scene is ready.
- voiceover: the words spoken over the scene (at most about 80 words; "(silence)" if none), or "" until the scene is ready.
- step_done: true in the reply that gives the finished scene, or once a scene is listed as saved for this step.
Use only facts from the context and your notes. No HTML tags."""

_SLIDES_SCHEMA = {
    "type": "object",
    "properties": {key: value for key, value in WORK_SCHEMA["properties"].items() if key != "target"},
    "required": list(WORK_SCHEMA["required"]),
}
_FILM_FIELDS = ["scratchpad", "search", "chunk_title", "location", "camera_angle", "lighting", "visual_prompt", "voiceover"]
_FILM_SCHEMA = {
    "type": "object",
    "properties": {**{key: {"type": "string"} for key in _FILM_FIELDS}, "step_done": {"type": "boolean"}},
    "required": [*_FILM_FIELDS, "step_done"],
}


def work_system(kind: str) -> str:
    return {"notes": WORK_SYSTEM, "film": FILM_WORK_SYSTEM, "slides": SLIDES_WORK_SYSTEM}[kind]


def work_schema(kind: str) -> dict:
    return {"notes": WORK_SCHEMA, "film": _FILM_SCHEMA, "slides": _SLIDES_SCHEMA}[kind]


_MARK = {"todo": " ", "done": "x", "stuck": "!"}


def index_view(index: Index, current: int | None, max_tokens: int = INDEX_BUDGET) -> str:
    """INDEX.md as the model sees it, shrunk step by step until it fits `max_tokens`."""
    states = [s.state for s in index.steps]
    head = [
        f"Goal: {truncate_to_tokens(index.goal, GOAL_IN_VIEW_TOKENS)}",
        f"Progress: {states.count('done')} done, {states.count('stuck')} stuck, {states.count('todo')} to do",
    ]
    contents = "Contents: " + ", ".join(f"{name} ({title})" for name, title in index.contents)
    short_extra = truncate_to_tokens(index.extra, 60)
    everything = range(len(index.steps))
    middle = current if current is not None else 0
    window = range(max(0, middle - 2), min(len(index.steps), middle + 4))

    def build(steps: range, extra: str, with_contents: bool) -> str:
        lines = head + [f"- [{'>' if i == current else _MARK[index.steps[i].state]}] {index.steps[i].title}"
                        for i in steps]
        lines += [extra] if extra else []
        lines += [contents] if with_contents and index.contents else []
        return "\n".join(lines)

    view = ""
    for steps, extra, with_contents in ((everything, index.extra, True), (everything, index.extra, False),
                                        (everything, short_extra, False), (window, short_extra, False)):
        view = build(steps, extra, with_contents)
        if estimate_tokens(view) <= max_tokens:
            return view
    return truncate_to_tokens(view, max_tokens)


def _render(sections: list[tuple[str, str]]) -> str:
    return "\n\n".join(f"# {name}\n{text}" for name, text in sections)


def _with_search(conn: sqlite3.Connection, embedder: Embedder, system: str,
                 before: list[tuple[str, str]], query: str, after: list[tuple[str, str]],
                 on_search: Callable[[str, list[SearchHit]], None] | None = None,
                 sources: Sequence[Source] = ()) -> list[dict]:
    """The messages with search hits filling whatever budget the other sections leave.

    The hits come from the project and from every one of `sources`. `on_search` gets the query
    and the hits actually packed into the messages.
    """
    def messages(found: str) -> list[dict]:
        user = _render(before + [("From the project", found)] + after)
        return [{"role": "system", "content": system}, {"role": "user", "content": user}]

    def total(msgs: list[dict]) -> int:
        return sum(estimate_tokens(m["content"]) for m in msgs)

    # Separators between hits are not part of format_hit(), so leave a little room for them.
    fixed = messages(NOTHING_FOUND)
    if total(fixed) > PROMPT_BUDGET:
        # Every section is capped, so this is a last guard: never send more than the budget.
        fixed[1]["content"] = truncate_to_tokens(fixed[1]["content"], PROMPT_BUDGET - estimate_tokens(system))
        if on_search is not None:
            on_search(query, [])
        return fixed
    room = PROMPT_BUDGET - total(fixed) - 2 * SEARCH_LIMIT
    hits = (search_sources(conn, list(sources), query, embedder, limit=SEARCH_LIMIT, max_tokens=room)
            if room > 0 and query.strip() else [])
    while hits and total(messages("\n\n".join(format_hit(h) for h in hits))) > PROMPT_BUDGET:
        hits.pop()
    if on_search is not None:
        on_search(query, hits)
    return messages("\n\n".join(format_hit(h) for h in hits) if hits else NOTHING_FOUND)


def _problem(last_error: str) -> list[tuple[str, str]]:
    """The error's first line (what failed) and its end (why), within ERROR_BUDGET."""
    if not last_error:
        return []
    first, _, rest = last_error.partition("\n")
    first = truncate_to_tokens(first, ERROR_BUDGET // 2)
    room = ERROR_BUDGET - estimate_tokens(first) - 1
    text = first + ("\n" + newest_to_tokens(rest, room).lstrip("\n") if rest.strip() and room > 0 else "")
    return [("Problem with your last reply", text)]


def build_plan_prompt(conn: sqlite3.Connection, embedder: Embedder, index: Index, last_error: str = "",
                      on_search: Callable[[str, list[SearchHit]], None] | None = None,
                      sources: Sequence[Source] = ()) -> list[dict]:
    goal = truncate_to_tokens(index.goal, 200)
    notes = truncate_to_tokens(index.extra, 300)
    before = [("Goal", goal)] + ([("Notes", notes)] if notes else [])
    return _with_search(conn, embedder, plan_system(index.kind), before, goal, _problem(last_error), on_search,
                        sources)


def build_work_prompt(conn: sqlite3.Connection, embedder: Embedder, index: Index, current: int,
                      scratchpad: str, search_query: str, last_error: str,
                      saved: tuple[tuple[str, str], ...] = (),
                      on_search: Callable[[str, list[SearchHit]], None] | None = None,
                      sources: Sequence[Source] = ()) -> list[dict]:
    """`saved` lists (file, title) of the chunks already saved for this step."""
    step = index.steps[current]
    listed = ", ".join(f"{name} ({title})" for name, title in saved) or "nothing yet"
    before = [
        ("Index", index_view(index, current)),
        ("Current step", f"{current + 1}. {truncate_to_tokens(step.title, CURRENT_STEP_TOKENS)}\n"
                         f"Saved for this step: {truncate_to_tokens(listed, 60)}"),
        ("Your notes so far", newest_to_tokens(scratchpad, SCRATCHPAD_BUDGET).strip() or "(empty)"),
    ]
    query = search_query.strip() or truncate_to_tokens(step.title, CURRENT_STEP_TOKENS)
    return _with_search(conn, embedder, work_system(index.kind), before, query, _problem(last_error), on_search,
                        sources)
