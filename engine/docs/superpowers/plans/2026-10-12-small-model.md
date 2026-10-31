# Small-model work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 8B model more relevant text from the person's own notes, make Doctor fixes small edits that can't overflow the reply, and add the tools that measure retrieval and runs.

**Architecture:** Measuring comes first: `eval-search` (new `evals.py`), a run log, and `smoke` (new `smoke.py`). Search changes stay in `search.py`, `store.py`, `chunking.py` and `db.py`. Read-only source indexes get their own connection helper in `db.py`, and `context.py` merges their hits. The Doctor's fix becomes a find/replace edit in `doctor.py`.

**Tech Stack:** Python 3.12+, SQLite (FTS5 trigram, sqlite-vec), Ollama (nomic-embed-text, qwen3:8b), pytest with `FakeEmbedder` and `ScriptedModel`.

**Spec:** `docs/superpowers/specs/2026-10-12-small-model-design.md` (approved 2026-10-12). Background: `docs/2026-10-08-small-model-review.md`.

## Global Constraints

- The window stays below 2,000 tokens: `PROMPT_BUDGET = 1500`, `reply_tokens = 450`, `context_window = 1999`. No task changes them.
- `pytest` never needs Ollama or the network: use `FakeEmbedder` (`embeddings.py`) and `ScriptedModel` (`chat.py`).
- Nothing is ever written to a source index.
- `EMBEDDING_FORMAT` becomes 2; the default chunk size becomes 200 tokens.
- Doctor fixes reply `{"find": "...", "replace": "..."}`; at most 3 fixes, a failed fix counts as one.
- No commit, comment or doc mentions an assistant; no attribution trailers.
- Suite command: `.venv/bin/pytest -q` (currently 315 passed).

## Flaws found in the spec, and how this plan settles them

1. **Hits from different indexes can't be merged by chunk id.** Each SQLite file numbers its chunks from 1, so `rrf` over chunk ids would mix up hits from different sources. The merge keys every hit by `(source, chunk_id)` (Task 5).
2. **"Settings" that nobody can set.** `Settings` is built from the command line with only `db_path`, so `chunk_tokens`, `keyword_weight` and `meaning_weight` would be code defaults with no way to try other values. They stay `Settings` fields with defaults, and `eval-search` gets `--chunk-tokens`, `--keyword-weight` and `--meaning-weight` to compare values (Tasks 1, 4, 7).
3. **Chunk size only applies to Markdown.** `.py` files are chunked by tree-sitter (`codegraph.py`), not `split_markdown`. The review's change targets Markdown; code chunking is unchanged.
4. **The grounding score is a rough proxy.** It counts shared words: paraphrases score low, and words copied from the goal or step title score high. It's for comparing runs with each other, not an absolute measure. The smoke report says so in one line (Task 3).
5. **Smoke goals "in the package" would need package data.** The four default goals become a constant list in `smoke.py` instead (Task 3).
6. **Logging searches needs a way out of `context.py`.** Prompt builders return only messages. They get an optional `on_search` callback (Task 2).
7. **A source index needs sqlite-vec loaded too, and can't be rebuilt.** A read-only connection helper loads the extension like `connect()`, and a source's settings are checked without `rebuild` (Task 5).
8. **The source's label comes from the stored `root` meta** (the absolute path the index was built from). An index without it is labelled `source 1`, `source 2`, … (Task 5).

The spec now has a "Notes from planning" section with items 1, 2, 3 and 5.

## Review Focus

1. A source index whose folder is being reindexed by another process while a run reads it: the run keeps working, with a clear error if the file is locked or replaced (WAL readers normally see a consistent snapshot).
2. A query of only stopwords or short words (`"is it the"`, `"pH"`): keyword search falls back to the raw words, and meaning search still runs.
3. A `find` that differs from the file only in whitespace, or that sits across the part boundary of a slide: a failed fix with a reason, never a silent wrong edit.
4. An old index (format 1, 400-token chunks) used by `run` (rebuilt), `search` (clear message to reindex) or as a source (refused, naming the file).
5. Ctrl+C during `smoke`: the workspaces made so far are removed unless `--keep`, and the summary of finished runs is still written.

---

### Task 1: `eval-search` and the fixture (#6, part 1)

