"""The router: works through INDEX.md one step at a time with the local 8B model.

The files are the state. Every turn re-reads INDEX.md, so a person can edit it between runs,
and every write is atomic, so an interrupted run resumes where it stopped.
"""

import re
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path

import yaml

from memory_engine.chat import ChatModel, ModelReplyError
from memory_engine.checks import SCENE_KEYS, CheckUnavailable, Problem, check_deck, check_slide
from memory_engine.context import PLAN_SCHEMA, build_plan_prompt, build_work_prompt, work_schema
from memory_engine.doctor import doctor_state, promote
from memory_engine.embeddings import Embedder
from memory_engine.frontmatter import join_frontmatter, split_frontmatter
from memory_engine.index_file import INDEX_NAME, Index, Step, new_index, read_index, write_index
from memory_engine.media import DECK_NAME, SCENES_DIR, compose_scene, deck_from, next_scene_number
from memory_engine.sandbox import SandboxUnavailable
from memory_engine.reindex import reindex_folder
from memory_engine.runlog import RunLog
from memory_engine.search import Source
from memory_engine.store import index_markdown
from memory_engine.workfiles import (
    ChunkFormatError,
    append_scratchpad,
    chunks_for_step,
    read_scratchpad,
    wipe_scratchpad,
    write_chunk,
)

MAX_STEPS = 8
MAX_STEP_TITLE = 120
FINISH_FIRST = "Save this step's result as a chunk before finishing it."


@dataclass(frozen=True)
class RunReport:
    status: str  # "done", "stuck", "paused" or "blocked" (the person has to fix a tool or a file)
    steps_done: int  # in this run
    turns: int  # model calls in this run
    stuck_step: str | None = None  # a step title, or "plan"
    reason: str = ""  # the last error when a run got stuck


@dataclass
class _Turn:
    error: str = ""
    search: str = ""
    finished: bool = False
    events: list[str] = field(default_factory=list)
    blocked: bool = False  # the person has to act (a tool, a file); asking the model again won't help


def _has_header(text: str) -> bool:
    return text.splitlines()[:1] == ["---"]


def _clean_steps(value) -> list[str]:
    if not isinstance(value, list):
        raise ModelReplyError("the reply is missing: steps")
    steps = [" ".join(str(s).split())[:MAX_STEP_TITLE] for s in value]
    steps = [s for s in steps if s][:MAX_STEPS]
    if not steps:
        raise ModelReplyError("the plan had no steps")
    return steps


def _mark(index_path: Path, title: str, state: str) -> Index | None:
    """Set the first unfinished step called `title` to `state` in INDEX.md as it is on disk now.

    The model call before this can take minutes, and a person may have edited INDEX.md meanwhile,
    so the file is re-read and the step found by title, never by an old position.
    """
    index = read_index(index_path)
    for position, step in enumerate(index.steps):
        if step.title == title and step.state == "todo":
            steps = list(index.steps)
            steps[position] = replace(step, state=state)
            index = replace(index, steps=tuple(steps), status="stuck" if state == "stuck" else index.status)
            write_index(index_path, index)
            return index
    return None


def _saved(workspace: Path, title: str) -> tuple[tuple[str, str], ...]:
    def chunk_title(name: str) -> str:
        return str(split_frontmatter((workspace / name).read_text(encoding="utf-8"))[0].get("title", ""))

    return tuple((name, chunk_title(name)) for name in chunks_for_step(workspace, title))


def _plan_turn(conn: sqlite3.Connection, embedder: Embedder, model: ChatModel, index_path: Path,
               last_error: str, log: RunLog, sources: Sequence[Source] = ()) -> _Turn:
    messages = build_plan_prompt(conn, embedder, read_index(index_path), last_error,
                                 on_search=lambda query, hits: log.search(None, query, hits), sources=sources)
    try:
        reply = model.complete(messages, PLAN_SCHEMA)
    except ModelReplyError as err:
        log.model(None, messages, str(err))
        return _Turn(error=str(err), events=[f"plan failed: {err}"])
    log.model(None, messages, reply)
    try:
        steps = _clean_steps(reply.get("steps"))
    except ModelReplyError as err:
        return _Turn(error=str(err), events=[f"plan failed: {err}"])
    index = read_index(index_path)
    if not index.steps:  # a person may have written steps while the model was planning; theirs win
        write_index(index_path, replace(index, status="working", steps=tuple(Step(s, "todo") for s in steps)))
    count = f"{len(steps)} step" + ("" if len(steps) == 1 else "s")
    return _Turn(finished=True, events=[f"planned {count}"])


