# 03 — Backlog

Status values: `todo` · `doing` · `done` · `blocked`. Pull the top `todo` in your lane. Update the status here when it changes.

## Restructure (added 2026-10-31)

### T-01 · Architect · done
**Land the real workspace in this repo.** Copy `apps/study/`, `engine/`, `scripts/` and any still-useful docs from the local workspace into this repo, commit, push.
- Done when: the real code is in this repo and the app runs from the repo.
- **Landed 2026-10-31**, and the stack was launched from the repo the same day (see `logs/2026-10-31.md` and `05-Running.md`).

### T-02 · Architect · todo
**Reconcile docs with the real code.** Walk `apps/study/` and `engine/`, remove every *(unverified)* marker in `02_Architecture.md`, and rewrite the M1 tickets below so they match reality (some may already be done — mark them so).
- Done when: nothing in `02_Architecture.md` is marked *(unverified)* and M1 ticket statuses are truthful.
- Note: much of this is now known from the launcher and configs (ports, SurrealDB, uv, OpenNB engine); remaining unknowns are the Ollama model wiring and what the M1 backend tickets map to in `engine/src/memory_engine`.

### T-03 · Architect · todo
**Decide the fate of the `kratt/` template.** Either delete it, or implement `template-review-fixes-spec.md` on a branch. Deferred 2026-10-31 by owner decision.
- Done when: decision recorded in `04_Decisions.md` and executed or ticketed.

### T-04 · Architect · todo
**Triage npm audit in `apps/study`** (28 findings, dev chain, 2 critical). Do not blanket-fix during M1; assess whether any affect runtime.
- Done when: each critical is understood and either fixed or dismissed with a reason in the log.

## Milestone 1 — Core loop
Note: ticket statuses below predate the landing of the real code. Re-validate in T-02 before working them.

### A-01 · Architect · todo
**Confirm base and frontend.** Confirm the Lokus/OpenNB fork base and whether the UI is the fork's or Lovable-generated. Write the decision in `02_Architecture.md` and the log.

### B-01 · Backend · todo
**Choose and scaffold the glue service** (FastAPI or Express) with a health endpoint and SQLite connection.
- Done when: service starts locally, `GET /health` returns ok, DB file is created, decision and reason logged.
- Reality check (2026-10-31): the Study folder service on :5057 may already be this — confirm in T-02.

### B-02 · Backend · todo
**Create the schema** per `02_Architecture.md`: topics, score_events, notes, note_links, reviews. Add migrations.
- Done when: schema creates on a fresh DB; inserting and reading a score event works in a test.
- Reality check (2026-10-31): `engine` keeps notes in Markdown + one SQLite index (`memory.db`); confirm what exists in `engine/src/memory_engine` before writing anything new.

### B-03 · Backend · todo
**Mastery calculation**: time-decayed weighted aggregate, `tau` in config.
- Done when: unit tests cover empty history, one old event, many recent events, and decay over time.

### B-04 · Backend · todo
**Model interface + Ollama adapter** (one method: review a note → list of `{topic, delta, reason}`). Leave a stub for an external model.
- Done when: a sample note returns structured JSON from a local model; invalid output is handled without crashing.
- Reality check (2026-10-31): the service already talks to Ollama (it starts it); confirm the existing interface in T-02.

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


## Requested feature — Artifacts

### F-12 · Frontend · done
**Complete study artifacts from the surviving `feat/artifacts` branch.** Flashcards, slides and quizzes, generation from chat/notes/slash menu/Artifacts view, full-screen viewers, Markdown storage and links, Quick Find, and complete input splitting are implemented on `codex/finish-artifacts`. See `logs/2026-11-03.md` and `apps/study/docs/artifacts-verification.md` for validation and limits. Mastery and engine code are unchanged.

## Requested product — Desktop distribution

### D-01 · Cross-cutting (owner-authorized) · done (unsigned preview)
**Ship the native study app, managed bundled engine, local file storage, product site and release pipeline.** Recover the old prototype and validate actual artifacts. The owner explicitly deferred signing/notarization on 2026-11-03: build unsigned previews and keep trusted distribution as a later gate. The owner’s explicit shipping request authorizes changes across the frontend/backend/documentation lanes.

- Delivered: the product site, seven native packages across Linux/macOS/Windows, managed local engine, disk persistence, checksums and a draft-release workflow. See `desktop-verification.md` for exact checks.

### D-02 · Cross-cutting · todo
**Trusted public desktop distribution.** Add Apple Developer ID signing/notarization and Windows publisher signing when credentials are available. Manually verify downloaded desktop interfaces on macOS and Windows and the Ubuntu package before promoting a stable release. The owner explicitly deferred signing; this does not block unsigned previews.

### F-13 · Frontend / brand (owner-authorized) · done
**Carry the app's Ember design into the product site, GitHub presentation and unthemed desktop surfaces.** Use the existing palette/type/mascot, review responsive screenshots, preserve release links and app theme choices. The owner explicitly requested this across the site, repository presentation and frontend.

### D-03 · AI providers (owner-authorized) · done
**Restore online AI choices in the desktop app.** Add direct OpenAI/Claude and compatible APIs, supported subscription authentication, protected local credential storage, and provider-aware startup/chat/artifacts. The owner's request supersedes D-01's local-only AI restriction; local files remain authoritative and remote requests require an explicit online-provider choice.


### D-04 · AI sign-in repair · done
**Correct ChatGPT host-ID formatting and migrate saved UUIDs.** The owner reported OpenAI rejecting `ext_agent_host_id`. Use the documented UUID URN, preserve the underlying host identity and saved accounts, and update the installed Linux app.

### D-05 · Desktop packaging · todo
**Repair Intel macOS frozen-engine OpenSSL linking.** Native run `41723137985` failed its packaged-engine smoke test on macos-x86_64 with `_SSL_get0_group_name` missing from cryptography's extension. Other platform results do not establish Intel macOS readiness.

### F-14 · Frontend (owner-requested) · done
**Sources boxes from the supplied HTML reference.** Subject boxes open source-card grids; Rich, Simple and Preview styles are selectable and persisted in desktop preferences. Preserve source actions and the existing list option. Include empty subjects, responsive themes and keyboard operation.