**Files:**
- Create: `src/memory_engine/evals.py`
- Create: `evals/fixture/` (about 10 short Markdown notes in `Biology/`, `Chemistry/`), `evals/fixture.jsonl` (about 15 queries)
- Modify: `src/memory_engine/__main__.py` (subcommand), `README.md`
- Test: `tests/test_evals.py`

**Interfaces:**
- Produces:
  - `load_queries(path: Path) -> list[EvalQuery]`, where `EvalQuery(query: str, relevant: tuple[Relevant, ...])` and `Relevant(path: str, heading: str | None)`. Raises `ValueError("line N: …")` for a bad line.
  - `score(queries, ranked: Callable[[str], list[tuple[str, str | None]]], k: int = 5) -> Metrics`, where `Metrics(recall: float, mrr: float, queries: int)`. `ranked` returns `(path, heading)` per hit, best first.
  - `evaluate(queries, corpus: Path, embedder, chunk_tokens: int, keyword_weight: float = 1.0, meaning_weight: float = 1.0) -> dict[str, Metrics]` with the keys `"keyword"`, `"meaning"`, `"merged"`. It builds the index in a `tempfile.TemporaryDirectory`.
  - CLI: `memory-engine eval-search QUERIES --corpus FOLDER [--chunk-tokens N] [--keyword-weight W] [--meaning-weight W]`. It prints `keyword  recall@5 0.80  mrr 0.62`, one line per ranking, then `queries: 15`.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_hit_counts_by_path_and_heading():
    queries = [EvalQuery("krebs", (Relevant("Biology/Krebs.md", "Staging"),))]
    metrics = score(queries, lambda q: [("Biology/Other.md", None), ("Biology/Krebs.md", "Krebs › Staging")])
    assert metrics.recall == 1.0 and metrics.mrr == 0.5 and metrics.queries == 1

def test_a_miss_scores_zero():
    queries = [EvalQuery("x", (Relevant("A.md", None),))]
    assert score(queries, lambda q: [("B.md", None)]) == Metrics(0.0, 0.0, 1)

def test_bad_lines_name_their_line(tmp_path):
    (tmp_path / "q.jsonl").write_text('{"query": "a", "relevant": [{"path": "A.md"}]}\nnot json\n')
    with pytest.raises(ValueError, match="line 2"):
        load_queries(tmp_path / "q.jsonl")

def test_eval_search_runs_on_the_fixture(capsys):
    assert main(["eval-search", str(FIXTURE / "../fixture.jsonl"), "--corpus", str(FIXTURE)], embedder=FakeEmbedder()) == 0
    lines = capsys.readouterr().out.splitlines()
    assert [line.split()[0] for line in lines[:3]] == ["keyword", "meaning", "merged"]
    assert all(0.0 <= float(value) <= 1.0 for line in lines[:3] for value in line.split()[2::2])
