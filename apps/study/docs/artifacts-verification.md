# Artifacts verification

Completed 2026-11-03 from Claude's `feat/artifacts` implementation through task 12 (`01fe172`).

## Result

Flashcards, slides and quizzes can be made from Kratt Chat, the note `/Kratt` popup, `/Flashcards`, `/Slides`, `/Quiz`, or New artifact. They persist as Markdown, link back to their sources, open from notes/chat/Quick Find, and support themed full-screen viewers. Artifact scores remain separate from mastery.

The maker sends all selected stored source text in ordered parts. Every request, including a retry, stays within the configured Chat memory budget. A failed part or cancelled operation saves no artifact. This guarantees input delivery, not factual completeness or correctness of model output. It cannot recover text omitted during an earlier source import.

## Checks

- All 79 Vitest test files pass individually: 1,000 tests, including targeted reruns after fixes.
- Production Vite build succeeds; existing large-chunk and browser-data notices remain.
- Real headless Chromium: flashcards, slides and quiz open through Quick Find and enter/leave full screen in Ember and Chalk.
- In both themes, `/Quiz` generates an artifact, saves the wiki link in the page, opens its viewer, and persists the quiz result. Tests use an isolated in-memory service with deterministic AI replies, never the personal Study folder.
- Added checks for note-link Markdown round trips, local-model routing, cancellation, large part counts, and dialog focus. The pre-existing slash-menu jsdom Range error is fixed in its test setup.

## Try it locally

1. Start the Study folder service (`memory-engine serve`) and the app (`npm run dev` in `apps/study`). Configure an installed local model or the online service in Settings → AI.
2. Open a note and type `/Flashcards`, `/Slides`, or `/Quiz`. Optionally enter a topic, then choose Make.
3. Open the resulting link. Use the viewer controls, Full screen (or F), then Escape.
4. In Kratt Chat, attach notes and choose Make. A natural-language request also offers a Make button after the answer.
5. Open Artifacts from the sidebar; try New artifact, type/subject filters, title search, and Ctrl K.
6. For a large subject, watch part progress; cancel once and confirm no partial artifact appears. AI output quality still needs review with the actual chosen model.
