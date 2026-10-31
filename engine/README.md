# memory-engine

A local memory and work loop for a small (8B) language model. It keeps everything in plain
Markdown files and uses one SQLite database (`memory.db`) as a rebuildable index over them.
It searches your notes and Python code by keyword and by meaning, and works through a plan
one step at a time, so the model never sees more than 2,000 tokens at once.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
ollama pull nomic-embed-text   # embeddings for search
ollama pull qwen3:8b           # the 8B model that does the work
```

`qwen3:8b` needs about 5-6 GB of free memory, so close other heavy apps before `run`.
The install adds the `memory-engine` command in `.venv/bin/`. Run the tests with
`.venv/bin/pytest`; they never need Ollama.

## Commands

Index a folder of `.md` and `.py` files (run it again after changes; only changed files are re-read):

```bash
.venv/bin/memory-engine reindex ~/notes
```

Search it:

```bash
.venv/bin/memory-engine search "where does the citric acid cycle run"
```

Search sends nomic-embed-text its task prefixes (`search_document:` for notes, `search_query:` for queries), so an index built before that must be rebuilt with `reindex`.

Notes are split into chunks of about 200 tokens, so several different notes fit in a prompt. `reindex` rebuilds an index made with another chunk size.

Work through a goal step by step in a workspace folder:

```bash
.venv/bin/memory-engine run ~/study/krebs --goal "Write a one-page study guide on the Krebs cycle"
```

Run it again without `--goal` to continue. Add `--log` to write every prompt, reply, search and check to `WORKSPACE/run.jsonl`, one JSON object per line, including each fix the Doctor asks for and why a failed one failed. The workspace holds:

- `INDEX.md`: the goal, the steps and their state, and a list of the results. Edit it any time.
- `SCRATCHPAD.md`: the model's notes for the current step, wiped when the step is done.
- `chunk_001.md`, `chunk_002.md`, ...: one file per result, each with a YAML header.
- `memory.db`: the search index. Delete it and the next run rebuilds it from the files.

### Using your notes in a run

A run can also read your own notes without ever writing to them. Index the folder into its own database, then name that database when you run:

```bash
.venv/bin/memory-engine --db ~/Study/.study/memory.db reindex ~/Study
.venv/bin/memory-engine run ~/study/krebs --goal "Write a one-page study guide on the Krebs cycle" --source-db ~/Study/.study/memory.db
```

`--source-db` can be given more than once. Its hits join the workspace's in each search, marked with the folder's name (`[Study] Biology/Krebs.md`). The database is opened read-only and immutable: nothing is written or created beside it, so it can sit in a read-only folder. Run `reindex` on the folder again to refresh it, even during a run: before each search the run checks whether the file changed and opens it again if so. If it can't be opened while a reindex is writing it (in a read-only folder, say), or can't be read, the run stops with a message naming the file and saying to try again. An index built with other embedding settings is refused with a message to reindex.

## Measuring search

`eval-search` indexes a folder of notes in a temporary database and scores three rankings (keyword, meaning, and the merged result) by recall@5 and MRR:

```bash
.venv/bin/memory-engine eval-search evals/fixture.jsonl --corpus evals/fixture [--chunk-tokens 200]
```

The queries file has one JSON object per line: a `query` and the notes that answer it, as `relevant` entries with a `path` relative to the corpus folder and, optionally, a `heading` (a hit counts when its heading contains that text):

```json
{"query": "how many NADH does one turn of the Krebs cycle make", "relevant": [{"path": "Biology/Krebs.md", "heading": "Products"}]}
```

Recall is the share of the `relevant` entries found in the top 5, and MRR is 1 divided by the rank of the first one found, both averaged over the queries. The fixture in `evals/` is small and only proves the harness works; to judge search for real, write queries against your own notes.

## Smoke test

`smoke` runs fixed goals with the real model (one notes goal, one film, one slides, one code), each in a temporary workspace, and summarises their run logs. It needs Ollama with `qwen3:8b` and `nomic-embed-text`, and takes a while:

```bash
.venv/bin/memory-engine smoke [--goals goals.jsonl] [--keep] [--source-db ~/Study/.study/memory.db]
```

`goals.jsonl` has one `{"kind": "notes", "goal": "..."}` object per line (`kind` is `notes`, `film` or `slides`). `--keep` leaves the workspaces in place so you can read their `run.jsonl`. Each run reads notes the way `run --source-db` does: the indexes given with `--source-db`, or else a temporary index of `evals/fixture` built at the start. It prints one row per goal and writes `smoke-YYYY-MM-DD-HHMMSS.json` to the current folder. The columns:

- status and steps: how the run ended (`done`, `stuck`, `paused` after its turn limit, or `blocked` on a missing tool or a file you need to fix) and how many of its steps were done. A plan that never worked shows as `stuck` with `steps 0/0`.
- turns per step: model turns spent on steps, divided by the number of steps. Lower is better.
- checks passed: the share of Doctor file checks that passed. Checks the machine couldn't run (no bubblewrap, no Marp tool) aren't counted as failures; they're shown as `(N blocked)`.
- stuck: the share of steps that ended stuck (`n/a` without steps).
- grounding: the share of a note's content words (4+ letters, no stopwords) that also appear in the source hits shown for that step before the note was written, averaged over notes. Hits from the workspace itself are left out, since they are the model's own earlier output. It counts shared words, not facts: compare runs with each other, not with a fixed bar.

## Study folder service

The study app keeps its subjects, folders, pages, quick notes and sources as Markdown files in
a Study folder, and reads and writes them through this service:

```bash
.venv/bin/memory-engine serve                 # the remembered folder, or ~/Study
.venv/bin/memory-engine serve --folder ~/Exams
```

- It listens on `http://127.0.0.1:5057`, so only this computer can reach it, and it answers only
  the study app: requests from any other web page are refused.