```

- [ ] **Step 2: Run them to see them fail.** Run `.venv/bin/pytest tests/test_evals.py -q`. Expected: FAIL with `ModuleNotFoundError: memory_engine.evals`.

- [ ] **Step 3: Implement `evals.py` and the subcommand.**
  - The keyword ranking is `fts_search` and the meaning ranking is `vector_search`, both with limit `k * 4`, mapped to `(path, heading)`.
  - The merged ranking is `hybrid_search(..., limit=k)`.
  - A heading matches when `relevant.heading in (hit_heading or "")`.
  - `chunk_tokens` reaches `index_markdown` through `reindex_folder` (Task 7 makes this a real parameter; until then pass the value through an added keyword parameter `chunk_tokens: int = 400` on `reindex_folder` and `index_markdown`).

- [ ] **Step 4: Run the tests and the suite.** Run `.venv/bin/pytest tests/test_evals.py -q && .venv/bin/pytest -q`. Expected: all pass.

- [ ] **Step 5: Commit** (`feat: eval-search measures recall@5 and MRR on a folder of notes`).

### Task 2: `run --log` (#6, part 2)

**Files:**
- Create: `src/memory_engine/runlog.py`
- Modify: `src/memory_engine/context.py` (`_with_search`, `build_plan_prompt`, `build_work_prompt`), `src/memory_engine/router.py` (`run`, `_plan_turn`, `_work_turn`, the three `promote` call sites), `src/memory_engine/__main__.py` (`--log`)
- Test: `tests/test_runlog.py`

**Interfaces:**
- Produces:
  - `RunLog(path: Path | None)` with `.model(step: int | None, messages: list[dict], reply: dict | str)`, `.search(step: int | None, query: str, hits: list[SearchHit])` and `.doctor(promotion: Promotion)`. `RunLog(None)` does nothing.
  - On the first failed write it prints `warning: run log not written: <reason>` to stderr once, and stops writing.
  - `build_plan_prompt(..., on_search: Callable[[str, list[SearchHit]], None] | None = None)` and the same keyword on `build_work_prompt`.
  - `run(..., log: RunLog | None = None)`.
- Line shapes (one JSON object per line, in `WORKSPACE/run.jsonl`):
  - `{"event": "model", "step": n|null, "messages": [...], "reply": {...}}`
  - `{"event": "search", "step": n|null, "query": "...", "hits": [{"source": null, "path": "...", "heading": "...", "text": "..."}]}`
  - `{"event": "doctor", "target": "...", "ok": true, "fixes": 1, "message": "..."}`
  - `step` is the 0-based step index, or `null` for the plan.

- [ ] **Step 1: Write the failing tests.**
  - `test_a_logged_run_writes_each_prompt_reply_search_and_check`: a notes run with `ScriptedModel` (a plan reply, then one work reply with a target). It asserts the events in `run.jsonl`, in order, are `model, search, model, search, doctor` (a search is logged as each prompt is built, before the model call), and that every line parses as JSON.
  - `test_an_unwritable_log_warns_once_and_the_run_goes_on`: the log path is a directory. Assert exactly one warning on stderr and the run status `done`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL with an import error for `memory_engine.runlog`.

- [ ] **Step 3: Implement it.**
  - `_with_search` calls `on_search(query, hits)` after packing. It logs the hits actually sent, not all found.
  - The router passes `lambda q, h: log.search(step, q, h)`, calls `log.model` after each `complete` (on `ModelReplyError`, log `reply` as the error text), and calls `log.doctor` after each `promote`.

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass.

- [ ] **Step 5: Commit** (`feat: run --log writes every prompt, reply, search and check to run.jsonl`).

### Task 3: `memory-engine smoke` (#6, part 3)

**Files:**
- Create: `src/memory_engine/smoke.py`
- Modify: `src/memory_engine/__main__.py` (subcommand), `README.md`
- Test: `tests/test_smoke.py`

**Interfaces:**
- Consumes: `run(..., log=RunLog(path))` from Task 2, and the `run.jsonl` line shapes.
- Produces:
  - `DEFAULT_GOALS: list[tuple[str, str]]` of `(kind, goal)`:
    1. `("notes", "Explain the Krebs cycle for a first-year biology exam")`
    2. `("film", "A two-minute explainer film about photosynthesis")`
    3. `("slides", "Five slides introducing the periodic table")`
    4. `("notes", "Write src/units.py with a function that converts Celsius to Fahrenheit, and a pytest test for it")`
  - `summarize(log_lines: list[dict], index: Index) -> RunStats` with `RunStats(turns_per_step: float, doctor_pass_rate: float | None, stuck_share: float, grounding: float | None)`.
    - `grounding` is the mean, over model replies that wrote a note body, of the share of the body's content words (`[a-zA-Z]{4,}`, lowercased, not in `STOPWORDS` from `search.py`) found in that step's logged hit texts.
    - The hit texts come from the search lines' `"text"` field (Task 2).
  - `smoke(goals, base: Path, embedder, model_factory, keep: bool) -> list[tuple[str, RunStats]]`.
  - CLI: `memory-engine smoke [--goals FILE] [--keep]`. `FILE` holds one `{"kind", "goal"}` JSON object per line.
    - It first checks Ollama and the chat model (`GET /api/tags` lists `settings.chat_model`), otherwise it prints `error: qwen3:8b isn't available in Ollama (ollama pull qwen3:8b)` and returns 1.
    - It prints one table row per goal, plus the line `grounding counts shared words: compare runs with each other, not with a fixed bar`.
    - It writes `smoke-YYYY-MM-DD-HHMM.json` to the current folder.

