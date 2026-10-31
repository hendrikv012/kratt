# Phase 2: File-System Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python router that runs a local 8B model one step at a time through a plan kept in Markdown files (`INDEX.md`, `SCRATCHPAD.md`, `chunk_*.md`), feeding it a prompt that never exceeds the 2,000-token window, as Phase 2 of the local 8B memory architecture.

**Architecture:** A workspace folder holds the person's own notes and code plus three kinds of working-memory files. Every turn the router re-reads `INDEX.md` from disk, so the file stays the truth and a person can edit it between runs. It then builds one bounded prompt from four parts: an index view, the scratchpad's newest notes, Phase 1 hybrid-search hits, and the last error. It asks the model for one JSON reply through Ollama's structured output, applies the reply to the files, and wipes the scratchpad when a step finishes. Phase 2 writes only working-memory files; promoting results into a project's primary files is the Phase 3 Doctor's job.

**Tech Stack:** Python 3.14, PyYAML 6 (frontmatter), Ollama `/api/chat` with a JSON-schema `format` and `think: false`, and Phase 1's `memory_engine` (SQLite, hybrid search, `estimate_tokens`).

**Spec:** `/home/caesarsta/Downloads/BaseN/architecture_spec.md` (sections 1, 2, 6 Phase 2, and 7).

## Global Constraints

- **Location:** extend the existing package at `/home/caesarsta/Downloads/BaseN/memory-engine/` (git, `main` at `6d84356`). All paths below are relative to it. Work on a branch.
- **Context window:** "keep the 8B model's active context window strictly below 2,000 tokens".
  - Ollama gets `num_ctx` 1999 and `num_predict` 450.
  - The prompt is at most 1,500 tokens by `estimate_tokens`, which deliberately estimates high.
  - 1,500 + 450 = 1,950.