- Subjects and folders are real folders; each page is one `.md` file with a YAML header
  (`id`, `title`, `created`, `updated`). Deleting moves a file into `.study/trash/`, never away
  for good, and `.study/layout.json` keeps order, colors and open folders.
- If a file changed on disk while the app still had unsaved typing for it, both versions are
  kept: the one on disk is saved beside it as `<title> (from disk <date time>).md`.
- Changing the folder in the app (Settings → Data → Study folder) is remembered in
  `~/.config/memory-engine/study.json`.
- When the app's AI runs on this computer (Settings → AI → On this computer), Kratt Chat and
  extensions' `ai.ask` go to Ollama with the model picked there (`local_ai.py`). The service keeps
  that choice in `study.json` (`local`, `model`; `PUT /setting/local-ai`), answers with
  `POST /local/ask` (`prompt`), and `GET /local/status` gives Ollama's state (`running`, `started`,
  `not-installed`, `failed` with Ollama's own error, or `off`) and the installed models that can chat.
  It never downloads a model. Ollama is asked at `OLLAMA_HOST`, or `127.0.0.1:11434`.
  - If Ollama isn't running, the service starts `ollama serve` (found on the PATH or where the
    Linux, macOS and Windows installers put it) at launch when a model is picked, and whenever the
    app asks for the status or an answer. One that is already running is used, never a second.
  - On exit (Ctrl+C, `kill`, a closed terminal) it stops only an Ollama it started itself; a systemd
    service or the Ollama app is left running. Its output goes to `<temp>/kratt-logs/ollama.log`.
  - Ask failures come back as `no-model`, `model-missing`, `ollama-missing`, `ollama-failed` or
    `ollama-unavailable`; the app turns them into messages that say what to do.