- [ ] **Step 1: Write the failing tests.**
  - `test_summary_counts_turns_checks_stuck_and_grounding`: hand-made log lines and an `Index` with 2 steps (1 done, 1 stuck). Expected values computed by hand: turns 3.0, Doctor 1 of 2 = 0.5, stuck 0.5, and a grounding of 0.5 from a body with 4 content words, 2 of them in the hits.
  - `test_smoke_runs_each_goal_and_cleans_up`: two goals with `ScriptedModel` factories. Assert two rows, and that the base folder holds no workspace afterwards (with `keep=False`).
  - `test_smoke_without_the_model_says_how_to_get_it`: an Ollama stub (`make_stub` in `conftest.py`) whose tags lack qwen3:8b. Expect exit 1 and the message.
  - `test_an_interrupted_smoke_keeps_the_finished_summary`: the second model factory raises `KeyboardInterrupt`. Expect one row in the written JSON and no workspaces left.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL with `ModuleNotFoundError: memory_engine.smoke`.

- [ ] **Step 3: Implement it.** Workspaces go in `tempfile.mkdtemp(dir=base)` and are removed in `finally` unless `keep`.

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass.

- [ ] **Step 5: Commit** (`feat: smoke runs fixed goals with the real model and reports turns, checks, stuck steps and grounding`).

### Task 4: Search prefixes, stopwords and weights (#3)

**Files:**
- Modify: `src/memory_engine/store.py:39-40` (`_embedding_input`), `src/memory_engine/search.py` (`fts_search`, `vector_search`, `rrf`, `hybrid_search`), `src/memory_engine/db.py:11` (`EMBEDDING_FORMAT = 2`), `src/memory_engine/config.py` (`keyword_weight`, `meaning_weight`), `src/memory_engine/evals.py`, `src/memory_engine/__main__.py`
- Test: `tests/test_search.py`, `tests/test_store.py`, `tests/test_db.py`

**Interfaces:**
- Produces:
  - `DOCUMENT_PREFIX = "search_document: "` (store.py) and `QUERY_PREFIX = "search_query: "` (search.py).
  - `STOPWORDS: frozenset[str]` in search.py (about 60 English words, lowercase).
  - `rrf(rankings, k=60, weights: list[float] | None = None)`.
  - `hybrid_search(..., keyword_weight: float = 1.0, meaning_weight: float = 1.0)`; the regex ranking keeps weight 1.0.
  - `Settings.keyword_weight: float = 1.0` and `Settings.meaning_weight: float = 1.0`.
  - `eval-search --keyword-weight/--meaning-weight` pass them through.

- [ ] **Step 1: Write the failing tests.**

```python
def test_documents_and_queries_carry_nomic_task_prefixes(conn, settings):
    seen = []
    class Recording(FakeEmbedder):
        def embed(self, texts):
            seen.extend(texts)
            return super().embed(texts)
    index_markdown(conn, "a.md", "# Krebs\nCitrate.", Recording())
    hybrid_search(conn, "citrate", Recording())
    assert seen[0].startswith("search_document: ") and seen[-1] == "search_query: citrate"

def test_weights_scale_each_ranking():
    assert rrf([[1, 2], [2, 1]], weights=[2.0, 1.0])[0][0] == 1

def test_an_old_index_must_be_rebuilt(conn, settings):
    set_meta(conn, "embedding", "nomic-embed-text, 768 dimensions, input format 1")
    with pytest.raises(ValueError, match="run reindex"):
        check_embedding(conn, settings)
```

  The stopword test indexes two documents, `"the the the"` and `"matrix of cells"`. It asserts that `fts_search(conn, "the matrix")` returns only the second document's chunk id. For the all-stopword case it asserts that `fts_search(conn, "the the")` returns the first document's chunk id.

- [ ] **Step 2: Run them to see them fail.** Expected: the prefix, stopword and weight tests FAIL.

- [ ] **Step 3: Implement it.**
  - `fts_search` drops words whose `lower()` is in `STOPWORDS`, unless that leaves none.
  - `rrf` multiplies `1 / (k + rank)` by the ranking's weight (default 1.0).
  - `vector_search` embeds `QUERY_PREFIX + query`, and `_embedding_input` prefixes `DOCUMENT_PREFIX`.

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass. Fix only the tests that assert exact embedder inputs, if any.

