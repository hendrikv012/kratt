# 00 — Agent rules (read first)

Project: **Kratt** (formerly BaseN) — a student study app: source imports, `[[wikilink]]` notes, local AI review, per-topic mastery scores.

## Source of truth
- Goals and milestones: [[01_Roadmap]]
- Stack and data model: [[02_Architecture]]
- Work to do: [[03_Backlog]]
- Progress notes: `logs/YYYY-MM-DD.md`

## Rules for every agent
1. Read this file, then [[02_Architecture]], then the ticket you were given. Do not start from memory.
2. Take **one** ticket at a time, the top `todo` ticket in your lane (see [[03_Backlog]]). Set it to `doing` before you start and `done` or `blocked` when you stop.
3. Do not change anything in [[02_Architecture]] without writing why in the day's log. If a ticket needs an architecture change, mark it `blocked` and say what you need.
4. Stay inside your lane's files (listed per ticket). If you must touch another lane's files, stop and log it.
5. Prototype first: **no Chroma and no photo OCR** until Milestone 3. Do not add them early.
6. Every ticket ends with: tests or a manual check run, a short log entry (what changed, how it was checked, what is left).
7. Never invent facts about the product. If something is unclear, write it under "Open questions" in the log.

## Lanes
- **Architect/Coordinator:** keeps the roadmap and backlog in order, writes tickets, reviews logs. Does not write feature code.
- **Backend:** local API, SQLite, scoring, AI calls.
- **Frontend:** UI, onboarding, notes and graph views.
