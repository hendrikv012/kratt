from memory_engine.chunking import estimate_tokens
from memory_engine.context import (
    INDEX_BUDGET,
    PLAN_SYSTEM,
    PROMPT_BUDGET,
    SCRATCHPAD_BUDGET,
    WORK_SCHEMA,
    WORK_SYSTEM,
    build_plan_prompt,
    build_work_prompt,
    index_view,
    plan_system,
    work_schema,
    work_system,
)
from memory_engine.index_file import Index, Step
from memory_engine.store import index_markdown


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


def test_long_step_title_stays_within_the_budget(conn, fake):
    index = Index("Goal", "working", (Step("Explain " * 1000, "todo"),), (), "")
    assert total(build_work_prompt(conn, fake, index, 0, "", "", "")) <= PROMPT_BUDGET


def test_numeric_notes_keep_to_their_share(conn, fake):
    index = Index("Goal", "working", (Step("S", "todo"),), (), "")
    content = build_work_prompt(conn, fake, index, 0, "1234567890 " * 1000, "", "")[-1]["content"]
    notes = content.split("# Your notes so far\n")[1].split("\n\n# From the project")[0]
    assert estimate_tokens(notes) <= SCRATCHPAD_BUDGET


def test_plan_prompt_shows_the_last_error(conn, fake):
    messages = build_plan_prompt(conn, fake, Index("G", "planning", (), (), ""), "the plan had no steps")
    assert "# Problem with your last reply\nthe plan had no steps" in messages[1]["content"]


def test_saved_results_for_the_step_are_shown(conn, fake):
    index = Index("Goal", "working", (Step("S", "todo"),), (), "")
    saved = build_work_prompt(conn, fake, index, 0, "", "", "", saved=(("chunk_003.md", "Eight steps"),))
    assert "# Current step\n1. S\nSaved for this step: chunk_003.md (Eight steps)" in saved[-1]["content"]
    assert "Saved for this step: nothing yet" in build_work_prompt(conn, fake, index, 0, "", "", "")[-1]["content"]



def test_target_is_optional_and_explained():
    assert "target" in WORK_SCHEMA["properties"] and "target" not in WORK_SCHEMA["required"]
    assert "- target: the project file this result should become" in WORK_SYSTEM and estimate_tokens(WORK_SYSTEM) <= 300


def test_steps_and_results_are_asked_to_be_short():
    assert "Each step produces one short piece: a note of at most about 200 words, or code of at most about 40 lines." in PLAN_SYSTEM
    assert "at most about 200 words or 40 lines of code" in WORK_SYSTEM
    assert estimate_tokens(PLAN_SYSTEM) <= 300


def test_last_error_keeps_its_first_line_and_its_end(conn, fake):
    index = Index("Goal", "working", (Step("S", "todo"),), (), "")
    error = ("the Doctor did not accept src/f.py: src/f.py still fails pytest after 3 fixes:\n"
             + "context line\n" * 300 + "E   assert -1 == 3")
    content = build_work_prompt(conn, fake, index, 0, "", "", error)[-1]["content"]
    assert "the Doctor did not accept src/f.py" in content and "E   assert -1 == 3" in content



def test_each_kind_has_its_own_plan_line_and_schema():
    assert plan_system("notes") == PLAN_SYSTEM
    assert "Each step is one scene of the film" in plan_system("film") and "one slide of at most 80 words" in plan_system("slides")
    assert {"location", "camera_angle", "lighting", "visual_prompt", "voiceover"} <= set(work_schema("film")["required"])
    assert "target" not in work_schema("slides")["properties"]
    assert all(estimate_tokens(work_system(k)) <= 300 and estimate_tokens(plan_system(k)) <= 300 for k in ("notes", "film", "slides"))
