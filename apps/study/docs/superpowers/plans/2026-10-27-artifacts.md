# Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kratt makes flashcards, slides and quizzes from notes. They come from Kratt Chat, the /Kratt box, the "/" menu or the Artifacts view, are saved in `Artifacts/`, open in a viewer that follows the theme and has a full-screen mode, and link back to the notes they were made from. No note is ever cut to fit the context window.

**Architecture:** Artifacts are a fourth list in the study state, loaded and synced exactly like chats (`data/vaultState.js`, `data/operations.js`). A pure pipeline does the work: `gatherFull` → `splitIntoParts` → `createArtifactMaker` → `parseArtifact`. It sends each part through the same send path as chat (`chatService.send`, engine or local model), and React reaches it through one hook, `useMakeArtifact`. Viewers are standalone components that take `items`. `ArtifactView` wraps them with the header and full mode, and every trigger (chat, /Kratt, "/" menu, Artifacts view) calls the same hook.

**Tech Stack:** React 18 with JSX, Vite, vitest 3.2.4 + Testing Library (jsdom), markdown-it, js-yaml, lucide-react, Tiptap (the Lokus editor).

**Spec:** `docs/superpowers/specs/2026-10-24-artifacts-design.md` (read it with this plan).

All paths below are relative to `src/views/studyhome/` unless they start with `src/` or `docs/`.

## Completion — 2026-11-03

Tasks 1–12 were recovered from the existing `feat/artifacts` branch at `01fe172`. Task 12 was reviewed and its chat tests rerun. Tasks 13–14 are implemented: note creation, slash commands, persistent artifact links, and Quick Find. Task 15 is complete; see `docs/artifacts-verification.md` for checks and manual steps. Historical checkboxes below describe the original implementation sequence, not remaining work.

Final fixes cover cancellation when the chat panel closes, arbitrarily many part-number digits, dialog keyboard focus, Quick Find group registration, and jsdom's missing Range geometry in slash-menu tests. No dependencies or engine code changed.

## Global Constraints

- Work in the worktree `apps/study/.claude/worktrees/artifacts`, branch `feat/artifacts`. It has no `node_modules`, so run `npm ci` once there first.
- Do not add or bump dependencies. Do not touch mastery, review, the graph, `engine/`, or the Sources screen.
- Run test files one at a time (`npx vitest run <file>`). The full suite has known random 10 s timeouts.
- UI copy is plain and short and never says Lokus or Open Notebook. The backend is "Kratt's engine".
- Viewers and cards use only `--st-*` tokens and existing `st-*` classes and fonts. Popups and overlays render inside `.study` (`el.closest(".study")`), never `document.body` directly.
- Kratt's text is rendered with markdown-it `{ html: false, linkify: false }`.
- Kratt's animation modes are `idle | think | hop | sleep` (`kratt/Kratt.jsx`).
- The link syntax is exactly `[[artifact:<id>|<Type> · <Title>]]`.
- Type labels are exactly: `Flashcards`, `Slides`, `Quiz`.
- The target sizes for each part are exactly:
  - flashcards: 1 per 400 bytes, between 3 and 15;
  - slides: 1 per 800 bytes, between 2 and 10;
  - quiz: 1 per 600 bytes, between 2 and 8.
- Nothing is cut to fit Chat memory. An artifact is saved only when every part worked.
- Commit after every task, with messages ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan adds to the spec

- **Sending:** the maker does not call `client.notebookAsk` itself. `createChatService` gains `send(prompt) → Promise<string>`, which carries the engine/local choice and the error mapping, and `ask` uses it. `shell.chat` gains `local` (`settings.ai.model === "local"`), so artifacts made outside the panel also use the computer's model when it's chosen. This replaces the spec's "export `fitContext`": `fitContext` stays private.
- **Leading text:** text before the first `###` in a flashcards or quiz body becomes a leading item with an empty front or question. That item is unusable but kept on save, so no text is lost.
- **Title in answers:** for flashcards and quiz, the maker removes a `# Title` line that comes before the first `###` before parsing, and uses it as the title.
- **Earlier items in later parts:** later parts list the items already made, keeping the newest ones that fit in 1024 bytes. The oldest are dropped first.
- **Slides title slide:** in part 2 and later, the first slide is dropped when its title matches (ignoring case and spaces) the artifact title or the topic.
- **Error copy:** one part gives "Kratt couldn't make these <items>. Try again."; several parts give "Kratt couldn't make part k of n of these <items>. Try again." `<items>` is the plural item word: `cards`, `slides` or `questions`.
- **Cancel:** throws `ChatError("cancelled", "")`. Callers show nothing for it.

## Review Focus

1. **A huge note with Chat memory on Short (8 KB):** a 100 KB note with no blank lines and multibyte text (é, emoji) must split at character boundaries, lose no byte, and show "part k of n" progress. Pinned in Task 3 and Task 5.
2. **Viewer keys while typing:** pressing F, G, A, Space or the arrows inside the title rename input or a menu must not flip, mark or enter full mode. Pinned in Task 6.
3. **A hand-edited file with junk** (unknown `type`, a missing `made_from`, a quiz with no `[x]`, `\r\n`) still loads, opens with the usable items and the notice, and saves back unchanged. Pinned in Task 1 and Task 2.
4. **HTML or scripts in Kratt's output** (`<img onerror>`, `<script>` in a slide or card) show as text. Pinned in Task 7.
5. **Closing the place a make started from** (closing the tab, the box or the dialog, or opening another chat) mid-make: no artifact is saved later and no state updates after unmount. Pinned in Task 5 (abort) and Task 4 (hook unmount).

