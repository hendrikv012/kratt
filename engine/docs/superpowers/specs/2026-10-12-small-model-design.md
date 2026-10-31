# Small-model work: better retrieval, a safer Doctor, and a way to measure (design)

Implements `docs/2026-10-08-small-model-review.md` in its suggested order: #6 measuring, #3 search, #1 sources, #4 the Doctor, #2 option A chunks. #5 is deferred. Every section below was approved in chat on 2026-10-12.

## Decisions (from the user)

- **Follow the review's order.** Measure first, then change search, then add sources, then the Doctor, then chunk size.
- **The real retrieval test set comes from the Study folder, later.** For now the harness is proven on a small fixture corpus. Its numbers only show that the harness works, not how good retrieval is.
- **Smoke runs are built now and run later.** qwen3:8b isn't pulled (about 5 GB on disk, 5-6 GB of RAM while running, on a 7.5 GB machine). The person runs `memory-engine smoke` when the machine is free.
- **Doctor fixes return only the edited piece**, `{"find", "replace"}`, not the whole file.
- **200-token chunks become the default now**, not after measuring.
- **#5 (thinking for Python steps) waits** until the smoke runs show Python steps failing often. A smaller prompt for those steps, or a bigger window (a spec change), is decided then.
- **The window stays below 2,000 tokens** (`architecture_spec.md`): a 1,500-token prompt and a 450-token reply.

## Goals and non-goals

**Goals:**
- A run can draw on the person's own notes, the Study folder above all, without writing to them.
- More, and more relevant, retrieved text fits in the same prompt.
- A Doctor fix can't run out of reply space, and a failed fix always says why.
- Retrieval quality and run quality can be measured, so later changes are decided by numbers.

