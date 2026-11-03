# Artifacts: flashcards, slides and quizzes Kratt makes

Date: 2026-10-24 · Branch: `feat/artifacts` · App: `apps/study`

## Goal

Kratt can turn notes into study material, called **artifacts**: flashcards, slides and quizzes. You can make one anywhere Kratt writes: Kratt Chat, the /Kratt box in a note, the note "/" menu and the Artifacts view. Every artifact is kept in one **Artifacts** place next to Chats. It opens in a viewer that follows the theme and has a **full mode** (full screen). Each artifact remembers the notes it was made from and where it was made.

## Decisions made while brainstorming

- **Full mode** means a full-screen viewer.
- **Types in v1** are flashcards, slides and quiz.
- **Scores** stay on the artifact (`last_score`). Mastery, review scheduling and the graph are not touched.
- **Triggers:** explicit Make actions everywhere, plus a "Make this as …" offer when a chat question asks for one in words.
- **Storage:** Markdown files in `Artifacts/`, made through the same engine call as chat (approach A). JSON files and the engine's Marp pipeline were rejected for v1.
- **Nothing is left out because of the context window.** Notes that don't fit in one prompt are split into parts, every part is sent, and the results are joined. An artifact is saved only when every part worked.
- There is no artifact editor in the app. Files can be edited by hand.

## Out of scope

Mastery and review changes, engine changes, the Marp render check, an in-app editor, more artifact types, and exporting (PDF or .pptx).

## 1. Storage and data model

`Artifacts/` is a fourth special folder next to `Chats/`, `Sources/` and `Quick notes/` (`SPECIAL_DIRS` in `data/vaultState.js`). Each artifact is one file, `Artifacts/<stamp> <title>.md`, and the code follows the chat code at every step:

- `stateFromSnapshot` reads files at `Artifacts/<file>` (one level deep only) into `state.artifacts`, newest `updated` first.
- `fileText` writes the header and body.
- `planSync` adds `listOps(prev.artifacts, next.artifacts, …)` with the same path rule as chats. Renaming keeps the path, as it does for chats.
- The `StudyProvider` "has data" check counts `state.artifacts`, and `Artifacts` is added to the special-folder list next to it.
- `EMPTY_STATE.artifacts = []`.

Header:

```yaml
id: <newId>
title: Photosynthesis
type: flashcards            # flashcards | slides | quiz
made_from: [<ids>]          # page, subject and source ids
made_in: { kind: chat, id: <chat id> }   # kind: chat | page; optional
created: <iso>
updated: <iso>
last_score: { right: 7, of: 10, at: <iso> }   # optional
parts: 5                    # how many parts the notes were split into
source_bytes: 61234         # bytes of notes the artifact covers (all of them)
```

State shape: `{ id, title, type, madeFrom: string[], madeIn: {kind,id}|null, created, updated, lastScore: {right,of,at}|null, items }`. An unknown `type` loads as `flashcards`, and its body is kept.

### Body formats (`artifacts/format.js`)

`parseArtifact(type, body)` turns a body into `items`, and `formatArtifact(type, items)` turns items back into a body. Both treat `\r\n` as `\n`. Text is never dropped: text before the first item goes into the first item. Formatting what was parsed gives back the same items.

- **Flashcards:** each `### <front>` starts a card, and the text under it is the back. Items are `{ front, back }`.
- **Slides:** slides are split by lines that are exactly `---`. The first `# ` line of a slide is its title, and the rest is Markdown. Items are `{ title, body }`. This works with Marp.
- **Quiz:** each `### <question>` starts a question, followed by `- [ ] choice` / `- [x] choice` lines and an optional `> why` line. Items are `{ question, choices: [{text, right}], why }`.

`problemsIn(type, items)` lists what makes an artifact unusable: no items, a card with an empty front or back, or a quiz question without exactly one right choice and at least two choices. It returns plain sentences such as "Question 3 has no correct answer."

### Operations (`data/operations.js`)

`addArtifact(state, { id, title, type, madeFrom, madeIn, items, now })`, `renameArtifact`, `recordScore(state, id, { right, of, now })` and `deleteArtifact`. Each returns new state, as the chat operations do, and sorts newest first.