---

### Task 1: Artifact body formats

**Files:**
- Create: `artifacts/format.js`
- Test: `artifacts/format.test.js`

**Interfaces:**
- Produces:
  - `ARTIFACT_TYPES = ["flashcards", "slides", "quiz"]`
  - `TYPE_LABELS = { flashcards: "Flashcards", slides: "Slides", quiz: "Quiz" }`
  - `itemCount(type, n) → "10 cards" | "1 slide" | "5 questions"`
  - `parseArtifact(type, body: string) → items[]`:
    - flashcards items are `{ front, back }`;
    - slides items are `{ title, body }`;
    - quiz items are `{ question, choices: [{ text, right: boolean }], why, rest }`, where `rest` holds other lines inside the question, written back after the choices.
  - `formatArtifact(type, items) → string`
  - `itemProblem(type, item, index) → string | null`
  - `problemsIn(type, items) → string[]`
  - `usableItems(type, items) → items[]`

- [ ] **Step 1: Write the failing tests** in `artifacts/format.test.js`:
  - `round-trips each type`: for a two-item sample of each type, `parseArtifact(t, formatArtifact(t, items))` deep-equals `items`.
  - `keeps text before the first item`: `parseArtifact("flashcards", "intro\n\n### Q\nA\n")[0]` equals `{ front: "", back: "intro" }`. `formatArtifact` of that result contains `"intro"`.
  - `reads CRLF files`: the same body with `\r\n` parses to the same items.
  - `a heading inside a back survives`: a card whose back has a line `### not a card` gives exactly one card after format → parse (escape it with a leading space, like `escapeHeadings`).
  - `a --- line inside a slide survives`: a slide body with `---` gives back one slide after format → parse (written as ` ---`).
  - `quiz parsing`: `"### 2+2?\n- [ ] 3\n- [x] 4\n> because\n"` gives `{ question: "2+2?", choices: [{text:"3",right:false},{text:"4",right:true}], why: "because", rest: "" }`. `[X]` counts as right.
  - `problems`:
    - `problemsIn("quiz", [])` equals `["Kratt made no questions."]`;
    - a quiz item with no right choice at index 2 gives `"Question 3 has no correct answer."`;
    - two right choices give `"Question 3 has more than one correct answer."`;
    - one choice gives `"Question 3 needs at least two choices."`;
    - an empty card front at index 0 gives `"Card 1 has an empty front."`, and an empty back `"Card 1 has an empty back."`;
    - an empty slide (no title and no body) gives `"Slide 1 is empty."`.
  - `usableItems drops only broken items`.
  - `itemCount`: `itemCount("flashcards", 1) === "1 card"`, `itemCount("quiz", 5) === "5 questions"`.

- [ ] **Step 2: Run** `npx vitest run src/views/studyhome/artifacts/format.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `artifacts/format.js`.** Follow `chats/format.js`: normalize `\r\n?` to `\n`, and parse line by line. A heading is `/^###[ \t]+(.*)$/`, and a slide break is a line that is exactly `---`. Trim blank lines around fields with `turnText`.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): body formats for flashcards, slides and quiz`.

### Task 2: Artifacts in the study data and the Study folder

**Files:**
- Modify: `data/operations.js` (`EMPTY_STATE`, a new `// ---------- Artifacts ----------` section, `mutations`)
- Modify: `data/vaultState.js` (`ARTIFACTS_DIR`, `SPECIAL_DIRS`, `artifactFrom`, `stateFromSnapshot`, `fileText`, `planSync`)
- Modify: `data/StudyProvider.jsx:21-40` (`hasContent` and the special-folder list)
- Test: `data/operations.test.js`, `data/vaultState.test.js`

**Interfaces:**
- Consumes: `parseArtifact`, `formatArtifact` and `ARTIFACT_TYPES` (Task 1).
- Produces:
  - State `state.artifacts: Artifact[]`, newest `updated` first, where `Artifact = { id, title, type, madeFrom: string[], madeIn: { kind: "chat" | "page", id } | null, created: number, updated: number, lastScore: { right, of, at: number } | null, parts: number, sourceBytes: number, items, extraMeta? }`.
  - `addArtifact(state, { id = newId(), title, type, madeFrom, madeIn = null, items, parts = 1, sourceBytes = 0, now = Date.now() }) → { state, id }`. Through `actions` it returns the id.
  - `renameArtifact(state, id, title)`: an empty title becomes `"Untitled <label>"`.
  - `recordScore(state, id, { right, of, now = Date.now() })`: sets `lastScore`, and does not change `updated`.
  - `deleteArtifact(state, id)`.
  - `ARTIFACTS_DIR = "Artifacts"`.

