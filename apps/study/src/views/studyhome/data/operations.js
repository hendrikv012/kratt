// Every change to the study data, as pure functions: (state, ...) => state.
// See tree.js for the state shape. Kept free of React and storage so the
// storage can later move to real folders on disk without touching this.

import { contains, foldersInside, homeOf, isContainer, parentIndex, resolveWikiHref, UNSORTED, UNSORTED_COLOR } from "./tree";
import { turnText } from "../chats/format";

export const SUBJECT_COLORS = ["#5bb98c", "#4fb7b3", "#e0a35a", "#9b8cf2", "#e07a8b", "#6aa6e8", "#d4c45a", "#c48ad9"];

export const EMPTY_STATE = {
  nodes: { [UNSORTED]: { id: UNSORTED, type: "unsorted", name: "Unsorted", color: UNSORTED_COLOR, children: [] } },
  subjects: [],
  quickNotes: [],
  sources: [],
  chats: [],
  recent: [],
  pinned: [],
  expanded: {},
};

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_NAMES = { subject: "Untitled subject", folder: "Untitled folder", page: "Untitled" };

function withNode(state, node) {
  return { ...state, nodes: { ...state.nodes, [node.id]: node } };
}

function patchNode(state, id, patch) {
  return withNode(state, { ...state.nodes[id], ...patch });
}

function setChildren(state, containerId, children) {
  return patchNode(state, containerId, { children });
}

// Removes nodes and every trace of them (containers' lists, recent, expanded).
function dropNodes(state, ids) {
  const gone = new Set(ids.filter((id) => id !== UNSORTED));
  const nodes = {};
  Object.values(state.nodes).forEach((node) => {
    if (gone.has(node.id)) return;
    nodes[node.id] = isContainer(node) ? { ...node, children: node.children.filter((c) => !gone.has(c)) } : node;
  });
  const expanded = Object.fromEntries(Object.entries(state.expanded).filter(([id]) => !gone.has(id)));
  // A source that was in a gone subject just loses that link.
  const sources = state.sources.map((s) =>
    s.subjects?.some((id) => gone.has(id)) ? { ...s, subjects: s.subjects.filter((id) => !gone.has(id)) } : s
  );
  return {
    ...state,
    nodes,
    expanded,
    sources,
    subjects: state.subjects.filter((id) => !gone.has(id)),
    recent: state.recent.filter((id) => !gone.has(id)),
    pinned: state.pinned.filter((id) => !gone.has(id)),
  };
}

// A new subject takes the first colour from `palette` (the active colour
// style's subject colours) that no other subject uses yet.
export function addSubject(state, { name = DEFAULT_NAMES.subject, palette = SUBJECT_COLORS } = {}) {
  const used = new Set(state.subjects.map((id) => state.nodes[id].color));
  const color = palette.find((c) => !used.has(c)) ?? palette[state.subjects.length % palette.length];
  const id = newId();
  const next = withNode(state, { id, type: "subject", name, color, children: [] });
  return { state: { ...next, subjects: [...state.subjects, id] }, id };
}

export function addChild(state, parentId, type, name = DEFAULT_NAMES[type]) {
  const id = newId();
  const node =
    type === "page"
      ? { id, type, name, content: "", mastery: null, home: parentId }
      : { id, type, name, children: [] };
  let next = withNode(state, node);
  next = setChildren(next, parentId, [...next.nodes[parentId].children, id]);
  next = { ...next, expanded: { ...next.expanded, [parentId]: true } };
  return { state: next, id };
}

export const rename = (state, id, name) =>
  id === UNSORTED ? state : patchNode(state, id, { name: name.trim() || DEFAULT_NAMES[state.nodes[id].type] });
export const setColor = (state, id, color) => patchNode(state, id, { color });
export const setContent = (state, id, content) => patchNode(state, id, { content });

// How well a page is known: null (not learned yet) or a number in 0..1.
// Anything else, or an id that isn't a page, leaves the state as it was.
export function setMastery(state, id, value) {
  const valid = value === null || (typeof value === "number" && value >= 0 && value <= 1);
  return valid && state.nodes[id]?.type === "page" ? patchNode(state, id, { mastery: value }) : state;
}

