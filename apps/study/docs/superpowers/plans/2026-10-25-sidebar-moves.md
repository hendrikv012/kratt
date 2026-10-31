# Sidebar moves, copy/paste and delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smooth drag and drop with a drop indicator in the sidebar tree, plus copy, paste and delete shortcuts that act on the selected row only while the tree has focus, rebindable in Settings > Shortcuts.

**Architecture:** New pure operations (`moveTo`, `moveSubject`, `duplicate`) in `data/operations.js`, and pure helpers for the tree's visible rows, drop placements and paste targets in `sidebar/`. `SubjectTree.jsx` gets one drag state for the whole tree (`useTreeDrag`) and roving-tabindex selection (`useTreeSelection`). Shortcuts are `BINDABLE` entries matched by a `keydown` listener on the tree element.

**Tech Stack:** React 19, Vite, Vitest + Testing Library (jsdom), plain CSS with `st-*` tokens, Playwright 1.48.2 via `npx` for the real-app check.

**Spec:** `docs/superpowers/specs/2026-10-25-sidebar-moves-design.md`

Work in `~/Downloads/KRATT/apps/study/.claude/worktrees/sidebar-moves` (branch `feat/sidebar-moves`). It has no `node_modules`: first run `ln -s ../../../node_modules node_modules` there, like the `tabbar` worktree. All paths below are relative to `src/views/studyhome/` unless they start with `src/` or `docs/`.

## Global Constraints

- Run test files one at a time: `npx vitest run <file>` (the full suite has random 10 s timeouts). `npm run build` must pass at the end.
- Operations stay pure `(state, ...) => state` or `=> { state, id }`, free of React and storage (see the header of `data/operations.js`). New ones are added to `mutations`.
- Shortcut ids and defaults: `sidebar.copy` "Copy the selected item" Ctrl+C; `sidebar.paste` "Paste a copy" Ctrl+V; `sidebar.delete` "Delete the selected item (asks first)" Ctrl+Delete; all `context: "Sidebar"`. `sidebar.deleteHovered` is removed; a saved binding under it carries over to `sidebar.delete`.
- Copy names: only the top copied item gets the suffix `" (copy)"`. Copied pages get `mastery: null`.
- Drop zones: container rows 25% / 50% / 25% (before / into / after); page rows 50% / 50%. Auto-expand after 600 ms. Auto-scroll within 32 px of the scroll area's edge. Dragged row opacity 0.4. Drop line 2 px accent.
- Toast texts: `Copied "<name>"`, and `The copied item was deleted`.
- Drag hint text: `Drop between items to move, onto a folder to put it inside. Hold Ctrl to also keep a page where it is.`
- Do not change the editor's wikilink click handling, the tab bar's `tabs.closeHovered`, or any unrelated feature.
- Code style: match the surrounding code (no semicolons removed or added, double quotes, short "why" comments above functions, as in `operations.js`).

## Review Focus

1. **A linked page dragged from the folder it is only linked into** should move only that listing; its home stays where it was. Pinned in Task 1 (`moveTo` keeps home when `fromId` is not home).
2. **Dropping a page onto a container that already lists it** (linked there) must show no indicator and do nothing. Pinned in Task 3 (`placementFor` returns null).
3. **Ctrl+C / Ctrl+V / Ctrl+Delete while renaming a row** must edit the name field, not copy, paste or delete the item. Pinned in Task 7.
4. **Pasting after the copied item was deleted** shows `The copied item was deleted` and changes nothing. Pinned in Task 7.
5. **Name-based wikilinks once page names exist twice after a copy.** The copy's links must point to the copies, and the *original's* links must still point to the originals; the graph draws both correctly. Pinned in Task 2 (`wikiTargets` on the copy and on the original, and same-subject preference in `resolveWikiHref`).

---

### Task 1: `moveTo` and `moveSubject`

**Files:**
- Modify: `data/operations.js` (after `move`; add both to `mutations`)
- Test: `data/operations.test.js`

**Interfaces:**
- Produces: `moveTo(state, id, fromId, toId, index) => state`, `moveSubject(state, id, index) => state`. `index` is the position in the target list *after* `id` is taken out of `fromId`.

- [ ] **Step 1: Write the failing tests** in a new `describe("moveTo and moveSubject")`, using `sample()`:

```js
it("moves into another list at a position", () => {
  const { s, bio, cells, notes } = sample();
  const next = op.moveTo(s, notes, bio, cells, 0);
  expect(next.nodes[cells].children[0]).toBe(notes);
  expect(next.nodes[bio].children).not.toContain(notes);
  expect(next.nodes[notes].home).toBe(cells);
  expect(next.expanded[cells]).toBe(true);
});
it("reorders within one list", () => {
  const { s, bio, cells, notes } = sample(); // bio.children = [cells, notes]
  expect(op.moveTo(s, notes, bio, bio, 0).nodes[bio].children).toEqual([notes, cells]);
});
it("moves a folder out to the subject's top level", () => {
  const { s, bio, cells, resp, notes } = sample();
  expect(op.moveTo(s, resp, cells, bio, 1).nodes[bio].children).toEqual([cells, resp, notes]);
});
it("refuses a folder into its own contents, and into a list that already has it", () => {
  const { s, bio, cells, resp, krebs } = sample();
  expect(op.moveTo(s, cells, bio, resp, 0)).toBe(s);
  const linked = op.link(s, krebs, bio);
  expect(op.moveTo(linked, krebs, resp, bio, 0)).toBe(linked);
});
it("moving a linked listing keeps the page's home", () => {
  const { s, bio, resp, krebs, chem } = sample();
  const linked = op.link(s, krebs, bio);
  const next = op.moveTo(linked, krebs, bio, chem, 0);
  expect(next.nodes[krebs].home).toBe(resp);
  expect(next.nodes[chem].children).toContain(krebs);
});
it("reorders subjects and ignores non-subjects", () => {
  const { s, bio, chem, notes } = sample();
  expect(op.moveSubject(s, chem, 0).subjects).toEqual([chem, bio]);
  expect(op.moveSubject(s, notes, 0)).toBe(s);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/data/operations.test.js`. Expected: FAIL, `op.moveTo is not a function`.

- [ ] **Step 3: Implement `moveTo` and `moveSubject`.** Same list: refuse only when `id` is not in it; otherwise splice. Different list: refuse when `!canPlace(state, id, toId)`. Clamp `index` to the list length. Update `home` and `expanded[toId]` as `move` does. Return the same `state` object for every refusal and for a no-op (same list, same index).

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit** — `git add src/views/studyhome/data/operations.* && git commit -m "feat(tree): move to a position, reorder subjects"`

### Task 2: `duplicate` with link rewriting

**Files:**
- Modify: `data/operations.js` (new section `// ---------- Copies`; add to `mutations`)
- Test: `data/operations.test.js`

**Interfaces:**
- Consumes: `foldersInside`, `homeOf`, `parentIndex`, `wikiTargets` from `data/tree.js`; `SUBJECT_COLORS`, `newId`.
- Produces: `duplicate(state, id, parentId, toId, index, { palette } = {}) => { state, id }`. For a subject, `toId` is `null` and `index` is the position in `state.subjects`. Returns `{ state, id: undefined }` unchanged-state for `UNSORTED` or a missing id.

- [ ] **Step 1: Write the failing tests** in `describe("duplicate")`. Build the link fixture with a page whose content has a wiki link by name: `op.setContent(s, notes, '<p><span data-type="wiki-link" target="Krebs" href="Krebs"></span></p>')`.