- [ ] **Step 1: Write the failing tests.**
  - In `operations.test.js`:
    - `addArtifact puts it first and returns its id`;
    - `renameArtifact` (including the empty title);
    - `recordScore keeps updated`;
    - `deleteArtifact`.
  - In `vaultState.test.js`, use a snapshot file `Artifacts/2026-10-27 10-00 Krebs.md` with header `{ id: "a1", title: "Krebs", type: "quiz", made_from: ["p1"], made_in: { kind: "chat", id: "c1" }, created, updated, last_score: { right: 3, of: 5, at }, parts: 2, source_bytes: 900, tags: ["x"] }` and a quiz body:
    - `loads artifacts`: `state.artifacts[0]` matches `{ id: "a1", type: "quiz", madeFrom: ["p1"], lastScore: { right: 3, of: 5 } }`, and `paths.a1` is the file path.
    - `a hand-edited artifact with junk still loads`: `type: "poster"` loads as `flashcards` with its body kept, and a missing `made_from` gives `[]`.
    - `a new artifact is written to Artifacts/`: `planSync` after `addArtifact` gives one `write` op with `create: true` and path `Artifacts/<stamp> <sanitized title>.md`. Its text has header keys `id, title, type, made_from, created, updated, parts, source_bytes`, plus `made_in` and `last_score` when set.
    - `scoring rewrites only that file` (`create: false`, `base` = version).
    - `deleting trashes it`.
    - `unknown header keys are written back` (`tags` survives, using `extraMeta` the same way sources do).
    - `nothing nested`: `Artifacts/sub/x.md` is not loaded as an artifact and not as a page.
  - In `StudyProvider.test.jsx`: a folder that has only `Artifacts/` counts as having content (follow the existing chats case).
- [ ] **Step 2: Run the three test files.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Copy the chat code at each step:
  - `artifactFrom(file)` sits next to `chatFrom`.
  - The `parts[0] === ARTIFACTS_DIR` branch sits next to the `CHATS_DIR` branch.
  - Add the artifact case to `fileText`, using `clean(...)` for the optional keys.
  - Add `listOps(prev.artifacts ?? [], next.artifacts ?? [], (a) => \`${ARTIFACTS_DIR}/${stampName(a.created || Date.now())} ${sanitizeName(a.title)}.md\`)`.
  - Keep extra header keys using the same rule as `SOURCE_KEYS`.
  - Update the "throw" message in `fileText` to name artifacts too.
- [ ] **Step 4: Run the three test files**, plus `data/vaultSync.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): keep artifacts in the Study folder`.

### Task 3: Every note, split into parts that fit

**Files:**
- Create: `artifacts/notes.js`
- Modify: `chats/chatService.js` (export the existing `cutToBytes` and add `export const byteLength = bytes`, with no other change)
- Test: `artifacts/notes.test.js`

**Interfaces:**
- Consumes: `pagesInside` and `allPages` (`data/tree.js`), `pageMarkdown` (`data/vaultState.js`), `ChatError`, `cutToBytes` and `byteLength` (`chats/chatService.js`).
- Produces:
  - `gatherFull(state, ids: string[]) → Note[]`, where `Note = { id, title, markdown }`.
  - `splitIntoParts(notes: Note[], room: number) → Part[]`, where:
    - `Part = { text: string, pieces: Piece[] }`;
    - `Piece = { noteId, title, k, n, markdown }`;
    - `text` is the pieces in order, each written as `"## [[<title>]]\n<markdown>\n"`, or `"## [[<title>]] (part k of n)\n<markdown>\n"` when `n > 1`.
  - `MIN_ROOM = 512`.

- [ ] **Step 1: Write the failing tests.**
  - `gatherFull`:
    - takes a page whole (longer than 2 KB, no cut);
    - takes a subject as every page in `pagesInside` order, each whole;
    - takes a source as `{ id, title, markdown: content }`;
    - includes the same page once, even when it's listed and also inside a listed subject;
    - skips unknown ids.
  - `packs small notes in order into one part`: 3 notes of 100 bytes with `room` 2048 give 1 part with 3 pieces, all with `n === 1`.
  - `no part is larger than room`: for random notes and each `room` in `[8192, 24576, 49152]` minus 1500, every `byteLength(part.text) <= room`.
  - `loses nothing`: for each note, joining `pieces.filter(p => p.noteId === id).sort(by k).map(p => p.markdown)` gives back `note.markdown` exactly. Run it on random Markdown, on a 100 KB note with no blank lines and no newlines made of `"é🙂a"` repeated, and on real-ish notes with headings.
  - `splits at a heading when one fits`: a note `"# A\n" + 3000 bytes + "\n## B\n" + 3000 bytes` with `room` 4096 gives a second piece starting `"## B"`. It falls back to a blank line, then a line break.
  - `labels pieces`: a note split into 3 pieces gives headers `(part 1 of 3)` through `(part 3 of 3)`.
  - `room too small`: `splitIntoParts(notes, 511)` throws a `ChatError` with code `"too-long"`.
  - `a very long title is cut in the header only`: a title of 1000 bytes is headed with at most 200 bytes, and `pieces[].title` stays whole.
