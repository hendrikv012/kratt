# Sidebar moves, copy/paste and delete — design

Date: 2026-10-25. Branch `feat/sidebar-moves`, based on `fix/tabbar` (6565215), which owns
`shortcuts.js` and Settings > Shortcuts.

## Goal

Moving notes and folders in the sidebar is messy. After this change the user can:

1. Keep notes at the top level of a subject or inside folders, with folders inside folders.
   (The data model already allows this; the work is making it easy to get things there.)
2. Drag notes, folders and subjects smoothly, with a clear indicator of where they will land.
3. Copy and paste subjects, folders and notes with Ctrl+C / Ctrl+V, and delete the selected
   item with Ctrl+Delete. Every delete asks first.
4. See and rebind these shortcuts in Settings > Shortcuts.

The shortcuts act only while the sidebar tree has focus, so the editor and text fields keep
their normal Ctrl+C, Ctrl+V and Ctrl+Delete.

## Why it is messy today

All in `src/views/studyhome/sidebar/SubjectTree.jsx`:

- Drops only go *into* a subject or folder row, always at the end of its list. No reordering,
  no dropping between rows.
- Moving to a subject's top level means hitting the subject row itself.
- Each row keeps its own `over` flag cleared on `dragleave`, which fires whenever the pointer
  crosses the icon, name or buttons inside the row, so the highlight flickers.
- Collapsed folders do not open while hovered.
- Subjects are not draggable.
- The only hint is a line of text under the whole tree; refused drops show nothing.
- Rows are `div`s with `onClick`, not focusable, so there is no "selected item" and
  shortcuts cannot be scoped to sidebar focus. (`fix/tabbar` works around this with
  "delete the item under the mouse".)

## Decisions (asked and answered)

- **Copying a subject (or folder) copies everything inside it**: folders and pages, with
  content and order. Copied pages start at mastery `null` ("not learned yet").
- **Wikilinks in copies**: a `[[link]]` that points at another page copied in the same paste
  is rewritten to point at the copy, by id, keeping its label (`[[<id>|Mitochondria]]` in
  the file). Links to anything else are left as they were.
- **Sources** are one global list with no link to subjects, so there is nothing to copy.
  Adding a subject–source link is out of scope.

## 1. Data rules (`data/operations.js`, pure functions)

### `moveTo(state, id, fromId, toId, index)`

Puts `id` at position `index` in `toId`'s children, taking it out of `fromId`.

- `fromId === toId` reorders within that list. `index` counts positions in the list *after*
  removal.
- Otherwise, the same refusals as `canPlace`: not into itself, not a folder into its own
  contents, and not into a container that already lists it. A refused move returns the same
  state.
- A page whose `home` was `fromId` gets `home: toId`, as `move` does. `expanded[toId]`
  becomes true.
- `move` (append) and `link` (Ctrl+drag) stay as they are.

### `moveSubject(state, id, index)`

Reorders `state.subjects`. Ids that are not subjects are ignored.

### `duplicate(state, id, parentId, toId, index)` → `{ state, id }`

`parentId` is the list the original is shown in (null for a subject). `toId` is where the
copy goes (null for a subject, which goes into `state.subjects` at `index`).

- **Subject or folder**: copies the container and, recursively, every folder in it and every
  page whose home is inside it. Each gets a new id; names stay, and only the top copy gets
  " (copy)". Children keep their order.
  - A page that is only *linked* into a copied container (its home is outside) is not copied:
    its id is listed in the copied container's children, so it is linked there too.
  - Copied pages get `mastery: null` and `home` set to their copied container.
- **Page**: one copy named "Name (copy)" with the same content and `mastery: null`. Its home
  is `toId`.
- **Subject color**: the first palette color no other subject uses, as `addSubject` does.
- **Links**: in each copied page's HTML, every `data-type="wiki-link"` element whose target
  resolves (as `wikiTargets` resolves it: id, then name) to a page copied in this same paste
  gets `href` and `target` set to the copy's id. The label (`alt`, or the text shown) keeps
  the original visible name. Other links are untouched.
- **Ambiguous names** (added while planning): after a copy, page names exist twice, so a
  name link in the *original* could resolve to the copy. `wikiTargets` resolution therefore
  prefers, among pages with the same name, the one in the linking page's own subject, and
  otherwise the first match. Before this change the last match won.
- `UNSORTED` cannot be duplicated.

Add `moveTo`, `moveSubject` and `duplicate` to `mutations`. Storage needs nothing new:
`vaultState` already turns new nodes into files, moves into folder or file moves, and order
into the layout file.

### Paste target (`sidebar/pasteTarget.js`, pure)

`pasteTarget(state, copied, selection)` → `{ toId, index }`:

| Copied | Selected | Lands |
|---|---|---|
| subject | a subject, or something in one | new subject right after that subject |
| subject | nothing / Unsorted | end of the subject list |
| folder or page | subject or folder | inside it, at the end |
| folder or page | page | right after that page, in the list it is shown in |
| folder or page | nothing / Unsorted | end of Unsorted |

If the copied item no longer exists, nothing is pasted and a toast says "The copied item was
deleted". Pasting a folder into itself (or into a folder inside it) is allowed: `duplicate`
collects everything to copy before inserting the copy, so the copy is never copied into
itself. Pasting again makes another copy.

### Delete

No new operation. The delete shortcut opens the existing `DeleteDialog`
(`shell.askDelete(id, parentId)`), which already asks for pages (remove here / delete
everywhere), folders (only the folder / everything) and subjects.

## 2. Drag and drop (`sidebar/SubjectTree.jsx`, `sidebar/dropZone.js`)