export const toggleExpanded = (state, id) => ({ ...state, expanded: { ...state.expanded, [id]: !state.expanded[id] } });

// Records a page as recently opened. Anything that isn't a page is ignored,
// so callers can report every visit without checking first.
export const visit = (state, id) =>
  state.nodes[id]?.type !== "page"
    ? state
    : { ...state, recent: [id, ...state.recent.filter((r) => r !== id)].slice(0, 8) };

// Pinning is idempotent: pinning a pinned page, or unpinning one that isn't,
// returns the same state so nothing is written.
export const pinPage = (state, id) =>
  state.pinned.includes(id) ? state : { ...state, pinned: [...state.pinned, id] };

export const unpinPage = (state, id) =>
  state.pinned.includes(id) ? { ...state, pinned: state.pinned.filter((p) => p !== id) } : state;

// Can `id` be moved or linked into `targetId`? Not into itself, not a folder
// into its own contents, and not where it already is.
export function canPlace(state, id, targetId) {
  const target = state.nodes[targetId];
  if (!target || !isContainer(target) || target.children.includes(id)) return false;
  return !contains(state, id, targetId);
}

export function move(state, id, fromId, toId) {
  if (fromId === toId || !canPlace(state, id, toId)) return state;
  let next = setChildren(state, fromId, state.nodes[fromId].children.filter((c) => c !== id));
  next = setChildren(next, toId, [...next.nodes[toId].children, id]);
  if (next.nodes[id].type === "page" && next.nodes[id].home === fromId) next = patchNode(next, id, { home: toId });
  return { ...next, expanded: { ...next.expanded, [toId]: true } };
}

// Moves `id` out of `fromId` and into `toId` at `index`, counted in the target
// list after `id` is taken out. Reordering inside one list is the same call.
// A refusal or a move that changes nothing returns the same state.
export function moveTo(state, id, fromId, toId, index) {
  const from = state.nodes[fromId]?.children;
  if (!from || !state.nodes[toId]) return state;
  const same = fromId === toId;
  if (same ? !from.includes(id) : !canPlace(state, id, toId)) return state;
  const rest = from.filter((c) => c !== id);
  const target = same ? rest : state.nodes[toId].children;
  const at = Math.max(0, Math.min(index, target.length));
  const list = [...target.slice(0, at), id, ...target.slice(at)];
  if (same) {
    if (list.every((c, i) => c === from[i])) return state;
    return setChildren(state, toId, list);
  }
  let next = setChildren(state, fromId, rest);
  next = setChildren(next, toId, list);
  if (next.nodes[id].type === "page" && next.nodes[id].home === fromId) next = patchNode(next, id, { home: toId });
  return { ...next, expanded: { ...next.expanded, [toId]: true } };
}