- [ ] **Step 2: Run** `npx vitest run src/views/studyhome/artifacts/notes.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement `artifacts/notes.js`.** Pieces are consecutive slices of the note, so joining them gives it back exactly. The algorithm the tests don't fully fix:

```js
// For a note that doesn't fit an empty part: cut it into slices of at most
// `limit` bytes, where limit = room - bytes of the worst-case header
// "## [[<title≤200B>]] (part 9999 of 9999)\n" - 1 (the closing "\n").
// The cut point in the next `limit` bytes of what's left, in this order:
// the last "\n#" (cut before the "#"), the last "\n\n" (cut after it), the
// last "\n" (cut after it), else cutToBytes(rest, limit).length.
// Never cut at 0: if the best point is 0, use the next rule.
// Small notes pack into the current part while they fit; a note that fits
// an empty part but not the current one starts a new part; pieces of a split
// note each fill a part, and the next notes may pack after the last piece.
```
- [ ] **Step 4: Run the test again.** Expected: PASS. Also run `chats/chatService.test.js`, which must still PASS.
- [ ] **Step 5: Commit** `feat(artifacts): gather whole notes and split them into parts`.

### Task 4: One way to send, and the `useMakeArtifact` hook

**Files:**
- Modify: `chats/chatService.js` (`createChatService` returns `{ send, ask }`, and `ask` calls `send`)
- Modify: `StudyPreview.jsx:229-241` (add `local: settings.ai.model === "local"` to `chatApi`)
- Create: `artifacts/maker.js` (this task covers only the prompt and the single-part path; Task 5 adds parts)
- Create: `artifacts/useMakeArtifact.js`
- Create: `artifacts/links.js`
- Test: `chats/chatService.test.js`, `artifacts/maker.test.js`, `artifacts/links.test.js`, `artifacts/useMakeArtifact.test.jsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `service.send(prompt: string) → Promise<string>`. It throws the same `ChatError` codes `ask` throws today: `offline`, `ai-auth`, `ai-unavailable` and the local codes.
  - `TARGETS = { flashcards: { per: 400, min: 3, max: 15 }, slides: { per: 800, min: 2, max: 10 }, quiz: { per: 600, min: 2, max: 8 } }`
  - `targetFor(type, partBytes) → number`: `Math.round(partBytes / per)`, clamped to min and max.
  - `buildArtifactPrompt({ type, partText, part, of, topic, made: string[], target }) → string`
  - `fixedPromptBytes(type, topic) → number`: the prompt's bytes with an empty `partText` and the full 1024-byte `made` allowance.
  - `createArtifactMaker({ send }) → { make({ type, notes, topic, memory, onProgress?, signal? }) → Promise<{ title, items, parts, sourceBytes }> }`
  - `artifactLink(artifact) → string`: `[[artifact:<id>|<Label> · <Title>]]`, with `|`, `[` and `]` in the title replaced by `-`.
  - `splitArtifactLinks(text) → Array<string | { id, label }>`
  - `useMakeArtifact() → { make({ type, ids, topic, madeIn }) → Promise<string | null>, busy: boolean, progress: { part, of } | null, error: string | null, cancel(): void, clearError(): void }`. It resolves to the new artifact's id, or null on failure or cancel.

- [ ] **Step 1: Write the failing tests.**
  - `chatService.test.js`:
    - `send returns the output`;
    - `send maps errors like ask` (offline, `ai-auth`, unavailable, local).
    - The existing `ask` tests stay as they are.
  - `maker.test.js`:
    - `prompt names the format, target and topic`: `buildArtifactPrompt` for quiz contains `- [x]`, `"about 5"`, the topic and `partText`.
    - `one part`: with a fake `send` that returns a valid 3-card body headed `# Krebs`, `make({ type: "flashcards", notes: [smallNote], topic: "", memory: "normal" })` resolves to `{ title: "Krebs", items.length: 3, parts: 1, sourceBytes: byteLength(note) }`, and `send` was called once.
    - `retries once`: `send` returns junk first, then a valid body, so it makes 2 calls. The second prompt contains `"Question 1 has no correct answer."`.
    - `fails after one retry`: junk twice rejects with `ChatError` code `artifact-unreadable` and message `"Kratt couldn't make these questions. Try again."` (`"…these cards…"` for flashcards, `"…these slides…"` for slides).
    - `send errors pass through`.
    - `title falls back to chatTitle(topic)`, or to the first note's title when there's no topic.
  - `links.test.js`:
    - `artifactLink({ id: "a1", type: "slides", title: "Cells | intro" })` gives `"[[artifact:a1|Slides · Cells - intro]]"`;
    - `splitArtifactLinks("See [[artifact:a1|Slides · X]] now")` gives `["See ", { id: "a1", label: "Slides · X" }, " now"]`;
    - plain `[[Page]]` links are left as text.
  - `useMakeArtifact.test.jsx` (render inside `renderWithProvider(fakeClient(SAMPLE_SNAPSHOT))` with a stub `ShellContext`, and set `client.notebookAsk` to return a valid body):
    - `make saves an artifact and returns its id` with `madeFrom = ids` and `madeIn` as passed;
    - `error is set and nothing saved on failure`;
    - `unmount mid-make saves nothing and warns nothing`.
