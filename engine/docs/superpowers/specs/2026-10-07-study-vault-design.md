# Study Vault: the study app's pages as Markdown files (design)

Piece 1 of 3 for connecting the study app (`lokus/src/views/studyhome/`) to the self-hosted memory engine (`memory-engine/`). The order is Vault, then FSRS memory, then Build from a goal (user decision, 2026-10-07). Each piece gets its own spec, plan and review.

## Decisions so far (from the user)

- **Self-hosted LLMs only.** No Claude, no cloud AI, no Obsidian-style redesign. The graph stays the Lokus graph the app already has.
- **Pages become real Markdown files** in a Study folder the student can change (decided 2026-10-05: "A Study folder you can change", "Real Markdown", "Update live", "Quiet retries, warn only if work is at risk").
- **File access goes through the local engine:** a small memory-engine service that the app uses in the browser preview and the desktop app alike. Chosen as the most token-efficient option with no loss in experience.
- **The folder mirrors the app.** Subjects and folders are real folders, and a page is one `.md` file. Order and colors live in a hidden `.study` folder.
- **Section 1 below was approved in chat.** Everything marked *Proposed* still needs the user's review in this spec.

## Goals and non-goals

**Goals:**
- Every subject, folder, page, quick note and source lives as files in the Study folder.
- The app reads and writes them through the service, and shows changes made on disk (by the local AI later, or by hand) without a reload.
- Nothing typed is ever lost.

**Not in this piece:**
- the FSRS memory (piece 2);
- building from a goal with the local model (piece 3);
- a search box;
- any change to the graph's lines or look;
- Lokus's main app, whose own save path still writes HTML into `.md` (a TODO there, which stays untouched).

## Section 1: How it fits together (approved)

- **The service:**
  - `memory-engine serve` runs a local web service on `127.0.0.1:5057`. It is reachable only from this computer and doesn't clash with Open Notebook (5055, 8502) or Lokus (3333, 3456).
  - It answers only the study app: requests whose `Origin` isn't the app (`http://localhost:1420`, `tauri://localhost`, `http://tauri.localhost`) are refused, so another web page can't touch the files.
  - It is the only writer of the Study folder. Writes are atomic, as in the engine, and only paths inside the folder are accepted.
- **What the app asks it for:**
  - the whole tree, read from the files;
  - one file's Markdown;
  - save, create, rename and move;
  - delete, which moves the file into `.study/trash/`;
  - a live stream of file changes.
- **Inside the app:**
  - Only `data/StudyProvider.jsx` changes its storage: `localStorage` is replaced by the service.
  - The state logic in `data/operations.js` stays as it is.
  - Each page, quick note and source gets a fixed `id:` in its YAML header, so renames don't break recent pages, the graph, or the FSRS memory later.
- **Markdown, not HTML:**
  - The editor reads Markdown through Lokus's own converter (`src/core/markdown/compiler.js`, already used when the editor is given non-HTML content).
  - For saving, the app converts the editor's HTML to Markdown with the `turndown` library (new dependency), with rules for `[[links]]` and task lists.
- **First start:** whatever is in browser storage (`study-app-data-v1`) is written into the Study folder once. After that, browser storage only keeps a safety copy of unsaved typing.
- **Starting it:** `start.fish` starts the service next to Open Notebook. If the service isn't running, the app says so plainly instead of acting empty.

## Section 2: The folder and its files (layout approved; details *Proposed*)

```
Study/
├── Biology/                 subject
│   ├── Cell metabolism/     folder
│   │   ├── Krebs cycle.md   page
│   │   └── Glycolysis.md
│   └── Photosynthesis.md
├── Unsorted/
│   └── Loose idea.md
├── Quick notes/
│   └── 2026-10-07 15-32.md
├── Sources/
│   ├── Krebs lecture.md     extracted text + YAML
│   └── files/
│       └── Krebs lecture.pdf
└── .study/                  hidden
    ├── layout.json          subject order and colors, child order, expanded folders, recent pages
    └── trash/               deleted files, with their old paths
```

- **Page:** YAML `id`, `title`, `created`, `updated`, plus `also_in` (other folders the page is shown in) and `mastery` only when set. The Markdown body follows.
  - The file name follows the title when the page is renamed in the app.
  - A file renamed by hand keeps its `id`, so it stays the same page.
  - A `.md` file without an `id` (made by hand or by the AI) gets one the first time the service reads it.
- **Subject or folder:** a real folder. Subject colors and the order of children live in `.study/layout.json`. Folders the layout doesn't mention are listed after the known ones, alphabetically.
- **Quick note:** `Quick notes/<date time>.md` with YAML `id` and `created`, then the text.
- **Source:** `Sources/<title>.md` with YAML `id`, `type` (link, file or text), `url` or `file`, `use`, `created`, `updated` and, for PDFs, `pages` / `read_pages` / `truncated`. The extracted text follows. The original file is copied into `Sources/files/`.
- **Names:**
  - Characters that file systems refuse (`/ \ : * ? " < > |` and control characters) are replaced by `-` in file names; the YAML title keeps the real name.
  - Two pages with the same name in one folder get ` (2)`, ` (3)` and so on.

## Section 3: Live updates and edit clashes (*Proposed*)

- **Watching:** the service looks at the folder's files once a second (modification time and size, no new dependency). It sends events (`added`, `changed`, `removed`) on `GET /events` (server-sent events). The app updates the tree, the graph and an open page from them.
- **Versions:** every read returns the file's version (a content hash). Every save sends the version it was based on.
- **A clash** happens when the file changed on disk after the app read it, and the page also has unsaved typing. In that case:
  - the student's text is saved;
  - the disk version is kept next to it as `<title> (from disk <date time>).md`;
  - a small notice says so.
  - Nothing is ever silently overwritten.
- **No unsaved typing:** the page simply reloads with the disk version.

## Section 4: Saving safety (*Proposed*)

- **Saving:** typing saves after 800 ms of quiet.
- **Safety copy:** until the service confirms a save, the unsaved text is also kept in browser storage, so a crash or closed tab loses nothing; it is offered back on the next start.
- **Retries:**
  - Failed saves retry quietly with a growing wait (1 s, 2 s, 5 s, then every 10 s).
  - The app warns only when work is at risk: unsaved for over 30 s, or the service unreachable. The warning says what to do, for example ``Start the study service: `memory-engine serve` ``.
- **Changing the Study folder:**
  - Settings gets a "Study folder" field (default `~/Study`). Changing it asks the service to switch.
  - The service creates the folder if needed and remembers the choice in `~/.config/memory-engine/study.json` for its next start.
  - Switching to a folder with no pages offers to copy the current pages over.

## Section 5: Testing (*Proposed*)

- **Engine** (`pytest`, temporary folders, a real HTTP client against the service):
  - Origin refusal;
  - paths that leave the folder;
  - atomic writes;
  - trash;
  - name clashes;
  - `id` assignment;
  - events for changes made by hand;
  - version clashes;
  - folder switching.
- **App** (`vitest`, with a fake service):
  - the first-start import;
  - saving with retries and the safety copy;
  - clash handling;
  - events updating the tree;
  - HTML ↔ Markdown round trips for headings, lists, task lists, `[[links]]`, code, tables and links.
- **Real browser:** start the service and the dev server, then check `http://localhost:1420/?view=study-preview` with headless Firefox screenshots. Then edit a file by hand and confirm the page and graph update.

## Open questions for the user

None blocking. Every *Proposed* item above has a default chosen; change any of them in review.
