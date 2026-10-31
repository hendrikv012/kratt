"""`memory-engine smoke`: run fixed goals with the real model and summarise their run logs."""

import http.client
import json
import re
import shutil
import sys
import tempfile
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from memory_engine.chat import ChatModel
from memory_engine.config import Settings
from memory_engine.db import connect, init_schema
from memory_engine.embeddings import Embedder
from memory_engine.index_file import INDEX_NAME, KINDS, Index, read_index
from memory_engine.reindex import reindex_folder
from memory_engine.router import RunReport, run
from memory_engine.runlog import RunLog
from memory_engine.search import STOPWORDS, open_sources

DEFAULT_GOALS: list[tuple[str, str]] = [
    ("notes", "Explain the Krebs cycle for a first-year biology exam"),
    ("film", "A two-minute explainer film about photosynthesis"),
    ("slides", "Five slides introducing the periodic table"),
    ("notes", "Write src/units.py with a function that converts Celsius to Fahrenheit, and a pytest test for it"),
]
LOG_NAME = "run.jsonl"
FIXTURE = Path(__file__).resolve().parents[2] / "evals" / "fixture"  # the notes smoke searches by default
TAGS_TIMEOUT = 5.0
_WORD = re.compile(r"[a-zA-Z]{4,}")


@dataclass(frozen=True)
class RunStats:
    status: str  # how the run ended: "done", "stuck", "paused" or "blocked"
    steps_done: int  # steps marked done in INDEX.md
    steps_total: int  # steps in INDEX.md; 0 when the plan never succeeded
    turns_per_step: float  # model turns spent on steps (not the plan), per step in INDEX.md
    doctor_pass_rate: float | None  # share of file checks that passed; None when nothing was checked
    doctor_blocked: int  # Doctor results stopped by the machine (no sandbox, a missing tool), not counted above
    stuck_share: float | None  # share of steps that ended stuck; None without steps
    grounding: float | None  # mean share of a note's content words found in its step's hits; None without notes


def _fetch_tags(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=TAGS_TIMEOUT) as response:
        return json.loads(response.read())


def model_available(url: str, model: str, fetch: Callable[[str], dict] | None = None) -> bool:
    """Whether Ollama at `url` answers and lists `model`. `fetch` gets the tags URL and returns its JSON."""
    try:
        tags = (fetch or _fetch_tags)(f"{url.rstrip('/')}/api/tags")
        names = {entry["name"] for entry in tags["models"]}
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError):
        return False
    return model in names or (":" not in model and f"{model}:latest" in names)


def _content_words(text: str) -> set[str]:
    return {word for word in map(str.lower, _WORD.findall(text)) if word not in STOPWORDS}


def summarize(log_lines: list[dict], index: Index, report: RunReport) -> RunStats:
    """Numbers for one run from its run.jsonl lines, its final INDEX.md and what run() returned."""
    steps = len(index.steps)
    step_turns = sum(1 for line in log_lines if line["event"] == "model" and line["step"] is not None)
    doctor = [line for line in log_lines if line["event"] == "doctor"]
    checks = [line["ok"] for line in doctor if not line.get("blocked")]
    stuck = sum(1 for step in index.steps if step.state == "stuck")

    # Only words from the person's notes (source hits) that the model was shown before it replied count:
    # the workspace's own hits are the model's earlier output, and a later search can't have grounded it.
    hit_words: dict[int | None, set[str]] = {}
    shares = []
    for line in log_lines:
        if line["event"] == "search":
            words = hit_words.setdefault(line["step"], set())
            for hit in line["hits"]:
                if hit.get("source") is not None:
                    words |= _content_words(hit["text"])
        elif line["event"] == "model":
            reply = line["reply"]
            body = reply.get("chunk_body") if isinstance(reply, dict) else None
            words = _content_words(body) if isinstance(body, str) else set()
            if words:
                shares.append(len(words & hit_words.get(line["step"], set())) / len(words))

    return RunStats(
        status=report.status,
        steps_done=sum(1 for step in index.steps if step.state == "done"),
        steps_total=steps,
        turns_per_step=step_turns / steps if steps else 0.0,
        doctor_pass_rate=sum(checks) / len(checks) if checks else None,
        doctor_blocked=len(doctor) - len(checks),
        stuck_share=stuck / steps if steps else None,
        grounding=sum(shares) / len(shares) if shares else None,
    )


def load_goals(path: Path) -> list[tuple[str, str]]:
    """Goals from a .jsonl file with one {"kind", "goal"} object per line."""
    goals = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
            kind, goal = entry["kind"], entry["goal"]
        except (ValueError, KeyError, TypeError) as err:
            raise ValueError(f'{path}: line {number} needs {{"kind": ..., "goal": ...}} ({err})') from err
        if kind not in KINDS or not isinstance(goal, str) or not goal.strip():
            raise ValueError(f"{path}: line {number} needs a kind of {', '.join(KINDS)} and a goal")
        goals.append((kind, goal))
    if not goals:
        raise ValueError(f"{path} has no goals")
    return goals


def _read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def build_corpus(folder: Path, db_path: Path, embedder: Embedder) -> Path:
    """Index `folder` into a new database at `db_path` for the runs to read, as eval-search does."""
    if not Path(folder).is_dir():
        raise ValueError(f"the notes for smoke to search aren't at {folder}; give --source-db")
    settings = Settings(db_path=db_path)
    conn = connect(settings)
    try:
        init_schema(conn, settings)
        reindex_folder(conn, Path(folder), embedder)
    finally:
        conn.close()
    return db_path


def smoke(goals: list[tuple[str, str]], base: Path, embedder: Embedder, model_factory: Callable[[], ChatModel],
          keep: bool, rows: list[tuple[str, RunStats]] | None = None,
          sources: Sequence[Path] = ()) -> list[tuple[str, RunStats]]:
    """Run each goal in its own workspace under `base`; Ctrl-C ends the loop and keeps the finished rows.

    A caller that wants the finished rows even when a run raises passes its own `rows` list to be filled.
    `sources` are indexes of notes every run reads from (as `run --source-db`).
    """
    rows = [] if rows is None else rows
    for kind, goal in goals:
        workspace = Path(tempfile.mkdtemp(dir=base))
        try:
            settings = Settings(db_path=workspace / "memory.db")
            conn = connect(settings)
            opened = []
            try:
                init_schema(conn, settings)
                opened = open_sources(list(sources), settings)
                report = run(workspace, conn, embedder, model_factory(), goal=goal, kind=kind,
                             log=RunLog(workspace / LOG_NAME), sources=opened)
            finally:
                for source in opened:
                    source.conn.close()
                conn.close()
            rows.append((goal, summarize(_read_log(workspace / LOG_NAME), read_index(workspace / INDEX_NAME), report)))
        except KeyboardInterrupt:
            print("interrupted: keeping the goals that finished", file=sys.stderr)
            break
        finally:
            if not keep:
                shutil.rmtree(workspace, ignore_errors=True)
    return rows