- [ ] **Step 2: Run the four test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`send`:** move the try/catch from `ask` into `send(prompt)`, and have `ask` call it.
  - **Maker:**
    - For flashcards and quiz, remove a leading `# Title` line before parsing.
    - The retry prompt is the same prompt plus `"\n\nYour last answer had these problems:\n- …\nAnswer again, in exactly the format above."`.
    - Give the prompt this shape:

```text
<INSTRUCTIONS>
Make <type label lowercase> from the notes below, in exactly this format:
<format spec + two-item example for the type>
Make about <target> <item word>. Cover everything in these notes.
[Part <k> of <n>. Don't repeat these, already made: <made, one per line>]
Topic: <topic or the notes' titles>
# Notes
<partText>
```
  - **Hook:**
    - It builds `createChatService({ client, address: () => shell.chat?.address, local: () => shell.chat?.local })` once per client.
    - It calls `gatherFull(state, ids)`, then `maker.make(...)`, then `actions.addArtifact(...)`.
    - It keeps an `AbortController` per make, aborts on unmount and on `cancel()`, and ignores results after abort (the same `asked` counter idea as AskKratt).
    - A non-`ChatError` is logged and shows `CHAT_MESSAGES["app-error"]`.
- [ ] **Step 4: Run the four test files**, plus `chats/ChatPanel.test.jsx` and `views/AskKratt.test.jsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): make an artifact through Kratt's send path`.

### Task 5: Parts, joining, progress and cancel

**Files:**
- Modify: `artifacts/maker.js`
- Test: `artifacts/maker.test.js`

**Interfaces:**
- Consumes: `splitIntoParts`, `MIN_ROOM` (Task 3), `MEMORY` (`chats/chatService.js`).
- Produces: `make` handles any number of parts. Each make sets `room = MEMORY[memory ?? "normal"] - fixedPromptBytes(type, topic)`.

- [ ] **Step 1: Write the failing tests.**
  - `every part is sent`: notes of 60 KB at `memory: "short"` send `parts.length` prompts in order, each prompt's `byteLength` is at most `MEMORY.short`, and the result has `parts === n`.
  - `nothing is left out`: the `partText` of every prompt, joined in order, contains every note's markdown (rebuild it the same way as Task 3's test, from the `pieces` that `splitIntoParts` gives for the same `room`).
  - `target scales with the part`: a 4000-byte part asks for "about 10" cards, and a 200-byte part asks for "about 3".
  - `later parts list what's made`: prompt 2 contains part 1's card fronts, and a `made` list over 1024 bytes keeps the newest entries.
  - `joining removes duplicates`:
    - cards with fronts `"Krebs cycle"` and `" krebs  CYCLE "` are kept once, the first one;
    - quiz questions are deduped the same way;
    - slides: part 2's first slide titled like the artifact title is dropped.
  - `a failing part stops everything`: part 2 junk twice rejects with `"Kratt couldn't make part 2 of 3 of these cards. Try again."`.
  - `progress`: `onProgress` is called with `{ part: 1, of: 3 }`, then `{ part: 2, of: 3 }`, then `{ part: 3, of: 3 }`.
  - `cancel`: aborting during part 2 rejects with `ChatError` code `"cancelled"`, and part 3 is never sent.
  - `Review Focus 1`: a 100 KB note of `"é🙂a"` at `"short"` resolves (with a fake `send` that answers 3 cards every time), and every prompt is at most 8192 bytes.
- [ ] **Step 2: Run the file.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the loop in `make`. Check `signal?.aborted` before each `send` and after each answer.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): make every part, join them, report progress`.

### Task 6: Flashcards viewer and the shared viewer keys

**Files:**
- Create: `artifacts/viewers/useViewerKeys.js`
- Create: `artifacts/viewers/FlashcardsViewer.jsx`
- Create: `artifacts/artifacts.css` (viewer and card styles, `--st-*` only)
- Test: `artifacts/viewers/FlashcardsViewer.test.jsx`

**Interfaces:**
- Consumes: `motionReduced` (`motion.js`).
- Produces:
  - `useViewerKeys(ref, keyMap: Record<string, () => void>)`. It listens on `ref.current` and on `window` while `ref` is shown. It ignores events whose target is an `input`, a `textarea`, `[contenteditable]` or inside `[role="menu"]`, and events with `defaultPrevented` or Ctrl/Meta/Alt held. Keys are matched by `e.key` (`"ArrowLeft"`, `" "`, `"f"`).
  - `<FlashcardsViewer items onFinish={({ right, of }) => void} />`.
  - A viewer root carries `className="st-viewer"` and an `aria-live="polite"` `.sr-only` status.

- [ ] **Step 1: Write the failing tests:**
  - `shows the first front and "1 / 3"`;
  - `Space, Enter or a click flips; the status says "Back"`;
  - `→ and ← move`, and `←` on the first card stays;
  - `Got it (g) and Again (a) only after a flip`; each moves on;
  - `summary at the end: "2 got, 1 again"`; `onFinish({ right: 2, of: 3 })` is called once;
  - `Go through the 1 again` shows only the missed card, and `onFinish` is not called again for that pass;
  - `Shuffle keeps every card`;
  - `reduced motion uses a crossfade`: with `.study[data-reduce-motion]`, the card has `data-motion="fade"`;
  - `Review Focus 2`: a key event from an `<input>` inside the viewer's parent does nothing.
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement.** The card's front and back are Markdown rendered with markdown-it (`html: false`). The flip uses a CSS transform under `[data-motion="flip"]` and an opacity change under `[data-motion="fade"]`.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): flashcards viewer`.