// Reorders the subjects. Anything that isn't a subject is ignored.
export function moveSubject(state, id, index) {
  if (!state.subjects.includes(id)) return state;
  const rest = state.subjects.filter((s) => s !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  const subjects = [...rest.slice(0, at), id, ...rest.slice(at)];
  return subjects.every((s, i) => s === state.subjects[i]) ? state : { ...state, subjects };
}

// Puts a page in one more folder; it stays where it already is too.
export function link(state, pageId, toId) {
  if (state.nodes[pageId].type !== "page" || !canPlace(state, pageId, toId)) return state;
  return setChildren(state, toId, [...state.nodes[toId].children, pageId]);
}

// Takes a page out of one folder. If that was its last place, it's deleted.
export function removeFromFolder(state, pageId, parentId) {
  let next = setChildren(state, parentId, state.nodes[parentId].children.filter((c) => c !== pageId));
  const remaining = parentIndex(next)[pageId] ?? [];
  if (remaining.length === 0) return dropNodes(next, [pageId]);
  if (next.nodes[pageId].home === parentId) next = patchNode(next, pageId, { home: remaining[0] });
  return next;
}

export const deletePage = (state, pageId) => dropNodes(state, [pageId]);

// Deletes a folder and keeps its contents: they move up into the folder's
// container, where the folder was.
export function deleteFolderKeepContents(state, folderId, parentId) {
  const folder = state.nodes[folderId];
  const siblings = state.nodes[parentId].children;
  const lifted = folder.children.filter((c) => !siblings.includes(c));
  const at = siblings.indexOf(folderId);
  let next = setChildren(state, parentId, [...siblings.slice(0, at), ...lifted, ...siblings.slice(at + 1)]);
  folder.children.forEach((c) => {
    if (next.nodes[c].type === "page" && next.nodes[c].home === folderId) next = patchNode(next, c, { home: parentId });
  });
  return dropNodes(next, [folderId]);
}

// Deletes a subject and keeps its contents: they go to Unsorted.
export function deleteSubjectKeepContents(state, subjectId) {
  const subject = state.nodes[subjectId];
  const unsorted = state.nodes[UNSORTED].children;
  let next = setChildren(state, UNSORTED, [...unsorted, ...subject.children.filter((c) => !unsorted.includes(c))]);
  subject.children.forEach((c) => {
    if (next.nodes[c].type === "page" && next.nodes[c].home === subjectId) next = patchNode(next, c, { home: UNSORTED });
  });
  return dropNodes(next, [subjectId]);
}

// Deletes a subject or folder with everything inside. Pages that are also
// linked into folders outside it survive there.
export function deleteContainerAndContents(state, containerId) {
  const doomed = new Set([containerId, ...foldersInside(state, containerId)]);
  const parents = parentIndex(state);
  const pagesHere = new Set([...doomed].flatMap((id) => state.nodes[id].children).filter((c) => state.nodes[c].type === "page"));
  const deadPages = [];
  let next = state;
  pagesHere.forEach((pageId) => {
    const outside = (parents[pageId] ?? []).filter((p) => !doomed.has(p));
    if (outside.length === 0) deadPages.push(pageId);
    else if (doomed.has(next.nodes[pageId].home)) next = patchNode(next, pageId, { home: outside[0] });
  });
  return dropNodes(next, [...doomed, ...deadPages]);
}

// What deleting a container would affect, for the confirmation screen.
export function deletionSummary(state, containerId) {
  const doomed = new Set([containerId, ...foldersInside(state, containerId)]);
  const parents = parentIndex(state);
  const pages = new Set([...doomed].flatMap((id) => state.nodes[id].children).filter((c) => state.nodes[c].type === "page"));
  const survivors = [...pages].filter((p) => (parents[p] ?? []).some((parent) => !doomed.has(parent)));
  return { folders: doomed.size - 1, pages: pages.size, survivors: survivors.length, direct: state.nodes[containerId].children.length };
}

// ---------- Copies

const unescapeAttr = (v) => v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapeAttr = (v) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeAttr(m[1]) : undefined;
};
const withAttr = (tag, name, value) => {
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  const set = escapeAttr(value);
  return re.test(tag) ? tag.replace(re, (_, a, b) => a + set + b) : tag.replace(/\s*\/?>$/, (end) => ` ${name}="${set}"${end}`);
};

// Points the wiki links of a copied page at the copies (`ids`: old page id -> copy id),
// resolving each link in the original state. The visible label stays: it becomes the alt.
function rewriteLinks(state, parents, content, fromPageId, ids) {
  return content.replace(/<(a|span)\b[^>]*data-type="wiki-link"[^>]*>(<\/span>)?/g, (whole, name, emptyEnd) => {
    const tag = emptyEnd ? whole.slice(0, -"</span>".length) : whole;
    const copy = ids[resolveWikiHref(state, attrOf(tag, "href") ?? "", fromPageId, parents)];
    const target = attrOf(tag, "target") ?? attrOf(tag, "href") ?? "";
    const label = attrOf(tag, "alt") || target.split("|")[1]?.trim() || target.split("|")[0].trim();
    const next = copy ? withAttr(withAttr(withAttr(tag, "href", copy), "target", copy), "alt", label) : tag;
    // An empty <span> (a link as read from its file) would be dropped when the page is saved
    // as Markdown, so every one becomes the <a> the editor uses, rewritten or not.
    return emptyEnd ? `<a${next.slice("<span".length)}${escapeAttr(label)}</a>` : next;
  });
}