def _save_chunk(workspace: Path, conn: sqlite3.Connection, embedder: Embedder, index_path: Path, step: str,
                title: str, body: str, target: str = "", extra_meta: dict | None = None) -> str:
    """Write the step's chunk, list it in Contents and make it searchable.

    For a file the Doctor already wrote, a text that can't be a chunk becomes "Saved as …",
    so the chunk always records the file.
    """
    try:
        name = write_chunk(workspace, step, title, body, target=target, extra_meta=extra_meta)
    except ChunkFormatError:
        if not target:
            raise
        name = write_chunk(workspace, step, title, f"Saved as {target}.", target=target, extra_meta=extra_meta)
    text = (workspace / name).read_text(encoding="utf-8")
    fresh = read_index(index_path)
    write_index(index_path, replace(fresh, contents=fresh.contents + ((name, split_frontmatter(text)[0]["title"]),)))
    index_markdown(conn, name, text, embedder)
    return name


def _refused(turn: _Turn, target: str, promotion) -> _Turn:
    if promotion.blocked:
        turn.blocked, turn.error = True, promotion.message
        turn.events.append(f"stopped: {promotion.message}")
        return turn
    turn.error = f"the Doctor did not accept {target}: {promotion.message}"
    turn.events.append(f"failed: the Doctor did not accept {target}")
    return turn


def _scene_number_rule(number: int) -> Callable[[str], list[Problem]]:
    def rule(content: str) -> list[Problem]:
        try:
            value = split_frontmatter(content)[0].get("scene_number")
        except (yaml.YAMLError, RecursionError, ValueError):
            return []  # check_scene reports the unreadable header
        return [] if value == number else [Problem("format", "scene", f"scene_number must stay {number}")]
    return rule


def _film_result(workspace, conn, embedder, model, index_path, step, reply, turn, log, on_fix=None) -> bool:
    """A finished scene becomes scenes/scene_NN.md; False when nothing was saved this turn."""
    visual, voice = str(reply["visual_prompt"] or "").strip(), str(reply["voiceover"] or "").strip()
    if not (visual and voice):
        if visual or voice or reply["step_done"] is True:
            missing = " and ".join(name for name, value in (("visual_prompt", visual), ("voiceover", voice)) if not value)
            turn.error = (f"the scene is missing {missing}: give both visual_prompt and voiceover "
                          '(write "(silence)" for a scene without words)')
            turn.events.append(f"failed: the scene is missing {missing}")
        return False
    number = next_scene_number(workspace)
    target = f"{SCENES_DIR}/scene_{number:02d}.md"
    content = compose_scene(number, str(reply["chunk_title"] or ""), str(reply["location"] or ""),
                            str(reply["camera_angle"] or ""), str(reply["lighting"] or ""), visual, voice)
    promotion = promote(workspace, conn, model, target, content, rules="scene",
                        check_piece=_scene_number_rule(number), fixed_target=True, on_fix=on_fix)
    log.doctor(promotion)
    if not promotion.ok:
        _refused(turn, target, promotion)
        return False
    meta, body = split_frontmatter(promotion.content)
    _save_chunk(workspace, conn, embedder, index_path, step, str(meta["title"]), body, target=target,
                extra_meta={key: meta[key] for key in SCENE_KEYS})
    turn.events.append(promotion.message)
    return True