- **Every loop:** "The 8B model reads this at the start of every loop". Every prompt contains a view of `INDEX.md` read from disk that turn.
- **Scratchpad:** "Must be wiped clean programmatically after a successful step". A step is successful when the model sets `step_done` and the step has at least one saved chunk file.
- **File format:** "All file outputs must strictly use Markdown formatting and YAML frontmatter (no HTML tags)". `INDEX.md`, `SCRATCHPAD.md` and every `chunk_*.md` start with a YAML frontmatter block. Chunk bodies with HTML tags outside code are refused.
- **Flat Markdown:** "clean, un-nested Markdown to prevent token bloat". `INDEX.md` steps are flat `- [ ]` lines; nested lines are a format error.
- **File names:** `INDEX.md`, `SCRATCHPAD.md` and `chunk_NNN.md` live directly in the workspace root (not in a subfolder). `INDEX.md` and `SCRATCHPAD.md` are never indexed into the search database; chunk files are.
- **Runtime:** Ollama at `http://localhost:11434`, chat model `qwen3:8b` (Q4_K_M), embeddings `nomic-embed-text`, all set in `Settings`.
- **Tests:** tests never need Ollama. They use `ScriptedModel`, `FakeEmbedder`, or the stub HTTP server.
- **Dependencies:** the only new one is `pyyaml>=6`.
- **Commits:** no AI or assistant attribution lines (the user's rule).

## Review Focus

1. **A person edits `INDEX.md` between runs** (ticks a step, adds or reorders steps, writes notes under their own heading). The next run follows the file as it is now, and every section the router doesn't own survives its rewrites. Tasks 2 and 5 test this.
2. **The 8B model answers with broken JSON, or with valid JSON that breaks the rules** (finishing without a result). That turn fails, the model is told why in the next prompt, nothing crashes, and the turn counts toward the stuck limit. Tasks 1 and 5 test this.
3. **The model never finishes a step.** The run stops after 8 turns on it, marks the step `[!]` in `INDEX.md`, and keeps the scratchpad so a person can see what went wrong. Task 5 tests this.
4. **A run is interrupted** (turn limit, Ctrl+C, power loss). Files are never half-written, because every write is atomic. Running again resumes at the first unfinished step with that step's notes. Tasks 2 and 5 test this.
5. **The model puts HTML in a result.** The chunk is not saved, the model is told which tag, and the step does not finish. Tasks 3 and 5 test this.

## File Structure

| File | Responsibility |
|---|---|
| `src/memory_engine/config.py` | Modify: add `chat_model`, `context_window`, `reply_tokens` to `Settings` |
| `src/memory_engine/ollama.py` | Create: one HTTP call to Ollama with readable errors, shared by embeddings and chat |
| `src/memory_engine/embeddings.py` | Modify: `OllamaEmbedder` uses `ollama.post_json` |
| `src/memory_engine/chat.py` | Create: `ChatModel` protocol, `OllamaChat`, `ScriptedModel`, `ChatError`, `ModelReplyError` |
| `src/memory_engine/frontmatter.py` | Create: split/join YAML frontmatter, `atomic_write` |
| `src/memory_engine/index_file.py` | Create: `INDEX.md` model, parse and render |
| `src/memory_engine/workfiles.py` | Create: `SCRATCHPAD.md` and `chunk_NNN.md` handlers |
| `src/memory_engine/context.py` | Create: system prompts, JSON schemas, budgeted prompt building |
| `src/memory_engine/router.py` | Create: the run loop |
| `src/memory_engine/reindex.py` | Modify: never index `INDEX.md` or `SCRATCHPAD.md` |
| `src/memory_engine/__main__.py` | Modify: `run` command |
| `README.md` | Create: setup and the three commands |
| `tests/conftest.py` | Modify: move the Ollama stub (`_start_stub`, `make_stub`) here from `tests/test_embeddings.py`, unchanged |

---

### Task 1: Shared Ollama client and the chat model

**Files:**
- Create: `src/memory_engine/ollama.py`, `src/memory_engine/chat.py`
- Modify: `src/memory_engine/config.py`, `src/memory_engine/embeddings.py`, `tests/conftest.py`, `tests/test_embeddings.py` (stub moved out, tests unchanged)
- Test: `tests/test_chat.py`

**Interfaces:**
- Consumes: Phase 1's `EmbeddingError`, `OllamaEmbedder`, and the stub `make_stub(status=200, payload=None, delay=0.0)`, which returns `.url` and `.requests` (a list of decoded request bodies).
- Produces:
  - **Settings:** gains `chat_model: str = "qwen3:8b"`, `context_window: int = 1999` and `reply_tokens: int = 450`.
  - **`ollama.py`:**
    - `class OllamaError(RuntimeError)`.
    - `post_json(url: str, path: str, payload: dict, timeout: float, model: str, error: type[OllamaError] = OllamaError) -> dict`. It POSTs JSON and returns the decoded JSON object.
    - It raises `error(...)` with exactly Phase 1's messages:
      - missing model: ``Ollama does not have the model {model}: run `ollama pull {model}` ``;
      - other HTTP errors: `Ollama at {url} answered HTTP {code}: {detail}`;
      - timeout: `Ollama at {url} did not answer within {timeout:g} s`;
      - connection failure: `Ollama not reachable at {url}: {reason}`;
      - a body that isn't a JSON object: `Ollama at {url} gave an unexpected response (...)`.
  - **`EmbeddingError`** now subclasses `OllamaError`. `OllamaEmbedder` calls `post_json(..., error=EmbeddingError)`, and every existing embedding test passes unchanged.
  - **`chat.py`:**
    - `class ChatError(OllamaError)`: Ollama itself failed. The run must stop.
    - `class ModelReplyError(ValueError)`: the model's text broke the format. The turn fails.
    - `class ChatModel(Protocol)`: `complete(self, messages: list[dict], schema: dict) -> dict`.
    - `OllamaChat(url: str, model: str, context_window: int = 1999, reply_tokens: int = 450, timeout: float = 300.0)`:
      - POSTs to `/api/chat` with `{"model", "messages", "format": schema, "stream": false, "think": false, "options": {"num_ctx": context_window, "num_predict": reply_tokens, "temperature": 0.2}}`.
      - Parses `message.content` with `json.loads`.
      - Raises `ModelReplyError("the reply was not valid JSON: …")` if that fails, and `ModelReplyError("the reply was not a JSON object")` for any other JSON type.
    - `ScriptedModel(replies: list[dict | Exception])`:
      - `complete` pops the next reply, raising it if it's an exception and returning it otherwise.
      - It records `.prompts` (a copy of each `messages`) and `.schemas`.
      - When the replies run out, it raises `RuntimeError("ScriptedModel has no replies left")`.

- [ ] **Step 1: Move the stub, then write the failing tests**

Move `_start_stub` and the `make_stub` fixture from `tests/test_embeddings.py` into `tests/conftest.py`, keeping their code (`stub_ollama` stays in `test_embeddings.py`). Then write `tests/test_chat.py`:

```python
PLAN = {"type": "object"}

def chat_reply(obj):
    return {"message": {"role": "assistant", "content": json.dumps(obj)}, "done": True}

def test_chat_returns_the_parsed_reply(make_stub):
    stub = make_stub(payload=chat_reply({"steps": ["Read", "Write"]}))
    assert OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "plan"}], PLAN) == {"steps": ["Read", "Write"]}

def test_chat_request_keeps_the_window_below_2000(make_stub):
    stub = make_stub(payload=chat_reply({}))
    OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)
    sent = stub.requests[0]
    assert sent["format"] == PLAN and sent["stream"] is False and sent["think"] is False
    assert sent["options"]["num_ctx"] == 1999 and sent["options"]["num_predict"] == 450

def test_missing_chat_model_says_how_to_get_it(make_stub):
    stub = make_stub(status=404, payload={"error": 'model "qwen3:8b" not found, try pulling it first'})
    with pytest.raises(ChatError, match="ollama pull qwen3:8b"):
        OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)

@pytest.mark.parametrize("content, message", [("Sure! Here are the steps", "not valid JSON"), ("[1, 2]", "not a JSON object")])
def test_bad_reply_text_is_a_model_mistake(make_stub, content, message):
    stub = make_stub(payload={"message": {"role": "assistant", "content": content}})
    with pytest.raises(ModelReplyError, match=message):
        OllamaChat(stub.url, "qwen3:8b").complete([{"role": "user", "content": "x"}], PLAN)

def test_scripted_model_replays_and_records():
    model = ScriptedModel([{"steps": ["a"]}, ModelReplyError("broken")])
    assert model.complete([{"role": "user", "content": "hi"}], PLAN) == {"steps": ["a"]}
    with pytest.raises(ModelReplyError):
        model.complete([{"role": "user", "content": "again"}], PLAN)
    assert [p[-1]["content"] for p in model.prompts] == ["hi", "again"]
    with pytest.raises(RuntimeError, match="no replies left"):
        model.complete([], PLAN)
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_chat.py -v`. Expected: FAIL (`ModuleNotFoundError: memory_engine.chat`). Also run `.venv/bin/pytest tests/test_embeddings.py -q`. Expected: 13 passed (the stub move changed nothing).
- [ ] **Step 3: Implement `ollama.py` and `chat.py`, move `OllamaEmbedder`'s HTTP code onto `post_json`, and extend `Settings`** as specified. Ollama's HTTP and parsing code moves out of `embeddings.py`; `OllamaEmbedder` keeps only batching, the vector-count check and the dimension check.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: 83 passed (77 + 6).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: shared Ollama client and a structured-output chat model"`

---

### Task 2: Frontmatter, atomic writes and INDEX.md

**Files:**
- Create: `src/memory_engine/frontmatter.py`, `src/memory_engine/index_file.py`
- Modify: `pyproject.toml` (add `pyyaml>=6`, then `.venv/bin/pip install -e '.[dev]'`)
- Test: `tests/test_index_file.py`

**Interfaces:**
- Produces:
  - **`frontmatter.py`:**
    - `split_frontmatter(text: str) -> tuple[dict, str]`: returns `({}, text)` when there's no leading `---` block. YAML errors propagate as `yaml.YAMLError`.
    - `join_frontmatter(meta: dict, body: str) -> str`: produces `"---\n" + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True) + "---\n" + body`.
    - `atomic_write(path: Path, text: str) -> None`: writes a temp file in the same folder, `fsync`s it, then calls `os.replace`. No temp file is left behind.
  - **`index_file.py`:**
    - `INDEX_NAME = "INDEX.md"`.
    - `Step` (frozen dataclass): `title: str`, `state: str`, with states `"todo"`, `"done"`, `"stuck"` written as `[ ]`, `[x]` (or `[X]`), `[!]`.
    - `Index` (frozen dataclass):
      - `goal: str`;
      - `status: str` (`"planning"`, `"working"`, `"done"` or `"stuck"`);
      - `steps: tuple[Step, ...]`;
      - `contents: tuple[tuple[str, str], ...]`, as (file name, title) pairs;
      - `extra: str` (everything the router doesn't own, verbatim, stripped);
      - `updated: str = ""`.
    - `class IndexFormatError(ValueError)`: messages start with `INDEX.md`.
    - `new_index(goal: str) -> Index`: status `"planning"`, nothing else filled in.
    - `read_index(path: Path) -> Index` and `write_index(path: Path, index: Index) -> None`. `write_index` stamps `updated` (UTC ISO-8601) and writes atomically.
- **The format, exactly** (render must produce this; parse must accept it):

```markdown
---
goal: Write a study guide on the Krebs cycle
status: working
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

- **Parse rules:**
  - The body is split into sections at lines starting with `## `. `## Steps` and `## Contents` are the router's, matched case-insensitively.
  - Every other section, and any text before the first section, goes into `extra` in its original order.
  - Inside Steps, blank lines are ignored. A line that isn't `- [ ] text`, `- [x] text`, `- [X] text` or `- [!] text` at column 0 raises `IndexFormatError(f"INDEX.md line {n}: steps must be flat '- [ ] text' lines")`.
  - Contents lines are `- name: title`.
  - Line numbers in errors count from the top of the file, frontmatter included.
  - A missing `status` means `"working"` when there are steps and `"planning"` otherwise. Any other unknown value raises `IndexFormatError`.
  - `updated` is read as `str(value)`, because a person may write an unquoted date.
  - Bad YAML or a missing `goal` raises `IndexFormatError`.
- **Render:** frontmatter, then `## Steps` with its lines, a blank line, `## Contents` with its lines, then a blank line and `extra` if it's non-empty. Each section ends with exactly one blank line before the next.

- [ ] **Step 1: Write the failing tests**

```python
INDEX = """---
goal: Write a study guide on the Krebs cycle
status: working
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
"""

def test_frontmatter_round_trip():
    assert split_frontmatter(join_frontmatter({"title": "A: b", "step": "x"}, "Body\n")) == ({"title": "A: b", "step": "x"}, "Body\n")

def test_text_without_frontmatter():
    assert split_frontmatter("Just text") == ({}, "Just text")

def test_atomic_write_leaves_only_the_file(tmp_path):
    atomic_write(tmp_path / "a.md", "old")
    atomic_write(tmp_path / "a.md", "new")
    assert [p.name for p in tmp_path.iterdir()] == ["a.md"] and (tmp_path / "a.md").read_text() == "new"

def test_read_index(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    assert index.goal == "Write a study guide on the Krebs cycle" and index.status == "working"
    assert [(s.title, s.state) for s in index.steps] == [
        ("List the eight steps", "done"), ("Explain where it happens", "todo"), ("Draw the cycle", "stuck")]
    assert index.contents == (("chunk_001.md", "The eight steps"),)
    assert index.extra == "## Notes\nKeep it under one page."

def test_write_then_read_round_trips(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    write_index(tmp_path / "INDEX.md", index)
    assert replace(read_index(tmp_path / "INDEX.md"), updated="") == replace(index, updated="")

def test_user_sections_survive_a_rewrite(tmp_path):                     # Review Focus 1
    (tmp_path / "INDEX.md").write_text(INDEX)
    index = read_index(tmp_path / "INDEX.md")
    write_index(tmp_path / "INDEX.md", replace(index, steps=index.steps + (Step("Quiz yourself", "todo"),)))
    text = (tmp_path / "INDEX.md").read_text()
    assert "## Notes\nKeep it under one page." in text and "- [ ] Quiz yourself" in text

def test_nested_steps_are_refused(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("- [ ] Explain", "  - [ ] Explain"))
    with pytest.raises(IndexFormatError, match="INDEX.md line 8: steps must be flat"):
        read_index(tmp_path / "INDEX.md")

def test_bad_yaml_is_a_readable_error(tmp_path):
    (tmp_path / "INDEX.md").write_text("---\ngoal: [unclosed\n---\n## Steps\n")
    with pytest.raises(IndexFormatError, match="INDEX.md"):
        read_index(tmp_path / "INDEX.md")

def test_new_index_renders_flat_sections(tmp_path):
    write_index(tmp_path / "INDEX.md", new_index("Learn: the cycle"))
    meta, body = split_frontmatter((tmp_path / "INDEX.md").read_text())
    assert meta["goal"] == "Learn: the cycle" and meta["status"] == "planning"
    assert body.startswith("## Steps\n") and "## Contents\n" in body
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_index_file.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `frontmatter.py` and `index_file.py`** as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest tests/test_index_file.py -v`. Expected: 9 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: INDEX.md with YAML frontmatter, flat steps and atomic writes"`

---

### Task 3: SCRATCHPAD.md and chunk files

**Files:**
- Create: `src/memory_engine/workfiles.py`
- Test: `tests/test_workfiles.py`

**Interfaces:**
- Consumes: `split_frontmatter`, `join_frontmatter`, `atomic_write` (Task 2).
- Produces:
  - `SCRATCHPAD_NAME = "SCRATCHPAD.md"`, `CHUNK_PATTERN = "chunk_*.md"`, `MAX_TITLE = 120`.
  - **Scratchpad.** The frontmatter `{step: <step title>}` ties the notes to one step.
    - `read_scratchpad(workspace: Path, step: str) -> str`: returns the stripped body if the file exists and its `step` equals `step`, and `""` otherwise.
    - `append_scratchpad(workspace: Path, step: str, text: str) -> None`: appends `text.strip()` as a new paragraph separated by a blank line. If the file belongs to another step, it starts fresh.
    - `wipe_scratchpad(workspace: Path, step: str) -> None`: leaves only the frontmatter `{step: step}` and an empty body.
  - **Chunks:**
    - `class ChunkFormatError(ValueError)`.
    - `html_tag(body: str) -> str | None`: the first `<tag>`, `</tag>` or `<!--` outside fenced code blocks and `inline code` spans, matched with the regex `<(?:[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?|/[A-Za-z][A-Za-z0-9-]*\s*)>|<!--`. A closing `>` is required, so prose like `x<y` passes. It returns the matched text, or `None`.
    - `write_chunk(workspace: Path, step: str, title: str, body: str) -> str`: returns the new file name.
      - A leading frontmatter block in `body` is removed, because the router writes its own.
      - An empty body raises `ChunkFormatError("the chunk is empty")`.
      - An HTML tag raises `ChunkFormatError(f"HTML tags are not allowed: {tag}")`.
      - `title` is stripped and cut to `MAX_TITLE`; an empty title becomes the first 60 characters of the body's first line.
      - The name is `chunk_{n:03d}.md`, with `n` one more than the highest existing number (1 if there are none).
      - The frontmatter is `{title, step, created}` (UTC ISO-8601). The file is written atomically.
    - `chunks_for_step(workspace: Path, step: str) -> list[str]`: names of chunk files whose frontmatter `step` equals `step`, sorted.

- [ ] **Step 1: Write the failing tests**

```python
def test_scratchpad_append_and_read(tmp_path):
    append_scratchpad(tmp_path, "List the steps", "First idea.")
    append_scratchpad(tmp_path, "List the steps", "Second idea.")
    assert read_scratchpad(tmp_path, "List the steps") == "First idea.\n\nSecond idea."
    assert split_frontmatter((tmp_path / "SCRATCHPAD.md").read_text())[0] == {"step": "List the steps"}

def test_scratchpad_belongs_to_one_step(tmp_path):
    append_scratchpad(tmp_path, "A", "About A.")
    assert read_scratchpad(tmp_path, "B") == ""
    append_scratchpad(tmp_path, "B", "About B.")
    assert read_scratchpad(tmp_path, "B") == "About B."

def test_wipe_scratchpad(tmp_path):
    append_scratchpad(tmp_path, "A", "Notes.")
    wipe_scratchpad(tmp_path, "B")
    assert read_scratchpad(tmp_path, "B") == "" and split_frontmatter((tmp_path / "SCRATCHPAD.md").read_text()) == ({"step": "B"}, "")

def test_missing_scratchpad_reads_empty(tmp_path):
    assert read_scratchpad(tmp_path, "A") == ""

def test_chunks_are_numbered_with_frontmatter(tmp_path):
    assert write_chunk(tmp_path, "List the steps", "Eight steps", "1. Citrate\n2. Isocitrate") == "chunk_001.md"
    assert write_chunk(tmp_path, "Explain", "Location", "In the matrix.") == "chunk_002.md"
    meta, body = split_frontmatter((tmp_path / "chunk_001.md").read_text())
    assert (meta["title"], meta["step"], body.strip()) == ("Eight steps", "List the steps", "1. Citrate\n2. Isocitrate")

def test_numbering_continues_after_the_highest(tmp_path):
    (tmp_path / "chunk_007.md").write_text("---\ntitle: old\nstep: x\n---\nOld.")
    assert write_chunk(tmp_path, "s", "t", "New.") == "chunk_008.md"

def test_html_in_a_chunk_is_refused(tmp_path):                        # Review Focus 5
    with pytest.raises(ChunkFormatError, match="HTML tags are not allowed: <div>"):
        write_chunk(tmp_path, "s", "t", "Intro\n<div>hi</div>")
    assert list(tmp_path.glob("chunk_*.md")) == []

def test_angle_brackets_in_code_are_allowed(tmp_path):
    write_chunk(tmp_path, "s", "Generics", "Use `List<int>` here.\n\n```java\nMap<String, Integer> m;\n```\n\n2 < 3 and 5 > 4.")

def test_model_frontmatter_is_replaced(tmp_path):
    name = write_chunk(tmp_path, "s", "Real title", "---\ntitle: Fake\n---\nText.")
    meta, body = split_frontmatter((tmp_path / name).read_text())
    assert meta["title"] == "Real title" and body.strip() == "Text."

def test_empty_chunk_is_refused(tmp_path):
    with pytest.raises(ChunkFormatError, match="empty"):
        write_chunk(tmp_path, "s", "t", "  \n")

def test_chunks_for_step(tmp_path):
    write_chunk(tmp_path, "A", "t1", "One.")
    write_chunk(tmp_path, "B", "t2", "Two.")
    write_chunk(tmp_path, "A", "t3", "Three.")
    assert chunks_for_step(tmp_path, "A") == ["chunk_001.md", "chunk_003.md"]
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_workfiles.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `workfiles.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 11 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: scratchpad and chunk file handlers with YAML frontmatter and no HTML"`

---

### Task 4: The bounded prompt

**Files:**
- Create: `src/memory_engine/context.py`
- Test: `tests/test_context.py`

**Interfaces:**
- Consumes: `Index`, `Step` (Task 2); Phase 1's `hybrid_search(conn, query, embedder, limit=5, max_tokens=1800, regex=None)`, `format_hit`, `estimate_tokens`, `truncate_to_tokens`.
- Produces:
  - **Budgets:** `PROMPT_BUDGET = 1500`, `INDEX_BUDGET = 250`, `SCRATCHPAD_BUDGET = 350`, `ERROR_BUDGET = 100`, `SEARCH_LIMIT = 5`.
  - **`PLAN_SCHEMA`:** `{"type": "object", "properties": {"steps": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 8}}, "required": ["steps"]}`.
  - **`WORK_SCHEMA`:** `{"type": "object", "properties": {"scratchpad": {"type": "string"}, "search": {"type": "string"}, "chunk_title": {"type": "string"}, "chunk_body": {"type": "string"}, "step_done": {"type": "boolean"}}, "required": ["scratchpad", "search", "chunk_title", "chunk_body", "step_done"]}`.
  - **`PLAN_SYSTEM` and `WORK_SYSTEM`** use exactly this text:

    `PLAN_SYSTEM`:
    ```
    You plan work for a small local assistant. Break the goal into 3 to 8 short steps.
    Each step is one concrete task whose result fits in one short Markdown file.
    Reply with JSON: {"steps": ["...", "..."]}.
    ```
    `WORK_SYSTEM`:
    ```
    You are working through a plan one step at a time. Reply with one JSON object:
    - scratchpad: short working notes for this step, kept until the step is done, or "".
    - search: words to look up in the project next turn, or "".
    - chunk_title and chunk_body: when you have this step's result, its title and its Markdown text (no HTML tags, no YAML header); otherwise "".
    - step_done: true only when this step's result has been saved as a chunk.
    Use only facts from the context and your notes. Be brief.
    ```
  - **`index_view(index: Index, current: int | None, max_tokens: int = INDEX_BUDGET) -> str`.** `current` is a 0-based step position.
    - Lines: `Goal: …`, then `Progress: {done} done, {stuck} stuck, {todo} to do`, then each step as `- [x] …`, `- [!] …`, `- [ ] …` (the current step as `- [>] …`), then `extra` (the person's notes), then `Contents: name (title), …`.
    - When over budget, it drops Contents first, then cuts `extra` to 60 tokens, then shows only steps `current-2 … current+3`, and finally applies `truncate_to_tokens`.
  - **`build_plan_prompt(conn, embedder, index: Index) -> list[dict]`:** `[{"role": "system", "content": PLAN_SYSTEM}, {"role": "user", "content": …}]`. The user part has the goal (cut to 200 tokens), `extra` (cut to 300 tokens), and search hits for the goal, which get the remaining budget.
  - **`build_work_prompt(conn, embedder, index: Index, current: int, scratchpad: str, search_query: str, last_error: str) -> list[dict]`:** a system message plus one user message with these sections, in order: `# Index` (`index_view`), `# Current step` (`{n}. {title}`, 1-based), `# Your notes so far` (the newest `SCRATCHPAD_BUDGET` tokens of the scratchpad, cut from the front, or `(empty)`), `# From the project` (hits joined by blank lines, or `(nothing found)`), and, only when `last_error` is set, `# Problem with your last reply` (cut to `ERROR_BUDGET`).
    - Search uses `search_query` when it isn't empty, and the current step's title otherwise.
    - The search's `max_tokens` is `PROMPT_BUDGET` minus the estimate of everything else, built first; when that is ≤ 0, search is skipped.
  - **Invariant:** for both builders, the sum of `estimate_tokens(m["content"])` over the messages is ≤ `PROMPT_BUDGET`.

- [ ] **Step 1: Write the failing tests**

```python
def steps(n, done=0):
    return tuple(Step(f"Step {i} " + "detail " * 8, "done" if i < done else "todo") for i in range(n))

def total(messages):
    return sum(estimate_tokens(m["content"]) for m in messages)

def test_system_prompts_are_short():
    assert estimate_tokens(PLAN_SYSTEM) <= 300 and estimate_tokens(WORK_SYSTEM) <= 300

def test_prompt_fits_the_budget_when_everything_is_huge(conn, fake):
    for i in range(10):
        index_markdown(conn, f"n{i}.md", "# Big\n" + "detail matrix " * 2000, fake)
    index = Index("Learn " * 200, "working", steps(100, done=49), tuple((f"chunk_{i:03d}.md", "t " * 20) for i in range(60)), "Note " * 500)
    messages = build_work_prompt(conn, fake, index, 49, "note " * 5000, "", "error " * 3000)
    assert total(messages) <= PROMPT_BUDGET

def test_index_view_keeps_the_current_step():
    view = index_view(Index("Goal", "working", steps(100, done=49), (), ""), 49)
    assert estimate_tokens(view) <= INDEX_BUDGET and "- [>] Step 49 " in view and "Progress: 49 done, 0 stuck, 51 to do" in view

def test_newest_notes_are_kept(conn, fake):
    index = Index("Goal", "working", (Step("Explain where it happens", "todo"),), (), "")
    content = build_work_prompt(conn, fake, index, 0, "OLD START " + "filler " * 3000 + "NEWEST LINE", "", "")[-1]["content"]
    assert "NEWEST LINE" in content and "OLD START" not in content and "1. Explain where it happens" in content

def test_step_title_drives_retrieval(conn, fake):
    index_markdown(conn, "a.md", "# Krebs\nThe citric acid cycle runs in the mitochondrial matrix.", fake)
    index_markdown(conn, "b.md", "# Tax\nThe tax law of 1820 changed tariffs.", fake)
    index = Index("Goal", "working", (Step("Explain where the citric acid cycle runs", "todo"),), (), "")
    def first_hit(query):
        return build_work_prompt(conn, fake, index, 0, "", query, "")[-1]["content"].split("# From the project\n")[1]
    assert first_hit("").startswith("a.md — Krebs")
    assert first_hit("tariff law 1820").startswith("b.md — Tax")

def test_last_error_is_shown(conn, fake):
    index = Index("Goal", "working", (Step("S", "todo"),), (), "")
    content = build_work_prompt(conn, fake, index, 0, "", "", "HTML tags are not allowed: <div>")[-1]["content"]
    assert "# Problem with your last reply\nHTML tags are not allowed: <div>" in content

def test_plan_prompt_fits_and_shows_the_goal(conn, fake):
    messages = build_plan_prompt(conn, fake, Index("Study the Krebs cycle " * 100, "planning", (), (), "Notes " * 800))
    assert messages[0]["content"] == PLAN_SYSTEM and "Study the Krebs cycle" in messages[1]["content"]
    assert total(messages) <= PROMPT_BUDGET
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_context.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `context.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 7 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: budgeted prompts that keep the model's window below 2,000 tokens"`

---

### Task 5: The run loop

**Files:**
- Create: `src/memory_engine/router.py`
- Modify: `src/memory_engine/reindex.py` (`SKIPPED_FILES = {"INDEX.md", "SCRATCHPAD.md"}`, skipped only in the root folder)
- Test: `tests/test_router.py`

**Interfaces:**
- Consumes:
  - `ChatModel`, `ModelReplyError`, `ScriptedModel` (Task 1);
  - `Index`, `Step`, `new_index`, `read_index`, `write_index`, `INDEX_NAME` (Task 2);
  - `read_scratchpad`, `append_scratchpad`, `wipe_scratchpad`, `write_chunk`, `chunks_for_step`, `ChunkFormatError` (Task 3);
  - `build_plan_prompt`, `build_work_prompt`, `PLAN_SCHEMA`, `WORK_SCHEMA` (Task 4);
  - Phase 1's `reindex_folder` and `index_markdown`.
- Produces:
  - `RunReport` (frozen dataclass): `status: str` (`"done"`, `"stuck"` or `"paused"`), `steps_done: int` (in this run), `turns: int`, `stuck_step: str | None = None`.
  - `MAX_STEPS = 8` and `MAX_STEP_TITLE = 120`.
  - `run(workspace: Path, conn, embedder, model: ChatModel, goal: str | None = None, max_turns: int = 40, max_turns_per_step: int = 8) -> RunReport`.
- **The algorithm** (decided here; the tests pin it):
  1. **Start.**
     - If `INDEX.md` is missing: with no `goal`, raise `ValueError("a new workspace needs a goal")`; otherwise write `new_index(goal)`.
     - If it exists and `goal` is given, raise `ValueError("INDEX.md already has a goal; edit INDEX.md to change it")`.
     - Then call `reindex_folder(conn, workspace, embedder)` so the person's own files are searchable.
  2. **Each turn, while `turns < max_turns`:**
     - Re-read `INDEX.md`.
     - If there are no steps, take a **plan turn**: `model.complete(build_plan_prompt(...), PLAN_SCHEMA)`. Clean the steps: strip them, drop empty ones, cut each to 120 characters, keep at most 8. An empty result fails the turn. Otherwise write the steps as `todo` with status `"working"`.
     - Otherwise the current step is the first `todo` one. If there is none, set status `"done"` and return.
     - Otherwise take a **work turn** with the scratchpad from `read_scratchpad(workspace, title)`, the pending search query and the last error.
     - `turns` counts model calls only. Finding that every step is done costs no turn.
     - A work reply missing any `WORK_SCHEMA` key fails the turn with `the reply is missing: {keys, comma-separated}`. `step_done` counts only when it is exactly `true`.
  3. **Applying a work reply,** in this order:
     1. Append a non-empty `scratchpad` to the scratchpad.
     2. A non-empty `chunk_body`: `write_chunk`, add `(name, title)` to Contents, then `index_markdown(conn, name, text, embedder)`. A `ChunkFormatError` sets the error and skips steps 3 and 4.
     3. `step_done`: if `chunks_for_step` is empty, set the error to `"Save this step's result as a chunk before finishing it."`. Otherwise mark the step `done` and call `wipe_scratchpad(workspace, next_title_or_"")`.
     4. Keep `search` as the next query.
  4. **Failed turns.** A turn fails on a `ModelReplyError`, a reply missing a schema key, a chunk error or a finish error. It counts toward the per-step limit, and its error goes into the next prompt.
     - When a step reaches `max_turns_per_step` turns without finishing, mark it `stuck`, set status `"stuck"`, keep the scratchpad, and return `RunReport("stuck", …, stuck_step=title)`.
     - A plan turn that fails `max_turns_per_step` times also returns `"stuck"`, with `stuck_step="plan"`.
  5. **Turn limit.** Reaching `max_turns` returns `"paused"`. `INDEX.md` keeps status `"working"`.
  6. **Exceptions that stop the run.** `ChatError` and `EmbeddingError` propagate: the files are already consistent.

- [ ] **Step 1: Write the failing tests**

```python
def work(scratchpad="", search="", chunk_title="", chunk_body="", step_done=False):
    return {"scratchpad": scratchpad, "search": search, "chunk_title": chunk_title,
            "chunk_body": chunk_body, "step_done": step_done}

@pytest.fixture
def workspace(tmp_path):
    folder = tmp_path / "project"
    folder.mkdir()
    return folder

def states(workspace):
    return [s.state for s in read_index(workspace / "INDEX.md").steps]

def test_plans_then_works_each_step(workspace, conn, fake):
    model = ScriptedModel([
        {"steps": ["List the steps", "Explain the location"]},
        work(scratchpad="Citrate first.", chunk_title="Steps", chunk_body="1. Citrate", step_done=True),
        work(chunk_title="Location", chunk_body="The matrix.", step_done=True),
    ])
    assert run(workspace, conn, fake, model, goal="Study the Krebs cycle") == RunReport("done", 2, 3)
    index = read_index(workspace / "INDEX.md")
    assert states(workspace) == ["done", "done"] and index.status == "done"
    assert index.contents == (("chunk_001.md", "Steps"), ("chunk_002.md", "Location"))
    assert read_scratchpad(workspace, "") == "" and "Citrate first." not in (workspace / "SCRATCHPAD.md").read_text()

def test_notes_stay_until_the_step_is_done(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only step"]}, work(scratchpad="Idea A"),
                           work(chunk_title="T", chunk_body="Result.", step_done=True)])
    run(workspace, conn, fake, model, goal="G")
    assert "Idea A" in model.prompts[2][-1]["content"]

def test_finishing_without_a_chunk_is_refused(workspace, conn, fake):  # Review Focus 2
    model = ScriptedModel([{"steps": ["Only step"]}, work(step_done=True),
                           work(chunk_title="T", chunk_body="Result.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "Save this step's result as a chunk before finishing it." in model.prompts[2][-1]["content"]

def test_broken_reply_is_a_failed_turn(workspace, conn, fake):          # Review Focus 2
    model = ScriptedModel([{"steps": ["Only step"]}, ModelReplyError("the reply was not valid JSON: x"),
                           {"scratchpad": "missing keys"}, work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G") == RunReport("done", 1, 4)
    assert "not valid JSON" in model.prompts[2][-1]["content"]
    assert "missing" in model.prompts[3][-1]["content"]

def test_a_step_that_never_finishes_is_marked_stuck(workspace, conn, fake):  # Review Focus 3
    model = ScriptedModel([{"steps": ["Hard step"]}] + [work(scratchpad="Still thinking.")] * 8)
    report = run(workspace, conn, fake, model, goal="G", max_turns_per_step=8)
    assert report == RunReport("stuck", 0, 9, stuck_step="Hard step")
    assert states(workspace) == ["stuck"] and read_index(workspace / "INDEX.md").status == "stuck"
    assert "Still thinking." in read_scratchpad(workspace, "Hard step")

def test_person_edits_to_the_index_are_followed(workspace, conn, fake):  # Review Focus 1
    (workspace / "INDEX.md").write_text("---\ngoal: G\nstatus: working\n---\n## Steps\n- [x] Done by hand\n- [ ] Second\n\n## Contents\n\n## Notes\nMine.\n")
    model = ScriptedModel([work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, model) == RunReport("done", 1, 1)
    assert "1. Done by hand" not in model.prompts[0][-1]["content"] and "2. Second" in model.prompts[0][-1]["content"]
    assert "## Notes\nMine." in (workspace / "INDEX.md").read_text()

def test_a_run_resumes_after_an_interruption(workspace, conn, fake):    # Review Focus 4
    first = ScriptedModel([{"steps": ["Only step"]}, work(scratchpad="Halfway there.")])
    assert run(workspace, conn, fake, first, goal="G", max_turns=2).status == "paused"
    second = ScriptedModel([work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, second) == RunReport("done", 1, 1)
    assert "Halfway there." in second.prompts[0][-1]["content"]

def test_html_result_is_not_saved_and_the_model_is_told(workspace, conn, fake):  # Review Focus 5
    model = ScriptedModel([{"steps": ["Only step"]}, work(chunk_title="T", chunk_body="<b>bold</b>", step_done=True),
                           work(chunk_title="T", chunk_body="**bold**", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "HTML tags are not allowed: <b>" in model.prompts[2][-1]["content"]
    assert sorted(p.name for p in workspace.glob("chunk_*.md")) == ["chunk_001.md"]

def test_results_become_searchable_but_working_files_do_not(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only step"]}, work(scratchpad="Scratch words.", chunk_title="Cycle", chunk_body="Citrate is first.", step_done=False),
                           work(chunk_title="", chunk_body="", step_done=True)])
    run(workspace, conn, fake, model, goal="G")
    assert hybrid_search(conn, "Citrate", fake)[0].path == "chunk_001.md"
    assert {r[0] for r in conn.execute("SELECT path FROM documents")} == {"chunk_001.md"}

def test_goal_rules(workspace, conn, fake):
    with pytest.raises(ValueError, match="needs a goal"):
        run(workspace, conn, fake, ScriptedModel([]))
    write_index(workspace / "INDEX.md", new_index("G"))
    with pytest.raises(ValueError, match="already has a goal"):
        run(workspace, conn, fake, ScriptedModel([]), goal="Other")
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_router.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `router.py` and the `reindex.py` skip** as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: all pass (83 + 9 + 11 + 7 + 10 = 120).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: router loop that works an INDEX.md plan step by step"`

---

### Task 6: `run` command and README

**Files:**
- Modify: `src/memory_engine/__main__.py`
- Create: `README.md`
- Test: `tests/test_reindex.py` (CLI tests live there)

**Interfaces:**
- Consumes: `run`, `RunReport` (Task 5); `OllamaChat`, `ChatError`, `ChatModel` (Task 1); `Settings` (Task 1 fields).
- Produces:
  - `main(argv: list[str] | None = None, embedder: Embedder | None = None, model: ChatModel | None = None) -> int`.
  - **New subcommand:** `run WORKSPACE [--goal TEXT] [--max-turns N]` (default 40).
  - **Database location:** `--db` now defaults to `None`. `reindex` and `search` then use `./memory.db`; `run` uses `WORKSPACE/memory.db`.
  - **Model:** `OllamaChat(settings.ollama_url, settings.chat_model, settings.context_window, settings.reply_tokens)` unless `model` is passed.
  - **Output and exit codes:**
    - `done`: `done: {n} step(s) finished in {t} turns` (using `step`/`steps` correctly), exit 0.
    - `paused`: `paused after {t} turns: run again to continue`, exit 0.
    - `stuck`: on stderr, `stuck on "{title}": read SCRATCHPAD.md, edit INDEX.md, then run again`, exit 1.
    - `ChatError`, `IndexFormatError` and `ValueError` print `error: …` on stderr, exit 1. (`IndexFormatError` is already a `ValueError`.)
  - **README:** what the engine does (one paragraph), setup (`python3 -m venv .venv`, `pip install -e '.[dev]'`, `ollama pull nomic-embed-text`, `ollama pull qwen3:8b`), the commands `reindex`, `search` and `run` with one example each, the `INDEX.md` format block from Task 2, and the note that `qwen3:8b` needs about 5-6 GB of free memory.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_reindex.py`)

```python
def test_cli_run_finishes_a_plan(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    model = ScriptedModel([{"steps": ["Write it"]}, {"scratchpad": "", "search": "", "chunk_title": "Note",
                                                     "chunk_body": "Text.", "step_done": True}])
    assert main(["run", str(workspace), "--goal", "Write a note"], embedder=fake, model=model) == 0
    assert "done: 1 step finished in 2 turns" in capsys.readouterr().out
    assert (workspace / "memory.db").exists() and (workspace / "chunk_001.md").exists()

def test_cli_run_reports_a_stuck_step(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    thinking = {"scratchpad": "Hmm.", "search": "", "chunk_title": "", "chunk_body": "", "step_done": False}
    assert main(["run", str(workspace), "--goal", "G"], embedder=fake,
                model=ScriptedModel([{"steps": ["Hard"]}] + [thinking] * 8)) == 1
    assert 'stuck on "Hard": read SCRATCHPAD.md' in capsys.readouterr().err

def test_cli_run_explains_a_missing_chat_model(tmp_path, fake, capsys):
    workspace = tmp_path / "ws"
    workspace.mkdir()
    missing = ScriptedModel([ChatError("Ollama does not have the model qwen3:8b: run `ollama pull qwen3:8b`")])
    assert main(["run", str(workspace), "--goal", "G"], embedder=fake, model=missing) == 1
    assert "ollama pull qwen3:8b" in capsys.readouterr().err
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_reindex.py -v`. Expected: the 3 new tests FAIL (`main()` got an unexpected keyword argument `model`).
- [ ] **Step 3: Implement the `run` command and write `README.md`** as specified.
- [ ] **Step 4: Run the whole suite**: `.venv/bin/pytest -q`. Expected: 123 passed, 0 failed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: run command and README"`

Phase 2 is complete when the whole suite passes. Phase 3 (the Doctor) gets its own plan.
