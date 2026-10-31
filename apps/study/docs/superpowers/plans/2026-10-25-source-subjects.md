# Sources Grouped by Subject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Sources screen shows sources in collapsible groups per subject (plus Unsorted); a source can be in several subjects, and is moved/added/removed by drag and by a menu.

**Architecture:** Each source's YAML header gets an optional `subjects:` list of subject folder names; in state it is `source.subjects` (subject ids). Pure operations change the list; `vaultState.js` reads it and writes it through the same id→path mapping pages use for `also_in`. A pure `sources/groups.js` decides grouping and what a drop does; the view is split into `SourcesView` / `SourceGroup` / `SourceRow` / `SubjectsDialog`.

**Tech Stack:** React 19, Vite, Vitest 3 + Testing Library (jsdom), js-yaml, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-25-source-subjects-design.md` (read it with this plan).

All paths below are relative to the worktree root
`/home/caesarsta/Downloads/KRATT/apps/study/.claude/worktrees/source-subjects`; `SH` = `src/views/studyhome`.

## Global Constraints

- Sources link to **subjects only** (top-level), never folders inside a subject.
- Plain drop **moves**; **Ctrl or Alt** + drop **adds**; from Unsorted always adds; onto Unsorted removes from the group dragged from; onto a group already containing it does nothing.
- Header key is exactly `subjects`, a list of subject folder names, written only when not empty.
- Membership changes never change `updatedAt`.
- Deleting a subject never deletes a source; it only removes the link.
- Group label for no subjects: **Unsorted**. Toast copy: `Moved to <name>`, `Added to <name>`, `Removed from <name>`. Empty group hint: `Drag sources here`. Dialog with no subjects: `Make a subject in the sidebar first`.
- Collapse state: `localStorage` key `kratt.sources.collapsed`, every access in try/catch.
- Run test files one at a time (`npx vitest run <file>`); the full suite has random 10 s timeouts.
- Never run the app or browser checks against `~/Study`; only against a copy.
- Out of scope: sidebar, pages, chats, SourceView, AddSourceDialog (except new sources get `subjects: []`), engine.

## Review Focus

1. Deleting a source shown in two groups deletes it everywhere — the delete dialog must say so (`It is also in <other subjects>.`) so the user doesn't think they're removing it from one subject. Test in Task 5.
2. A source in two subjects renders as two rows: React keys and keyboard/hover selection must be per row instance (`<groupId>:<sourceId>`), so hovering one copy doesn't highlight the other. Test in Task 4.
3. Collapsing the group that holds the selected row must not leave Enter opening an invisible row; selection clamps to visible rows. Test in Task 4.
4. A drag that ends without a drop (Escape, dropped outside) must clear the drag state and highlight, so the next plain hover doesn't show a drop target. Test in Task 5.
5. Renaming a source (title change via `updateSource`) keeps its subjects in the rewritten header. Test in Task 2.

---

### Task 1: Membership operations

**Files:**
- Modify: `SH/data/operations.js` (Sources section ~line 203, `dropNodes` ~line 39, `addSources`, `mutations`)
- Test: `SH/data/operations.test.js`

**Interfaces:**
- Produces (all `(state, …) => state`, returning the **same** `state` object on a no-op, and exposed via `mutations` so `actions.<name>(…)` works):
  - `setSourceSubjects(state, sourceId, subjectIds: string[])` — keep only ids in `state.subjects`, de-duplicated, in given order.
  - `addSourceToSubject(state, sourceId, subjectId)` — append if missing and `subjectId` is a subject.
  - `removeSourceFromSubject(state, sourceId, subjectId)`
  - `moveSourceToSubject(state, sourceId, fromId, toId)` — remove `fromId`, add `toId`.
  - `addSources` gives each new source `subjects: []`.
  - `dropNodes` (used by both subject-delete functions) removes gone ids from every `source.subjects`; sources not containing a gone id keep their object identity.

- [ ] **Step 1: Worktree setup.** `ln -s ../../../node_modules node_modules` in the worktree root (points at `apps/study/node_modules`). Check: `npx vitest run src/views/studyhome/data/operations.test.js` passes as-is.

- [ ] **Step 2: Write failing tests** in a new `describe("source subjects", …)` using `sample()` (`bio`, `chem`) plus `op.addSources(s, [{ type: "link", title: "L" }])`:
  - `new sources start with no subjects` → `sources[0].subjects` equals `[]`.
  - `adds a subject once` → add `bio` twice → `subjects` equals `[bio]`; second call returns the same object (`toBe`).
  - `ignores ids that are not subjects` → `addSourceToSubject(s, id, cells)` returns `s` (`toBe`); `setSourceSubjects(s, id, [bio, "nope", bio, chem])` → `[bio, chem]`.
  - `moves between subjects` → after add `bio`, `moveSourceToSubject(s, id, bio, chem)` → `[chem]`.
  - `removes a subject` → `[bio, chem]` minus `bio` → `[chem]`; removing a missing one returns the same state.
  - `membership changes keep updatedAt` → `updatedAt` unchanged after add/move/remove/set.
  - `deleting a subject keeps its sources and drops the link` → for both `deleteSubjectKeepContents(s, bio)` and `deleteContainerAndContents(s, bio)`: source still present, `subjects` equals `[chem]` (was `[bio, chem]`).
  - `renaming a source keeps its subjects` → `updateSource(s, id, { title: "New" }).sources[0].subjects` equals `[bio]`.

- [ ] **Step 3: Run** `npx vitest run src/views/studyhome/data/operations.test.js` → new tests FAIL (functions undefined).

- [ ] **Step 4: Implement** the five changes above in `operations.js`; update the Sources shape comment to include `subjects: [subject ids]`. Add the four new names to `mutations` next to `deleteSource`.

- [ ] **Step 5: Run** the same file → all PASS.

- [ ] **Step 6: Commit** `git add src/views/studyhome/data/operations*.js && git commit -m "feat(sources): subject membership operations"`

---

### Task 2: Read and write `subjects:` in the Study folder

**Files:**
- Modify: `SH/data/vaultState.js` (`sourceFrom` ~72, its call ~154, `fileText` source branch ~280, `listOps` ~415–437)
- Test: `SH/data/vaultState.test.js`

**Interfaces:**
- Consumes: Task 1's `mutations.addSourceToSubject`, `setSourceSubjects`, `rename` (existing).
- Produces: after `stateFromSnapshot`, every source has `subjects: string[]` (subject ids = top-level folder paths). `fileText(state, id, now, pathOf)` writes `subjects: source.subjects.map(pathOf)` for sources when not empty (key placed right after `file`), omitted when empty.

- [ ] **Step 1: Write failing tests** (build variants of the file's `snapshot` with a helper `withSubjects(list)` that sets `s1.meta.subjects`; the unchanged `snapshot`, whose `s1` has no `subjects`, is the "old file" case):
  - `reads a source's subjects` → snapshot with `s1.meta.subjects: ["Biology", "Gone", "Biology"]` → `state.sources[0].subjects` equals `["Biology"]`.
  - `an old source without subjects is Unsorted and isn't rewritten` → `s1.subjects` equals `[]`; `planSync(state, mutations.setContent(state, "p1", "<p>x</p>"), paths).ops` has no op with `id: "s1"`.
  - `adding a subject rewrites only that source` → `addSourceToSubject(state, "s1", "Biology")` → exactly one op: `{ op: "write", id: "s1", path: "Sources/Lecture.md", create: false, base: "v4" }`, text matches `/\nsubjects:\n\s*- Biology\n/`.
  - `removing the last subject drops the key` → from a snapshot with `subjects: ["Biology"]`, `setSourceSubjects(state, "s1", [])` → write whose text does not contain `subjects:`.
  - `renaming a subject rewrites its linked sources` → snapshot with `s1.meta.subjects: ["Biology"]`, `mutations.rename(state, "Biology", "Bio")` → ops include the folder `move` and a write for `s1` whose text matches `/- Bio\n/` and not `/- Biology/`.
  - `a new subject is written by its folder name` → `addSubject` (name "Physics") then `addSourceToSubject(…, s1, newId)` → write text matches `/- Physics\n/`.
  - `renaming a source keeps its subjects` → snapshot with `subjects: ["Biology"]`, `updateSource(state, "s1", { title: "Talk" })` → write text matches both `/title: Talk/` and `/- Biology/`.

