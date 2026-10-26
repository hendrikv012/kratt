# 03 — Backlog

Status values: `todo` · `doing` · `done` · `blocked`. Pull the top `todo` in your lane. Update the status here.

## Milestone 1 — Core loop

### B-01 · Backend · todo
**Choose and scaffold the glue service** (FastAPI or Express) with a health endpoint and SQLite connection.
- Done when: service starts locally, `GET /health` returns ok, DB file is created, decision and reason logged.

### B-02 · Backend · todo
**Create the schema** from [[02_Architecture]]: `topics`, `score_events`, `notes`, `note_links`, `reviews`. Add migrations.
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
**Note editor with review button** in the forked app, showing the review result and the score changes.
- Done when: write a note → press review → see the changes without leaving the page.

### A-01 · Architect · todo
**Decide base and frontend:** confirm Lokus/OpenNB forks and Lovable vs built-in UI. Write the decision in [[02_Architecture]] and the log.

## Milestone 2 — UI and onboarding

### F-10 · Frontend · todo
**Onboarding flow** for students who have never used note tools: first-run walkthrough, one example note, one example review.
### F-11 · Frontend · todo
**Kratt branding pass:** name, colours, blocky mascot (design in progress), consistent components.

## Milestone 3 — later
- B-20 fuzzy/semantic topic matching · B-21 source import (PDF first) · B-22 OCR for test photos · B-23 vector DB
