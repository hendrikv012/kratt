# Small-model review: can qwen3:8b do good work here?

Date: 2026-10-08. A code reading of the `run` loop, retrieval and the Doctor. Nothing was run against a real model, so every point below is a reading of the code, not a measurement.

**Verdict: workable with changes, not doomed.** The control loop already suits an 8B model. The weak part is retrieval: the model gets too little relevant text, and it searches the wrong corpus. That limits output quality more than the model size does.

## What already works for an 8B model

Keep these as they are.

- **The reply format is enforced.** The JSON schema goes to Ollama's `format` option (`chat.py:36`), so a reply can't be broken JSON. Missing keys are caught at `router.py:256-259`.
- **The model never writes YAML or file structure.** It fills flat fields, and code builds the scene file (`router.py:162-163`, `context.py:86-91`) or the deck (`router.py:203-205`).
- **Steps are small.** Each step is one note of about 200 words, one scene or one slide (`context.py:41-45`). A plan has at most 8 steps (`context.py:25`).
- **The token limits are real.** The prompt is capped at 1,500 tokens (`context.py:14`), every section has its own cap (`context.py:15-20`), and the reply is capped at 450 tokens (`config.py:19`). The token estimate errs high, so Ollama never silently cuts the prompt.
- **The loop stops instead of spiralling.** The Doctor gets 3 fixes, a step gets 8 turns and a run gets 40. A step that keeps failing is marked `[!]` and handed to the person (`router.py:347-351`).

## Mistakes and how to fix them

They are listed in order of impact on output quality. Fix #6 (evals) **first** anyway, so the changes from the other fixes can be measured instead of guessed.

### 1. `run` only searches the workspace

**What's wrong.** `run` indexes only the workspace folder (`router.py:308`) into `WORKSPACE/memory.db` (`__main__.py:106`). An index can belong to only one folder, and pointing `--db` at your notes index fails (`reindex.py:54-55`). A new workspace has almost nothing to search, yet the prompt says "Use only facts from the context and your notes" (`context.py:62`).

**Why it hurts.** The model has two choices: make facts up, or break that rule. Either way, it isn't drawing on your knowledge.

**How to fix it.**
- Add a `--source-db PATH` option (it can be repeated) that opens other indexes **read-only**, such as the notes index built by `memory-engine reindex ~/notes`.
- In `context.py`, run `hybrid_search` on the workspace and on each source index, then merge the results with `rrf` (`search.py:48`). Label each hit with where it came from, such as `[notes] krebs.md › Staging`.
- Never write to a source index. `reindex_folder` keeps running on the workspace only.

### 2. Too little retrieved text reaches the model

**What's wrong.** The spec keeps the window below 2,000 tokens (`config.py:18`, `architecture_spec.md:5`). After the system prompt, index view, current step, notes and error, about 500-700 tokens are left for search results (`context.py:154`). Chunks can be up to 400 tokens (`chunking.py:118`), so that is 1-2 chunks.

**Why it hurts.** One or two chunks is rarely enough to write a good note. One weak hit takes up half of what the model sees.

**How to fix it.** This changes the spec, so you have to decide it.
- **Option A (keep the spec):** split chunks smaller, at 200 tokens (`split_markdown(max_tokens=200)`), so 3-4 different chunks fit in the same space. Bump `EMBEDDING_FORMAT` so the index is rebuilt.
- **Option B (change the spec):** raise `context_window` to about 4096 and give search results about 2,000 tokens. Measure RAM and speed first: the machine has 7.5 GB, and the KV cache grows with the window.
- Try A first. It's free, and #6 will show whether it's enough.

### 3. Search misses easy wins

**What's wrong.**
- nomic-embed-text was trained with task prefixes, but none are added: documents are embedded at `store.py:40` and queries at `search.py:40`. `db.py:10` already expects this change.
- The keyword search ORs together every word of 3 or more letters, with no stopword list (`search.py:29-32`). On a trigram index, words like "the", "and" and "with" match almost everything.
- The two rankings are merged with equal weight (`search.py:48-55`).

**How to fix it.**
- `store.py:40`: prefix document text with `search_document: `. `search.py:40`: prefix the query with `search_query: `. Bump `EMBEDDING_FORMAT` to 2 in `db.py:11` so old vectors are rebuilt.
- Add a short English stopword set in `fts_search` and drop those words before building the `OR` expression.
- Let `rrf` take per-ranking weights. Only change them from 1:1 if the harness from #6 shows a gain.
- Leave out a re-ranker for now. At this corpus size it costs more than it gives.

### 4. The Doctor can run out of reply space

**What's wrong.** A fix must return the **whole file** as one JSON string (`doctor.py:28`) within 450 tokens. A 40-line Python file with JSON escaping can go over. A cut-off reply raises `ModelReplyError` (`chat.py:42-44`), and the Doctor quietly `continue`s (`doctor.py:179-180`), which uses up one of its 3 fixes without saying why.

**How to fix it.**
- Give fix calls their own, larger reply limit (about 1,024 tokens). `ChatModel.complete` can take a `reply_tokens` override.
- Or ask for only the edited piece: `{"find": "...", "replace": "..."}`. That keeps replies short no matter how long the file is.
- Log a cut-off reply as a failed fix with its reason, instead of skipping it silently.

### 5. One reply carries too many decisions

**What's wrong.** A notes reply decides the notes, search query, title, body, target path and done flag all at once (`context.py:56-62`), with `think: False` (`chat.py:38`). The search query it writes only returns results on the **next** turn (`router.py:282`).

**Why it hurts.** It's fine for short notes, but weak for Python that has to pass pytest. The model plans, writes and checks in a single pass, with no room to reason.

**How to fix it.**
- Turn on `think` for Python steps only (`target` ending in `.py`), and give those calls a larger reply limit.
- Run the search before the first turn of a step, using the step title. `context.py:191` already falls back to the title, so make sure the first turn uses it.

### 6. Nothing measures quality

**What's wrong.** The tests use a hashing stand-in embedder (`embeddings.py:28-43`) and a model that replays prepared replies (`chat.py:58-74`). They show the code does what it was designed to do, not that retrieval is good or that qwen3:8b finishes its steps. There are no prompt or reply logs.

**How to fix it.**
- **Retrieval set:** 30-50 query and relevant-chunk pairs from your real notes, in `evals/retrieval.jsonl`. Add a `memory-engine eval-search` command that reports recall@5 and MRR for keyword-only, vector-only and merged search. Run it before and after #2 and #3.
- **Run log:** an option that writes every prompt and reply of `run` to `WORKSPACE/run.jsonl`.
- **Smoke run:** 3-5 fixed goals, one per kind, run with the real model. Track turns per step, Doctor pass rate, the share of steps marked `[!]`, and whether notes cite facts that are actually in the retrieved text.
- Keep the evals out of `pytest`: they need Ollama, and the tests must not.

## Suggested order

1. #6, the measuring harness, to get a baseline.
2. #3, prefixes and stopwords. This is cheap and needs one re-index.
3. #1, the source indexes. This is the biggest gain.
4. #4, the Doctor's reply space.
5. #2 option A, then option B only if the numbers call for it. B needs a decision about the spec.
6. #5, `think` for Python steps.