// Copies a subject, folder or page, with everything inside, to `index` in `toId` (for a
// subject, `toId` is null and `index` is in state.subjects). Only the top copy is named
// "(copy)". Copied pages start unstudied. Pages only linked in stay links to the original.
export function duplicate(state, id, parentId, toId, index, { palette = SUBJECT_COLORS } = {}) {
  const top = state.nodes[id];
  const isSubject = top?.type === "subject";
  const target = isSubject ? null : state.nodes[toId];
  if (!top || id === UNSORTED || (!isSubject && (!target || !isContainer(target)))) return { state, id: undefined };

  // Everything is read from the original state first, so pasting into the copied
  // folder itself doesn't copy the copy.
  const parents = parentIndex(state);
  const containers = isContainer(top) ? [id, ...foldersInside(state, id)] : [];
  const pages = isContainer(top)
    ? [...new Set(containers.flatMap((c) => state.nodes[c].children))].filter(
        (c) => state.nodes[c].type === "page" && containers.includes(homeOf(state, parents, c))
      )
    : [id];
  const ids = Object.fromEntries([...containers, ...pages].map((old) => [old, newId()]));

  const nodes = { ...state.nodes };
  containers.forEach((old) => {
    const node = state.nodes[old];
    nodes[ids[old]] = { ...node, id: ids[old], children: node.children.map((c) => ids[c] ?? c) };
  });
  pages.forEach((old) => {
    const node = state.nodes[old];
    // created: undefined, so the file gets a fresh date like any new page.
    const home = old === id ? toId : ids[homeOf(state, parents, old)];
    nodes[ids[old]] = { ...node, id: ids[old], home, mastery: null, created: undefined, content: rewriteLinks(state, parents, node.content || "", old, ids) };
  });
  const copy = ids[id];
  nodes[copy] = { ...nodes[copy], name: `${top.name} (copy)` };

  const insert = (list) => {
    const at = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), copy, ...list.slice(at)];
  };
  if (isSubject) {
    const used = new Set(state.subjects.map((s) => state.nodes[s].color));
    nodes[copy].color = palette.find((c) => !used.has(c)) ?? palette[state.subjects.length % palette.length];
    return { state: { ...state, nodes, subjects: insert(state.subjects) }, id: copy };
  }
  nodes[toId] = { ...target, children: insert(target.children) };
  return { state: { ...state, nodes, expanded: { ...state.expanded, [toId]: true } }, id: copy };
}

export function addQuickNote(state, text) {
  if (!text.trim()) return state;
  return { ...state, quickNotes: [{ id: newId(), text: text.trim(), createdAt: Date.now() }, ...state.quickNotes] };
}

export const updateQuickNote = (state, id, text) => ({
  ...state,
  quickNotes: state.quickNotes.map((n) => (n.id === id ? { ...n, text } : n)),
});

export const deleteQuickNote = (state, id) => ({ ...state, quickNotes: state.quickNotes.filter((n) => n.id !== id) });

// ---------- Sources ----------
// What the student studies from: a web link, a file, or pasted text.
//   { id, type: "link" | "file" | "text", title, url?, fileName?, fileSize?,
//     content, use, subjects: [subject ids], createdAt, updatedAt, extraMeta? }
// `use` is whether it's ticked as one to use (by the AI, once it arrives).
// `subjects` is the subjects it belongs to (none = Unsorted); a source can be
// in several. Changing them never changes `updatedAt`. `extraMeta` holds header
// keys from its file the app doesn't use (tags, aliases…), written back unchanged.

// Adds several at once, newest first, all ticked.
export function addSources(state, items) {
  const now = Date.now();
  const added = items.map((item) => ({ content: "", ...item, id: newId(), use: true, subjects: [], createdAt: now, updatedAt: now }));
  return { ...state, sources: [...added, ...state.sources] };
}