### Task 7: Slides viewer

**Files:**
- Create: `artifacts/viewers/SlidesViewer.jsx`
- Test: `artifacts/viewers/SlidesViewer.test.jsx`

**Interfaces:**
- Consumes: `useViewerKeys` (Task 6).
- Produces: `<SlidesViewer items />`.

- [ ] **Step 1: Write the failing tests:**
  - `shows slide 1 title and "1 / 4"`;
  - `→, Space, PageDown and a click go forward; ←, PageUp go back`; it stops at the ends;
  - `status announces "Slide 2 of 4: <title>"`;
  - `Review Focus 4`: a slide body `<img src=x onerror="alert(1)"><script>x</script>` renders as text, with no `img` and no `script` element in the DOM.
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use a 16:9 frame (`aspect-ratio: 16 / 9`) scaled to the space with `max-width`/`max-height`. Render each slide body with markdown-it `{ html: false, linkify: false }`.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): slides viewer`.

### Task 8: Quiz viewer

**Files:**
- Create: `artifacts/viewers/QuizViewer.jsx`
- Test: `artifacts/viewers/QuizViewer.test.jsx`

**Interfaces:**
- Consumes: `useViewerKeys` (Task 6).
- Produces: `<QuizViewer items onFinish={({ right, of }) => void} />`.

- [ ] **Step 1: Write the failing tests:**
  - `click or 1–9 picks; the answer shows "Right" or "Not quite" plus why`; the choices lock after the pick;
  - `Enter or Next goes on only after a pick`;
  - `score at the end "3 of 5"`; `onFinish({ right: 3, of: 5 })` is called once;
  - `Retry the wrong ones` asks only those, and `onFinish` is not called for the retry;
  - `Start over` resets;
  - `the right choice is marked for screen readers` (`aria-describedby` / status text).
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): quiz viewer`.

### Task 9: Artifact tab, header and full mode

