# Sources grouped by subject — design

Date: 2026-10-25 · Branch: `feat/source-subjects` · Status: approved in chat, awaiting spec review

## Goal

Opening Sources shows sources grouped by subject, like NotebookLM shows sources per notebook. Each
subject is a group that expands and collapses. A source can belong to several subjects without its
file being copied. Sources can be added to a subject, removed from one, and moved between subjects,
by dragging and from a menu. Sources with no subject show in an "Unsorted" group.

Decisions made with the user:
- Sources link to **subjects only** (top-level folders), not to folders inside a subject.
- A plain drag **moves** a source; **Ctrl or Alt + drop adds** it (same as pages in the sidebar).
- The group for sources without a subject is called **Unsorted** (as for pages).

Not in scope: the sidebar, pages, chats, the source detail view, the Add Source dialog (new sources
start in Unsorted), and memory-engine (it passes YAML headers through unchanged).

## How it works today

- Each source is `Sources/<title>.md` in the Study folder: YAML header (`id`, `title`, `type`,
  `url`, `file`, `use`, `created`, `updated`, PDF counts) and the extracted text as body. Uploaded
  originals sit in `Sources/files/`, referenced by `file:`.
- Subjects are top-level folders; a subject's id is its folder path (new in-app subjects keep a
  UUID until the next load).
- `stateFromSnapshot` (`data/vaultState.js`) reads `Sources/*.md` into a flat `state.sources`;
  `SourcesView.jsx` shows one sortable table. Nothing links sources to subjects.
- Pages already belong to several containers through an `also_in:` header list of folder paths,
  turned from ids into paths at write time. This design copies that pattern.

## Data model

### On disk

A source's header gains an optional list of subject folder names:

```yaml
subjects: [Ajalugu, Saksa keel]
```

- Written only when the list is not empty; a missing or empty list means Unsorted.
- The file stays in `Sources/`; nothing is duplicated.
- Existing files need no migration: without `subjects:` they load as Unsorted and are rewritten
  only when the user changes their subjects.

Rejected alternatives: a map in the layout file (link lives apart from the source and drifts when
files change outside the app; mixes data into view state) and copies/symlinks per subject folder
(duplication, fragile).

### In state

`source.subjects: string[]` — subject ids, in the order the user added them, no duplicates.
Always present after load (`[]` when none). The shape comment in `operations.js` is updated.

### Reading (`sourceFrom` / `stateFromSnapshot`)

`subjects` from the header is mapped to subject ids (top-level dirs that exist). Unknown names (a
subject renamed or deleted outside the app) and duplicates are dropped. Dropping on read does not
rewrite the file.

### Writing (`fileText` / `planSync`)

- `fileText` for a source takes the same `pathOf` used for pages and writes
  `subjects: source.subjects.map(pathOf)` when not empty.
- In `planSync`, `listOps` for sources compares `fileText(prev, id, 0, oldPathOf)` with
  `fileText(next, id, 0, pathAfter)`, so:
  - a source whose subjects changed is rewritten;
  - renaming a subject rewrites the header of every linked source in the same batch as the folder
    move;
  - a new in-app subject (UUID id) is written by its folder name;
  - sources that did not change are not rewritten.
- Writes keep `base: versions[id]`, so a file changed on disk meanwhile is kept, not overwritten.

### Operations (`data/operations.js`, pure functions)

| Function | Used by | Effect |
|---|---|---|
| `setSourceSubjects(state, id, subjectIds)` | Subjects… dialog | replace the list (filtered to existing subjects, de-duplicated) |
| `addSourceToSubject(state, id, subjectId)` | Ctrl/Alt drop, drop from Unsorted | append if missing |
| `removeSourceFromSubject(state, id, subjectId)` | menu, drop onto Unsorted | remove it |
| `moveSourceToSubject(state, id, fromId, toId)` | plain drop | remove `fromId`, add `toId` |

Each no-op returns the same `state` object (so `planSync` writes nothing). None of them touch
`updatedAt` — subject membership is organisation, not a content change. All are added to
`mutations` so `actions.*` exposes them.

Deleting a subject (`deleteSubjectKeepContents`, `deleteContainerAndContents`) also removes its id
from every `source.subjects`. Source files are never trashed because a subject went away.

