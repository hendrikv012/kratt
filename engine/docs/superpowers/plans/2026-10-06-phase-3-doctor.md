# Phase 3: The Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic checking layer that every model result must pass before it becomes a real project file: it runs Python through compile, ruff, mypy and pytest in a locked sandbox, checks Markdown for its YAML header, HTML and slide length, sends only the failing trace and the draft back to the 8B model to fix, records the fix in `learned_repairs`, and commits the file. This is Phase 3 of the local 8B memory architecture.

**Architecture:**
- **How results reach project files:**
  - A work reply may now name a `target` (like `notes/krebs.md` or `src/parse.py`).
  - The router hands every targeted result to `doctor.promote`. That is the only code path that writes a project file.
  - Results without a target stay working-memory chunk files, exactly as in Phase 2.
- **Checks:**
  - Markdown checks run in-process.
  - Python checks run on a temporary copy of the workspace, inside a bubblewrap sandbox: read-only system, hidden home, `/run` and `/tmp`, no network, a time limit and a memory limit.
- **Fixing:**
  - A failed check starts a short fix loop with its own small prompt: the file name, the failing trace, at most one matching past fix, and the draft.
  - When the file passes, each failure it overcame becomes a `learned_repairs` row, and the file is committed with git (`git init` first if needed).

**Tech Stack:** Python 3.14, bubblewrap (`/usr/bin/bwrap`), ruff and mypy (new dependencies), pytest, git, Phase 1's `learned_repairs` table (`record_repair`, `find_repairs`, `mark_used`) and Phase 2's router and chat model.

**Spec:** `/home/caesarsta/Downloads/BaseN/architecture_spec.md` (sections 1, 3 "Debug Episodes", 4, 6 Phase 3, and 7).

## Global Constraints

- **Location:** extend `/home/caesarsta/Downloads/BaseN/memory-engine/` (`main` at `9fccc26`) on a branch. All paths below are relative to it.
- **Intercept everything:** "a deterministic validation layer that intercepts all LLM output before it is written to the primary project files".
  - Project files are written only by `doctor.promote`.
  - The router's own files (`INDEX.md`, `SCRATCHPAD.md`, `chunk_*.md`, `memory.db`) can never be targets.
