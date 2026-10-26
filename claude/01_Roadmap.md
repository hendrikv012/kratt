# 01 — Roadmap

## Product in one line
A study environment where students import sources, write interconnected notes, get AI review, and see a per-topic **mastery map** that shows what they actually know. "A memory system of scoring, powered by AI."

## Why it exists
AI summaries let students pass without learning. Kratt keeps the student in control: it maps what they know, checks it, and tracks improvement over time. The UI must work for students who have never used Obsidian or similar tools.

## Target users
High school and university students, especially Estonian riigieksamid, German DSD2 and Abitur preparation. About 100 test students available for user testing.

## Milestones

### M1 — Core loop works (prototype)
Note → AI review → score update, visible in a simple mastery view.
- Done when: a student can write a note, ask for a review, and see topic scores change from logged events.

### M2 — UI and onboarding
A redesigned, easy-to-use interface a first-time student can use without help (the current UI is hard for beginners).
- Done when: 5 test students finish onboarding and complete the core loop unaided.

### M3 — Sources and depth
Source imports (PDF, slides, links), fuzzy/semantic topic matching, then OCR for test photos and a vector DB if needed.
- Done when: duplicate topics are merged automatically and an imported PDF can be reviewed.

### M4 — Language subjects and hybrid AI
Qualitative feedback for essays and languages. Optional external model (e.g. Claude) for Estonian writing, with the local model as default.
- Done when: an Estonian essay gets useful feedback through the external-model path.

### M5 — Growth features (later)
Recall system, gamification and competitions, teacher content, presentation builder (extension, kept deliberately incomplete so students still learn).

## Open questions
- Final choice of base: forks of Lokus and OpenNB (current) vs earlier Obsidian/Logseq plan.
- Frontend: Lovable vs built into the fork.
- Hosting and accounts: local-only for the prototype, anything beyond is undecided.
