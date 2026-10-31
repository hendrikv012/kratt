"""Command line: `python -m memory_engine reindex FOLDER`, `search QUERY`, `eval-search QUERIES`, `run WORKSPACE` and `smoke`."""

import os
import sys

# `python -m memory_engine` puts the current folder first on sys.path, so a workspace file named
# like a library (yaml.py, json.py) would be imported and run here, outside the sandbox.
sys.path[:] = [entry for entry in sys.path if entry not in ("", os.getcwd())]

import argparse  # noqa: E402  (the path cleanup above must run first)
import json
import shutil
import signal
import tempfile
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from memory_engine.chat import ChatError, ChatModel, OllamaChat
from memory_engine.config import Settings
from memory_engine.db import check_embedding, connect, init_schema
from memory_engine.embeddings import Embedder, EmbeddingError, OllamaEmbedder
from memory_engine.evals import evaluate, load_queries
from memory_engine.reindex import reindex_folder
from memory_engine.router import run
from memory_engine.runlog import RunLog
from memory_engine.search import format_hit, hybrid_search, open_sources
from memory_engine.serve import DEFAULT_PORT, load_study_folder, make_server
from memory_engine.smoke import (
    DEFAULT_GOALS,
    FIXTURE,
    build_corpus,
    load_goals,
    model_available,
    smoke,
)
from memory_engine.workfiles import read_scratchpad

MAX_LISTED_FAILURES = 10


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memory_engine", description="Local memory index and hybrid search.")
    parser.add_argument("--db", type=Path, default=None,
                        help="database file (default: ./memory.db, or WORKSPACE/memory.db for run)")
    commands = parser.add_subparsers(dest="command", required=True)
    reindex = commands.add_parser("reindex", help="sync the index with a folder of .md and .py files")
    reindex.add_argument("root", type=Path)
    search = commands.add_parser("search", help="find the best matching chunks")
    search.add_argument("query")
    search.add_argument("--regex", help="keep only chunks whose text matches this regular expression")
    search.add_argument("--limit", type=int, default=5)
    evaluate_search = commands.add_parser("eval-search", help="measure recall@5 and MRR of search on a folder of notes")
    evaluate_search.add_argument("queries", type=Path, help="a .jsonl file of queries and the notes that answer them")
    evaluate_search.add_argument("--corpus", type=Path, required=True, help="the folder of notes to index")
    evaluate_search.add_argument("--chunk-tokens", type=int, default=Settings.chunk_tokens, help="largest chunk when splitting notes")
    evaluate_search.add_argument("--keyword-weight", type=float, default=1.0, help="weight of the keyword ranking when merging")
    evaluate_search.add_argument("--meaning-weight", type=float, default=1.0, help="weight of the meaning ranking when merging")
    serve = commands.add_parser("serve", help="run the Study folder service for the study app")
    serve.add_argument("--folder", type=Path, default=None, help="the Study folder (default: the remembered one, or ~/Study)")
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    work = commands.add_parser("run", help="work through WORKSPACE/INDEX.md step by step with the local model")
    work.add_argument("workspace", type=Path)
    work.add_argument("--goal", help="the goal for a new workspace (an existing one keeps the goal in INDEX.md)")
    work.add_argument("--kind", choices=("notes", "film", "slides"), default=None,
                      help="what each step makes in a new workspace: notes (default), film scenes or slides")
    work.add_argument("--source-db", type=Path, action="append", default=[],
                      help="an index of your notes (made by --db FILE reindex FOLDER) to read from, never write to; repeatable")
    work.add_argument("--max-turns", type=int, default=40)
    work.add_argument("--log", action="store_true",
                      help="write every prompt, reply, search and check to WORKSPACE/run.jsonl")
    work.add_argument("--timeout", type=float, default=None,
                      help="seconds to wait for one reply from the model (default: 600)")
    smoke_goals = commands.add_parser("smoke", help="run fixed goals with the real model and summarise their run logs")
    smoke_goals.add_argument("--goals", type=Path, default=None,
                             help="a .jsonl file with one {\"kind\", \"goal\"} per line (default: four fixed goals)")
    smoke_goals.add_argument("--keep", action="store_true", help="keep each goal's workspace to read its run.jsonl")
    smoke_goals.add_argument("--source-db", type=Path, action="append", default=[],
                             help="an index of notes for the runs to read (as run --source-db); repeatable "
                                  "(default: a temporary index of evals/fixture)")
    return parser


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def _stuck_message(workspace: Path, report) -> str:
    if report.stuck_step == "plan":
        return (f"stuck while planning: {report.reason or 'no usable plan'}\n"
                "Write the steps into INDEX.md yourself as '- [ ] step' lines, then run again.")
    notes = "Read the notes in SCRATCHPAD.md, then reword" if read_scratchpad(workspace, report.stuck_step) else "Reword"
    return (f'stuck on "{report.stuck_step}": {report.reason or "the step was never finished"}\n'
            f"{notes} or split the step in INDEX.md, change [!] back to [ ], and run again.")