- **Secure checks:** "Run generated code through `pytest`, `mypy`, or local linters in a secure subprocess".
  - Every Python check runs under `bwrap` with: `/` read-only; `/home`, `/root`, `/run` and `/tmp` replaced by empty tmpfs (`/run` holds system sockets such as Docker's); only the venv folder (`sys.prefix`) re-bound read-only; network and other namespaces unshared; the environment cleared; a 2 GiB address-space limit; and a timeout.
  - The checked copy is mounted at `/tmp/work`. Mounting it at a new top-level folder fails, because `/` is read-only.
  - Without `bwrap`, Python targets are refused with an install message. Markdown targets still work.
- **Only the trace and the draft go back:** "the Doctor passes *only* the failing stack trace and the drafted code back to the LLM".
  - The fix prompt contains the file name, the failing check's trace (the newest 300 tokens), the draft, and one matching `learned_repairs` diff of at most 150 tokens when there is one. Nothing from `INDEX.md` or the scratchpad goes in.
  - The past fix is how section 3's table can "prevent the LLM from repeating mistakes".
- **Learn and commit:** "Once tests pass, the system promotes the fix to the `learned_repairs` table and commits the file".
  - Each check failure that a later draft fixed becomes one `record_repair(kind, trace, unified diff to the passing file, target)`.
  - The file is committed with git. When the workspace isn't inside a git repository, the Doctor runs `git init` first (the user's decision, 2026-10-06).
  - Only the target path is staged and committed. The message is ``Write {target} (checked by the Doctor)``, with no AI or assistant attribution (the user's rule).
- **Context window:** "strictly below 2,000 tokens". The fix prompt is at most `PROMPT_BUDGET` (1,500), plus the 450-token reply. A draft too long to fit is refused rather than cut.
- **The person's files:** never overwrite a file the person made. A target that already exists may only be replaced if an earlier chunk file records the Doctor writing it (frontmatter `target`).
- **Short pieces (the user's decision, 2026-10-06):** the planner asks for steps that each produce one short piece, at most about 200 words or 40 lines of code. Every result then fits the Doctor's fix prompt (about 400 tokens).
- **Lint rules:** ruff runs with `--isolated --select E4,E7,E9,F`, its classic correctness rules. Newer ruff defaults add import-sorting rules that would cost an 8B model turns for nothing. mypy runs with `--ignore-missing-imports`.
- **Python environment:** checks use the memory-engine venv's Python (`sys.executable`), which has pytest, ruff and mypy. The workspace's own third-party packages are not available inside the sandbox.
- **Tests:** tests never need Ollama. Tests that need `bwrap` are marked `needs_bwrap = pytest.mark.skipif(shutil.which("bwrap") is None, reason="bubblewrap not installed")`.
- **Dependencies:** the new ones are `ruff>=0.6` and `mypy>=1.11`.

## Review Focus

1. **Model-written code tries to do harm:** delete or change the person's files, read secrets, use the network or a local socket, loop forever, or eat memory. The sandbox contains it, and the check fails with a readable trace. Task 1 tests this.
2. **The model aims a result at a file it must not touch:** the person's own existing file, a router file, a hidden folder, `../`, an absolute path, or a symlink leading out of the workspace. The Doctor refuses, writes nothing, and tells the model why. Tasks 2 and 4 test this.
3. **The fix loop never converges.** After 3 fixes the Doctor gives up. Nothing is written or committed, and the router's next prompt carries the last trace. Task 3 tests this.
4. **Git is in an awkward state:** the workspace isn't a repository, there's no git identity, or the file hasn't changed. The Doctor initialises the repository, commits with a fallback identity, and treats "nothing to commit" as success. Task 3 tests this.
5. **A check tool is missing or the workspace is too big to copy.** Python targets fail with a message saying what to install or change, and Markdown targets keep working. Tasks 1 and 2 test this.

## File Structure

| File | Responsibility |
|---|---|
| `src/memory_engine/sandbox.py` | Create: run one command under bubblewrap with limits |
| `src/memory_engine/checks.py` | Create: target rules, Markdown checks, Python checks |
| `src/memory_engine/doctor.py` | Create: fix loop, learned repairs, git commit |
| `src/memory_engine/workfiles.py` | Modify: `write_chunk(..., target="")`, `targets_written` |
| `src/memory_engine/context.py` | Modify: optional `target` in `WORK_SCHEMA`; `PLAN_SYSTEM` and `WORK_SYSTEM` ask for short pieces |
| `src/memory_engine/router.py` | Modify: targeted results go through `promote` |
| `pyproject.toml` | Modify: add `ruff>=0.6`, `mypy>=1.11` |
| `README.md` | Modify: a "Checked files" section |
| `tests/conftest.py` | Modify: the `needs_bwrap` marker |

---

### Task 1: The sandbox

**Files:**
- Create: `src/memory_engine/sandbox.py`
- Modify: `pyproject.toml` (add the dependencies, then `.venv/bin/pip install -e '.[dev]'`), `tests/conftest.py` (`needs_bwrap`)
- Test: `tests/test_sandbox.py`

**Interfaces:**
- Produces:
  - `class SandboxUnavailable(RuntimeError)`.
  - `SandboxResult` (frozen dataclass): `returncode: int | None` (`None` means it timed out) and `output: str` (stdout and stderr combined, keeping the last `OUTPUT_LIMIT = 4000` characters). On a timeout the output ends with `timed out after {timeout:g} s`.
  - `SANDBOX_DIR = "/tmp/work"`, `MEMORY_LIMIT = 2 * 1024**3`.
  - `run_sandboxed(argv: list[str], workdir: Path, timeout: float) -> SandboxResult`.
    - It raises `SandboxUnavailable("Python files can't be checked without a sandbox: install bubblewrap (the bwrap command)")` when `shutil.which("bwrap")` is `None`.
    - It runs `subprocess.run(["bwrap", *args, "--", *argv], capture_output=True, timeout=timeout, preexec_fn=<set RLIMIT_AS to MEMORY_LIMIT>)`, with `args`:
      ```
      --ro-bind / / --tmpfs /home --tmpfs /root --tmpfs /run --tmpfs /tmp
      --ro-bind {sys.prefix} {sys.prefix} --dev /dev --proc /proc
      --bind {workdir} /tmp/work --chdir /tmp/work
      --unshare-all --die-with-parent --new-session --clearenv
      --setenv PATH /usr/bin:/bin --setenv HOME /tmp --setenv PYTHONDONTWRITEBYTECODE 1
      ```

- [ ] **Step 1: Write the failing tests**

```python
def run_python(code, workdir, timeout=30):
    return run_sandboxed([sys.executable, "-c", code], workdir, timeout)

@needs_bwrap
def test_runs_a_command_in_its_folder(tmp_path):
    (tmp_path / "a.txt").write_text("hello")
    result = run_python("print(open('a.txt').read())", tmp_path)
    assert result.returncode == 0 and "hello" in result.output

@needs_bwrap
def test_cannot_change_files_outside_its_folder(tmp_path):
    work, outside = tmp_path / "work", tmp_path / "outside.txt"
    work.mkdir()
    outside.write_text("safe")
    result = run_python(f"open({str(outside)!r}, 'w').write('changed')", work)
    assert result.returncode != 0 and outside.read_text() == "safe"

@needs_bwrap
def test_home_and_run_are_hidden(tmp_path):
    result = run_python(f"import os; print([n for n in os.listdir({str(Path.home())!r}) if n.startswith('.')], os.listdir('/run'))", tmp_path)
    assert result.output.strip() == "[] []"

@needs_bwrap
def test_network_is_blocked(tmp_path):
    server = socket.create_server(("127.0.0.1", 0))
    try:
        result = run_python(f"import socket; socket.create_connection(('127.0.0.1', {server.getsockname()[1]}), 2)", tmp_path)
    finally:
        server.close()
    assert result.returncode != 0

@needs_bwrap
def test_endless_code_times_out(tmp_path):
    result = run_python("while True: pass", tmp_path, timeout=1)
    assert result.returncode is None and result.output.endswith("timed out after 1 s")

@needs_bwrap
def test_memory_hog_is_stopped(tmp_path):
    assert run_python("x = bytearray(3 * 1024**3)", tmp_path).returncode != 0

def test_missing_bubblewrap_is_explained(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.sandbox.shutil.which", lambda name: None)
    with pytest.raises(SandboxUnavailable, match="install bubblewrap"):
        run_python("print(1)", tmp_path)
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_sandbox.py -v`. Expected: FAIL (`ModuleNotFoundError: memory_engine.sandbox`).
- [ ] **Step 3: Implement `sandbox.py`, add the dependencies and the `needs_bwrap` marker** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 7 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: run generated code in a bubblewrap sandbox"`

---

### Task 2: Target rules and checks

**Files:**
- Create: `src/memory_engine/checks.py`
- Test: `tests/test_checks.py`

**Interfaces:**
- Consumes: `run_sandboxed`, `SandboxResult`, `SandboxUnavailable` (Task 1); `split_frontmatter` and `html_tag` (Phase 2); `FENCE` (Phase 1 `chunking`).
- Produces:
  - `Problem` (frozen dataclass): `kind: str` (`"compile"`, `"lint"`, `"test"` or `"format"`, the values `learned_repairs.kind` allows), `check: str` (`"py_compile"`, `"ruff"`, `"mypy"`, `"pytest"` or `"markdown"`) and `trace: str`.
  - `class TargetError(ValueError)` and `class CheckUnavailable(RuntimeError)`.
  - Constants: `MAX_SLIDE_WORDS = 80`, `COPY_LIMIT = 50 * 1024**2` and `SKIPPED_COPY = {".git", ".venv", "venv", "__pycache__", "node_modules", ".pytest_cache", ".mypy_cache", ".ruff_cache"}`. Files named `memory.db*` are skipped too.
  - **`resolve_target(workspace: Path, target: str, ours: set[str]) -> Path`.** It returns the absolute path. `TargetError` messages are checked in this order:
    1. An empty or absolute path, or one with a `..` part: `the target must be a path inside the workspace, like notes/krebs.md`.
    2. Any part starting with `.`, a root-level `INDEX.md`, `SCRATCHPAD.md` or `chunk_*.md`, or a name starting with `memory.db`: `{target} is one of the router's own files`.
    3. A suffix other than `.md` and `.py`: `only .md and .py files can be targets`.
    4. A resolved path outside `workspace.resolve()`: `{target} leaves the workspace`.
    5. A path that exists and whose POSIX form isn't in `ours`: `{target} already exists and was not written by the Doctor; choose a new file name`.
  - **`check_markdown(content: str) -> list[Problem]`.** All problems at once, each `Problem("format", "markdown", …)`:
    - a YAML error: `the YAML header can't be read: …`;
    - no header: `the file needs a YAML header with a title`;
    - no `title`: `the YAML header needs a title`;
    - `html_tag`: `HTML tags are not allowed: {tag}`;
    - when the header has `marp: true`, the body is split into slides at lines that are exactly `---` outside code fences. Words are `re.findall(r"[\w'’-]+", slide)`. A long slide gives `slide {n} has {words} words; the limit is 80`.
  - **`check_python(workspace: Path, target: str, content: str) -> list[Problem]`.**
    - It copies the workspace into a `tempfile.TemporaryDirectory()`, skipping `SKIPPED_COPY` and `memory.db*`. If the copied bytes would pass `COPY_LIMIT`, it raises `CheckUnavailable("the workspace is too big to check (over 50 MB)")`.
    - It writes `content` to `target` in the copy, then runs these with `run_sandboxed` and returns at most one problem, from the first failure:
      1. `py_compile`: `[sys.executable, "-m", "py_compile", target]`, kind `compile`, timeout 60.
      2. `ruff`: `[sys.executable, "-m", "ruff", "check", "--isolated", "--no-cache", "--output-format", "concise", "--select", "E4,E7,E9,F", target]`, kind `lint`, timeout 60.
      3. `mypy`: `[sys.executable, "-m", "mypy", "--ignore-missing-imports", "--no-error-summary", "--cache-dir", "/tmp/mypy-cache", target]`, kind `lint`, timeout 60.
      4. `pytest`, only if the copy holds a `test_*.py` or `*_test.py` file: `[sys.executable, "-m", "pytest", "-q", "-x", "--no-header", "-p", "no:cacheprovider"]`, kind `test`, timeout 120. Exit code 5 (no tests collected) counts as a pass.
    - A nonzero exit or a timeout becomes `Problem(kind, check, result.output.strip())`.
  - **`check_file(workspace: Path, target: str, content: str) -> list[Problem]`:** dispatches on the suffix.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("target, message", [
    ("/etc/notes.md", "must be a path inside the workspace"),
    ("../notes.md", "must be a path inside the workspace"),
    ("", "must be a path inside the workspace"),
    ("INDEX.md", "router's own files"),
    ("chunk_003.md", "router's own files"),
    (".git/notes.md", "router's own files"),
    ("notes/x.txt", "only .md and .py"),
])
def test_bad_targets_are_refused(tmp_path, target, message):
    with pytest.raises(TargetError, match=message):
        resolve_target(tmp_path, target, set())

def test_symlink_out_of_the_workspace_is_refused(tmp_path):
    workspace, outside = tmp_path / "ws", tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "link").symlink_to(outside)
    with pytest.raises(TargetError, match="leaves the workspace"):
        resolve_target(workspace, "link/x.md", set())

def test_existing_files_are_only_replaced_when_the_doctor_wrote_them(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "mine.md").write_text("Mine.")
    with pytest.raises(TargetError, match="was not written by the Doctor"):
        resolve_target(tmp_path, "notes/mine.md", set())
    assert resolve_target(tmp_path, "notes/mine.md", {"notes/mine.md"}) == (tmp_path / "notes" / "mine.md").resolve()
    assert resolve_target(tmp_path, "notes/new.md", set()) == (tmp_path / "notes" / "new.md").resolve()

GOOD_MD = "---\ntitle: Krebs cycle\n---\nEight steps in the matrix.\n"

def test_good_markdown_passes():
    assert check_markdown(GOOD_MD) == []

@pytest.mark.parametrize("content, trace", [
    ("Eight steps.", "the file needs a YAML header with a title"),
    ("---\nauthor: me\n---\nText.", "the YAML header needs a title"),
    ("---\ntitle: [x\n---\nText.", "the YAML header can't be read"),
    ("---\ntitle: T\n---\n<div>x</div>", "HTML tags are not allowed: <div>"),
])
def test_markdown_problems(content, trace):
    problems = check_markdown(content)
    assert problems[0].kind == "format" and trace in problems[0].trace

def test_long_slide_is_reported():
    deck = "---\ntitle: Deck\nmarp: true\n---\n# One\nShort.\n\n---\n\n# Two\n" + "word " * 81
    assert [p.trace for p in check_markdown(deck)] == ["slide 2 has 82 words; the limit is 80"]  # "Two" + 81

def test_slide_rule_only_applies_to_decks():
    assert check_markdown("---\ntitle: Notes\n---\n" + "word " * 200) == []

@needs_bwrap
@pytest.mark.parametrize("content, kind, check, trace", [
    ("def f(:\n    pass\n", "compile", "py_compile", "SyntaxError"),
    ("import os\n\ndef f() -> int:\n    return 1\n", "lint", "ruff", "F401"),
    ("def f(x: int) -> str:\n    return x\n", "lint", "mypy", "Incompatible return value type"),
])
def test_python_problems(tmp_path, content, kind, check, trace):
    problems = check_python(tmp_path, "calc.py", content)
    assert [(p.kind, p.check) for p in problems] == [(kind, check)] and trace in problems[0].trace

@needs_bwrap
def test_failing_project_test_is_reported_and_passing_code_is_clean(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_calc.py").write_text("from calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n")
    broken = check_python(tmp_path, "calc.py", "def add(a: int, b: int) -> int:\n    return a - b\n")
    assert [(p.kind, p.check) for p in broken] == [("test", "pytest")] and "assert -1 == 3" in broken[0].trace
    assert check_python(tmp_path, "calc.py", "def add(a: int, b: int) -> int:\n    return a + b\n") == []
    assert not (tmp_path / "calc.py").exists()

def test_too_big_workspace_is_explained(tmp_path, monkeypatch):
    monkeypatch.setattr("memory_engine.checks.COPY_LIMIT", 10)
    (tmp_path / "big.md").write_text("x" * 100)
    with pytest.raises(CheckUnavailable, match="too big to check"):
        check_python(tmp_path, "calc.py", "x = 1\n")
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_checks.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `checks.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 21 passed (7 bad targets, 1 symlink, 1 existing, 1 good, 4 problems, 2 slides, 3 Python, 1 project test, 1 too big).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: target rules, Markdown checks and sandboxed Python checks"`

---

### Task 3: The fix loop, learned repairs and commits

**Files:**
- Create: `src/memory_engine/doctor.py`
- Modify: `src/memory_engine/workfiles.py` (`write_chunk(..., target: str = "")` stores `target` in the frontmatter when it isn't empty; `targets_written(workspace: Path) -> set[str]` returns every chunk file's frontmatter `target`)
- Test: `tests/test_doctor.py`

**Interfaces:**
- Consumes:
  - `resolve_target`, `check_file`, `Problem`, `TargetError`, `CheckUnavailable` (Task 2) and `SandboxUnavailable` (Task 1);
  - `ChatModel` and `ModelReplyError` (Phase 2);
  - `record_repair`, `find_repairs`, `mark_used` (Phase 1);
  - `estimate_tokens`, `newest_to_tokens`, `truncate_to_tokens`, `atomic_write`, `PROMPT_BUDGET`.
- Produces:
  - Constants: `MAX_FIXES = 3`, `TRACE_TOKENS = 300`, `HINT_TOKENS = 150`.
  - `FIX_SCHEMA = {"type": "object", "properties": {"content": {"type": "string"}}, "required": ["content"]}`.
  - `DOCTOR_SYSTEM`, exactly:
    ```
    You fix one file so that it passes its checks. Change only what the failed check needs.
    Reply with JSON: {"content": "<the whole corrected file>"}.
    ```
  - `Promotion` (frozen dataclass): `ok: bool`, `target: str`, `content: str` (the final text), `fixes: int` (fixes the model made), `commit: str | None` (a sha), `message: str`.
  - **`build_fix_prompt(conn, target: str, content: str, problems: list[Problem]) -> tuple[list[dict], int | None] | None`.**
    - It returns `(messages, hint_repair_id)`, or `None` when the parts don't fit in `PROMPT_BUDGET`.
    - The trace is the problems' traces joined, as `"{check}: {trace}"` lines, then cut with `newest_to_tokens` to `TRACE_TOKENS`.
    - The hint is `find_repairs(conn, trace, 1)`. Its `fix_diff` is cut to `HINT_TOKENS`.
    - The user message: `# File\n{target}`, then `# Check that failed\n{trace}`, then (only with a hint) `# A fix that worked before\n{diff}`, then `# The file\n{content}`, joined by blank lines.
  - **`commit_file(workspace: Path, target: str, message: str) -> str | None`.**
    - If `git -C workspace rev-parse --is-inside-work-tree` fails, run `git init -q`.
    - Then `git add -- target` and `git commit -q -m message -- target`. If `git config user.email` is empty, add `-c user.name=memory-engine -c user.email=memory-engine@localhost`.
    - After the add, if `git status --porcelain -- {target}` prints nothing, the file is unchanged: return `None` without committing.
    - Otherwise commit and return `git rev-parse HEAD`. Any git error raises `RuntimeError(f"git commit failed: {stderr}")`.
  - **`promote(workspace: Path, conn, model: ChatModel, target: str, content: str, max_fixes: int = MAX_FIXES) -> Promotion`.** In order:
    1. `resolve_target(workspace, target, targets_written(workspace))`. A `TargetError` returns `ok=False` with its message.
    2. Up to `max_fixes + 1` times, run `check_file`.
       - `SandboxUnavailable` or `CheckUnavailable` returns `ok=False` with its message.
       - No problems: stop.
       - On the last attempt, return `ok=False` with ``{target} still fails {check} after {max_fixes} fixes:\n{trace}``.
       - Otherwise, `build_fix_prompt`. `None` returns `ok=False` with ``{target} is too long for the Doctor to fix; keep files under about 400 tokens``.
       - Otherwise, take `model.complete(messages, FIX_SCHEMA)["content"]` as the new draft, and remember `(problem, draft before the fix)`.
       - A `ModelReplyError` or a non-string `content` keeps the old draft and still uses up the attempt.
    3. On success:
       - Write the file with `atomic_write`, creating parent folders.
       - For each remembered problem, call `record_repair(problem.kind, "{check}: {trace}", unified diff (difflib, file labels a/{target} and b/{target}) from that draft to the final content, target)`.
       - Call `mark_used` on a hint that led to the final pass.
       - `commit_file(workspace, target, f"Write {target} (checked by the Doctor)")`.
       - Message: `checked {target}`, plus ` after {n} fix(es)` when there were fixes, plus `, committed` when a commit was made.
    4. `ChatError` propagates, because Ollama itself failed and the run must stop.

- [ ] **Step 1: Write the failing tests**

```python
GOOD = "---\ntitle: Krebs cycle\n---\nEight steps.\n"

def git_log(workspace):
    return subprocess.run(["git", "-C", str(workspace), "log", "--format=%s"], capture_output=True, text=True).stdout.splitlines()

def test_clean_file_is_written_and_committed(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/krebs.md", GOOD)
    assert result.ok and result.fixes == 0 and result.message == "checked notes/krebs.md, committed"
    assert (tmp_path / "notes" / "krebs.md").read_text() == GOOD
    assert git_log(tmp_path) == ["Write notes/krebs.md (checked by the Doctor)"]
    assert conn.execute("SELECT count(*) FROM learned_repairs").fetchone()[0] == 0

def test_only_the_trace_and_the_draft_go_back(tmp_path, conn):
    model = ScriptedModel([{"content": GOOD}])
    promote(tmp_path, conn, model, "notes/krebs.md", "Eight steps.")
    system, user = model.prompts[0]
    assert system["content"] == DOCTOR_SYSTEM
    assert user["content"] == "# File\nnotes/krebs.md\n\n# Check that failed\nmarkdown: the file needs a YAML header with a title\n\n# The file\nEight steps."

def test_fix_is_recorded_as_a_learned_repair(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([{"content": GOOD}]), "notes/krebs.md", "Eight steps.")
    assert result.ok and result.fixes == 1 and result.message == "checked notes/krebs.md after 1 fix, committed"
    repair = find_repairs(conn, "markdown: the file needs a YAML header with a title")[0]
    assert (repair.kind, repair.file_path) == ("format", "notes/krebs.md") and "+title: Krebs cycle" in repair.fix_diff

def test_a_past_fix_is_offered_and_counted(tmp_path, conn):
    rid = record_repair(conn, "format", "markdown: the YAML header needs a title", "+title: Something")
    model = ScriptedModel([{"content": GOOD}])
    assert promote(tmp_path, conn, model, "notes/k.md", "---\nauthor: me\n---\nText.").ok
    assert "# A fix that worked before\n+title: Something" in model.prompts[0][1]["content"]
    assert conn.execute("SELECT times_used FROM learned_repairs WHERE id = ?", (rid,)).fetchone()[0] == 1

def test_gives_up_after_three_fixes(tmp_path, conn):              # Review Focus 3
    model = ScriptedModel([{"content": "Still no header."}] * 3)
    result = promote(tmp_path, conn, model, "notes/k.md", "No header.")
    assert not result.ok and "notes/k.md still fails markdown after 3 fixes" in result.message
    assert not (tmp_path / "notes" / "k.md").exists() and not (tmp_path / ".git").exists()

def test_a_broken_fix_reply_uses_up_an_attempt(tmp_path, conn):
    model = ScriptedModel([ModelReplyError("the reply was not valid JSON: x"), {"content": GOOD}])
    assert promote(tmp_path, conn, model, "notes/k.md", "No header.").fixes == 1

def test_refused_target_writes_nothing(tmp_path, conn):            # Review Focus 2
    (tmp_path / "mine.md").write_text("Mine.")
    result = promote(tmp_path, conn, ScriptedModel([]), "mine.md", GOOD)
    assert not result.ok and "was not written by the Doctor" in result.message and (tmp_path / "mine.md").read_text() == "Mine."

def test_the_doctor_may_replace_its_own_file(tmp_path, conn):
    write_chunk(tmp_path, "s", "Krebs", GOOD, target="notes/krebs.md")
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "krebs.md").write_text(GOOD)
    assert promote(tmp_path, conn, ScriptedModel([]), "notes/krebs.md", GOOD.replace("Eight", "8")).ok

def test_unchanged_file_and_missing_identity_still_succeed(tmp_path, conn, monkeypatch):  # Review Focus 4
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "no-gitconfig"))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    first = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    write_chunk(tmp_path, "s", "K", GOOD, target="notes/k.md")
    second = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", GOOD)
    assert first.commit and second.ok and second.commit is None and second.message == "checked notes/k.md"

def test_too_long_draft_is_refused(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([]), "notes/k.md", "No header. " * 600)
    assert not result.ok and "too long for the Doctor to fix" in result.message

@needs_bwrap
def test_python_lint_error_is_fixed(tmp_path, conn):
    fixed = "def f() -> int:\n    return 1\n"
    model = ScriptedModel([{"content": fixed}])
    result = promote(tmp_path, conn, model, "src/f.py", "import os\n\n" + fixed)
    assert result.ok and (tmp_path / "src" / "f.py").read_text() == fixed
    assert "ruff: " in model.prompts[0][1]["content"] and "F401" in model.prompts[0][1]["content"]
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_doctor.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `doctor.py` and the two `workfiles.py` additions** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 11 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: the Doctor fixes failed checks, learns the fix and commits the file"`

---

### Task 4: Targeted results go through the Doctor

**Files:**
- Modify: `src/memory_engine/context.py`, `src/memory_engine/router.py`, `README.md`
- Test: `tests/test_router.py`, `tests/test_context.py`

**Interfaces:**
- Consumes: `promote`, `Promotion` (Task 3); `write_chunk(..., target=)` (Task 3).
- Produces:
  - **`WORK_SCHEMA`:** adds `"target": {"type": "string"}` to `properties`. It is NOT added to `required`, so Phase 2 replies without it stay valid.
  - **`PLAN_SYSTEM`** becomes exactly:
    ```
    You plan work for a small local assistant. Break the goal into 3 to 8 short steps.
    Each step produces one short piece: a note of at most about 200 words, or code of at most about 40 lines.
    Reply with JSON: {"steps": ["...", "..."]}.
    ```
  - **`WORK_SYSTEM`:**
    - Its `chunk_title and chunk_body` line becomes: `- chunk_title and chunk_body: when you have this step's result, its title and its Markdown text (at most about 200 words or 40 lines of code, no HTML tags, no YAML header); otherwise "".`
    - It gains one line after it, exactly: `- target: the project file this result should become (like notes/krebs.md or src/parse.py), or "" to keep it as a note. It is checked before it is written.`
  - **Router, for `.md` targets:** a body without a YAML header becomes `join_frontmatter({"title": chunk_title, or the body's first line if the title is empty}, body)` before `promote`. `WORK_SYSTEM` tells the model not to write YAML headers, so the router supplies the title the Doctor checks for.
  - **Router, in `_work_turn`:** when `chunk_body` and `target` (stripped) are both non-empty, call `promote(workspace, conn, model, target, body)` before saving the chunk.
    - **On failure:**
      - set the turn error to ``the Doctor did not accept {target}: {message}``;
      - add the event `failed: the Doctor did not accept {target}`;
      - save no chunk.
    - **On success:**
      - save the chunk with `write_chunk(workspace, title, chunk_title, promotion.content, target=target)`;
      - add the Contents entry and index it, as before;
      - add the event `promotion.message` in place of `saved {name}`.
  - **README:** a "Checked files" section, covering:
    - what `target` does;
    - which checks run;
    - that Python checks need bubblewrap;
    - that the Doctor never overwrites a file it didn't write;
    - that it runs `git init` and commits each checked file;
    - that `learned_repairs` remembers fixes.

- [ ] **Step 1: Write the failing tests**

In `tests/test_context.py`:
```python
def test_target_is_optional_and_explained():
    assert "target" in WORK_SCHEMA["properties"] and "target" not in WORK_SCHEMA["required"]
    assert "- target: the project file this result should become" in WORK_SYSTEM and estimate_tokens(WORK_SYSTEM) <= 300

def test_steps_and_results_are_asked_to_be_short():
    assert "Each step produces one short piece: a note of at most about 200 words, or code of at most about 40 lines." in PLAN_SYSTEM
    assert "at most about 200 words or 40 lines of code" in WORK_SYSTEM
    assert estimate_tokens(PLAN_SYSTEM) <= 300
```

In `tests/test_router.py` (the existing `work()` helper gains `target=""`, passed through only when it isn't empty):
```python
GOOD = "---\ntitle: Krebs cycle\n---\nEight steps.\n"

def test_targeted_result_is_checked_written_and_committed(workspace, conn, fake):
    lines = []
    model = ScriptedModel([{"steps": ["Write the note"]}, work(chunk_title="Krebs", chunk_body=GOOD, target="notes/krebs.md", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G", progress=lines.append).status == "done"
    assert (workspace / "notes" / "krebs.md").read_text() == GOOD
    assert split_frontmatter((workspace / "chunk_001.md").read_text())[0]["target"] == "notes/krebs.md"
    assert lines[-1] == 'step 1/1 "Write the note": checked notes/krebs.md, committed, finished'

def test_markdown_target_gets_its_title_from_the_chunk_title(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Write the note"]}, work(chunk_title="Krebs cycle", chunk_body="Eight steps.\n", target="notes/krebs.md", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert (workspace / "notes" / "krebs.md").read_text() == GOOD

def test_doctor_fixes_inside_the_turn(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Write the note"]}, work(chunk_title="K", chunk_body="<b>Eight</b> steps.", target="notes/k.md", step_done=True),
                           {"content": GOOD}])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert (workspace / "notes" / "k.md").read_text() == GOOD
    assert conn.execute("SELECT count(*) FROM learned_repairs").fetchone()[0] == 1

def test_rejected_result_is_not_written_and_the_model_is_told(workspace, conn, fake):  # Review Focus 2
    (workspace / "notes").mkdir()
    (workspace / "notes" / "mine.md").write_text("Mine.")
    model = ScriptedModel([{"steps": ["Write the note"]}, work(chunk_title="K", chunk_body=GOOD, target="notes/mine.md", step_done=True),
                           work(chunk_title="K", chunk_body=GOOD, target="notes/new.md", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert (workspace / "notes" / "mine.md").read_text() == "Mine."
    assert "the Doctor did not accept notes/mine.md: notes/mine.md already exists" in model.prompts[2][-1]["content"]
    assert sorted(p.name for p in workspace.glob("chunk_*.md")) == ["chunk_001.md"]

def test_results_without_a_target_are_unchanged(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only"]}, work(chunk_title="T", chunk_body="Plain note.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert not (workspace / ".git").exists() and "target" not in split_frontmatter((workspace / "chunk_001.md").read_text())[0]
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_context.py tests/test_router.py -v`. Expected: the 7 new tests FAIL.
- [ ] **Step 3: Implement the schema, prompt line, router change and README section** as specified.
- [ ] **Step 4: Run the whole suite**: `.venv/bin/pytest -q`. Expected: 195 passed (149 + 7 + 21 + 11 + 7).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: targeted results go through the Doctor before they become project files"`

Phase 3 is complete when the whole suite passes. Phase 4 (the cinematic and presentation enforcers, including the Marp CLI check) gets its own plan.