- [ ] **Step 2: Run** `npx vitest run src/views/studyhome/data/vaultState.test.js` → new tests FAIL.

- [ ] **Step 3: Implement.**
  - `sourceFrom(file, isSubject)` adds `subjects`: header list → `String`s → keep those where `isSubject(name)` (a top-level dir that exists, i.e. `nodes[name]?.type === "subject"`) → de-duplicate. Always set (`[]` when none) — note `clean()` keeps arrays.
  - `fileText` source branch: pass `pathOf` through for `subjects`.
  - `listOps` for sources gets the path mappings: compare `fileText(prev, id, 0, (x) => paths[x])` with `fileText(next, id, 0, pathAfter)`, and create-writes use `pathAfter` too. The identity shortcuts (`prevList === nextList`, `before.get(id) === item`) must not skip a source that has subjects — a subject rename changes its text without changing the source object. Quick notes and chats keep today's behaviour.

- [ ] **Step 4: Run** `vaultState.test.js`, then `vaultSync.test.js` and `operations.test.js` → all PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(sources): keep source subjects in the Study folder"`

---

### Task 3: Grouping, drop rules and collapse storage (pure)

**Files:**
- Create: `SH/sources/groups.js`
- Test: `SH/sources/groups.test.js`

**Interfaces:**
- Consumes: state shape; `UNSORTED` from `../data/tree`.
- Produces:
  - `sourceGroups(state, compare) -> Array<{ id, name, color, sources }>`: one per `state.subjects` id in that order (`name`/`color` from the node, `sources` = those whose `subjects` include it, sorted by `compare`), then `{ id: UNSORTED, name: "Unsorted", color: undefined, sources }` for sources with no subjects — only when non-empty.
  - `dropAction(state, sourceId, fromId, toId, copy: boolean) -> { type: "move"|"add"|"remove"|"none", subjectId?, fromId? }` per Global Constraints (`remove` carries `subjectId: fromId`; `add`/`move` carry `subjectId: toId`).
  - `dropMessage(action, state) -> string | null`: `Moved to <name>` / `Added to <name>` / `Removed from <name>`; `null` for `none`.
  - `COLLAPSED_KEY = "kratt.sources.collapsed"`, `readCollapsed() -> Record<string, boolean>` (`{}` on missing/invalid/throwing storage), `writeCollapsed(map)` (swallows errors), `isCollapsed(map, group) -> boolean` = `map[group.id] ?? group.sources.length === 0`.

