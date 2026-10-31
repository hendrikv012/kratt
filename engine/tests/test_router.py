import pytest

from conftest import needs_bwrap, needs_marp
from memory_engine.chat import ModelReplyError, ScriptedModel
from memory_engine.frontmatter import split_frontmatter
from dataclasses import replace

from memory_engine.index_file import Step, new_index, read_index, write_index
from memory_engine.router import RunReport, run
from memory_engine.search import hybrid_search
from memory_engine.workfiles import read_scratchpad


def work(scratchpad="", search="", chunk_title="", chunk_body="", step_done=False, target=""):
    reply = {"scratchpad": scratchpad, "search": search, "chunk_title": chunk_title,
             "chunk_body": chunk_body, "step_done": step_done}
    return reply | ({"target": target} if target else {})


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


def test_finishing_without_a_chunk_is_refused(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only step"]}, work(step_done=True),
                           work(chunk_title="T", chunk_body="Result.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "Save this step's result as a chunk before finishing it." in model.prompts[2][-1]["content"]


def test_broken_reply_is_a_failed_turn(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only step"]}, ModelReplyError("the reply was not valid JSON: x"),
                           {"scratchpad": "missing keys"}, work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G") == RunReport("done", 1, 4)
    assert "not valid JSON" in model.prompts[2][-1]["content"]
    assert "missing" in model.prompts[3][-1]["content"]


def test_a_step_that_never_finishes_is_marked_stuck(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Hard step"]}] + [work(scratchpad="Still thinking.")] * 8)
    report = run(workspace, conn, fake, model, goal="G", max_turns_per_step=8)
    assert report == RunReport("stuck", 0, 9, stuck_step="Hard step")
    assert states(workspace) == ["stuck"] and read_index(workspace / "INDEX.md").status == "stuck"
    assert "Still thinking." in read_scratchpad(workspace, "Hard step")


def test_person_edits_to_the_index_are_followed(workspace, conn, fake):
    (workspace / "INDEX.md").write_text("---\ngoal: G\nstatus: working\n---\n## Steps\n- [x] Done by hand\n- [ ] Second\n\n## Contents\n\n## Notes\nMine.\n")
    model = ScriptedModel([work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, model) == RunReport("done", 1, 1)
    assert "1. Done by hand" not in model.prompts[0][-1]["content"] and "2. Second" in model.prompts[0][-1]["content"]
    assert "## Notes\nMine." in (workspace / "INDEX.md").read_text()


def test_a_run_resumes_after_an_interruption(workspace, conn, fake):
    first = ScriptedModel([{"steps": ["Only step"]}, work(scratchpad="Halfway there.")])
    assert run(workspace, conn, fake, first, goal="G", max_turns=2).status == "paused"
    second = ScriptedModel([work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, second) == RunReport("done", 1, 1)
    assert "Halfway there." in second.prompts[0][-1]["content"]


def test_html_result_is_not_saved_and_the_model_is_told(workspace, conn, fake):
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


def test_rerun_with_a_stuck_step_stays_stuck(workspace, conn, fake):
    (workspace / "INDEX.md").write_text("---\ngoal: G\nstatus: stuck\n---\n## Steps\n- [x] One\n- [!] Two\n\n## Contents\n")
    model = ScriptedModel([])
    assert run(workspace, conn, fake, model) == RunReport("stuck", 0, 0, stuck_step="Two")
    assert model.prompts == []


class EditsDuringCall(ScriptedModel):
    """A model whose call `on_call` lets a person edit files while it 'thinks'."""

    def __init__(self, replies, edit, on_call=0):
        super().__init__(replies)
        self.edit, self.on_call = edit, on_call

    def complete(self, messages, schema):
        if len(self.prompts) == self.on_call:
            self.edit()
        return super().complete(messages, schema)


def test_edits_made_during_a_model_call_are_kept(workspace, conn, fake):
    path = workspace / "INDEX.md"
    path.write_text("---\ngoal: G\n---\n## Steps\n- [ ] First\n\n## Contents\n")

    def edit():
        text = path.read_text().replace("- [ ] First\n", "- [ ] First\n- [ ] Added by hand\n")
        path.write_text(text + "\n## My notes\nKeep this.\n")

    model = EditsDuringCall([work(chunk_title="T", chunk_body="R.", step_done=True),
                             work(chunk_title="T2", chunk_body="R2.", step_done=True)], edit)
    assert run(workspace, conn, fake, model).status == "done"
    text = path.read_text()
    assert "- [x] First" in text and "- [x] Added by hand" in text and "## My notes\nKeep this." in text


def test_stuck_mark_follows_the_title_not_the_position(workspace, conn, fake):
    path = workspace / "INDEX.md"
    path.write_text("---\ngoal: G\n---\n## Steps\n- [x] Done\n- [ ] Hard\n\n## Contents\n")

    def edit():
        path.write_text(path.read_text().replace("- [x] Done\n", "- [x] Done\n- [x] Inserted above\n"))

    model = EditsDuringCall([work(scratchpad="Hmm.")] * 2, edit, on_call=1)
    assert run(workspace, conn, fake, model, max_turns_per_step=2).stuck_step == "Hard"
    assert [(s.title, s.state) for s in read_index(path).steps] == [
        ("Done", "done"), ("Inserted above", "done"), ("Hard", "stuck")]


def test_failed_plan_turn_tells_the_model_why(workspace, conn, fake):
    model = ScriptedModel([{"steps": []}, {"steps": ["Only"]}, work(chunk_title="T", chunk_body="R.", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "# Problem with your last reply\nthe plan had no steps" in model.prompts[1][-1]["content"]


def test_saved_result_is_shown_on_the_next_turn(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Only"]}, work(chunk_title="T", chunk_body="R."), work(step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "Saved for this step: chunk_001.md (T)" in model.prompts[2][-1]["content"]


def test_stuck_report_says_why(workspace, conn, fake):
    cut = ModelReplyError("the reply was cut off at 450 tokens: keep scratchpad and chunk_body shorter")
    report = run(workspace, conn, fake, ScriptedModel([{"steps": ["Only"]}] + [cut] * 8), goal="G")
    assert report.status == "stuck" and "cut off at 450 tokens" in report.reason


def test_progress_is_reported_each_turn(workspace, conn, fake):
    lines = []
    model = ScriptedModel([{"steps": ["Only"]}, work(scratchpad="Idea.", chunk_title="T", chunk_body="R.", step_done=True)])
    run(workspace, conn, fake, model, goal="G", progress=lines.append)
    assert lines == ["planned 1 step", 'step 1/1 "Only": notes, saved chunk_001.md, finished']



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
    model = ScriptedModel([{"steps": ["Write the note"]}, work(chunk_title="Krebs cycle", chunk_body="<b>Eight</b> steps.", target="notes/k.md", step_done=True),
                           {"find": "<b>Eight</b> steps.", "replace": "Eight steps.\n"}])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert (workspace / "notes" / "k.md").read_text() == GOOD
    assert conn.execute("SELECT count(*) FROM learned_repairs").fetchone()[0] == 1


def test_rejected_result_is_not_written_and_the_model_is_told(workspace, conn, fake):
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


@needs_bwrap
def test_python_result_is_kept_in_its_chunk_as_a_code_block(workspace, conn, fake):
    code = "def between(a: int, b: int, c: int) -> bool:\n    return a<b and b>c\n"
    model = ScriptedModel([{"steps": ["Write the check"]}, work(chunk_title="Between", chunk_body=code, target="src/between.py", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert (workspace / "src" / "between.py").read_text() == code
    assert split_frontmatter((workspace / "chunk_001.md").read_text())[1] == "```python\n" + code + "```\n"


@needs_bwrap
def test_python_result_with_a_fence_in_its_docstring_keeps_its_chunk(workspace, conn, fake):
    code = 'def between(a: int, b: int, c: int) -> bool:\n    """Example:\n```\nbetween(1, 2, 3)\n```\n"""\n    return a<b and b>c\n'
    model = ScriptedModel([{"steps": ["Write it"]}, work(chunk_title="B", chunk_body=code, target="src/between.py", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert split_frontmatter((workspace / "chunk_001.md").read_text())[1].startswith("````python\n")


def test_header_only_markdown_result_still_gets_a_chunk(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Write it"]}, work(chunk_title="Empty", chunk_body="---\ntitle: Empty\n---\n", target="notes/e.md", step_done=True)])
    assert run(workspace, conn, fake, model, goal="G").status == "done"
    assert "Saved as notes/e.md." in (workspace / "chunk_001.md").read_text()



def test_new_workspace_takes_its_kind(workspace, conn, fake):
    model = ScriptedModel([RuntimeError("stop")])
    with pytest.raises(RuntimeError):
        run(workspace, conn, fake, model, goal="G", kind="film")
    assert read_index(workspace / "INDEX.md").kind == "film"


def test_kind_cannot_change_from_the_command_line(workspace, conn, fake):
    write_index(workspace / "INDEX.md", new_index("G", kind="slides"))
    with pytest.raises(ValueError, match="already says kind: slides"):
        run(workspace, conn, fake, ScriptedModel([]), kind="film")



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
    model = ScriptedModel([{"steps": ["Arrival"]}, scene(lighting=""), {"find": "lighting: ''", "replace": "lighting: Cold"}])
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
                           {"find": "A.\n\n***\n\nB.", "replace": "A and B."}])
    assert run(workspace, conn, fake, model, goal="Krebs", kind="slides").status == "done"
    assert "which Marp reads as a new slide" in model.prompts[3][1]["content"]
    assert split_frontmatter((workspace / "deck.md").read_text())[1] == "# Intro\nShort.\n\n---\n\n# Steps\nA and B.\n"


def test_an_empty_scene_field_is_named(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Arrival"]}, scene(voiceover=""), scene()])
    assert run(workspace, conn, fake, model, goal="G", kind="film").status == "done"
    assert "the scene is missing voiceover" in model.prompts[2][-1]["content"]


def test_one_scene_per_step(workspace, conn, fake):
    model = ScriptedModel([{"steps": ["Arrival"]}, scene(step_done=False)])
    assert run(workspace, conn, fake, model, goal="G", kind="film") == RunReport("done", 1, 2)
    assert sorted(p.name for p in (workspace / "scenes").glob("*.md")) == ["scene_01.md"]


def test_a_fix_cannot_change_the_scene_number(workspace, conn, fake):
    wrong = "---\ntitle: Arrival\nscene_number: 5\nlocation: Lab\ncamera_angle: Wide\nlighting: Cold\n---\n## Visual prompt\nA lab.\n\n## Voiceover\nIt began.\n"
    model = ScriptedModel([{"steps": ["Arrival"]}, scene(lighting=""), {"find": "scene_number: 1\nlocation: Lab\ncamera_angle: Wide\nlighting: ''", "replace": "scene_number: 5\nlocation: Lab\ncamera_angle: Wide\nlighting: Cold"},
                           {"find": "scene_number: 5", "replace": "scene_number: 1"}])
    assert run(workspace, conn, fake, model, goal="G", kind="film").status == "done"
    assert "scene_number must stay 1" in model.prompts[3][1]["content"]
    assert split_frontmatter((workspace / "scenes" / "scene_01.md").read_text())[0]["scene_number"] == 1


def test_a_missing_marp_tool_stops_the_run_at_once(workspace, conn, fake, monkeypatch):
    monkeypatch.setattr("memory_engine.checks.MARP_CLI", workspace / "missing" / "marp-cli.js")
    model = ScriptedModel([{"steps": ["Intro"]}, slide("# Intro\nShort.")])
    report = run(workspace, conn, fake, model, goal="G", kind="slides")
    assert report.status == "blocked" and "npm ci --prefix tools/marp" in report.reason
    assert len(model.prompts) == 2 and read_index(workspace / "INDEX.md").steps[0].state == "todo"


@needs_marp
def test_new_slides_build_on_an_edited_deck(workspace, conn, fake):
    first = ScriptedModel([{"steps": ["Intro"]}, slide("# Intro\nShort.")])
    assert run(workspace, conn, fake, first, goal="Krebs", kind="slides").status == "done"
    deck = workspace / "deck.md"
    deck.write_text(deck.read_text().replace("Short.", "Short, edited by hand."))
    index = read_index(workspace / "INDEX.md")
    write_index(workspace / "INDEX.md", replace(index, steps=index.steps + (Step("Steps", "todo"),)))
    second = ScriptedModel([slide("# Steps\nEight of them.")])
    assert run(workspace, conn, fake, second).status == "done"
    assert split_frontmatter(deck.read_text())[1] == "# Intro\nShort, edited by hand.\n\n---\n\n# Steps\nEight of them.\n"


@needs_marp
def test_a_broken_edited_deck_stops_with_a_message(workspace, conn, fake):
    first = ScriptedModel([{"steps": ["Intro"]}, slide("# Intro\nShort.")])
    run(workspace, conn, fake, first, goal="Krebs", kind="slides")
    deck = workspace / "deck.md"
    before = deck.read_text().replace("Short.", "Short.\n\n***\n\nBroken.")
    deck.write_text(before)
    index = read_index(workspace / "INDEX.md")
    write_index(workspace / "INDEX.md", replace(index, steps=index.steps + (Step("Steps", "todo"),)))
    report = run(workspace, conn, fake, ScriptedModel([slide("# Steps\nEight.")]))
    assert report.status == "blocked" and "deck.md" in report.reason and "Marp reads as a new slide" in report.reason
    assert deck.read_text() == before