### Links back to the source

`madeFrom` ids are shown as chips. Pages and subjects resolve through `state.nodes`, and sources through `state.sources`. An id that no longer resolves shows a muted "deleted note" chip, and the artifact stays. `madeIn` opens the chat (`shell.chat.open`) or the page (`node:<id>`). If the chat or page is gone, the link is hidden.

## 2. Making artifacts

### Maker (`artifacts/maker.js`)

`createArtifactMaker({ client, address })` returns `make({ type, context, topic, memory })`, which resolves to `{ title, items }`.

- **Nothing is left out.** An artifact covers every byte of every note it is made from. Nothing is cut to fit Chat memory: no "half the budget" rule, no 2 KB start of each subject page, and no item that is skipped because it doesn't fit. Notes that don't fit in one prompt are split into **parts** (below), and Kratt makes items for each part.
- **Notes gathered (`gatherFull(state, ids)` in `artifacts/notes.js`):** a page gives all of its Markdown. A subject gives every page inside it in full, in tree order (`pagesInside`). A source gives its full `content`. Each note is `{ title, markdown }`. The same note reached twice (a page and its subject) is included once. `chatService.js` is not changed.
- **Parts (`splitIntoParts(notes, room)` in `artifacts/notes.js`):** `room` is the Chat memory budget (`MEMORY[memory]`) minus the fixed prompt (instructions, format, example, topic). Notes are packed in order into parts of at most `room` bytes, each part headed `## [[Title]]`. A note larger than `room` is split into consecutive pieces at the last heading that fits, then the last blank line, then the last line break, and as a last resort at a character boundary (`cutToBytes`). Each piece is headed `## [[Title]] (part k of n)`. Joining the pieces gives back the note exactly. A pure test checks this for every note: the parts together hold every byte of the input once, in order. If even an empty part doesn't fit (`room` < 512 bytes), it throws `ChatError("too-long")`.
- **Prompt for each part:** Kratt's instructions, the exact body format for the type with a two-item example, the notes in this part, the topic (default: the notes' titles), and a target size for the part:
  - cards: 1 per 400 bytes, 3–15;
  - slides: 1 per 800 bytes, 2–10;
  - questions: 1 per 600 bytes, 2–8.

  It also says "this is part k of n; cover everything in it; don't repeat earlier parts". For part 2 and later, it lists the fronts, titles or questions already made (cut to fit, oldest first) so items don't repeat. There is no cap on the total, so a big subject makes a big artifact.
- **Joining the parts:** items are joined in part order. Flashcards with the same front and quiz questions with the same text (ignoring case and spaces) are kept once. Slides: only part 1 may start with a title slide, and later title slides are dropped.
- **Sending:** each part goes through `client.notebookAsk(address(), prompt)`, one at a time. Errors map exactly as in `createChatService`: offline, `ai-auth` and `ai-unavailable`.
- **Parse and retry, for each part:** the part's answer is parsed with `parseArtifact`. If `problemsIn` finds problems, Kratt gets one retry for that part with the problems listed. If the retry also fails, the make stops with `ChatError("artifact-unreadable", "Kratt couldn't make part k of n of these <type>. Try again.")`. Nothing is saved: a saved artifact always covers all its notes.
- **Progress and cancel:** `make` takes `onProgress({ part, of })` and an `AbortSignal`. When there is more than one part, wherever you made it shows "Making part 2 of 5…" with **Cancel**. Cancelling stops after the current request and saves nothing.
- **Coverage on the artifact:** the header records `parts: <n>` and `source_bytes: <total bytes of notes used>`. The viewer header shows "Made from 3 notes · all of them, in 5 parts".
- **Title:** the first `# ` line of part 1's answer if there is one, otherwise `chatTitle(topic)`.

The caller saves the artifact with `actions.addArtifact` and then shows or inserts the link.

### Link syntax

`[[artifact:<id>|<Type> · <Title>]]` is used in chat turns and in notes. It uses the id, so renames don't break it.

### Triggers