- With the AI online, it bridges the study app's prompts to a local Open Notebook: `POST /notebook/ask`
  (`base_url`, `prompt`) runs the prompt through an Open Notebook transformation named
  "Study app prompt", created the first time it is missing, and `GET /notebook/status?base_url=`
  checks that Open Notebook answers. Only http(s) addresses are accepted and redirects are not
  followed. Failures come back as `ai-auth` (wrong password) or `ai-unavailable`. Open Notebook's
  password is set with `PUT /setting/notebook-password` and kept in
  `~/.config/memory-engine/notebook-password` (readable only by you); the service never sends it back.
- `scripts/start.fish` (in the workspace) starts the service and the study app, and stops the service
  when the app's dev server stops.


`run` makes notes by default. Choose another kind when you start a workspace (it is saved in
`INDEX.md` as `kind:`, so later runs remember it):

```bash
.venv/bin/memory-engine run ~/film/lab --goal "A two-minute film about the Krebs cycle" --kind film
.venv/bin/memory-engine run ~/talks/krebs --goal "A short talk on the Krebs cycle" --kind slides
```

**Film:** each step is one scene, saved as `scenes/scene_01.md`, `scenes/scene_02.md`, ...
New scenes take the next free number and never replace a scene file someone else wrote.

```markdown
---
title: Arrival
scene_number: 1
location: University lab, night
camera_angle: Wide shot, slow push-in
lighting: Cold fluorescent light
---
## Visual prompt
A quiet lab at night, one desk lamp on.

## Voiceover
It began here, with a question nobody had asked.
```

**Slides:** each step adds exactly one slide to `deck.md`, a [Marp](https://marp.app) deck. A
slide starts with a `# heading` line, has at most 80 words, closes any code block it opens, and
has no line of `---`, `***` or `___` (Marp would start a new slide there). Before every save the
whole deck is rendered with the Marp tool and must produce the same number of slides.

You can edit `deck.md` yourself between runs: your version is committed first and new slides
go after it. If an edit breaks the deck, the next run stops with a message saying what to fix.
Decks are checked in the sandbox, so they need bubblewrap too. Install the Marp tool once (it
needs Node.js):

```bash
npm ci --prefix tools/marp
```

## Checked files

A result can name a `target`, the project file it should become (like `notes/krebs.md` or
`src/parse.py`). Before anything is written there, the Doctor checks it:

- Markdown needs a YAML header with a `title` and no HTML. In slide decks (`marp: true`),
  each slide may have at most 80 words.
- Python is compiled, then checked with `ruff` and `mypy`, then the workspace's tests run with
  `pytest`. This happens on a temporary copy inside a sandbox (bubblewrap, the `bwrap` command)
  with no network, no terminal and your home folder hidden (the rest of the system is visible
  read-only). Without bubblewrap, Python targets are refused.

When a check fails, the model gets back only the error and its draft (plus one matching fix
that worked before) and has up to 3 tries. A file that passes is written, the fix is
remembered in the database for next time, and the file is committed in the workspace's own
git repository (the Doctor runs `git init` there if needed, even inside another repository).
The Doctor only replaces a file that its own last commit wrote and that nobody has changed
since; otherwise the model has to pick a new name (`deck.md` is the exception: see Slides). Names that would hide a Python module
(like `yaml.py`) are refused too.
Results without a target stay as `chunk_*.md` notes.

## INDEX.md

```markdown
---
goal: Write a study guide on the Krebs cycle
status: working
kind: notes
updated: '2026-10-06T12:00:00+00:00'
---
## Steps
- [x] List the eight steps
- [ ] Explain where it happens
- [!] Draw the cycle

## Contents
- chunk_001.md: The eight steps

## Notes
Keep it under one page.
```

If a tool is missing or a file needs your attention (for example the Marp tool isn't installed),
`run` stops at once with `stopped: …` instead of asking the model again.

`[ ]` is to do, `[x]` is done, and `[!]` is stuck: the model tried 8 times without finishing.
Read `SCRATCHPAD.md`, reword or split the step, change it back to `[ ]`, and run again.
Steps must be flat `- [ ]` lines. Sections other than Steps and Contents (like Notes) are
yours: the model reads them and the router never changes them.