- [ ] **Step 5: Commit** (`feat: nomic task prefixes, keyword stopwords and weighted rank fusion`).

### Task 5: Read-only source indexes in runs (#1)

**Files:**
- Modify: `src/memory_engine/db.py` (`connect_readonly`), `src/memory_engine/search.py` (`SearchHit.source`, `format_hit`, `search_sources`), `src/memory_engine/context.py` (`_with_search` and the two builders take `sources`), `src/memory_engine/router.py` (`run(..., sources=...)`), `src/memory_engine/__main__.py` (`run --source-db`, repeatable), `README.md`
- Test: `tests/test_sources.py`

**Interfaces:**
- Consumes: `hybrid_search` from Task 4, and `RunLog.search` hit shape from Task 2 (`"source"` is now the label).
- Produces:
  - `connect_readonly(path: Path, settings: Settings) -> sqlite3.Connection`. It opens `file:{path}?mode=ro` with `uri=True` and loads sqlite-vec like `connect`. A missing file raises `ValueError(f"no index at {path}")`.
  - `Source(label: str, conn: sqlite3.Connection)` and `open_sources(paths: list[Path], settings) -> list[Source]`.
    - It checks each source with `check_embedding(conn, settings)`, re-raising as `ValueError(f"{path} was built with other settings; run memory-engine reindex on its folder")`.
    - The label is `Path(get_meta(conn, "root")).name`, or `source N` when missing.
  - `SearchHit.source: str | None = None`. `format_hit` puts `[label] ` before the title when `source` is set.
  - `search_sources(workspace_conn, sources, query, embedder, limit, max_tokens) -> list[SearchHit]`.
    - It runs `hybrid_search` on each, then fuses the hit lists with `rrf` over keys `(source, chunk_id)`. Each list is a ranking in its own order; the workspace's source is `None`.
    - It packs the result by `max_tokens` as `hybrid_search` does (reuse its packing; extract `_pack(hits, limit, max_tokens)` from `hybrid_search`).
  - `run(..., sources: list[Source] = ())`; the CLI flag is `run --source-db PATH` (`action="append"`).

- [ ] **Step 1: Write the failing tests.**
  - `test_a_source_index_is_read_only`: build an index in `tmp_path/notes`, then open it with `connect_readonly`. A `DELETE FROM chunks` raises `sqlite3.OperationalError`, and the file's bytes are unchanged after a run that used it.
  - `test_hits_from_a_source_are_labelled_and_merged`: the workspace index holds `"Krebs workspace note"` and the source (root `/x/Study`) holds `"Krebs cycle staging"`. A work prompt for query `"krebs"` contains `[Study] ` before the source hit's path, and holds both hits.
  - `test_equal_chunk_ids_from_two_indexes_stay_apart`: both indexes have chunk id 1 with different text. Both texts appear in the merged hits.
  - `test_a_source_with_other_settings_is_refused`: set its `embedding` meta to format 1. `open_sources` raises with the path and "run memory-engine reindex".
  - `test_a_missing_source_is_a_clear_error`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL with an import error for `connect_readonly`.

- [ ] **Step 3: Implement it.** `_with_search` calls `search_sources` when sources are given, and `hybrid_search` otherwise (the same output when `sources` is empty).

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass.

- [ ] **Step 5: Commit** (`feat: run --source-db draws on the person's notes, read-only and labelled`).

### Task 6: Doctor fixes as find/replace (#4)

**Files:**
- Modify: `src/memory_engine/doctor.py` (`FIX_SCHEMA`, `DOCTOR_SYSTEM`, `build_fix_prompt`, the fix loop in `promote`)
- Test: `tests/test_doctor.py`