def _slide_result(workspace, conn, embedder, model, index_path, step, goal, reply, turn, log, on_fix=None) -> bool:
    """A finished slide is added to deck.md once the whole deck passes; False when nothing was saved.

    The deck is read once: a deck the person edited is kept (the user's rule), but only after it passes
    the deck checks on its own, so the model is never asked to fix the person's slides.
    """
    body = str(reply["chunk_body"] or "")
    if not body.strip():
        if reply["step_done"] is True:
            turn.error = "Give this step's slide in chunk_body before finishing it."
            turn.events.append(f"failed: {turn.error}")
        return False
    deck = workspace / DECK_NAME
    base = deck.read_text(encoding="utf-8") if deck.is_file() else None
    if base is not None and doctor_state(workspace, DECK_NAME) != "clean":
        try:
            problems = check_deck(base)
        except (CheckUnavailable, SandboxUnavailable) as err:
            problems = []
            turn.blocked, turn.error = True, str(err)
        if problems:
            turn.blocked = True
            turn.error = (f"{DECK_NAME} has a problem from its last edit, so no slide was added: "
                          f"{'; '.join(p.trace for p in problems)}. Fix {DECK_NAME}, then run again")
        if turn.blocked:
            turn.events.append(f"stopped: {turn.error}")
            return False
    promotion = promote(workspace, conn, model, DECK_NAME, body, rules="deck",
                        assemble=lambda slide: deck_from(base, goal, slide), check_piece=check_slide,
                        fixed_target=True, keep_edits=True, on_fix=on_fix)
    log.doctor(promotion)
    if not promotion.ok:
        _refused(turn, DECK_NAME, promotion)
        return False
    _save_chunk(workspace, conn, embedder, index_path, step, str(reply["chunk_title"] or ""), promotion.content,
                target=DECK_NAME)
    turn.events.append(promotion.message)
    return True


def _notes_result(workspace, conn, embedder, model, index_path, step, reply, turn, log, on_fix=None) -> bool:
    """A note becomes a chunk; with a target it first becomes a project file through the Doctor."""
    body = str(reply["chunk_body"] or "")
    if not body.strip():
        return True
    target = str(reply.get("target") or "").strip()
    chunk_title = str(reply["chunk_title"] or "")
    if not target:
        try:
            name = _save_chunk(workspace, conn, embedder, index_path, step, chunk_title, body)
        except ChunkFormatError as err:
            turn.error = str(err)
            turn.events.append(f"failed: {err}")
            return False
        turn.events.append(f"saved {name}")
        return True
    if target.endswith(".md") and not _has_header(body):
        body = join_frontmatter({"title": chunk_title.strip() or body.strip().splitlines()[0].lstrip("#").strip()}, body)
    promotion = promote(workspace, conn, model, target, body, on_fix=on_fix)
    log.doctor(promotion)
    if not promotion.ok:
        _refused(turn, target, promotion)
        return False
    body = promotion.content
    if target.endswith(".py"):
        # Chunk files are Markdown: code goes in a fence (where "a<b>c" isn't mistaken for HTML),
        # one backtick longer than any run of backticks inside the code.
        fence = "`" * max(3, max((len(run) for run in re.findall(r"`+", body)), default=0) + 1)
        body = f"{fence}python\n{body.rstrip()}\n{fence}"
    _save_chunk(workspace, conn, embedder, index_path, step, chunk_title, body, target=target)
    turn.events.append(promotion.message)
    return True


