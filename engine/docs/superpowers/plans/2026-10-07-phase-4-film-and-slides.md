# Phase 4: Film Scenes and Slide Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two output kinds besides notes: a film workspace writes one scene file per step, with strict YAML (`scene_number`, `location`, `camera_angle`, `lighting`), a visual prompt and a voiceover. A slides workspace adds one slide per step to a Marp deck that must render with the Marp CLI before it is saved. This is Phase 4 of the local 8B memory architecture.

**Architecture:**
- **Choosing a kind:** `INDEX.md` gains `kind: notes | film | slides`, set once with `run --kind`.
- **Prompts per kind:** the kind picks the planner line, the work instructions and the reply schema.
- **Film:** the model answers each scene as plain JSON fields. The router composes the scene file deterministically (`scenes/scene_NN.md`) and hands it to the Doctor under scene rules.
- **Slides:**
  - The model answers one slide.
  - The Doctor checks the whole deck: the existing `deck.md` plus the new slide, including a Marp render whose slide count must match.
  - Its fix prompt still shows only the new slide, so long decks never outgrow the 450-token reply.
- **Marp:** pinned in `tools/marp/` and run with Node inside the Phase 3 sandbox.

**Tech Stack:** Python 3.14, Node 26 (`/usr/bin/node`), `@marp-team/marp-cli` 4.5.1 (local npm install, about 131 MB), bubblewrap, and Phases 1-3 of `memory_engine`.

**Spec:** `/home/caesarsta/Downloads/BaseN/architecture_spec.md` (sections 2, 5, and 6 Phase 4).

## Global Constraints

- **Location:** extend `/home/caesarsta/Downloads/BaseN/memory-engine/` (`main` at `a7b09a1`) on a branch. All paths below are relative to it.
- **Scene files:** "Enforce strict YAML frontmatter for all film outputs. Every scene chunk file must include `scene_number`, `location`, `camera_angle`, and `lighting` keys in the YAML, followed by standard Markdown containing the visual generation prompt and voiceover script."
  - The scene file and the step's chunk file both carry those four keys.
  - The body is exactly `## Visual prompt` and `## Voiceover`, both non-empty.
- **Decks:** "Enforce the Marp standard (slides separated by `---`). The Doctor must verify slides render successfully via the Marp CLI before saving."
  - `deck.md` has the frontmatter `marp: true`, `title` and `paginate: true`. Slides are joined with `\n\n---\n\n`.
  - Before writing, Marp must render the deck with exit code 0, and the number of rendered `<section` elements must equal the deck's slide count.
  - A slide may not contain a line made only of `---`, `***` or `___`, because Marp starts a new slide at each one (verified with Marp 4.5.1).
- **The user's decisions (2026-10-07):**
  - The kind is a `--kind` flag, saved in `INDEX.md`. The default is `notes`.
  - Decks are built one slide per step.
  - Still in force from earlier: short pieces (at most about 200 words or 40 lines), each workspace having its own git repository, and every checked file being committed.
- **Earlier phases stay in force:** "strictly below 2,000 tokens" and "no HTML tags" hold for scenes and slides too. Every file a kind produces goes through `doctor.promote`.
- **Marp setup:**
  - `tools/marp/package.json` pins `@marp-team/marp-cli` at `4.5.1`, and `tools/marp/package-lock.json` is committed. `tools/marp/node_modules/` is git-ignored.
  - Install with `npm ci --prefix tools/marp`.
  - The CLI path is `tools/marp/node_modules/@marp-team/marp-cli/marp-cli.js`, found relative to the repository (`Path(memory_engine.__file__).resolve().parents[2]`).