### Zones

`dropZone(rect, clientY, kind)` → `"before" | "into" | "after"`, pure:

- Subject or folder row: top 25% before, middle 50% into, bottom 25% after.
- Page row: top half before, bottom half after.

The tree turns a zone into a placement `{ toId, index, depth }`:

- before/after a row → that row's list, at its index or the index after it. Depth is the
  row's depth.
- "after" on an *expanded* container that has children → first child of that container
  (index 0, depth + 1), matching where the line is drawn.
- into → end of that container.
- The Unsorted header → into Unsorted.
- A dragged subject only gets before/after against subject rows. Any other row gives no
  placement.
- A placement that `canPlace` (or the same-list reorder rule) refuses gives no placement. A
  placement that would leave the item exactly where it is also gives none.

### State and events

- One `drop` state for the whole tree: `{ dragging: { id, from }, placement }`.
- Rows report `dragover` (they compute the zone, preventDefault only when there is a
  placement). The tree clears the placement on `dragleave` from the tree element itself and
  on `dragend`/`drop`. No per-row `over` flags, so there is no flicker.
- Drop → `moveSubject`, `moveTo`, or `link` when Ctrl/Alt is held, a page is dragged and the
  placement is *into* a folder or subject (not Unsorted).
- Hovering a collapsed container's *into* zone for 600 ms expands it.
- While dragging within 32px of the sidebar scroll area's top or bottom edge, it scrolls.
- Escape or dropping outside changes nothing.
- Subject rows become draggable (not while being renamed).

### Indicator

- before/after: a 2px accent line (`.st-drop-line`) positioned at the gap and indented to the
  placement's depth, so it shows inside vs outside a folder.
- into: the row gets `data-drop="into"`, giving an accent outline and a light tint.
- No placement: nothing drawn. `dropEffect = "none"`.
- The dragged row gets `data-dragging` (opacity 0.4). With reduced motion: no transitions.
- The hint under the tree stays: "Drop between items to move, onto a folder to put it inside.
  Hold Ctrl to also keep a page where it is."

### Out of scope

Dragging into the tab bar or editor, dragging several items at once, and touch dragging
(HTML5 drag and drop does not support touch; today's version does not either).

## 3. Selection, shortcuts and Settings

### Tree semantics and focus

- The `<ul>` gets `role="tree"`, and rows get `role="treeitem"`, `aria-level`,
  `aria-selected` and `aria-expanded` (containers).
- Roving tabindex: only the selected row (or the first subject when none is) has
  `tabIndex=0`.
- Selection is `{ id, parentId }`, because a linked page can show in several places. It lives
  in `SubjectTree`. When the selected node disappears, selection moves to the next visible
  row, else the previous one, else none.
- Click selects, focuses and opens (as today). The selected row gets a focus ring distinct
  from the "open in the editor" `aria-current` style.
- Keys on a focused row: ↑/↓ previous/next visible row, → expand or go to the first child,
  ← collapse or go to the parent, Home/End first/last row, Enter opens, F2 renames.

### Shortcuts (`shortcuts.js`)

`BINDABLE` gets three entries, all `context: "Sidebar"`:

| id | label | default |
|---|---|---|
| `sidebar.copy` | Copy the selected item | Ctrl+C |
| `sidebar.paste` | Paste a copy | Ctrl+V |
| `sidebar.delete` | Delete the selected item (asks first) | Ctrl+Delete |

- They replace `fix/tabbar`'s `sidebar.deleteHovered` and its window-level listener
  (`useDeleteShortcut`). A saved binding under the old id carries over to `sidebar.delete`
  (`keysOf` reads the old id as a fallback).
- The listener is a `keydown` on the tree element, so it only fires while focus is inside the
  tree. Events from the rename `<input>` are ignored. The editor, Search, chat and other
  inputs never reach it.
- Copy keeps `{ id, parentId }` in an in-app clipboard (in `SubjectTree`'s parent shell
  context so it survives the tree re-rendering). It does not touch the system clipboard.
  Toast: `Copied "Name"`.
- Cmd counts as Ctrl (already true in `comboOf`).
- `tabs.closeHovered` is unchanged.

### Settings > Shortcuts

The existing list in `settings/SystemSections.jsx` renders `BINDABLE`, so the three appear
and use the existing recorder and `clashes` check (fixed shortcuts and same-context
duplicates are refused).

### Context menu

Each row's "More" menu gains Copy and Paste (Paste disabled until something is copied) and
shows the bound keys next to Copy, Paste and Delete….

## Testing

- Unit (`operations.test.js`, new `dropZone.test.js`, `pasteTarget.test.js`): `moveTo`
  (reorder, cross-list, refusals, home update), `moveSubject`, `duplicate` (deep copy, new
  ids, names, mastery reset, linked pages stay links, link rewriting by id with label kept,
  outside links untouched), zones, placements and paste targets.
- Component (`SubjectTree.test.jsx`): arrow-key navigation, shortcuts only with tree focus,
  Ctrl+V inside a `contenteditable` does not paste in the tree, Ctrl+Delete opens the delete
  dialog, rebinding in settings takes effect.
- `shortcuts.test.js`: new entries, old-id fallback, clashes.
- Real app: `npm run dev` driven by headless Chromium (Playwright). Drag a page out of a
  folder to the subject's top level, nest a folder in a folder, reorder, reorder subjects,
  copy and paste a subject and check the copied link in the graph, delete with confirmation.
  Screenshots of the line and into indicators.
- Run test files one at a time (the full suite has random 10 s timeouts). `npm run build`
  must pass.