```js
it("copies a subject with everything inside, new ids, progress reset", () => {
  let { s, bio, krebs } = sample();
  s = op.setMastery(s, krebs, 0.8);
  const { state, id } = op.duplicate(s, bio, null, null, 1);
  expect(state.subjects[1]).toBe(id);
  expect(state.nodes[id].name).toBe("Biology (copy)");
  const copiedPages = pagesInside(state, id);
  expect(copiedPages).toHaveLength(2);
  expect(copiedPages.some((p) => p === krebs)).toBe(false);
  expect(copiedPages.map((p) => state.nodes[p].name).sort()).toEqual(["Krebs", "Notes"]);
  expect(copiedPages.every((p) => state.nodes[p].mastery === null)).toBe(true);
  expect(state.nodes[id].color).not.toBe(state.nodes[bio].color);
});
it("keeps order and nesting", () => {
  const { s, bio, cells } = sample();
  const { state, id } = op.duplicate(s, bio, null, null, 1);
  const names = (cid) => state.nodes[cid].children.map((c) => state.nodes[c].name);
  expect(names(id)).toEqual(["Cells", "Notes"]);
  const cellsCopy = state.nodes[id].children[0];
  expect(cellsCopy).not.toBe(cells);
  expect(names(cellsCopy)).toEqual(["Respiration"]);
  expect(names(state.nodes[cellsCopy].children[0])).toEqual(["Krebs"]);
});
it("a page only linked into the copied subject stays a link to the original", () => {
  let { s, bio, chem } = sample();
  const r = op.addChild(s, chem, "page", "Bonds");
  s = op.link(r.state, r.id, bio);
  const { state, id } = op.duplicate(s, bio, null, null, 2);
  expect(state.nodes[id].children).toContain(r.id);
  expect(state.nodes[r.id].home).toBe(chem);
});
it("points links between copied pages at the copies, keeping the label", () => {
  let { s, bio, notes, krebs } = sample();
  s = op.setContent(s, notes, '<p><span data-type="wiki-link" target="Krebs" href="Krebs"></span></p>');
  const { state, id } = op.duplicate(s, bio, null, null, 1);
  const notesCopy = state.nodes[id].children.find((c) => state.nodes[c].name === "Notes");
  const krebsCopy = pagesInside(state, id).find((p) => state.nodes[p].name === "Krebs");
  expect(wikiTargets(state, notesCopy)).toEqual([krebsCopy]);
  expect(state.nodes[notesCopy].content).toContain('alt="Krebs"');
  expect(wikiTargets(state, notes)).toEqual([krebs]); // original untouched
});
it("leaves links to pages outside the copy alone", () => {
  let { s, bio, notes, chem } = sample();
  const r = op.addChild(s, chem, "page", "Bonds");
  s = op.setContent(r.state, notes, '<p><span data-type="wiki-link" target="Bonds" href="Bonds"></span></p>');
  const { state, id } = op.duplicate(s, bio, null, null, 1);
  const notesCopy = state.nodes[id].children.find((c) => state.nodes[c].name === "Notes");
  expect(wikiTargets(state, notesCopy)).toEqual([r.id]);
  expect(state.nodes[notesCopy].content).toBe(state.nodes[notes].content);
});
it("copies a single page as 'Name (copy)' after it", () => {
  const { s, bio, cells, notes } = sample();
  const { state, id } = op.duplicate(s, notes, bio, bio, 2);
  expect(state.nodes[bio].children).toEqual([cells, notes, id]);
  expect(state.nodes[id]).toMatchObject({ name: "Notes (copy)", mastery: null, home: bio });
});
it("can paste a folder into itself without copying the copy", () => {
  const { s, bio, cells } = sample();
  const { state, id } = op.duplicate(s, cells, bio, cells, 99);
  expect(state.nodes[cells].children.at(-1)).toBe(id);
  expect(foldersInside(state, id)).toHaveLength(1); // only the copied Respiration
});
it("refuses Unsorted", () => {
  const { s } = sample();
  expect(op.duplicate(s, "unsorted", null, null, 0).state).toBe(s);
});
```