- **Tests:** tests never need Ollama. Tests that render with Marp are marked `needs_marp`, which skips them when `bwrap`, `node` or the Marp CLI file is missing.
- **Commits:** no AI or assistant attribution lines (the user's rule).

## Review Focus

1. **A film reply has a missing, empty or overlong field** (or a scene file that someone edited by hand has a non-integer `scene_number`). The scene is refused with a message naming the field, and nothing is written. Tasks 2 and 4 test this.
2. **A slide has more than 80 words, HTML, or a `---`, `***` or `___` line.** It is refused, the model is told why, and the deck already saved stays exactly as it was. Tasks 2 and 4 test this.
3. **The Marp tool or Node is missing.** Decks fail with an install message instead of a demand that the model fix its slide. Notes and scenes keep working. Task 2 tests this.
4. **The person edits `deck.md` or a scene between runs.** The Doctor refuses to overwrite the edited file (Phase 3 ownership), and new scenes take the next free number. Task 4 tests this.
5. **A deck grows long.** Each slide step still fits the prompt budget, because only the new slide goes to the model. The Marp check covers the whole deck. Tasks 3 and 4 test this.

## File Structure

| File | Responsibility |
|---|---|
| `src/memory_engine/index_file.py` | Modify: `kind` in `Index` and in the frontmatter |
| `src/memory_engine/checks.py` | Modify: scene rules, deck rules, Marp render |
| `src/memory_engine/sandbox.py` | Modify: `run_sandboxed(..., read_only=())` binds extra folders |
| `src/memory_engine/doctor.py` | Modify: `promote(..., rules="", assemble=None)` |
| `src/memory_engine/media.py` | Create: scene composition and numbering, deck assembly |
| `src/memory_engine/context.py` | Modify: planner line, instructions and schema per kind |
| `src/memory_engine/router.py` | Modify: film and slide work turns |
| `src/memory_engine/workfiles.py` | Modify: `write_chunk(..., extra_meta=None)` |
| `src/memory_engine/__main__.py` | Modify: `run --kind` |
| `tools/marp/package.json`, `tools/marp/package-lock.json` | Create: the pinned Marp CLI |
| `.gitignore`, `README.md`, `tests/conftest.py` | Modify: ignore `node_modules`; document the kinds and the Marp install; add the `needs_marp` marker |

---

### Task 1: The kind of a workspace

**Files:**
- Modify: `src/memory_engine/index_file.py`, `src/memory_engine/router.py` (only the start of `run`), `src/memory_engine/__main__.py`
- Test: `tests/test_index_file.py`, `tests/test_router.py`, `tests/test_reindex.py`

**Interfaces:**
- Produces:
  - `KINDS = ("notes", "film", "slides")`.
  - `Index` gains `kind: str = "notes"`, after the existing defaulted fields.
  - `"kind"` joins `_OWN_KEYS`. A missing `kind` reads as `"notes"`; an unknown one raises ``IndexFormatError("INDEX.md: unknown kind {kind!r}; use notes, film or slides")``. The renderer writes `kind` after `status`.
  - `new_index(goal: str, kind: str = "notes") -> Index`.
  - `run(..., kind: str | None = None)`:
    - a new workspace uses `kind or "notes"`;
    - an existing one with a different `kind` given raises ``ValueError(f"INDEX.md already says kind: {index.kind}; edit INDEX.md to change it")``.
  - CLI: `run` gains `--kind {notes,film,slides}` (default `None`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_index_file.py
def test_kind_defaults_to_notes_and_round_trips(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX)
    assert read_index(tmp_path / "INDEX.md").kind == "notes"
    write_index(tmp_path / "INDEX.md", new_index("Film it", kind="film"))
    assert read_index(tmp_path / "INDEX.md").kind == "film"
    assert split_frontmatter((tmp_path / "INDEX.md").read_text())[0]["kind"] == "film"

def test_unknown_kind_is_a_readable_error(tmp_path):
    (tmp_path / "INDEX.md").write_text(INDEX.replace("status: working\n", "status: working\nkind: opera\n"))
    with pytest.raises(IndexFormatError, match="unknown kind 'opera'"):
        read_index(tmp_path / "INDEX.md")

# tests/test_router.py
def test_new_workspace_takes_its_kind(workspace, conn, fake):
    model = ScriptedModel([RuntimeError("stop")])
    with pytest.raises(RuntimeError):
        run(workspace, conn, fake, model, goal="G", kind="film")
    assert read_index(workspace / "INDEX.md").kind == "film"

def test_kind_cannot_change_from_the_command_line(workspace, conn, fake):
    write_index(workspace / "INDEX.md", new_index("G", kind="slides"))
    with pytest.raises(ValueError, match="already says kind: slides"):
        run(workspace, conn, fake, ScriptedModel([]), kind="film")

# tests/test_reindex.py
def test_cli_run_sets_the_kind(tmp_path, fake):
    main(["run", str(tmp_path / "ws"), "--goal", "G", "--kind", "slides"], embedder=fake,
         model=ScriptedModel([ChatError("stop here")]))
    assert read_index(tmp_path / "ws" / "INDEX.md").kind == "slides"
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_index_file.py tests/test_router.py tests/test_reindex.py -q`. Expected: the 5 new tests FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: 235 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: a workspace kind (notes, film, slides) set with run --kind"`

---

### Task 2: Scene rules, deck rules and the Marp render

**Files:**
- Create: `tools/marp/package.json` and `tools/marp/package-lock.json` (from `npm install --prefix tools/marp @marp-team/marp-cli@4.5.1 --save-exact`)
- Modify: `.gitignore` (`node_modules/`), `src/memory_engine/sandbox.py`, `src/memory_engine/checks.py`, `tests/conftest.py` (`needs_marp`)
- Test: `tests/test_checks.py`

**Interfaces:**
- Consumes: `run_sandboxed`, `_slides`, `check_markdown`, `split_frontmatter`, `html_tag`.
- Produces:
  - `run_sandboxed(argv, workdir, timeout, read_only: tuple[Path, ...] = ())`: each extra path is bound read-only at the same path.
  - `MARP_DIR = Path(__file__).resolve().parents[2] / "tools" / "marp"` and `MARP_CLI = MARP_DIR / "node_modules/@marp-team/marp-cli/marp-cli.js"`.
  - `SCENE_KEYS = ("scene_number", "location", "camera_angle", "lighting")`, `MAX_FIELD = 120`.
  - **`check_scene(content: str) -> list[Problem]`.** All problems at once, each `Problem("format", "scene", …)`:
    - the YAML errors from `check_markdown`;
    - a missing `title`: `the YAML header needs a title`;
    - each missing or empty key: `the YAML header needs {key}`;
    - a `scene_number` that isn't an integer of at least 1: `scene_number must be a whole number from 1 up`;
    - a field over 120 characters: `{key} must be at most 120 characters`;
    - section headings that aren't exactly `## Visual prompt` and `## Voiceover`, in that order: `the scene needs exactly two sections: "## Visual prompt" and "## Voiceover"`;
    - an empty section: `the {Visual prompt|Voiceover} section is empty`;
    - HTML: `HTML tags are not allowed: {tag}`.
  - **`render_deck(content: str) -> int`.**
    - It writes `deck.md` into a temporary folder and runs, in the sandbox with `read_only=(MARP_DIR,)` and timeout 60: `["/bin/sh", "-c", f'{node} {MARP_CLI} deck.md -o deck.html >marp.log 2>&1 || {{ cat marp.log; exit 3; }}; grep -o "<section" deck.html | wc -l']`, where `node = shutil.which("node")`.
    - It returns the count from the last output line. A failure raises `DeckRenderError(output)`, a subclass of `ValueError`.
    - When `node` or `MARP_CLI` is missing, it raises ``CheckUnavailable("slide decks can't be checked: install Node.js, then run: npm ci --prefix tools/marp")``.
  - **`check_deck(content: str) -> list[Problem]`.** Problems are `Problem("format", "marp", …)`:
    - first the `check_markdown` problems (relabelled `marp`);
    - no `marp: true`: `the YAML header needs marp: true`;
    - for each slide `n`, an empty one: `slide {n} is empty`;
    - a line matching `^ {0,3}([-*_])( *\1){2,} *$` outside code fences: `slide {n} has a line of {chars}, which Marp reads as a new slide`.
    - Only when everything above passes, `render_deck`. A `DeckRenderError` gives `Marp could not render the deck: {output tail}`. A count different from the slide count gives `Marp made {rendered} slides but the deck has {slides}`.
  - **`check_file(workspace, target, content, rules: str = "")`:** `rules == "scene"` uses `check_scene`. A `.md` whose YAML has `marp: true`, or `rules == "deck"`, uses `check_deck`. Otherwise it behaves as before.

- [ ] **Step 1: Install Marp and write the failing tests**

Run: `npm install --prefix tools/marp @marp-team/marp-cli@4.5.1 --save-exact --no-audit --no-fund`. Expected: `tools/marp/node_modules/@marp-team/marp-cli/marp-cli.js` exists.

```python
SCENE = ("---\ntitle: Arrival\nscene_number: 1\nlocation: University lab, night\ncamera_angle: Wide shot, slow push-in\n"
         "lighting: Cold fluorescent light\n---\n## Visual prompt\nA quiet lab at night.\n\n## Voiceover\nIt began here.\n")

def test_a_good_scene_passes():
    assert check_scene(SCENE) == []

@pytest.mark.parametrize("change, trace", [
    (("location: University lab, night\n", ""), "the YAML header needs location"),
    (("lighting: Cold fluorescent light", "lighting: ''"), "the YAML header needs lighting"),
    (("scene_number: 1", "scene_number: first"), "scene_number must be a whole number from 1 up"),
    (("camera_angle: Wide shot, slow push-in", "camera_angle: " + "x" * 121), "camera_angle must be at most 120 characters"),
    (("## Voiceover\nIt began here.\n", ""), 'exactly two sections: "## Visual prompt" and "## Voiceover"'),
    (("It began here.", ""), "the Voiceover section is empty"),
    (("A quiet lab at night.", "A <b>quiet</b> lab."), "HTML tags are not allowed: <b>"),
])
def test_scene_problems(change, trace):
    assert trace in [p.trace for p in check_scene(SCENE.replace(*change))]

DECK = "---\nmarp: true\ntitle: Krebs\npaginate: true\n---\n# One\nShort.\n\n---\n\n# Two\nMore.\n"

@pytest.mark.parametrize("rule", ["***", "___", "- - -"])
def test_a_line_marp_reads_as_a_break_is_refused(rule):
    traces = [p.trace for p in check_deck(DECK.replace("More.", f"More.\n\n{rule}\n\nEven more."))]
    assert traces == [f"slide 2 has a line of {rule}, which Marp reads as a new slide"]

def test_a_deck_needs_the_marp_header():
    assert "the YAML header needs marp: true" in [p.trace for p in check_deck(DECK.replace("marp: true\n", ""))]

@needs_marp
def test_a_good_deck_renders():
    assert check_deck(DECK) == [] and render_deck(DECK) == 2

@needs_marp
def test_marp_counts_its_own_breaks():
    assert render_deck(DECK.replace("More.", "More.\n\n***\n\nEven more.")) == 3

def test_a_missing_marp_tool_is_explained(monkeypatch):
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", Path("/nonexistent/marp-cli.js"))
    with pytest.raises(CheckUnavailable, match="npm ci --prefix tools/marp"):
        check_deck(DECK)
```

`needs_marp = pytest.mark.skipif(shutil.which("bwrap") is None or shutil.which("node") is None or not MARP_CLI.exists(), reason="Marp not installed")` goes in `tests/conftest.py`.

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_checks.py -q`. Expected: FAIL (`ImportError: cannot import name 'check_scene'`).
- [ ] **Step 3: Implement** the sandbox's `read_only` and the scene and deck rules, as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: 250 passed (15 new: 1 + 7 scene, 3 + 1 rules and header, 2 render, 1 missing tool).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: scene rules, deck rules and a Marp render check"`

---

### Task 3: The Doctor checks a piece inside a whole file

**Files:**
- Modify: `src/memory_engine/doctor.py`
- Test: `tests/test_doctor.py`

**Interfaces:**
- Consumes: `check_file(..., rules=)` (Task 2).
- Produces: `promote(workspace, conn, model, target, content, max_fixes=MAX_FIXES, rules: str = "", assemble: Callable[[str], str] | None = None) -> Promotion`:
  - Checks run on `assemble(content)` when `assemble` is given, otherwise on `content`, with `rules` passed to `check_file`.
  - The fix loop, the fix prompt and `learned_repairs` work on `content` alone (the piece). With `assemble`, the prompt's last section is titled `# Your part of the file` instead of `# The file`.
  - On success, `assemble(final piece)` is written and committed, and `Promotion.content` is the final piece.

- [ ] **Step 1: Write the failing tests**

```python
def deck_with(slide):
    return "---\nmarp: true\ntitle: Krebs\npaginate: true\n---\n# One\nShort.\n\n---\n\n" + slide + "\n"

@needs_marp
def test_only_the_new_piece_goes_to_the_model(tmp_path, conn):
    model = ScriptedModel([{"content": "# Two\nShort enough."}])
    result = promote(tmp_path, conn, model, "notes/deck.md", "# Two\n" + "word " * 90, rules="", assemble=deck_with)
    user = model.prompts[0][1]["content"]
    assert "# Your part of the file\n# Two\nword" in user and "# One" not in user
    assert result.ok and result.content == "# Two\nShort enough."
    assert (tmp_path / "notes" / "deck.md").read_text() == deck_with("# Two\nShort enough.")

def test_scene_rules_apply_when_asked(tmp_path, conn):
    result = promote(tmp_path, conn, ScriptedModel([{"content": "still not a scene"}] * 3), "scenes/scene_01.md",
                     "---\ntitle: T\n---\nNo sections.", rules="scene")
    assert not result.ok and "still fails scene" in result.message

@needs_marp
def test_a_long_deck_still_fits_the_fix_prompt(tmp_path, conn):
    long_deck = lambda slide: deck_with("\n\n---\n\n".join([f"# S{i}\n" + "word " * 70 for i in range(30)] + [slide]))
    model = ScriptedModel([{"content": "# New\nShort."}])
    assert promote(tmp_path, conn, model, "notes/deck.md", "# New\n" + "word " * 90, assemble=long_deck).ok
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_doctor.py -q`. Expected: the 3 new tests FAIL (unexpected keyword argument `assemble`).
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: 253 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: the Doctor checks a piece inside its whole file"`

---

### Task 4: Film and slide steps in the router

**Files:**
- Create: `src/memory_engine/media.py`
- Modify: `src/memory_engine/context.py`, `src/memory_engine/router.py`, `src/memory_engine/workfiles.py`, `README.md`
- Test: `tests/test_media.py`, `tests/test_router.py`, `tests/test_context.py`

**Interfaces:**
- Consumes: Tasks 1-3; `join_frontmatter`, `split_frontmatter`, `_slides` (from `checks`).
- Produces:
  - **`workfiles.write_chunk(..., extra_meta: dict | None = None)`:** the extra keys are written after `title`, `step` and `created`.
  - **`media.py`:**
    - `DECK_NAME = "deck.md"`.
    - `next_scene_number(workspace: Path) -> int`: one more than the highest number found in `scenes/`, or 1. A number comes from either a file name `scene_NN.md` or a frontmatter `scene_number`; unreadable or non-integer values are ignored. Counting file names means a scene file someone wrote by hand without a header still takes its number.
    - `compose_scene(number: int, title: str, location: str, camera_angle: str, lighting: str, visual_prompt: str, voiceover: str) -> str`: produces `join_frontmatter({"title", "scene_number", "location", "camera_angle", "lighting"}, f"## Visual prompt\n{visual_prompt.strip()}\n\n## Voiceover\n{voiceover.strip()}\n")`. Strings are stripped, and an empty title becomes `Scene {number}`.
    - `deck_with(workspace: Path, goal: str, slide: str) -> str`: the slides of the current `deck.md` (when it exists) plus `slide.strip()`, joined by `\n\n---\n\n`. The frontmatter is kept from `deck.md`, or is new as `{"marp": True, "title": goal cut to 120 characters, "paginate": True}`.
  - **`context.py`:**
    - `plan_system(kind) -> str`: the notes text is exactly today's `PLAN_SYSTEM` (which stays the notes value). Film replaces the middle line with `Each step is one scene of the film: one place, one camera set-up, a short visual prompt and a short voiceover.` Slides replaces it with `Each step is one slide of at most 80 words.`
    - `work_system(kind)` and `work_schema(kind)`. Notes is today's text and schema.
    - Slides drops `target` from the schema and uses this text:
      ```
      You are making a slide deck one slide at a time. Reply with one JSON object:
      - scratchpad: short working notes for this slide, or "".
      - search: words to look up in the project next turn, or "".
      - chunk_title and chunk_body: when the slide is ready, its title and its Markdown (a "# heading" line and at most 80 words; no HTML tags, no YAML header, no lines of --- or ***); otherwise "".
      - step_done: true in the reply that saves this slide, or once a slide is listed as saved for this step.
      Use only facts from the context and your notes.
      ```
    - Film's schema has the required string fields `scratchpad`, `search`, `chunk_title`, `location`, `camera_angle`, `lighting`, `visual_prompt` and `voiceover`, plus the boolean `step_done`. Film's text:
      ```
      You are writing a film one scene at a time. Reply with one JSON object:
      - scratchpad: short working notes for this scene, or "".
      - search: words to look up in the project next turn, or "".
      - chunk_title: the scene's title.
      - location, camera_angle, lighting: one short phrase each.
      - visual_prompt: what the camera shows, for an image or video generator (at most about 80 words), or "" until the scene is ready.
      - voiceover: the words spoken over the scene (at most about 80 words), or "" until the scene is ready.
      - step_done: true in the reply that gives the finished scene, or once a scene is listed as saved for this step.
      Use only facts from the context and your notes. No HTML tags.
      ```
    - `build_plan_prompt` and `build_work_prompt` take the kind from `index.kind`.
  - **Router, by `index.kind`:**
    - **Film:** when `visual_prompt` and `voiceover` are both non-empty:
      1. `number = next_scene_number(workspace)`;
      2. `promote(workspace, conn, model, f"scenes/scene_{number:02d}.md", compose_scene(...), rules="scene")`;
      3. on success, `write_chunk(workspace, title, scene title, body of promotion.content, target=…, extra_meta={the four SCENE_KEYS from the promoted frontmatter})`.
      A failed promotion fails the turn, as for notes.
    - **Slides:** a non-empty `chunk_body` triggers `promote(workspace, conn, model, "deck.md", body, rules="deck", assemble=lambda s: deck_with(workspace, index.goal, s))`. On success, `write_chunk(..., promotion.content, target="deck.md")`.
    - **Notes:** unchanged.
    - **Every kind:** `_work_turn` checks the reply's missing keys against `work_schema(index.kind)["required"]` and passes `work_schema(index.kind)` to the model.
    - **Events:** `promotion.message`, as in Phase 3.
  - **README:** the three kinds, `--kind`, the scene file format, how decks grow and are checked, and the Marp install (`npm ci --prefix tools/marp`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_media.py
def test_compose_scene_writes_the_spec_keys():
    meta, body = split_frontmatter(compose_scene(3, "", " Lab ", "Wide", "Cold", "A lab.", "It began."))
    assert meta == {"title": "Scene 3", "scene_number": 3, "location": "Lab", "camera_angle": "Wide", "lighting": "Cold"}
    assert body == "## Visual prompt\nA lab.\n\n## Voiceover\nIt began.\n"

def test_scene_numbers_continue_after_the_highest(tmp_path):
    assert next_scene_number(tmp_path) == 1
    (tmp_path / "scenes").mkdir()
    (tmp_path / "scenes" / "scene_07.md").write_text(compose_scene(7, "T", "L", "C", "Li", "V", "O"))
    (tmp_path / "scenes" / "broken.md").write_text("---\nscene_number: first\n---\n")
    assert next_scene_number(tmp_path) == 8

def test_deck_with_starts_and_extends_a_deck(tmp_path):
    first = deck_with(tmp_path, "Krebs cycle", "# One\nShort.")
    assert split_frontmatter(first)[0] == {"marp": True, "title": "Krebs cycle", "paginate": True}
    (tmp_path / "deck.md").write_text(first)
    assert split_frontmatter(deck_with(tmp_path, "ignored", "# Two\nMore."))[1] == "# One\nShort.\n\n---\n\n# Two\nMore.\n"

# tests/test_context.py
def test_each_kind_has_its_own_plan_line_and_schema():
    assert plan_system("notes") == PLAN_SYSTEM
    assert "Each step is one scene of the film" in plan_system("film") and "one slide of at most 80 words" in plan_system("slides")
    assert {"location", "camera_angle", "lighting", "visual_prompt", "voiceover"} <= set(work_schema("film")["required"])
    assert "target" not in work_schema("slides")["properties"]
    assert all(estimate_tokens(work_system(k)) <= 300 and estimate_tokens(plan_system(k)) <= 300 for k in ("notes", "film", "slides"))

# tests/test_router.py
def scene(**fields):
    reply = {"scratchpad": "", "search": "", "chunk_title": "Arrival", "location": "Lab", "camera_angle": "Wide",
             "lighting": "Cold", "visual_prompt": "A quiet lab.", "voiceover": "It began.", "step_done": True}
    return reply | fields

def test_film_steps_write_numbered_scene_files(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Arrival", "Discovery"]}, scene(), scene(chunk_title="Discovery")])
    assert run(workspace, conn, fake, model, goal="A short film", kind="film").status == "done"
    meta, body = split_frontmatter((workspace / "scenes" / "scene_02.md").read_text())
    assert (meta["scene_number"], meta["title"]) == (2, "Discovery") and body.startswith("## Visual prompt\n")
    chunk_meta = split_frontmatter((workspace / "chunk_001.md").read_text())[0]
    assert {k: chunk_meta[k] for k in ("scene_number", "location", "camera_angle", "lighting")} == {
        "scene_number": 1, "location": "Lab", "camera_angle": "Wide", "lighting": "Cold"}

def test_a_scene_with_an_empty_field_is_refused(workspace, conn, fake):
    fixed = "---\ntitle: Arrival\nscene_number: 1\nlocation: Lab\ncamera_angle: Wide\nlighting: Cold\n---\n## Visual prompt\nA lab.\n\n## Voiceover\nIt began.\n"
    model = ScriptedModel([{"steps": ["Arrival"]}, scene(lighting=""), {"content": fixed}])
    assert run(workspace, conn, fake, model, goal="G", kind="film").status == "done"
    assert "the YAML header needs lighting" in model.prompts[2][1]["content"]

def test_a_new_scene_never_overwrites_an_edited_one(workspace, conn, fake):
    (workspace / "scenes").mkdir()
    (workspace / "scenes" / "scene_01.md").write_text("My own scene.")
    model = ScriptedModel([{"steps": ["Arrival"]}, scene()])
    assert run(workspace, conn, fake, model, goal="G", kind="film").status == "done"
    assert (workspace / "scenes" / "scene_01.md").read_text() == "My own scene." and (workspace / "scenes" / "scene_02.md").exists()

def slide(body, done=True):
    return {"scratchpad": "", "search": "", "chunk_title": body.splitlines()[0].lstrip("# "), "chunk_body": body, "step_done": done}

@needs_marp
def test_slide_steps_grow_one_checked_deck(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Intro", "Steps"]}, slide("# Intro\nWhat the cycle does."), slide("# Steps\nEight of them.")])
    assert run(workspace, conn, fake, model, goal="Krebs cycle", kind="slides").status == "done"
    assert split_frontmatter((workspace / "deck.md").read_text())[1] == "# Intro\nWhat the cycle does.\n\n---\n\n# Steps\nEight of them.\n"

@needs_marp
def test_a_bad_slide_leaves_the_saved_deck_alone(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Intro", "Steps"]}, slide("# Intro\nShort."), slide("# Steps\nA.\n\n***\n\nB."),
                           {"content": "# Steps\nA and B."}])
    assert run(workspace, conn, fake, model, goal="Krebs", kind="slides").status == "done"
    assert "which Marp reads as a new slide" in model.prompts[3][1]["content"]
    assert split_frontmatter((workspace / "deck.md").read_text())[1] == "# Intro\nShort.\n\n---\n\n# Steps\nA and B.\n"
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_media.py tests/test_context.py tests/test_router.py -q`. Expected: the 9 new tests FAIL.
- [ ] **Step 3: Implement** `media.py`, the per-kind prompts and schemas, the router branches, `write_chunk`'s `extra_meta` and the README section, as specified.
- [ ] **Step 4: Run the whole suite**: `.venv/bin/pytest -q`. Expected: 262 passed (253 + 9).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: film workspaces write scene files and slide workspaces grow a Marp deck"`

Phase 4 is the last phase of the spec. After it, the next step is connecting the study app (spec section 8).