- [ ] **Step 1: Write failing tests:**
  - `groups follow subject order with Unsorted last` → subjects `[A, B]`, sources: x in `[B]`, y in `[A, B]`, z in `[]` → ids `[A, B, UNSORTED]`; `A.sources` = `[y]`; `B.sources` contains x and y.
  - `no Unsorted group when every source has a subject`.
  - `empty subjects still get a group` → `sources: []`.
  - `dropAction` table: same group → none; to a group it's already in → none; from UNSORTED to A → add A; from A to UNSORTED → remove A; UNSORTED to UNSORTED → none; A to B plain → move (fromId A, subjectId B); A to B with copy → add B.
  - `dropMessage` → `"Moved to B"`, `"Added to B"`, `"Removed from A"`, `null`.
  - `collapse storage survives broken storage` → `localStorage.getItem` throwing → `readCollapsed()` equals `{}`; invalid JSON → `{}`; `writeCollapsed` with throwing `setItem` doesn't throw.
  - `isCollapsed defaults` → empty group true, non-empty false, explicit map value wins.

- [ ] **Step 2: Run** `npx vitest run src/views/studyhome/sources/groups.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** `groups.js`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/views/studyhome/sources/groups* && git commit -m "feat(sources): grouping and drop rules"`

---

### Task 4: Grouped Sources screen (groups, rows, collapse, keyboard)

**Files:**
- Create: `SH/sources/SourceGroup.jsx`, `SH/sources/SourceRow.jsx`
- Modify: `SH/sources/SourcesView.jsx`, `SH/sources/sources.css`
- Test: `SH/sources/SourcesView.test.jsx` (new)

**Interfaces:**
- Consumes: Task 3 (`sourceGroups`, `readCollapsed`, `writeCollapsed`, `isCollapsed`); existing `SORTS`, `TYPE_NAMES`, `titleOf`, `ago` stay exported from `SourcesView.jsx` (SourceView imports them).
- Produces:
  - `SourceGroup({ group, collapsed, onToggle, children, dropProps, over })` — header `<button aria-expanded>` with chevron, colour dot (`style={{ background: group.color }}`, none for Unsorted), name and count as `"<name> · <n>"`; body hidden when collapsed; empty body text `Drag sources here`. The group root is a `section` with `aria-label={group.name}`; `dropProps` are spread on it (Task 5 fills them; here `{}`).
  - `SourceRow({ source, groupId, selected, onHover, onDelete, menuItems, dragProps })` — today's row cells plus a ⋯ `Menu` (from `../sidebar/Menu`, label `More for <title>`) after delete; `menuItems` empty in this task.
  - Layout: header and use-all tick as today; one shared sort header row (`SortHeader` buttons) above the groups; each group renders a table with today's columns.