Import `foldersInside` from `./tree` at the top of the test file.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/data/operations.test.js`. Expected: FAIL, `op.duplicate is not a function`.

- [ ] **Step 3: Implement `duplicate`.** First collect everything from the original state: the containers (`[id, ...foldersInside(state, id)]`) and the pages whose `homeOf` is one of them. Then build an id map old → new, and only after that insert the top copy at `toId`/`index` (or into `subjects`). Containers' children map through the id map, and unmapped ids (linked pages) are kept as they are. Copied pages: `home` mapped, `mastery: null`, `pinned`/`recent` not copied. Subject color: same rule as `addSubject` with `palette ?? SUBJECT_COLORS`. Link rewriting in each copied page's `content`:

```js
// For each wiki-link element, resolve its target the way wikiTargets does (in the original
// state); if that page is in the id map, set href and target to the copy's id and, when
// there is no alt yet, alt to the original visible text (the old target).
```

Do it with one `replace` over `/<(a|span)\b[^>]*data-type="wiki-link"[^>]*>/g` and attribute rewrites. Resolution can reuse `wikiTargets` logic: factor the resolution in `tree.js` into an exported `resolveWikiHref(state, href, fromPageId) => id | undefined` that `wikiTargets` also uses. One change in behavior: when a *name* matches several pages, prefer the one whose `subjectOf` equals the linking page's subject, and otherwise the first match in `allPages` order. Before this change the last match won. Without the change, after a copy the original's `[[Krebs]]` would resolve to the copy. Add a test in `operations.test.js`: after duplicating Biology, `wikiTargets(state, notes)` is still `[krebs]` (the original). The "points links between copied pages at the copies" test above already asserts this on its last line.

- [ ] **Step 4: Run to verify they pass** — same command, plus `npx vitest run src/views/studyhome/data/graphData.test.js` if it exists (it uses `wikiTargets`). Expected: PASS.

- [ ] **Step 5: Check the file round trip.** Add a test to `data/vaultState.test.js`: a state after `duplicate` of a subject with a rewritten link, saved through the existing plan and read back with `stateFromSnapshot` (follow the round-trip helper that file already uses), keeps the copy's link pointing at the copy. Run `npx vitest run src/views/studyhome/data/vaultState.test.js`. Expected: PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat(tree): duplicate subjects, folders and pages, links follow the copies"`

### Task 3: Visible rows and drop placements (pure)

**Files:**
- Create: `sidebar/treeRows.js`, `sidebar/dropZone.js`
- Test: `sidebar/treeRows.test.js`, `sidebar/dropZone.test.js`

**Interfaces:**
- Consumes: `canPlace` from `data/operations.js`, `isContainer`, `UNSORTED`.
- Produces:
  - `visibleRows(state) => Row[]`, `Row = { key, id, parentId, depth, index }`, with `key = \`${parentId ?? "root"}/${id}\``. The order is subjects (`parentId: null`, depth 0), then Unsorted's children (`parentId: UNSORTED`, depth 0). It descends into a container only when `state.expanded[id]`.
  - `zoneOf(rect, clientY, isContainerRow) => "before" | "into" | "after"`.
  - `placementFor(state, row, zone, dragging) => Placement | null`, where `dragging = { id, from }` and `Placement = { toId, index, depth, kind: "line" | "into", anchorKey, side: "before" | "after" | null }`. For a subject move, `toId` is `null` and `index` is the subject index.

- [ ] **Step 1: Write the failing tests.** `treeRows.test.js`: build the state with `operations` like `sample()`. Collapsed gives one row per subject. With `expanded[bio]` and `expanded[cells]`, the rows go Biology(0), Cells(1), Respiration(2), Notes(1), Chemistry(0). A page linked in two places appears twice with different `key`s.

`dropZone.test.js`, with `rect = { top: 0, height: 40 }`:

```js
expect(zoneOf(rect, 5, true)).toBe("before");   // < 10
expect(zoneOf(rect, 20, true)).toBe("into");
expect(zoneOf(rect, 35, true)).toBe("after");   // >= 30
expect(zoneOf(rect, 19, false)).toBe("before");
expect(zoneOf(rect, 21, false)).toBe("after");
```

`placementFor` cases (state from `sample()`, Biology and Cells expanded):
- Notes dragged `before` the Cells row → `{ toId: bio, index: 0, depth: 1, kind: "line" }`.
- Krebs dragged `into` the Biology row → `{ toId: bio, index: bio.children.length, kind: "into" }`.
- Krebs dragged `after` an expanded Cells row that has children → `{ toId: cells, index: 0, depth: 2, kind: "line" }`.
- Notes dragged `after` the Cells row while Cells is collapsed → `{ toId: bio, index: 1 }`. This is the same spot Notes is already in, so the result is `null`.
- In the same list, an item dragged forward from index 0 to `after` index 1 → index 1 (the index after removal).
- Cells dragged `into` Respiration → `null`.
- A page dragged onto a container that already lists it (linked there) → `null` (Review Focus 2).
- A subject dragged `before` another subject → `{ toId: null, index }`. A subject dragged onto a folder row or `into` a subject → `null`.
- A folder dragged `into` the Unsorted header (pass the row `{ id: UNSORTED, parentId: null, depth: -1 }`) → `{ toId: UNSORTED, kind: "into" }`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/sidebar/treeRows.test.js`, then `npx vitest run src/views/studyhome/sidebar/dropZone.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the two modules** to those signatures.

