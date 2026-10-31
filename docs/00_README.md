# 00 — Agent rules (read first)

Project: **Kratt** (formerly BaseN) — a student study app: source imports, wikilink notes, local AI review, per-topic mastery scores.

## Source of truth
- Agent rules: this file
- Goals and milestones: `01_Roadmap.md`
- Stack and data model: `02_Architecture.md`
- Work to do: `03_Backlog.md`
- Decisions, with reasons: `04_Decisions.md`
- Progress notes: `logs/YYYY-MM-DD.md` (one file per working day)

## Rules for every agent
1. Read this file, then `02_Architecture.md`, then the ticket you were given. Do not start from memory.
2. Take **one** ticket at a time, the top `todo` ticket in your lane (see `03_Backlog.md`). Set it to `doing` before you start and `done` or `blocked` when you stop, updating `03_Backlog.md` as you go.
3. Do not change anything in `02_Architecture.md` without recording why in `04_Decisions.md` and the day's log. If a ticket needs an architecture change, mark it `blocked` and say what you need.
4. Stay inside your lane's files (listed per ticket). If you must touch another lane's files, stop and log it.
5. Prototype first: no vector DB and no photo OCR until Milestone 3. Do not add them early.
6. Every ticket ends with: tests or a manual check run, plus a short log entry (what changed, how it was checked, what is left).
7. Never invent facts about the product. Anything not confirmed against real code is marked *(unverified)* in `02_Architecture.md` and must be checked in ticket T-02. If something is unclear, write it under "Open questions" in the day's log.

## Lanes
- **Architect/Coordinator:** keeps roadmap, backlog and decisions in order, writes tickets, reviews logs. Does not write feature code.
- **Backend (`engine/`):** local API, SQLite, scoring, AI calls.
- **Frontend (`apps/study/`):** UI, onboarding, notes and graph views.