- **Kratt Chat (`ChatPanel.jsx`):** a "Make ▾" dropdown (Flashcards / Slides / Quiz) next to the quick prompts. It is disabled while busy or offline. It uses the chat's context ids, and the topic is the chat title. On success it adds a Kratt turn: `Here are your <type>: [[artifact:…]]`. `madeIn` is the chat. With no chat yet, it creates one first, the same way `sendQuestion` does.
- **Asking in words:** `wantsArtifact(question)` in `artifacts/intent.js` returns a type or null, from a pattern of a make/create/generate/give me verb plus flashcards/cards/slides/deck/presentation/quiz. Kratt answers normally, and the answer then shows a **Make this as <type>** button. Nothing is generated until it's clicked.
- **/Kratt box (`AskKratt.jsx`):** three Make buttons. The page is the context and the typed text is an optional topic. On success the link is inserted with `insertAnswer` where /Kratt was typed. `madeIn` is the page.
- **Slash menu:** `/Flashcards`, `/Slides` and `/Quiz` send `kratt:ask` with `{ make: <type> }`. `PageView` opens AskKratt in make mode for that type.
- **Artifacts view:** **New artifact** opens a small dialog: type, notes (the same picker as chat context, at least one required) and an optional topic. `madeIn` is null.

While making, Kratt shows his "think" animation. Each place runs one make at a time. A closed box or dialog ignores a late answer, using the same `asked` counter pattern as AskKratt.

## 3. Viewers and full mode

`artifact:<id>` becomes a tab kind. It needs changes in `shell/tabs.js` (`tabIdOf`, `exists`) and in the `StudyPreview` routing and tab titles. `sanitizeTabs` drops it once the artifact is deleted. `artifacts/ArtifactView.jsx` renders:

- **Header:** an editable title (`renameArtifact`), the type label, Made-from chips, the Made-in link, and buttons for Full screen, Try again and Delete (with a confirm). **Try again** makes a new artifact of the same type from the same `madeFrom` and opens it. The old one is kept.
- **Flashcards (`FlashcardsViewer.jsx`):** one card. Click, Space or Enter flips it. ← / → move between cards, with a "3 / 10" counter and Shuffle. After a flip, **Got it** (G) or **Again** (A) marks the card and moves on. At the end a summary shows "7 got, 3 again", with **Go through the 3 again** and **Start over**. `recordScore(right = got, of = total)` is saved once each full pass ends.
- **Slides (`SlidesViewer.jsx`):** one 16:9 slide, scaled to fit. ← / →, Space, PageUp/PageDown or a click move between slides, with a counter. Markdown is rendered with markdown-it `html: false, linkify: false`, as in AskKratt.
- **Quiz (`QuizViewer.jsx`):** one question. Clicking a choice or pressing 1–9 picks it. The answer then shows right or wrong plus the `why` line, then **Next** (Enter). At the end it shows the score with **Retry the wrong ones** and **Start over**. `recordScore` is saved after a full run, not after a retry.

**Full mode:** F or the Full screen button shows the viewer as a fixed overlay covering the window. It is rendered inside `.study` (with the same `rootFor` approach as editor popups) so the theme variables apply. It also calls `requestFullscreen()` on the overlay; if that fails or is refused, the overlay alone stays. Esc closes any open menu first, then leaves full mode (and leaves browser full screen if it was entered). If the browser leaves full screen by itself, the overlay closes too. The viewer keys work the same inside it.

**Theme and access:** viewers use only `--st-*` tokens and the existing fonts. When reduced motion is on (the system setting, or the app setting in `motion.js`), the flip becomes a crossfade and slides don't animate. Every control can be reached by keyboard and has a visible focus ring. Card side, slide number and quiz feedback are announced through an `aria-live="polite"` region.

## 4. The Artifacts place and the cards