- [ ] **Step 4: Run both to verify they pass.**

- [ ] **Step 5: Commit** — `git add src/views/studyhome/sidebar/treeRows.* src/views/studyhome/sidebar/dropZone.* && git commit -m "feat(sidebar): visible rows and drop placements"`

### Task 4: Paste target (pure)

**Files:**
- Create: `sidebar/pasteTarget.js`
- Test: `sidebar/pasteTarget.test.js`

**Interfaces:**
- Consumes: `subjectOf`, `parentIndex`, `UNSORTED` from `data/tree.js`.
- Produces: `pasteTarget(state, copied, selection) => { toId, index } | null`. `copied = { id, parentId }` and `selection = { id, parentId } | null`. It returns `null` when `state.nodes[copied.id]` is missing. For a subject, `toId` is `null`.

- [ ] **Step 1: Write the failing tests**, one per row of the spec's table:
  - Subject copied, something inside Chemistry selected → `{ toId: null, index: subjects.indexOf(chem) + 1 }`.
  - Subject copied, nothing selected → `{ toId: null, index: subjects.length }`.
  - Folder copied, Cells selected → `{ toId: cells, index: cells.children.length }`.
  - Page copied, Notes (under bio) selected → `{ toId: bio, index: bio.children.indexOf(notes) + 1 }`.
  - Page copied, nothing or Unsorted selected → `{ toId: UNSORTED, index: unsorted.children.length }`.
  - Copied id deleted → `null`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/sidebar/pasteTarget.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement `pasteTarget`.**

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit** — `git commit -m "feat(sidebar): where a paste lands"` (with the two files added).

### Task 5: Drag and drop in the tree

**Files:**
- Create: `sidebar/useTreeDrag.js`
- Modify: `sidebar/SubjectTree.jsx` (replace `useDropTarget`, the per-row `over` state and the hint text), `styles/shell.css` (the drop line, `data-drop="into"`, `data-dragging`), `styles/motion.css` (no transition with reduced motion)
- Test: `sidebar/SubjectTree.drag.test.jsx`

**Interfaces:**
- Consumes: `visibleRows`, `zoneOf`, `placementFor` (Task 3); `actions.moveTo`, `actions.moveSubject`, `actions.link`.
- Produces: `useTreeDrag({ state, actions, scrollRef }) => { dragging, placement, rowProps(row, isContainerRow), treeProps, unsortedProps }`. `rowProps` returns `draggable`, `onDragStart`, `onDragOver`, `onDragEnd`, `onDrop`, `data-dragging`, `data-drop`. `treeProps` returns `onDragLeave` (clears the placement only when `e.relatedTarget` is outside the tree) and `onDragOver` (handles auto-scroll).