def _run(conn, settings: Settings, args, embedder: Embedder, model: ChatModel | None) -> int:
    if model is None:
        model = OllamaChat(settings.ollama_url, settings.chat_model, settings.context_window, settings.reply_tokens,
                           timeout=args.timeout or settings.chat_timeout)
    sources = open_sources(args.source_db, settings)  # first, so a bad --source-db fails before any rebuild
    try:
        if check_embedding(conn, settings, rebuild=True):
            print("embedding settings changed: rebuilding the index")
        report = run(args.workspace, conn, embedder, model, goal=args.goal, max_turns=args.max_turns, kind=args.kind,
                     log=RunLog(args.workspace / "run.jsonl") if args.log else None, sources=sources,
                     progress=lambda line: print(line, file=sys.stderr, flush=True))
    finally:
        for source in sources:
            source.conn.close()
    if report.status == "stuck":
        print(_stuck_message(args.workspace, report), file=sys.stderr)
        return 1
    if report.status == "blocked":
        print(f"stopped: {report.reason}", file=sys.stderr)
        return 1
    if report.status == "paused":
        print(f"paused after {_plural(report.turns, 'turn')}: run again to continue")
    else:
        print(f"done: {_plural(report.steps_done, 'step')} finished in {_plural(report.turns, 'turn')}")
    return 0