- [ ] **Step 1: Write failing tests.** Harness: `installMemoryLocalStorage()`; render `<StudyProvider client={fakeClient(SNAP)}><ShellContext.Provider value={{ open, toast }}><SourcesView /></ShellContext.Provider></StudyProvider>` (see `views/PageView.test.jsx` for the provider pattern), `open`/`toast` are `vi.fn()`. `SNAP`: folders `Biology`, `Chemistry`, `Physics`, `Sources`, layout `subjects: [Biology, Chemistry, Physics]`; sources `s1` "Lecture" `subjects: [Biology, Chemistry]` updated `2026-10-03`, `s2` "Notes" `subjects: [Biology]` updated `2026-10-02`, `s3` "Loose" no subjects updated `2026-10-01`. With the default sort (updated, newest first) the visible rows are Biology: Lecture, Notes · Chemistry: Lecture · Unsorted: Loose.
  - `shows a group per subject in subject order, Unsorted last` → section labels in order `Biology, Chemistry, Physics, Unsorted`; headers read `Biology · 2`, `Chemistry · 1`, `Physics · 0`.
  - `a source in two subjects shows in both groups` → `within(Biology)` and `within(Chemistry)` each have "Lecture".
  - `empty subject starts collapsed with a hint` → Physics header `aria-expanded="false"`; after click, `Drag sources here` visible.
  - `collapsing hides rows and is remembered` → click Biology header → "Notes" gone; unmount, re-render → still collapsed; `localStorage.getItem("kratt.sources.collapsed")` contains `"Biology":true`.
  - `hover selects one row instance` (Review Focus 2) → hover Lecture in Chemistry → only that row has `data-selected`.
  - `Enter opens the selected visible row after collapsing` (Review Focus 3) → hover Notes in Biology, collapse Biology, press Enter → `open` called with a visible source (`s1` from Chemistry), never `s2`.
  - `ArrowDown walks across groups` → first row selected on load; ArrowDown ×3 then Enter → `open({ view: "source", id: "s3" })`; ArrowDown ×2 from the start → Enter opens `s1` (the Chemistry copy).
  - Existing behaviour: `ticking use still works` (`setSourcesUse` via checkbox) and `no sources shows the empty state`.

- [ ] **Step 2: Run** `npx vitest run src/views/studyhome/sources/SourcesView.test.jsx` → FAIL.
- [ ] **Step 3: Implement.** Selection is a row key `"<groupId>:<sourceId>"` over the flat list of visible rows (collapsed groups skipped); if the selected key disappears, select the first visible row. Collapsed map in state initialised from `readCollapsed()`, written on toggle. Styles: reuse `st-src-*` table classes; add `st-src-group`, `st-src-group-head`, `st-src-group-empty`, `[data-over]` highlight using existing tokens (`--st-accent`, `--st-line-strong` if present, else `--st-line`).
- [ ] **Step 4: Run** the test file and `src/views/studyhome/StudyPreview.test.jsx` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(sources): group the Sources screen by subject"` (add new files first).

---

### Task 5: Drag, menu, Subjects dialog and toasts

**Files:**
- Create: `SH/sources/SubjectsDialog.jsx`
- Modify: `SH/sources/SourcesView.jsx`, `SH/sources/SourceRow.jsx`, `SH/sources/SourceGroup.jsx`, `SH/sources/sources.css`
- Test: `SH/sources/SourcesView.test.jsx`

**Interfaces:**
- Consumes: Task 1 actions (`actions.moveSourceToSubject`, `addSourceToSubject`, `removeSourceFromSubject`, `setSourceSubjects`); Task 3 `dropAction`, `dropMessage`; `useShell().toast(text)`.
- Produces:
  - Drag state in `SourcesView`: `dragging: { id, from } | null`. Rows: `draggable`, `onDragStart` sets it and `e.dataTransfer?.setData("application/x-study-source", id)`, `effectAllowed = "copyMove"`; `onDragEnd` clears it. Groups: `onDragOver` → `preventDefault` + `over` only when `dropAction(...).type !== "none"` (copy = `e.ctrlKey || e.altKey`); `onDragLeave` clears `over`; `onDrop` runs the action, toasts `dropMessage`, clears drag state.
  - `SubjectsDialog({ sourceId, onDone })` — `Dialog` titled `Subjects for "<title>"`, `st-pick-list` of every subject (colour dot + name + checkbox, initially ticked per `source.subjects`), buttons Cancel and Done; Done → `actions.setSourceSubjects(sourceId, ticked)`; with no subjects shows `Make a subject in the sidebar first` and only a Close button.
  - Row menu items (⋯ `Menu` and right-click `ContextMenu` from `../ui/context-menu`, same list): `Open`, `Subjects…`, `Remove from <group name>` (only when `groupId !== UNSORTED`; toasts `Removed from <name>`), `Delete`.
  - Delete dialog (Review Focus 1): when the source has 2+ subjects, add `It is also in <names of its other subjects, comma-separated>.` ("other" = every subject except the group the Delete was chosen from).