**Interfaces:**
- Produces:
  - `FIX_SCHEMA = {"type": "object", "properties": {"find": {"type": "string"}, "replace": {"type": "string"}}, "required": ["find", "replace"]}`.
  - `DOCTOR_SYSTEM`: `You fix one file so that it passes its checks. Change only what the failed check needs.\nReply with JSON: {"find": "<text copied exactly from the file>", "replace": "<what it becomes>"}. Keep find short but unique.`
  - `apply_edit(content: str, find: str, replace: str) -> str`, raising `ValueError` with exactly one of:
    - `"the edit had nothing to find"`
    - `"the text to change isn't in the file"`
    - `"the text to change appears {n} times; include more of it"`
  - `build_fix_prompt(..., last_problem: str = "")` adds the section `("Problem with your last fix", last_problem)` when given.
  - The give-up message ends with `; last fix: {reason}` when the last attempt failed.

- [ ] **Step 1: Write the failing tests.**
  - `test_an_edit_is_applied_once`: `apply_edit("a = 1\nb = 2\n", "b = 2", "b = 3") == "a = 1\nb = 3\n"`.
  - `test_edit_failures_say_why`: parametrized over the three reasons, checking each exact message.
  - `test_a_failed_fix_counts_and_its_reason_reaches_the_next_prompt`: a Python file failing a syntax check. `ScriptedModel` replies first `{"find": "nope", "replace": "x"}`, then a correct edit. Assert `promotion.ok`, `fixes == 1`, and that the second fix prompt contains "Problem with your last fix" and "isn't in the file".
  - `test_a_cut_off_reply_is_a_failed_fix_with_its_reason`: the scripted model raises `ModelReplyError("the reply was cut off at 450 tokens…")` 3 times. The give-up message contains "last fix: the reply was cut off".
  - `test_a_slide_fix_edits_only_the_slide`: an existing slide-deck test, adapted so the edit applies to the part.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (no `apply_edit`; schema mismatch).

- [ ] **Step 3: Implement it.**
  - In the loop, a `ModelReplyError` or an `apply_edit` `ValueError` sets `last_problem` and `continue`s.
  - A success clears it, and `fixes` counts successful edits only, as today.
  - The 3-attempt limit counts every attempt (the loop's range is unchanged).

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass. Update the existing Doctor tests that script whole-file `{"content": …}` replies to edits.

- [ ] **Step 5: Commit** (`feat: Doctor fixes are small find/replace edits, and a failed fix says why`).

### Task 7: 200-token chunks (#2 option A)

**Files:**
- Modify: `src/memory_engine/config.py` (`chunk_tokens: int = 200`), `src/memory_engine/chunking.py` (`CHUNK_TOKENS = 200`, the `split_markdown` default), `src/memory_engine/store.py` (`index_markdown(..., chunk_tokens=CHUNK_TOKENS)`), `src/memory_engine/reindex.py` (`reindex_folder(..., chunk_tokens=CHUNK_TOKENS)`), `src/memory_engine/db.py` (`embedding_signature` includes `chunks {settings.chunk_tokens} tokens`), `src/memory_engine/__main__.py` (passes `settings.chunk_tokens`), `src/memory_engine/evals.py` (the default `--chunk-tokens` is `settings.chunk_tokens`)
- Test: `tests/test_chunking.py`, `tests/test_db.py`, `tests/test_reindex.py`

**Interfaces:**
- Consumes: the temporary `chunk_tokens` keyword from Task 1. This task makes the default 200 and puts it in the signature.
- Produces: `embedding_signature(settings) == f"{embed_model}, {embed_dims} dimensions, input format {EMBEDDING_FORMAT}, chunks {chunk_tokens} tokens"`.

- [ ] **Step 1: Write the failing tests.**
  - `test_chunks_are_at_most_200_tokens_by_default`: a 1,000-token section gives chunks of `token_estimate <= 200`.
  - `test_a_chunk_size_change_rebuilds_the_index`: build with `Settings(chunk_tokens=400)`, then `check_embedding(conn, Settings(chunk_tokens=200), rebuild=True)` returns True and leaves no documents.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (chunks up to 400; same signature).

- [ ] **Step 3: Implement it.** Change the constant, the signature and the plumbing above. The router's `index_markdown` call uses the default.

- [ ] **Step 4: Run the tests and the suite.** Expected: all pass. Tests that assert exact chunk counts for long text get the new numbers.

- [ ] **Step 5: Commit, and update the README** (search section: 200-token chunks; `reindex` rebuilds old indexes) (`feat: 200-token chunks, so more different notes fit in the prompt`).