**Not in this work:**
- thinking for Python steps (#5);
- a bigger window (#2 option B);
- a re-ranker;
- writing the real Study test set (it comes once the Study folder has pages);
- any change to the study app (lokus).

## Section 1: Measuring (#6)

### `memory-engine eval-search QUERIES.jsonl --corpus FOLDER [--chunk-tokens N]`
- Builds a throwaway index of `FOLDER` in a temporary directory, with the configured embedder (Ollama's nomic-embed-text), then deletes it.
- Each line of `QUERIES.jsonl` is `{"query": "...", "relevant": [{"path": "Biology/Krebs.md", "heading": "Staging"}]}`. `heading` is optional.
- A result counts as relevant when its file path matches and, if a heading is given, its heading contains that heading. Relevance never depends on chunk ids, so scores stay comparable across chunk sizes.
- Reports recall@5 and MRR (mean reciprocal rank of the first relevant hit, 0 if none in the top 5) for three rankings: keyword only, meaning only, and merged. One line each, plus the number of queries.
- `--chunk-tokens N` builds the throwaway index with that chunk size instead of the setting.
- An unreadable line or an unknown path is a clear error naming the line.

### The fixture
- `evals/fixture/`: about 10 short study notes in two or three folders (biology, chemistry).
- `evals/fixture.jsonl`: about 15 queries over them.
- A test runs `eval-search` on the fixture with the hashing test embedder and checks the report's shape and that the numbers are between 0 and 1. That's a test of the harness, not a quality bar.

### `run --log`
- Appends one JSON line per event to `WORKSPACE/run.jsonl`:
  - every prompt and reply (`{"event": "model", "step": n, "messages": [...], "reply": {...}}`);
  - every Doctor result (`{"event": "doctor", "target": ..., "ok": ..., "fixes": n, "message": ...}`);
  - every search (`{"event": "search", "step": n, "query": ..., "hits": [{"source", "path", "heading"}]}`).
- Off by default. A log that can't be written doesn't stop the run; it prints one warning.

### `memory-engine smoke [--goals FILE] [--keep]`
- Runs fixed goals in throwaway workspaces with the real model. The defaults are four goals in the package: one notes, one film, one slides, and one notes goal whose steps write Python.
- Each run uses `--log`. After each run it reports:
  - turns per step;
  - Doctor pass rate (checked files that passed, of all checked files);
  - the share of steps marked `[!]`;
  - grounding: for each written note, the share of its content words (four letters or more, not stopwords) that appear in the text retrieved during that step, averaged.
- Prints one summary table, and writes it to `smoke-YYYY-MM-DD-HHMM.json` in the current folder, so later runs can be compared.
- `--keep` keeps the workspaces for reading.
- If Ollama or the model is missing, it says so and stops (exit 1), before creating anything.
- Tested with the replay model and the hashing embedder. `pytest` never needs Ollama.

## Section 2: Search (#3, #2 option A)

- **Task prefixes.** The embedding input of a chunk starts with `search_document: `, and a query with `search_query: ` (nomic-embed-text was trained with them). `EMBEDDING_FORMAT` goes from 1 to 2, so an existing index says it must be rebuilt and `reindex` rebuilds it.
- **Stopwords.** A short English stopword list (about 60 words: articles, pronouns, auxiliaries, common prepositions) is dropped from the keyword query before the `OR` expression is built. If every word is a stopword, the words are used as they are.
- **Ranking weights.** `rrf(rankings, k=60, weights=None)` multiplies each ranking's terms by its weight. New settings `keyword_weight` and `meaning_weight` both default to 1.0. The regex ranking, when used, keeps weight 1.0. They only move away from 1:1 if `eval-search` shows a gain.
- **Chunk size.** New setting `chunk_tokens`, default **200** (was a fixed 400). It goes into the index's settings signature next to the embedding settings, so changing it makes `reindex` rebuild the index (re-chunk and re-embed).

## Section 3: The person's notes in runs (#1)

- **`run --source-db PATH`**, which can be repeated, adds read-only indexes to a run.
  - Opened with SQLite's read-only mode (`file:PATH?mode=ro`). Nothing is ever written to them; `reindex_folder` keeps running on the workspace only.
  - An index built with other embedding settings or another chunk size is refused before the run starts, with a message that names it and says to run `reindex` on its folder.
  - A missing file is a clear error.
- **Labels.** Each source is named after the folder it indexes (stored when it was built), for example `Study`. Its hits are shown as `[Study] Biology/Krebs cycle.md — Staging`. Workspace hits stay unlabelled.
- **Merging.** `context.py` runs `hybrid_search` on the workspace and on each source, then merges the hit lists with rrf (each list ranked in its own order) and packs the best hits into the room left, as it does today.
- **The Study folder.** Documented in the README: `memory-engine reindex ~/Study --db ~/Study/.study/memory.db`, then `run ... --source-db ~/Study/.study/memory.db`. `.study` is hidden, so the Study folder service and the study app ignore the index.
- **The prompt rule** ("Use only facts from the context and your notes") stays. With sources, the context is the person's notes.

## Section 4: The Doctor (#4)

- **A fix replies `{"find": "...", "replace": "..."}`.** The system prompt says to copy the text to change exactly, and to reply with the smallest piece that contains it.
- The Doctor applies the edit to the draft (to the part, for a slide):
  - `find` must appear exactly once. Not found, found more than once, or empty: that's a failed fix with the reason ("the text to change isn't in the file", "it appears 3 times; include more of it").
  - A reply that is cut off or isn't valid JSON (`ModelReplyError`) is a failed fix with that reason. It is no longer skipped silently.
- **A failed fix still counts as one of the 3 fixes.** Its reason goes into the next fix prompt (as "Problem with your last fix") and, if the Doctor gives up, into the final message.
- Learned repairs are recorded from the before and after drafts as today.

## Notes from planning

- Hits from different indexes are merged by `(source, chunk id)`: every SQLite file numbers its chunks from 1.
- `chunk_tokens`, `keyword_weight` and `meaning_weight` are `Settings` defaults; `eval-search` takes `--chunk-tokens`, `--keyword-weight` and `--meaning-weight` to compare other values, since `Settings` has no other way to be changed.
- The chunk size applies to Markdown. `.py` files keep their tree-sitter chunks.
- The four default smoke goals are a constant in `smoke.py`, not package data.

## Testing

- All tests use the replay model and the hashing embedder; none needs Ollama or the network.
- Each section's tests: the eval harness on the fixture; the run log's lines; the smoke report from replayed runs; the prefixes in what the embedder receives; stopwords dropped and the all-stopword fallback; weighted rrf; a chunk-size change forcing a rebuild; a source index used read-only (a write attempt fails, its file is unchanged) and labelled in the prompt; a mismatched source refused; find/replace applied once, and each failure reason reaching the next prompt.
- The full suite (`.venv/bin/pytest -q`) stays green.

## Review focus

- A source index that is also being written by another process (a `reindex` running) while a run reads it.
- Very short or stopword-only queries, and queries in other languages.
- A `find` that matches across the part boundary of a slide, or whitespace-only differences.
- A smoke run interrupted halfway (Ctrl+C): workspaces cleaned up unless `--keep`.
- An old index (format 1, 400-token chunks) opened by `run`, `search` or as a source.