## Sources screen

`SourcesView.jsx` is split so no file gets large: `SourcesView.jsx` (header, sort, empty state,
keyboard, dialogs), `SourceGroup.jsx` (one collapsible group and its drop target), `SourceRow.jsx`
(one row, drag source, menu), `SubjectsDialog.jsx` (checklist). Styles stay in `sources.css`.

- **Header** unchanged: "All sources", "New source", use-all tick. The empty state (no sources at
  all) is unchanged.
- **Sort** controls in one row at the top; the chosen sort applies inside each group.
- **Groups**, in sidebar subject order (`state.subjects`), then **Unsorted** last:
  - header: chevron, subject colour dot, name, count ("Keemia · 3"); click or Enter/Space toggles;
    `aria-expanded` set.
  - a subject with no sources shows with "Drag sources here" and is collapsed by default; others
    are open by default.
  - Unsorted shows only when it has sources.
  - collapse state per subject is kept in `localStorage` (key `kratt.sources.collapsed`), every
    read/write in try/catch; the screen works without it.
- **Rows** as today (tick, type, title/url, created, updated, delete) plus a **⋯** button. A source
  in two subjects appears in both groups; it is the same source, so "use" and delete affect both.
- **Drag** (HTML5 drag and drop, own MIME type so sidebar drops are not confused with it):
  - rows are draggable; a group (header or body) is a drop target and is highlighted while hovered;
  - plain drop → `moveSourceToSubject(from, to)`; Ctrl or Alt + drop → `addSourceToSubject`;
  - drag from Unsorted → always add;
  - drop onto Unsorted → `removeSourceFromSubject(from)` (no-op when dragged from Unsorted);
  - drop onto a group the source is already in → nothing.
- **Menu** (⋯ button and right-click, using `ui/context-menu`): Open, **Subjects…**, **Remove
  from <subject>** (only inside a subject group), Delete.
- **Subjects… dialog** (`LinkDialog` look, `st-pick-list`): every subject with its colour and a
  checkbox, Done applies `setSourceSubjects`; Cancel/Escape changes nothing. With no subjects yet
  it says so ("Make a subject in the sidebar first").
- **Toasts** after a drop or menu change: "Moved to Keemia", "Added to Keemia", "Removed from
  Keemia".
- **Keyboard**: arrow keys move through visible rows across groups (collapsed groups skipped);
  Enter opens the selected row, as today.

## Errors and edge cases

- Write failure or version conflict: handled by the existing sync queue and vault banner.
- Subject renamed in the app: linked headers rewritten (see Writing).
- Subject renamed or deleted outside the app: the source shows as Unsorted on next load; its file is
  left untouched until the user changes it. Same limitation as pages' `also_in`.
- Subject deleted in the app: link removed, source kept.
- Unknown or duplicate names in `subjects:`: dropped on read.

## Data safety

- Before the first run against real data: `tar czf ~/Study-backup-2026-10-25.tar.gz -C ~ Study`.
- Browser checks run against a copy of the Study folder, never `~/Study`.
- Work happens in worktree `apps/study/.claude/worktrees/source-subjects`; `apps/study` main and
  its uncommitted changes are not touched.

## Testing

Vitest, run file by file (the full suite has random 10 s timeouts).

- `data/operations.test.js`: each new function (incl. no-op returns same state), subject delete
  clears links in both delete variants.
- `data/vaultState.test.js`: read `subjects:` (missing, unknown, duplicate); write it; omitted when
  empty; subject rename rewrites only linked sources; unchanged source not rewritten; new in-app
  subject written by name; old file without `subjects:` loads as Unsorted and is not rewritten.
- `sources/SourcesView.test.jsx` (new): groups in subject order, Unsorted last/hidden, collapse and
  its persistence, multi-subject source in two groups, Subjects… dialog, Remove from, drop = move,
  Ctrl+drop = add, drop onto Unsorted, drop onto own group = nothing.
- `npm run build`.
- Headless Chromium against a copy of the Study folder: drag, Ctrl+drag, menu, and the resulting
  headers in the copied `Sources/*.md`.

## Merge note

`feat/sidebar-moves` adds ~33 lines to `operations.js` (additions only); expect a small, easy
conflict in the `mutations` list if both merge.