- [ ] **Step 1: Write failing tests** (same harness and SNAP):
  - `dropping moves a source` → `fireEvent.dragStart(Notes row in Biology)`, `fireEvent.dragOver(Chemistry section)`, `fireEvent.drop(Chemistry section)` → Biology no longer has Notes, Chemistry has it; `toast` called with `"Moved to Chemistry"`.
  - `Ctrl+drop adds` → same with `fireEvent.drop(section, { ctrlKey: true })` → Notes in both; toast `"Added to Chemistry"`. (If jsdom drops `ctrlKey` on drag events, create the event with `createEvent.drop` and `Object.defineProperty(event, "ctrlKey", { value: true })`.)
  - `dropping from Unsorted adds` → Loose to Physics → Loose in Physics, Unsorted group gone.
  - `dropping onto Unsorted removes from the group dragged from` → Notes from Biology onto Unsorted → Notes in Unsorted only.
  - `dropping onto a group it is in does nothing` → Lecture (Biology) onto Chemistry → no toast, `section` never gets `data-over`.
  - `a cancelled drag leaves no drop target` (Review Focus 4) → dragStart, dragOver Chemistry, `fireEvent.dragEnd(row)` → no section has `data-over`; a later `dragOver` without dragStart sets none.
  - `Subjects… sets the checked subjects` → open ⋯ on Loose, click `Subjects…`, tick Biology and Physics, Done → Loose in Biology and Physics.
  - `Remove from only appears in a subject group` → ⋯ on Loose (Unsorted) has no `Remove from`; ⋯ on Lecture in Chemistry → `Remove from Chemistry` → Lecture only in Biology; toast `"Removed from Chemistry"`.
  - `deleting warns about other subjects` → Delete on Lecture in Biology → dialog text contains `It is also in Chemistry.`
  - `Subjects dialog without subjects` → SNAP with no subject folders → `Make a subject in the sidebar first`.

- [ ] **Step 2: Run** the test file → new tests FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `SourcesView.test.jsx`, `groups.test.js`, `StudyPreview.test.jsx`, `sources/readPdf.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(sources): drag, menu and Subjects dialog"` (add `SubjectsDialog.jsx` first).

---

### Task 6: Full verification against a copy of the Study folder

**Files:** none changed unless a check fails (fix in the owning task's files, with a test).

- [ ] **Step 1: Back up** the real folder: `tar czf ~/Study-backup-2026-10-25.tar.gz -C ~ Study && tar tzf ~/Study-backup-2026-10-25.tar.gz | grep -c .` → non-zero count.
- [ ] **Step 2: Every test file**, one at a time: `for f in $(git ls-files 'src/**/*.test.js*'); do npx vitest run "$f" >/dev/null 2>&1 || echo "FAIL $f"; done` → no `FAIL` lines (re-run a file once if it timed out; a repeat failure is real).
- [ ] **Step 3: Build:** `npm run build` → exits 0.
- [ ] **Step 4: Browser check on a copy.** `cp -a ~/Study $CLAUDE_JOB_DIR/tmp/Study-copy`; start the engine against it (`~/Downloads/KRATT/engine/.venv/bin/memory-engine serve --folder $CLAUDE_JOB_DIR/tmp/Study-copy`, only if port 5057 is free — otherwise stop and ask) and this worktree's `npm run dev` on port 1420 (only if free). In headless Chromium: open Sources, drag the Napoleon source onto Ajalugu, Ctrl+drag onto Saksa keel, collapse Ajalugu and reload, use Subjects… to untick Saksa keel. Check the copy's `Sources/*.md` header after each step (`subjects:` list as expected; body and other keys unchanged), and that `~/Study/Sources/*.md` is byte-identical to before (`cmp`).
- [ ] **Step 5: Commit** any fixes; then update `~/Documents/Dev/Kratt/Kratt.md` Now (branch, commit, test/build results, next: try by hand and merge) and Decisions (`subjects:` header list for source↔subject, drag moves / Ctrl adds).