**Files:**
- Create: `artifacts/ArtifactView.jsx`
- Create: `artifacts/FullMode.jsx`
- Create: `artifacts/madeFrom.js`
- Modify: `shell/tabs.js` (`tabIdOf`, `exists` and the top comment; `artifact:<id>`)
- Modify: `StudyPreview.jsx` (route `artifact`, and `labelOf` → the artifact title)
- Test: `artifacts/ArtifactView.test.jsx`, `artifacts/madeFrom.test.js`, `shell/tabs.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 and 6–8; `Dialog` and `Choice` (`dialogs/Dialog.jsx`).
- Produces:
  - `madeFromChips(state, ids) → Array<{ id, label, kind: "page" | "subject" | "source" | "missing" }>`.
  - `coverageLine(artifact) → string`: `"Made from 3 notes · all of them, in 5 parts"`, or `"… · all of it"` when there is 1 note and 1 part.
  - `<ArtifactView id />`.
  - `<FullMode onClose>{children}</FullMode>`.
  - Route `{ view: "artifact", id }`.

- [ ] **Step 1: Write the failing tests.**
  - `tabs.test.js`:
    - `tabIdOf({ view: "artifact", id: "a1" }) === "artifact:a1"`;
    - `sanitizeTabs` drops `artifact:gone` and keeps `artifact:a1`.
  - `madeFrom.test.js`: chips for a page, a subject, a source and a missing id (label `"deleted note"`), plus `coverageLine` for both cases.
  - `ArtifactView.test.jsx` (full app with a snapshot that has one artifact of each type):
    - `opens the right viewer for the type`;
    - `chips open the page, subject or source`;
    - `Made in opens the chat` (`shell.chat.open`), and is hidden when that chat is gone;
    - `rename saves` with `renameArtifact`;
    - `Delete asks first, then deletes and closes the tab`;
    - `finishing a quiz or a flashcards pass saves last_score` (a planSync write);
    - `a broken hand-edited body shows "2 items couldn't be read"` and the usable items; with none usable it shows the notice and the raw text in a `<pre>`;
    - `Try again` makes a new artifact from the same `madeFrom` and opens it, and the old one stays;
    - **Full mode:**
      - `F enters full mode` (a `dialog` named after the artifact, inside `.study`), and `document.documentElement.requestFullscreen` is called when present;
      - `Esc leaves`;
      - `Esc with an open menu closes only the menu`;
      - `a refused requestFullscreen (rejects) still shows the overlay`;
      - `fullscreenchange to no element closes the overlay`.
- [ ] **Step 2: Run the three test files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`FullMode`:** portal into `document.querySelector(".study") ?? document.body` with `role="dialog" aria-modal="true"`, focus moved inside and given back on close. It calls `el.requestFullscreen?.()` and catches errors, and calls `document.exitFullscreen?.()` on close if `document.fullscreenElement`.
  - **Header:** title input (`TitleInput` style), type label, chips, `coverageLine`, Made-in, Full screen, Try again (`useMakeArtifact`, then `shell.open({ view: "artifact", id })`), and Delete (`Dialog` + `Choice`).
- [ ] **Step 4: Run the three test files**, plus `shell/TabBar.test.jsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): artifact tab with header and full mode`.

### Task 10: Artifacts in the sidebar, the Artifacts view and its setting

**Files:**
- Create: `sidebar/ArtifactsSection.jsx`
- Create: `artifacts/ArtifactsView.jsx`
- Create: `artifacts/icons.js` (`TYPE_ICONS = { flashcards: Layers, slides: Presentation, quiz: ListChecks }`)
- Modify: `sidebar/Sidebar.jsx` (render under `ChatsSection` when `sections.artifacts !== false`)
- Modify: `shell/tabs.js` (add `"artifacts"` to `FIXED`)
- Modify: `StudyPreview.jsx` (route `artifacts`, `VIEW_TITLES.artifacts = "Artifacts"`)
- Modify: `useSettings.js:37` (`sidebar: { chats: true, artifacts: true, review: true, pinned: true }`)
- Modify: `settings/LayoutSection.jsx:136` (an `Artifacts` toggle after `Chats`)
- Test: `artifacts/ArtifactsView.test.jsx`, `sidebar/Sidebar.test.jsx` (or the existing sidebar test file), `vaultSettings.test.jsx`

**Interfaces:**
- Consumes: `relativeTime` and `msOf` (`chats/summary.jsx`), `pagesInside`, `TYPE_LABELS`, `itemCount`.
- Produces: `<ArtifactsSection />` and `<ArtifactsView />` (a region named "Artifacts").

- [ ] **Step 1: Write the failing tests.**
  - **Sidebar:**
    - `shows the 3 newest with type icons`;
    - `"No artifacts yet" when empty`;
    - `See all opens the Artifacts view`;
    - `a row opens the artifact tab`;
    - `hidden when Settings > Layout > Artifacts is off`.
  - **Settings:** a saved `layout.sidebar: { chats: false }` from before still shows Artifacts, so the default merges in. If the merge in `useSettings` is shallow for `sidebar`, add the key in `settings/upgrade.js` and test that instead.
  - **Artifacts view:**
    - `lists all, newest first`, each with title, made-from names (the first 2, then `+N`), date and `"3 of 5"` when scored;
    - `type filter`;
    - `subject filter`, which matches a page inside the subject, the subject itself, and a source whose `subjects` includes it;
    - `title search`;
    - `empty state with Kratt`.
- [ ] **Step 2: Run the files.** Expected: FAIL.
- [ ] **Step 3: Implement.** Copy `ChatsSection` and `ChatsView`, with their classes and layout.
- [ ] **Step 4: Run the files**, plus `chats/ChatsView.test.jsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): Artifacts in the sidebar and their own view`.

### Task 11: New artifact dialog

**Files:**
- Create: `artifacts/NewArtifactDialog.jsx`
- Create: `artifacts/MakeProgress.jsx` (`"Making part 2 of 5…"` plus Cancel; `"Kratt is making your cards…"` when `of === 1`; Kratt in mode `think`)
- Modify: `artifacts/ArtifactsView.jsx` (a New artifact button)
- Test: `artifacts/NewArtifactDialog.test.jsx`

**Interfaces:**
- Consumes: `useMakeArtifact` (Task 4), `Dialog` (`dialogs/Dialog.jsx`), the DropdownMenu note picker pattern from `ChatPanel.jsx:279-290` (subjects, pages, and here also sources).
- Produces: `<NewArtifactDialog onClose />` and `<MakeProgress progress onCancel />`.

- [ ] **Step 1: Write the failing tests:**
  - `Make is disabled until a type and at least one note are picked`;
  - `making shows progress and opens the new artifact` with `madeIn: null`;
  - `Cancel stops it and saves nothing`;
  - `errors show in the dialog with Try again`;
  - `closing the dialog mid-make saves nothing`.
- [ ] **Step 2: Run the file.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): new artifact dialog`.

### Task 12: Artifacts in Kratt Chat

**Files:**
- Create: `artifacts/intent.js`
- Create: `artifacts/ArtifactCard.jsx` (icon, title, `itemCount`, Open; `"Artifact deleted"` for an unknown id)
- Modify: `chats/ChatPanel.jsx` (a Make ▾ menu next to the quick prompts; `renderTurn` splits Kratt text with `splitArtifactLinks`; the offer button)
- Test: `artifacts/intent.test.js`, `chats/ChatPanel.test.jsx`

**Interfaces:**
- Consumes: `useMakeArtifact`, `artifactLink`, `splitArtifactLinks`, `MakeProgress`.
- Produces:
  - `wantsArtifact(question) → "flashcards" | "slides" | "quiz" | null`. It needs a verb (make|create|generate|give me|turn … into) and a noun (flashcards?|flash cards?|cards → flashcards; slides?|deck|presentation → slides; quiz|quizzes → quiz), case-insensitive.
  - `<ArtifactCard id />`.