def _work_turn(workspace: Path, conn: sqlite3.Connection, embedder: Embedder, model: ChatModel,
               index_path: Path, current: int, search: str, last_error: str, log: RunLog,
               sources: Sequence[Source] = ()) -> _Turn:
    index = read_index(index_path)
    title = index.steps[current].title
    schema = work_schema(index.kind)
    messages = build_work_prompt(conn, embedder, index, current, read_scratchpad(workspace, title),
                                 search, last_error, _saved(workspace, title),
                                 on_search=lambda query, hits: log.search(current, query, hits), sources=sources)
    try:
        reply = model.complete(messages, schema)
    except ModelReplyError as err:
        log.model(current, messages, str(err))
        return _Turn(error=str(err), events=[f"failed: {err}"])
    log.model(current, messages, reply)
    if missing := [key for key in schema["required"] if key not in reply]:
        err = f"the reply is missing: {', '.join(missing)}"
        return _Turn(error=err, events=[f"failed: {err}"])

    turn = _Turn()

    def on_fix(target, fix_messages, fix_reply, problem):
        log.fix(current, target, fix_messages, fix_reply, problem)

    notes = str(reply["scratchpad"] or "")
    if notes.strip():
        append_scratchpad(workspace, title, notes)
        turn.events.append("notes")
    if index.kind in ("film", "slides"):
        # One scene or one slide per step (the user's rule): saving it finishes the step.
        if index.kind == "film":
            saved = _film_result(workspace, conn, embedder, model, index_path, title, reply, turn, log, on_fix)
        else:
            saved = _slide_result(workspace, conn, embedder, model, index_path, title, index.goal, reply, turn, log,
                                      on_fix)
        turn.search = str(reply["search"] or "").strip()
        if saved and (marked := _mark(index_path, title, "done")) is not None:
            wipe_scratchpad(workspace, next((s.title for s in marked.steps if s.state == "todo"), ""))
            turn.finished = True
            turn.events.append("finished")
        return turn
    if not _notes_result(workspace, conn, embedder, model, index_path, title, reply, turn, log, on_fix):
        return turn

    turn.search = str(reply["search"] or "").strip()
    if reply["step_done"] is True:
        if not chunks_for_step(workspace, title):
            turn.error = FINISH_FIRST
            turn.events.append(f"failed: {FINISH_FIRST}")
        elif (marked := _mark(index_path, title, "done")) is not None:
            wipe_scratchpad(workspace, next((s.title for s in marked.steps if s.state == "todo"), ""))
            turn.finished = True
            turn.events.append("finished")
    return turn


def run(workspace: Path, conn: sqlite3.Connection, embedder: Embedder, model: ChatModel,
        goal: str | None = None, max_turns: int = 40, max_turns_per_step: int = 8,
        progress: Callable[[str], None] | None = None, kind: str | None = None,
        log: RunLog | None = None, sources: Sequence[Source] = ()) -> RunReport:
    """Work through INDEX.md; `progress` gets one line per model call, `log` every prompt, reply, search and check.

    `sources` are read-only indexes of the person's notes that the searches draw on besides the workspace.
    """
    log = log or RunLog(None)
    workspace = Path(workspace)
    index_path = workspace / INDEX_NAME
    if not index_path.exists():
        if not goal:
            raise ValueError("a new workspace needs a goal")
        write_index(index_path, new_index(goal, kind or "notes"))
    elif goal is not None:
        raise ValueError("INDEX.md already has a goal; edit INDEX.md to change it")
    elif kind is not None and (existing := read_index(index_path).kind) != kind:
        raise ValueError(f"INDEX.md already says kind: {existing}; edit INDEX.md to change it")
    reindex_folder(conn, workspace, embedder)

    turns = steps_done = step_turns = 0
    counting = None  # the step title (or "plan") whose turns step_turns counts
    search = last_error = ""
    while True:
        index = read_index(index_path)
        current = next((i for i, s in enumerate(index.steps) if s.state == "todo"), None)
        if index.steps and current is None:
            stuck = next((s.title for s in index.steps if s.state == "stuck"), None)
            status = "stuck" if stuck is not None else "done"
            if index.status != status:
                write_index(index_path, replace(index, status=status))
            return RunReport(status, steps_done, turns, stuck_step=stuck)
        if turns >= max_turns:
            return RunReport("paused", steps_done, turns)

        key = index.steps[current].title if index.steps else "plan"
        if key != counting:
            counting, step_turns, search, last_error = key, 0, "", ""

        if key == "plan":
            turn = _plan_turn(conn, embedder, model, index_path, last_error, log, sources)
            label = ""
        else:
            turn = _work_turn(workspace, conn, embedder, model, index_path, current, search, last_error, log, sources)
            steps_done += turn.finished
            label = f'step {current + 1}/{len(index.steps)} "{key}": '
        turns += 1
        if progress is not None:
            progress(label + (", ".join(turn.events) or "no change"))
        if turn.blocked:
            return RunReport("blocked", steps_done, turns, stuck_step=key, reason=turn.error)

        if turn.finished:
            counting = None
            continue
        search, last_error = turn.search, turn.error
        step_turns += 1
        if step_turns >= max_turns_per_step:
            if key == "plan" or _mark(index_path, key, "stuck") is None:
                fresh = read_index(index_path)
                write_index(index_path, replace(fresh, status="stuck"))
            return RunReport("stuck", steps_done, turns, stuck_step=key, reason=last_error)
