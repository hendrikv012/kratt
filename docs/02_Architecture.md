# 02 — Architecture

Status: draft for the prototype, rewritten 2026-10-31 for the monorepo. Items marked *(unverified)* describe the real workspace that currently lives only on the local machine (see ticket T-01) and must be confirmed once that code lands in this repo (ticket T-02).

## Repository layout (decided 2026-10-31, see 04_Decisions.md)
- `apps/study/` — the study app (web + Tauri desktop) *(unverified)*
- `engine/` — memory-engine and kratt-service *(unverified)*
- `scripts/` — helper scripts *(unverified)*
- `docs/` — this planning set and `logs/`
- `design/` — mascot art; `.ember-preview/` — redesign boards, reference only
- `kratt/` — unused stock Next.js template, fate in ticket T-03

## Stack
- App base: forks of **Lokus** and **OpenNB** (supersedes the earlier Obsidian/Logseq base-shell idea; final confirmation is ticket A-01)
- Local LLM and vision: **Ollama**
- Storage: **SQLite**
- Glue service: **FastAPI or Express** (pick one in B-01)
- Dev tools: Claude Code / Vibe, GitHub
- Deferred until M3: Chroma (vector DB), Tesseract.js OCR, LlamaIndex/LangChain

## Principles
1. **Local-first.** Everything runs on the student's machine by default.
2. **Pluggable models.** A model interface so external models (e.g. Claude) can sit beside the local one.
3. **Append-only score events.** Mastery is computed from a log, never overwritten.
4. **Prototype scope discipline.** Validate the note → review → score loop before adding infrastructure.

## Data model (proposed)
```
topics(id, name, normalized_name, created_at)
score_events(id, topic_id, delta, reason, source_note_id, created_at)   -- append-only
notes(id, title, body_md, created_at, updated_at)
note_links(from_note_id, to_note_id)                                    -- wikilinks
reviews(id, note_id, model, prompt_version, result_json, created_at)
```
- A review produces zero or more `score_events` (e.g. a mistake in "simplifying n!" → negative delta on that topic).
- Confirm against the real schema in `engine/` during T-02.

## Mastery calculation (proposed)
Time-decayed weighted aggregate, not a flat sum:
```
mastery(topic) = clamp( sum( delta_i * exp(-age_days_i / tau) ) , 0, 100 )
```
`tau` is tunable per subject. Keep it in config, not in code.

## Known risks
- **Topic fragmentation:** "simplify n!" vs "simplifying n!" would split a topic. Prototype: normalise names; M3: fuzzy/semantic matching.
- **Subject fit:** delta-per-topic suits math and science; essays and languages need a different feedback model (M4).
- **Estonian quality:** local open models are weaker in Estonian, hence the hybrid option in M4.

## API surface (proposed, prototype)
- `POST /notes`, `GET /notes/:id`
- `POST /notes/:id/review` → runs the model, writes score events
- `GET /mastery` → per-topic scores
- `POST /topics/merge` (later)