def _eval_search(args, embedder: Embedder | None) -> int:
    # The index lives in a temporary folder, so no memory.db is created or touched.
    if embedder is None:
        settings = Settings(db_path=Path("memory.db"))
        embedder = OllamaEmbedder(settings.ollama_url, settings.embed_model, settings.embed_dims)
    try:
        queries = load_queries(args.queries)
        results = evaluate(queries, args.corpus, embedder, args.chunk_tokens,
                           keyword_weight=args.keyword_weight, meaning_weight=args.meaning_weight)
    except (EmbeddingError, OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    for name, metrics in results.items():
        print(f"{name:<8} recall@5 {metrics.recall:.2f}  mrr {metrics.mrr:.2f}")
    print(f"queries: {len(queries)}")
    return 0


def _percent(share: float | None) -> str:
    return "n/a" if share is None else f"{share:.0%}"


def _smoke(args, embedder: Embedder | None, model: ChatModel | None) -> int:
    settings = Settings(db_path=Path("memory.db"))
    if model is None:
        if not model_available(settings.ollama_url, settings.chat_model):
            print(f"error: {settings.chat_model} isn't available in Ollama (ollama pull {settings.chat_model})",
                  file=sys.stderr)
            return 1
        model_factory = lambda: OllamaChat(settings.ollama_url, settings.chat_model, settings.context_window,
                                           settings.reply_tokens, timeout=settings.chat_timeout)
    else:
        model_factory = lambda: model
    if embedder is None:
        embedder = OllamaEmbedder(settings.ollama_url, settings.embed_model, settings.embed_dims)
    try:
        goals = load_goals(args.goals) if args.goals else DEFAULT_GOALS
    except (OSError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    base = Path(tempfile.mkdtemp(prefix="memory-engine-smoke-"))
    rows: list = []
    failed = False
    try:
        sources = args.source_db or [build_corpus(FIXTURE, base / "fixture.db", embedder)]
        smoke(goals, base, embedder, model_factory, args.keep, rows, sources=sources)
    except (EmbeddingError, ChatError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)  # the goals that finished are still reported and saved
        failed = True
    except KeyboardInterrupt:
        print("interrupted while indexing the notes for smoke", file=sys.stderr)
    finally:
        if args.keep:
            print(f"workspaces kept in {base}")
        else:
            shutil.rmtree(base, ignore_errors=True)
    for goal, stats in rows:
        blocked = f" ({stats.doctor_blocked} blocked)" if stats.doctor_blocked else ""
        print(f"{goal[:48]:<48}  {stats.status}  steps {stats.steps_done}/{stats.steps_total}"
              f"  turns/step {stats.turns_per_step:.1f}  checks passed {_percent(stats.doctor_pass_rate)}{blocked}"
              f"  stuck {_percent(stats.stuck_share)}  grounding {_percent(stats.grounding)}")
    print("grounding counts shared words: compare runs with each other, not with a fixed bar")
    summary = Path(f"smoke-{datetime.now():%Y-%m-%d-%H%M%S}.json")
    summary.write_text(json.dumps({"model": settings.chat_model,
                                   "results": [{"goal": goal, **asdict(stats)} for goal, stats in rows]},
                                  indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"summary written to {summary}")
    if failed:
        return 1
    return 0 if len(rows) == len(goals) else 130


def _stop_on_terminate(*_) -> None:
    raise KeyboardInterrupt  # so `kill` (as start.fish does) also stops an Ollama the service started


def serve_forever(server) -> None:
    for name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), _stop_on_terminate)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


def main(argv: list[str] | None = None, embedder: Embedder | None = None, model: ChatModel | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "serve":
        folder = (args.folder or load_study_folder()).expanduser()
        server = make_server(folder, args.port)
        print(f"Study folder: {folder}")
        print(f"Listening on http://127.0.0.1:{server.server_port}", flush=True)
        server.start_ollama()
        serve_forever(server)
        return 0
    if args.command == "eval-search":
        return _eval_search(args, embedder)
    if args.command == "smoke":
        return _smoke(args, embedder, model)
    if args.command == "run":
        args.workspace.mkdir(parents=True, exist_ok=True)
    default_db = args.workspace / "memory.db" if args.command == "run" else Path("memory.db")
    settings = Settings(db_path=args.db or default_db)
    if embedder is None:
        embedder = OllamaEmbedder(settings.ollama_url, settings.embed_model, settings.embed_dims)
    try:
        conn = connect(settings)
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    try:
        init_schema(conn, settings)
        if args.command == "run":
            return _run(conn, settings, args, embedder, model)
        if args.command == "reindex":
            if check_embedding(conn, settings, rebuild=True):
                print("embedding settings changed: rebuilding the index")
            report = reindex_folder(conn, args.root, embedder, chunk_tokens=settings.chunk_tokens)
            summary = f"indexed {report.indexed}, unchanged {report.unchanged}, removed {report.removed}"
            print(summary + (f", failed {len(report.failed)}" if report.failed else ""))
            for path, reason in report.failed[:MAX_LISTED_FAILURES]:
                print(f"{path}: {reason}", file=sys.stderr)
            if len(report.failed) > MAX_LISTED_FAILURES:
                print(f"and {len(report.failed) - MAX_LISTED_FAILURES} more", file=sys.stderr)
            if report.failed:
                return 1
        else:
            check_embedding(conn, settings)
            for hit in hybrid_search(conn, args.query, embedder, limit=args.limit, regex=args.regex,
                                     keyword_weight=settings.keyword_weight, meaning_weight=settings.meaning_weight):
                print(format_hit(hit))
                print()
    except (EmbeddingError, ChatError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("interrupted: run again to continue", file=sys.stderr)
        return 130
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