- [ ] **Step 1: Write the failing component tests.** Mount `StudyPreview` with `fakeClient(SAMPLE_SNAPSHOT)` as `sidebar/Sidebar.test.jsx` does, and mock the editor and graph as `shell/tabBarFeatures.test.jsx` does. Stub `getBoundingClientRect` on rows so that `{ top: 0, height: 40 }`. Use a fake `dataTransfer = { setData() {}, effectAllowed: "", dropEffect: "" }`. Tests:
  - With Biology and Cells expanded, `dragStart` on "Krebs cycle" (under Cells), then `dragOver` with `clientY: 5` on the "Cells" row, renders one `.st-drop-line`. After `drop`, the rows' text order is Biology, Krebs cycle, Cells, …: Krebs cycle is directly under Biology and no longer inside Cells.
  - With `clientY: 20` on the Cells row, the row gets `data-drop="into"` and no `st-drop-line`.
  - Moving the pointer over the icon inside the same row (a `dragLeave` whose `relatedTarget` is a child of the row) keeps `data-drop="into"` (no flicker).
  - With fake timers, hovering `into` a collapsed folder for 600 ms expands it, and 599 ms doesn't.
  - Subject rows are `draggable="true"`. Dropping Biology after Chemistry reorders the Subjects list.
  - Dropping a page with `ctrlKey: true` into a folder keeps it in its old place too (`link`).
  - `dragEnd` with no drop changes nothing and removes the indicator.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/sidebar/SubjectTree.drag.test.jsx`. Expected: FAIL.

- [ ] **Step 3: Implement `useTreeDrag` and wire it into `SubjectTree.jsx`.** Render the drop line once, as `<div className="st-drop-line" style={{ top, left: 6 + depth * 14 }} aria-hidden="true" />` inside a `position: relative` tree wrapper. `top` is the anchor row's `offsetTop` or `offsetTop + offsetHeight`. The anchor row is found by `data-row-key`. Auto-expand: a timer keyed by the hovered container id is reset whenever the placement changes. Auto-scroll: while dragging, if `clientY` is within 32 px of `scrollRef`'s rect edge, scroll by 8 px per `dragover`. `scrollRef` is the sidebar's scroll element, so pass a ref down from `Sidebar.jsx` or use `closest(".st-side-scroll")`, whichever class `Sidebar.jsx` uses. Set `dataTransfer.dropEffect = "none"` when there's no placement. Replace the hint text with the exact text from Global Constraints. Show the Ctrl sentence only when a page is dragged.

- [ ] **Step 4: Run to verify the tests pass**, then also `npx vitest run src/views/studyhome/sidebar/Sidebar.test.jsx`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(sidebar): drop before, into or after with a drop line"` (with the new files added).

### Task 6: Selection and keyboard navigation

**Files:**
- Create: `sidebar/useTreeSelection.js`
- Modify: `sidebar/SubjectTree.jsx` (`role="tree"` on the subjects `<ul>`, `role="group"` on nested `<ul>`s, row attributes), `styles/shell.css` (`.st-tree-row:focus-visible` ring, distinct from `[aria-current]`)
- Test: `sidebar/SubjectTree.keys.test.jsx`

**Interfaces:**
- Consumes: `visibleRows` (Task 3); `shell.open`, `shell.startRename`, `actions.toggleExpanded`.
- Produces: `useTreeSelection({ state, rows }) => { selected, select(row), rowProps(row), onTreeKeyDown(e) }`, where `selected = { id, parentId } | null`. `rowProps` gives `role="treeitem"`, `tabIndex` (0 for the selected row, or for the first row when nothing is selected, else -1), `aria-selected`, `aria-level={depth + 1}`, `aria-expanded` (containers), `data-row-key` and `onFocus`. Moving the selection focuses the new row element by `data-row-key`.