- **Sidebar:** `sidebar/ArtifactsSection.jsx` goes right under `ChatsSection`. It has the heading "Artifacts" with a "See all" button (which opens the `artifacts` view) and shows the 3 newest artifacts. Each row has a type icon (Layers for flashcards, Presentation for slides, ListChecks for quiz), the title and a relative time. With no artifacts it says "No artifacts yet". It is shown when `sections.artifacts !== false`.
- **Setting:** `layout.sidebar.artifacts: true` in the defaults (`useSettings.js`), an "Artifacts" toggle in Settings > Layout next to "Chats", and an upgrade step that sets it to true for existing saved settings.
- **Artifacts view (`artifacts/ArtifactsView.jsx`):** `artifacts` joins `FIXED` in `shell/tabs.js`.
  - It lists every artifact, newest first. Each row shows the icon, title, made-from names (the first 2, then "+N"), date and last score.
  - Type filter: All / Flashcards / Slides / Quiz.
  - Subject filter: matches artifacts whose `madeFrom` includes the subject or a page inside it (`pagesInside`).
  - Title search, and the New artifact button.
  - The empty state has Kratt and a line on how to make one. The layout follows `ChatsView`.
- **Card in chat:** when `ChatPanel` renders a Kratt turn, it shows each `[[artifact:<id>|…]]` as a card with the icon, title, item count and Open (which opens the tab). An unknown id shows "Artifact deleted". The rest of the turn renders as it does now.
- **Card in notes:** the link stays the existing wiki-link node, labeled with its alt text. The wiki-link click handler sends targets starting with `artifact:` to `shell.open({ view: "artifact", id })`. An unknown id uses the existing missing-link style.
- **Find (Ctrl K):** artifacts are searchable by title, and a result opens the viewer tab.

## 5. Errors

| Case | What you see |
|---|---|
| Engine offline, down or wrong password | The existing `CHAT_MESSAGES` text, where you clicked Make |
| Prompt too long | The existing `too-long` message |
| A part's answer is unreadable after one retry | "Kratt couldn't make part k of n of these <type>. Try again." Nothing is saved |
| Make cancelled | Nothing is saved; the box or dialog goes back to its start |
| File edited by hand and now has problems | The viewer shows the usable items and a notice "N items couldn't be read". With no usable items, the notice plus the raw text |
| Artifact deleted while open | The tab closes (`sanitizeTabs`). Links show "Artifact deleted" |

## 6. Testing

Automated (vitest, jsdom):
- `artifacts/format.test.js`: each type round-trips and lost text is kept; `\r\n` files work; `problemsIn` catches each case.
- `artifacts/notes.test.js`: `gatherFull` includes subject pages and sources in full with no duplicates. `splitIntoParts` loses nothing: for random and real notes at each memory size, joining the parts in order gives back every note byte for byte. It also never makes a part over `room`, and splits at a heading or blank line when one fits.
- `artifacts/maker.test.js` (fake client): every prompt fits each memory size, every part is sent, the target size scales with the part, earlier items are listed for later parts, joining removes duplicates, a part's one retry then `artifact-unreadable` saves nothing, cancel works, progress is reported, errors map correctly, and the title is chosen correctly.
- `artifacts/intent.test.js`: matches and non-matches for each type.
- `data/vaultState.test.js` and `operations.test.js`: `Artifacts/` loads, and create, rename, score and delete produce the right write and trash ops.
- Viewer tests, one file per type plus `ArtifactView.test.jsx`: keys, flipping, marking, scoring and `recordScore`, entering and leaving full mode with Esc, the reduced-motion crossfade, and made-from chips including deleted ones.
- Tests added to the existing `ChatPanel`, `AskKratt`, `PageView`, `Sidebar`, `LayoutSection` and tabs tests for the new behavior only.
- Full `npm test` (file by file if the known 10 s timeouts appear) and `npm run build`.
- A headless Chromium check of the three viewers and full mode in one dark and one light style.

By hand: start the engine (`scripts/start.fish`), run `npm run dev` in `apps/study`, then:
1. Kratt Chat → Make → Flashcards; flip through the cards; press F, then Esc.
2. Try `/Slides` in a note.
3. Type "make me a quiz on this" in chat and click the offer.
4. Check the sidebar section, the Artifacts view filters and the made-from chips.
5. Switch styles and light/dark while a viewer is open.

## Before implementation

`apps/study` `main` has uncommitted engine-rename changes in `ChatPanel.jsx`, `chatService.js` and about 10 other files. Commit them first and rebase `feat/artifacts` onto that commit, so the artifact work starts from the renamed wording.