export const updateSource = (state, id, patch) => ({
  ...state,
  sources: state.sources.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
});

export const setSourcesUse = (state, ids, use) => ({
  ...state,
  sources: state.sources.map((s) => (ids.includes(s.id) ? { ...s, use } : s)),
});

// Sets which subjects a source is in: only real subjects, once each, in order.
// Returns the same state when nothing would change.
export function setSourceSubjects(state, sourceId, subjectIds) {
  const next = [...new Set(subjectIds)].filter((id) => state.subjects.includes(id));
  const source = state.sources.find((s) => s.id === sourceId);
  const now = source?.subjects ?? [];
  if (!source || (next.length === now.length && next.every((id, i) => id === now[i]))) return state;
  return { ...state, sources: state.sources.map((s) => (s.id === sourceId ? { ...s, subjects: next } : s)) };
}

const subjectsOf = (state, sourceId) => state.sources.find((s) => s.id === sourceId)?.subjects ?? [];

export const addSourceToSubject = (state, sourceId, subjectId) =>
  setSourceSubjects(state, sourceId, [...subjectsOf(state, sourceId), subjectId]);

export const removeSourceFromSubject = (state, sourceId, subjectId) =>
  setSourceSubjects(state, sourceId, subjectsOf(state, sourceId).filter((id) => id !== subjectId));

export const moveSourceToSubject = (state, sourceId, fromId, toId) =>
  setSourceSubjects(state, sourceId, [...subjectsOf(state, sourceId).filter((id) => id !== fromId), toId]);

export const deleteSource = (state, id) => ({ ...state, sources: state.sources.filter((s) => s.id !== id) });

// ---------- Chats ----------
// Talks with Kratt, each saved as a file in Chats/:
//   { id, title, created, updated, context: [page or subject ids], turns: [{ who: "you" | "kratt", text }] }
// Times are milliseconds. The list is kept newest first, by `updated`.

const NEW_CHAT = "New chat";
const newestFirst = (chats) => [...chats].sort((a, b) => b.updated - a.updated);

export function addChat(state, { id = newId(), title = NEW_CHAT, context = [], now = Date.now() } = {}) {
  const chat = { id, title: title.trim() || NEW_CHAT, created: now, updated: now, context: [...context], turns: [] };
  return { state: { ...state, chats: newestFirst([chat, ...state.chats]) }, id };
}

export function appendTurn(state, id, turn, now = Date.now()) {
  const added = { who: turn.who === "kratt" ? "kratt" : "you", text: turnText(turn.text) };
  const chats = state.chats.map((c) => (c.id === id ? { ...c, turns: [...c.turns, added], updated: now } : c));
  return { ...state, chats: newestFirst(chats) };
}

export const renameChat = (state, id, title) => ({
  ...state,
  chats: state.chats.map((c) => (c.id === id ? { ...c, title: title.trim() || NEW_CHAT } : c)),
});

export const setChatContext = (state, id, context) => ({
  ...state,
  chats: state.chats.map((c) => (c.id === id ? { ...c, context: [...context] } : c)),
});

export const deleteChat = (state, id) => ({ ...state, chats: state.chats.filter((c) => c.id !== id) });

// The changes components may make, as one list for the store to wrap.
export const mutations = {
  addSubject,
  addChild,
  rename,
  setColor,
  setContent,
  setMastery,
  toggleExpanded,
  visit,
  pinPage,
  unpinPage,
  move,
  moveTo,
  moveSubject,
  duplicate,
  link,
  removeFromFolder,
  deletePage,
  deleteFolderKeepContents,
  deleteSubjectKeepContents,
  deleteContainerAndContents,
  addQuickNote,
  updateQuickNote,
  deleteQuickNote,
  addSources,
  updateSource,
  setSourcesUse,
  deleteSource,
  setSourceSubjects,
  addSourceToSubject,
  removeSourceFromSubject,
  moveSourceToSubject,
  addChat,
  appendTurn,
  renameChat,
  setChatContext,
  deleteChat,
};