- [ ] **Step 1: Write the failing tests:**
  - Clicking "Biology" selects it (`aria-selected="true"`), focuses it, and still opens it (the heading shows Biology).
  - ArrowDown/ArrowUp move between visible rows. ArrowRight on a collapsed subject expands it, and a second ArrowRight goes to its first child. ArrowLeft goes back to the parent, and on an expanded row collapses it. Home and End go to the first and last rows.
  - Enter opens the selected row, and F2 shows the rename input.
  - Only one row has `tabIndex=0`.
  - When the selected item is deleted (through its menu), the next visible row becomes selected.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/views/studyhome/sidebar/SubjectTree.keys.test.jsx`.

- [ ] **Step 3: Implement `useTreeSelection`** and apply `rowProps` to each row in `TreeItem`. The existing row `onClick` becomes: `select(row)`, then open as today.

- [ ] **Step 4: Run the new tests to verify they pass, then `Sidebar.test.jsx` and `SubjectTree.drag.test.jsx`.**

- [ ] **Step 5: Commit** — `git commit -am "feat(sidebar): selectable tree with arrow keys"` (with the new files added).

### Task 7: Copy, paste and delete shortcuts, Settings and menus

**Files:**
- Modify: `shortcuts.js` (the `BINDABLE` entries, with an old-id fallback in `keysOf`), `shortcuts.test.js`, `sidebar/SubjectTree.jsx` (remove `useDeleteShortcut` and the `trackPointer` and `data-tree-id` use if nothing else needs them; add the tree `onKeyDown`), `sidebar/Menu.jsx` (`disabled` and `hint` on items), `StudyPreview.jsx` (`clipboard` and `setClipboard` in the shell value and its deps list), `settings/SystemSections.jsx` (group title and `WHERE.Sidebar`), `shell/tabBarFeatures.test.jsx` (replace the hovered-subject test)
- Test: `sidebar/SubjectTree.clipboard.test.jsx`, `shortcuts.test.js`

**Interfaces:**
- Consumes: `pasteTarget` (Task 4), `actions.duplicate` (Task 2), `useTreeSelection().selected` (Task 6), `matches` and `keysOf` from `shortcuts.js`, `shell.toast`, `shell.askDelete`.
- Produces: `shell.clipboard: { id, parentId } | null` and `shell.setClipboard(value)`. Menu items accept `disabled: boolean` and `hint: string`. The hint is rendered as `<kbd className="st-menu-hint">`.

- [ ] **Step 1: Write the failing tests.** In `shortcuts.test.js`:

```js
expect(keysOf({}, "sidebar.copy")).toBe("Ctrl+C");
expect(keysOf({}, "sidebar.paste")).toBe("Ctrl+V");
expect(keysOf({}, "sidebar.delete")).toBe("Ctrl+Delete");
expect(keysOf({ "sidebar.deleteHovered": "Ctrl+Shift+Delete" }, "sidebar.delete")).toBe("Ctrl+Shift+Delete");
expect(clashes({}, "sidebar.copy", "Ctrl+V")).toEqual(["Paste a copy"]);
expect(BINDABLE.some((b) => b.id === "sidebar.deleteHovered")).toBe(false);
```

In `SubjectTree.clipboard.test.jsx`, mount as in Task 5:
  - Select Biology, press Ctrl+C on the row (`fireEvent.keyDown(row, { key: "c", ctrlKey: true })`). A toast `Copied "Biology"` appears. Press Ctrl+V and a subject "Biology (copy)" appears right after Biology. Its Cells folder holds a "Krebs cycle".
  - Select the page "Loose idea" (in Unsorted), copy it, select "Cells" and paste. "Loose idea (copy)" appears inside Cells.
  - Ctrl+Delete on the selected Biology row opens the dialog `Delete "Biology"?`. Cancel closes it, and Biology is still there.
  - Keys fired on `document.body` or inside an element with `contenteditable="true"` outside the tree do nothing: no toast, no dialog, no new subject.
  - While renaming (F2), Ctrl+C, Ctrl+V and Ctrl+Delete on the rename input don't copy, paste or delete (Review Focus 3).
  - Copy a page, delete it through the dialog, then select a row and press Ctrl+V. The toast `The copied item was deleted` appears and the tree doesn't change (Review Focus 4).
  - After rebinding `sidebar.copy` to Ctrl+Shift+C (seed `localStorage` settings with `shortcuts: { "sidebar.copy": "Ctrl+Shift+C" }`), Ctrl+C does nothing and Ctrl+Shift+C copies.
  - The "More" menu shows Copy with the hint `Ctrl+C`. Paste is disabled until something is copied.

In `shell/tabBarFeatures.test.jsx`, replace "Ctrl+Delete over a sidebar subject asks to delete it" with "Ctrl+Delete on the selected sidebar subject asks to delete it". Click "Biology", then fire Ctrl+Delete on that row, and expect the dialog. Add "Ctrl+Delete with the mouse over a sidebar row but focus elsewhere does nothing in the sidebar". Keep the tab test as it is.

- [ ] **Step 2: Run each to verify they fail.**

- [ ] **Step 3: Implement.**
  - `BINDABLE` gets the three entries from Global Constraints in place of `sidebar.deleteHovered`.
  - `keysOf` becomes: `shortcuts?.[id] ?? (id === "sidebar.delete" ? shortcuts?.["sidebar.deleteHovered"] : undefined) ?? default`.
  - The tree's `onKeyDown` ignores events whose target is an `input`, `textarea` or contenteditable, and returns when `e.defaultPrevented`. Then:
    - copy: `setClipboard(selected)` and toast `Copied "<name>"`.
    - paste: with `t = pasteTarget(...)`, if `!t`, toast `The copied item was deleted`. Otherwise `const id = actions.duplicate(clipboard.id, clipboard.parentId, t.toId, t.index, { palette: shell.palette })` and select the new row.
    - delete: `shell.askDelete(selected.id, selected.parentId)`.
    - `preventDefault()` for each of the three.
  - Delete `useDeleteShortcut`. Delete `shell/pointer.js` only if `TabBar.jsx` no longer imports it; it does, so keep it.
  - Menu items: Copy and Paste go before Delete…, each with `hint: keysOf(shell.shortcuts, …)`.
  - In Settings, the group title "Under the mouse" becomes "Tab bar and sidebar". `WHERE.Sidebar` becomes "With a sidebar item selected and the sidebar focused."

- [ ] **Step 4: Run to verify they pass.** Run each changed test file one at a time: `shortcuts.test.js`, `SubjectTree.clipboard.test.jsx`, `shell/tabBarFeatures.test.jsx`, `shell/TabBar.test.jsx`, `settings/SettingsDialog.test.jsx`, `sidebar/Sidebar.test.jsx`, `SubjectTree.drag.test.jsx` and `SubjectTree.keys.test.jsx`.

- [ ] **Step 5: Commit** — `git commit -am "feat(sidebar): copy, paste and delete the selected item, rebindable"` (with the new test added).

### Task 8: Full check in the real app

**Files:**
- Scratch (not committed): `$CLAUDE_JOB_DIR/tmp/sidebar-check.mjs`, `$CLAUDE_JOB_DIR/tmp/study/`, and screenshots in `$CLAUDE_JOB_DIR/tmp/shots/`
- Modify: `~/Documents/Dev/Kratt/Kratt.md` ("Now")

- [ ] **Step 1: Run every test file one at a time and build.** Loop `for f in $(git ls-files 'src/**/*.test.*'); do npx vitest run "$f" || echo "FAIL $f"; done`, then `npm run build`. Expected: no `FAIL` lines, and the build succeeds. A file that only times out is re-run once on its own before it counts as a failure.

- [ ] **Step 2: Start a throwaway Study folder service and the dev server.** First check that `ss -ltn` shows nothing on 5057 or 1421; if something does, stop and ask. Copy a small sample folder to `$CLAUDE_JOB_DIR/tmp/study/` (Biology/Cells/Krebs cycle.md containing `[[Glycolysis]]`, Biology/Glycolysis.md, Chemistry/Bonds.md). Run `~/Downloads/KRATT/engine/.venv/bin/memory-engine serve --folder $CLAUDE_JOB_DIR/tmp/study --port 5057` and `npm run dev -- --port 1421 --strictPort` in the background. Afterwards, check that `~/.config/memory-engine/study.json` was not created or changed, and restore it if it was.

- [ ] **Step 3: Drive the app with `npx -y playwright@1.48.2`** (the installed Chromium is `chromium-1140`). Open `http://localhost:1421/?view=study-preview`. Go through these, taking a screenshot of each indicator:
  1. Drag Krebs cycle out of Cells to just above Glycolysis. The drop line shows at depth 1, and after the drop it's at Biology's top level. Check the file moved under `study/Biology/`.
  2. Drag the Cells folder into the Chemistry row (into outline), then back.
  3. Create a folder inside Cells and drag a page into it, to check nesting three deep.
  4. Reorder Chemistry above Biology.
  5. Click Biology, press Ctrl+C then Ctrl+V. "Biology (copy)" appears with its files on disk, and its Krebs cycle's `.md` contains `[[<id>|Glycolysis]]` pointing at the copied Glycolysis.
  6. Ctrl+Delete on the copy opens the dialog. Confirm "Delete subject and everything inside" and check the folder is gone.
  7. Click into a page's editor, type text, and press Ctrl+C, Ctrl+V and Ctrl+Delete. The text is copied, pasted and a word deleted, and nothing changes in the tree.
  8. In Settings > Shortcuts the three sidebar entries are listed. Rebind Copy to Ctrl+Shift+C and check it works.

- [ ] **Step 4: Stop both background processes** and delete `$CLAUDE_JOB_DIR/tmp/study`.

- [ ] **Step 5: Update the "Now" entry** in `~/Documents/Dev/Kratt/Kratt.md`. Give the branch, the commit, the test and build results and what was checked in the browser. Next: user tries it in `npm run dev`; merge `fix/tabbar` first or together.

- [ ] **Step 6: Commit any fixes** found in Steps 1–3, with their tests, as `fix(sidebar): …`.
