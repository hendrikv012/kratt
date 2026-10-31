# 03 — Backlog

Status values: `todo` · `doing` · `done` · `blocked`. Pull the top `todo` in your lane. Update the status here when it changes.

## Restructure (added 2026-10-31)

### T-01 · Architect · doing
**Land the real workspace in this repo.** Copy `apps/study/`, `engine/`, `scripts/` and any still-useful docs from the local workspace into this repo, commit, push.
- Done when: the real code is in this repo and the app runs from the repo.

### T-02 · Architect · todo
**Reconcile docs with the real code.** Walk `apps/study/` and `engine/`, remove every *(unverified)* marker in `02_Architecture.md`, and rewrite the M1 tickets below so they match reality (some may already be done — mark them so).
- Done when: nothing in `02_Architecture.md` is marked *(unverified)* and M1 ticket statuses are truthful.

### T-03 · Architect · todo
**Decide the fate of the `kratt/` template.** Either delete it, or implement `template-review-fixes-spec.md` on a branch. Deferred 2026-10-31 by owner decision.
- Done when: decision recorded in `04_Decisions.md` and executed or ticketed.

## Milestone 1 — Core loop
Note → AI review → score update, visible in a simple mastery view. Validate these tickets against reality in T-02 first.

### A-01 · Architect · todo
**Confirm base and frontend.** Confirm the Lokus/OpenNB fork base and whether the UI is the fork's or Lovable-generated. Write the decision in `02_Architecture.md` and the log.

### B-01 · Backend · todo
**Choose and scaffold the glue service** (FastAPI or Express) with a health endpoint and SQLite connection.
- Done when: service starts locally, `GET /health` returns ok, DB file is created, decision and reason logged.

### B-02 · Backend · todo
**Create the schema** per `02_Architecture.md`: topics, score_events, notes, note_links, reviews. Add migrations.
- Done when: schema creates on a fresh DB; inserting and reading a score event works in a test.

### B-03 · Backend · todo
**Mastery calculation**: time-decayed weighted aggregate, `tau` in config.
- Done when: unit tests cover empty history, one old event, many recent events, and decay over time.

### B-04 · Backend · todo
**Model interface + Ollama adapter** (one method: review a note → list of `{topic, delta, reason}`). Leave a stub for an external model.
- Done when: a sample note returns structured JSON from a local model; invalid output is handled without crashing.

### B-05 · Backend · todo
**Review endpoint**: `POST /notes/:id/review` calls the model and writes `score_events` (topic names normalised).
- Done when: reviewing a note adds events and `GET /mastery` reflects them.

### F-01 · Frontend · todo
**Mastery view (stub data first):** per-topic list or simple map with scores, wired to `GET /mastery` once B-05 is done.
- Done when: view renders from stub data, then from the real API.

### F-02 · Frontend · todo
**Note editor with review button**, showing the review result and the score changes.
- Done when: write a note → press review → see the changes without leaving the page.

## Milestone 2 — UI and onboarding

### F-10 · Frontend · todo
**Onboarding flow** for students who have never used note tools: first-run walkthrough, one example note, one example review.

### F-11 · Frontend · todo
**Kratt branding pass:** name, colours, blocky mascot (art in `design/`), consistent components.

## Milestone 3 — later
- B-20 fuzzy/semantic topic matching · B-21 source import (PDF first) · B-22 OCR for test photos · B-23 vector DB