- [ ] **Step 1: Write the failing tests.**
  - `intent.test.js`:
    - matches "Make me flashcards on this", "can you create a slide deck", "give me a quiz", "turn this into flash cards";
    - doesn't match "what are slides in biology", "quiz me on this" (the existing quick prompt stays a normal question), or "I made cards yesterday".
  - `ChatPanel.test.jsx`:
    - `Make ▾ → Flashcards adds a Kratt turn "Here are your flashcards: [[artifact:…]]" shown as a card`;
    - `the card opens the artifact tab`;
    - `with no chat yet, Make creates the chat first`;
    - `a question asking for slides gets the "Make this as slides" button under the answer, and nothing is made until it's clicked`;
    - `a card for a deleted artifact says "Artifact deleted"`;
    - `Make is disabled while busy or offline`;
    - `opening another chat mid-make saves nothing into the new chat` (`Review Focus 5`);
    - the existing chat tests still pass.
- [ ] **Step 2: Run both files.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The topic is `chat.title`, and the context is the chat's `context` ids. On success, call `actions.appendTurn(id, { who: "kratt", text: \`Here are your ${label.toLowerCase()}: ${artifactLink(a)}\` })`.
  - `citationsIn` already ignores `artifact:` links, so check that and don't change it.
- [ ] **Step 4: Run both files.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): make artifacts in Kratt Chat`.

### Task 13: Artifacts in notes: the /Kratt box, the "/" menu and links

**Files:**
- Modify: `views/AskKratt.jsx` (props `make?: type`; three Make buttons; inserting the link)
- Modify: `views/PageView.jsx:18-48` (`useAskKratt` keeps `{ editor, make }` from `e.detail`; `usePageLinks` opens `artifact:` hrefs)
- Modify: `src/editor/lib/slash-command.jsx:594-608` (three commands in the Kratt group: `Flashcards`, `Slides`, `Quiz`, with descriptions "Make flashcards from this note.", "Make slides from this note.", "Make a quiz from this note."; each sends `kratt:ask` with `{ editor, make: <type> }`)
- Test: `views/AskKratt.test.jsx`, `views/PageView.test.jsx`

**Interfaces:**
- Consumes: `useMakeArtifact`, `artifactLink`, `MakeProgress`, `insertAnswer` (already in `AskKratt.jsx`).
- Produces: `<AskKratt editor pageId make? onClose />`.

- [ ] **Step 1: Write the failing tests:**
  - `Make → Quiz in the /Kratt box inserts the artifact link where /Kratt was typed`, and the saved page Markdown contains `[[artifact:<id>|Quiz · …]]`; `madeIn` is `{ kind: "page", id }`;
  - `the typed text is the topic`;
  - `/Slides opens the box in make mode for slides` (dispatch `kratt:ask` with `make: "slides"`);
  - `clicking an artifact link in a note opens the artifact tab` (dispatch `lokus:open-file` with `"artifact:a1"`), and an unknown id opens nothing;
  - `closing the box mid-make saves nothing`;
  - the existing AskKratt question flow is unchanged.
- [ ] **Step 2: Run both files.** Expected: FAIL.
- [ ] **Step 3: Implement.** Insert with the existing `insertAnswer(editor, at, html)`, where `html` is a `<p>` whose content is the link Markdown turned into the wiki-link node HTML through `noteFileToHtml` (`src/core/markdown/noteFile.js`). Check that saving gives back the same `[[artifact:…|…]]`. Keep the `/Kratt` command and its copy as they are.
- [ ] **Step 4: Run both files**, plus `src/core/markdown/noteFile.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): make artifacts from notes`.

### Task 14: Find artifacts with Ctrl K

**Files:**
- Modify: `quickfind/builtinProviders.js` (an `artifacts` provider: group `"Artifacts"`, title, subtitle = type label, `run` opens `{ view: "artifact", id }`)
- Test: `quickfind/QuickFind.test.jsx`

- [ ] **Step 1: Write the failing test:** `finds an artifact by title and opens it`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artifacts): find artifacts with Ctrl K`.

### Task 15: Final check and docs

**Files:**
- Modify: `CLAUDE.md` (one "Rules that are easy to break" bullet for Artifacts: `Artifacts/` is a special folder like `Chats/`; artifacts are made only through `useMakeArtifact` → `chatService.send`; notes are split into parts and never cut; links are `[[artifact:<id>|…]]`)
- Modify: `~/Documents/Dev/Kratt/Kratt.md` (Now/Next, a few lines)

- [ ] **Step 1:** Run every test file one at a time: `for f in $(git ls-files 'src/**/*.test.*'); do npx vitest run "$f" || echo "FAIL $f"; done`. Expected: no `FAIL` lines.
- [ ] **Step 2:** Run `npm run build`. Expected: it exits 0.
- [ ] **Step 3:** Check in headless Chromium. Run `npm run dev` with the engine stubbed, or with a real engine if one is running. For one dark and one light style, open one artifact of each type, enter and leave full mode, and save screenshots to `$CLAUDE_JOB_DIR/tmp`. Check contrast and that the overlay follows the theme.
- [ ] **Step 4:** Commit `docs: artifacts in CLAUDE.md`, and update the Obsidian note.
