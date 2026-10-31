// The Study folder ↔ the app's state.
//
// stateFromSnapshot turns the service's snapshot (folders, .md files, layout) into the
// state operations.js works on. planSync compares two states and lists the smallest
// file operations that make the folder match: mkdir, move, write, trash, layout.
//
// Ids: pages, quick notes and sources keep the `id` from their YAML header. Subjects and
// folders have no header, so their id is their folder path ("Biology", "Biology/Cells");
// ones made in the app keep their new id until the next load. `paths` maps every id to
// its current path in the folder.

import yaml from "js-yaml";
import { noteFileToHtml, noteHtmlToMarkdown } from "../../../core/markdown/noteFile.js";
import { formatTurns, parseTurns } from "../chats/format";
import { EMPTY_STATE, SUBJECT_COLORS } from "./operations";
import { isContainer, parentIndex, UNSORTED } from "./tree";

export const UNSORTED_DIR = "Unsorted";
export const QUICK_NOTES_DIR = "Quick notes";
export const SOURCES_DIR = "Sources";
export const CHATS_DIR = "Chats";
const SPECIAL_DIRS = new Set([UNSORTED_DIR, QUICK_NOTES_DIR, SOURCES_DIR, CHATS_DIR]);

// The same rule as memory-engine's sanitize_name: names every file system accepts, at most
// 200 bytes (room left for " (2)" and ".md" under the usual 255).
const MAX_NAME_BYTES = 200;
export function sanitizeName(name) {
  let cleaned = String(name ?? "").replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, "-").trim().replace(/^\.+/, "").trim();
  const bytes = new TextEncoder().encode(cleaned);
  if (bytes.length > MAX_NAME_BYTES) cleaned = new TextDecoder().decode(bytes.slice(0, MAX_NAME_BYTES)).replace(/\uFFFD+$/, "").trim();
  return cleaned || "Untitled";
}

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

// Where `path` is after the file or folder at `from` moved to `to`.
export const movedPath = (path, from, to) =>
  path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
const dirname = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const stem = (path) => basename(path).replace(/\.md$/, "");
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
const iso = (time) => new Date(time).toISOString();
// A header time in milliseconds (0 when missing). YAML may already have made it a Date.
const msOf = (time) => (time === undefined || time === null ? 0 : new Date(time).getTime() || 0);
const pad = (n) => String(n).padStart(2, "0");

function stampName(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// Folders first, then pages, each by name: the order used when the layout says nothing.
function defaultOrder(ids, nodes) {
  const containers = ids.filter((id) => isContainer(nodes[id])).sort((a, b) => byName(nodes[a].name, nodes[b].name));
  const pages = ids.filter((id) => !isContainer(nodes[id])).sort((a, b) => byName(nodes[a].name, nodes[b].name));
  return [...containers, ...pages];
}

const keyOf = (id, nodes, pathOf) => (isContainer(nodes[id]) ? pathOf(id) : id);

function ordered(ids, savedKeys, nodes, pathOf) {
  const byKey = new Map(ids.map((id) => [keyOf(id, nodes, pathOf), id]));
  const known = (savedKeys ?? []).map((key) => byKey.get(key)).filter((id) => id !== undefined);
  const rest = defaultOrder(ids.filter((id) => !known.includes(id)), nodes);
  return [...new Set([...known, ...rest])];
}

function clean(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

function sourceFrom(file) {
  const meta = file.meta ?? {};
  return clean({
    id: file.id,
    type: meta.type ?? "text",
    title: String(meta.title ?? stem(file.path)),
    url: meta.url,
    file: meta.file,
    fileName: meta.file ? basename(String(meta.file)) : undefined,
    content: (file.body ?? "").replace(/\n$/, ""),
    use: meta.use !== false,
    createdAt: Date.parse(meta.created) || 0,
    updatedAt: Date.parse(meta.updated) || 0,
    pageCount: meta.pages,
    readPages: meta.read_pages,
    truncated: meta.truncated,
  });
}

function chatFrom(file) {
  const meta = file.meta ?? {};
  const created = msOf(meta.created);
  return {
    id: file.id,
    title: String(meta.title ?? stem(file.path)),
    created,
    updated: msOf(meta.updated) || created,
    context: Array.isArray(meta.context) ? meta.context.map(String) : [],
    turns: parseTurns(file.body ?? ""),
  };
}

// Each page's HTML by the Markdown it came from, kept from the last snapshot: a refresh only
// converts files whose text changed.
let htmlByMarkdown = new Map();

export function stateFromSnapshot(snapshot) {
  const converted = new Map();
  const htmlOf = (markdown) => {
    const html = htmlByMarkdown.get(markdown) ?? noteFileToHtml(markdown);
    converted.set(markdown, html);
    return html;
  };
  const layout = snapshot.layout ?? {};
  const nodes = { [UNSORTED]: { ...EMPTY_STATE.nodes[UNSORTED], children: [] } };
  const paths = { [UNSORTED]: UNSORTED_DIR };
  const versions = {};
  const quickNotes = [];
  const sources = [];
  const chats = [];
  const isSpecial = (path) => SPECIAL_DIRS.has(path.split("/")[0]);

  const dirs = (snapshot.folders ?? []).filter((path) => !isSpecial(path));
  let nextColor = 0;
  for (const dir of dirs) {
    const name = basename(dir);
    nodes[dir] = dir.includes("/")
      ? { id: dir, type: "folder", name, children: [] }
      : { id: dir, type: "subject", name, color: layout.colors?.[dir] ?? SUBJECT_COLORS[nextColor++ % SUBJECT_COLORS.length], children: [] };
    paths[dir] = dir;
  }
  for (const dir of dirs) if (nodes[dirname(dir)]) nodes[dirname(dir)].children.push(dir);

  const containerAt = (path) => (path === UNSORTED_DIR ? UNSORTED : nodes[path] ? path : null);
  for (const file of snapshot.files ?? []) {
    const parts = file.path.split("/");
    const meta = file.meta ?? {};
    versions[file.path] = file.version;
    if (parts[0] === QUICK_NOTES_DIR) {
      if (parts.length === 2) {
        quickNotes.push({ id: file.id, text: (file.body ?? "").trim(), createdAt: Date.parse(meta.created) || 0 });
        paths[file.id] = file.path;
      }
      continue;
    }
    if (parts[0] === CHATS_DIR) {
      if (parts.length === 2) {
        chats.push(chatFrom(file));
        paths[file.id] = file.path;
      }
      continue;
    }
    if (parts[0] === SOURCES_DIR) {
      if (parts.length === 2) {
        sources.push(sourceFrom(file));
        paths[file.id] = file.path;
      }
      continue;
    }
    const home = containerAt(dirname(file.path)) ?? UNSORTED;
    nodes[file.id] = clean({
      id: file.id,
      type: "page",
      name: String(meta.title ?? stem(file.path)),
      content: htmlOf(file.body ?? ""),
      mastery: meta.mastery ?? null,
      home,
      created: meta.created,
    });
    if (nodes[file.id].mastery === undefined) nodes[file.id].mastery = null;
    paths[file.id] = file.path;
    nodes[home].children.push(file.id);
    for (const other of meta.also_in ?? []) {
      const target = containerAt(String(other));
      if (target && target !== home && !nodes[target].children.includes(file.id)) nodes[target].children.push(file.id);
    }
  }

  const pathOf = (id) => paths[id];
  for (const node of Object.values(nodes)) {
    if (isContainer(node)) node.children = ordered(node.children, layout.order?.[paths[node.id]], nodes, pathOf);
  }
  const subjectIds = dirs.filter((dir) => !dir.includes("/"));
  const subjects = ordered(subjectIds, layout.subjects, nodes, pathOf);
  const expanded = Object.fromEntries(
    (layout.expanded ?? []).map((key) => [key === UNSORTED_DIR ? UNSORTED : key, true]).filter(([id]) => nodes[id])
  );
  const recent = (layout.recent ?? []).filter((id) => nodes[id]?.type === "page");
  const pinned = (layout.pinned ?? []).filter((id) => nodes[id]?.type === "page");
  htmlByMarkdown = converted;
  quickNotes.sort((a, b) => b.createdAt - a.createdAt);
  sources.sort((a, b) => b.createdAt - a.createdAt);
  chats.sort((a, b) => b.updated - a.updated);
  return { state: { nodes, subjects, quickNotes, sources, chats, recent, pinned, expanded }, paths, versions };
}

// The snapshot as it will be once `ops` (saves kept from an earlier session) have run, so the
// app shows what the queue is about to write.
export function applyOps(snapshot, ops) {
  let folders = [...(snapshot.folders ?? [])];
  let files = [...(snapshot.files ?? [])];
  const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);
  for (const op of ops) {
    if (op.op === "mkdir" && !folders.includes(op.path)) folders.push(op.path);
    if (op.op === "move") {
      folders = folders.map((path) => movedPath(path, op.from, op.to));
      files = files.map((file) => ({ ...file, path: movedPath(file.path, op.from, op.to) }));
    }
    if (op.op === "trash") {
      folders = folders.filter((path) => !inside(path, op.path));
      files = files.filter((file) => !inside(file.path, op.path));
    }
    if (op.op === "write") {
      const match = /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(op.text);
      const meta = (match && yaml.load(match[1])) || {};
      const old = files.find((file) => file.path === op.path);
      const entry = { path: op.path, id: String(meta.id ?? old?.id ?? `path:${op.path}`), meta, body: match ? match[2] : op.text, version: old?.version };
      files = [...files.filter((file) => file.path !== op.path), entry];
    }
  }
  return { ...snapshot, folders, files };
}

// ---------- the layout file: what files can't say

export function layoutOf(state, pathOf) {
  const nodes = state.nodes;
  const layout = {
    subjects: state.subjects.map(pathOf),
    colors: Object.fromEntries(state.subjects.map((id) => [pathOf(id), nodes[id].color])),
  };
  const order = {};
  for (const node of Object.values(nodes)) {
    if (!isContainer(node)) continue;
    const keys = node.children.map((id) => keyOf(id, nodes, pathOf));
    const natural = defaultOrder(node.children, nodes).map((id) => keyOf(id, nodes, pathOf));
    if (keys.join("\u0000") !== natural.join("\u0000")) order[pathOf(node.id)] = keys;
  }
  if (Object.keys(order).length) layout.order = order;
  const expanded = Object.keys(state.expanded).filter((id) => state.expanded[id] && nodes[id]).map(pathOf).sort();
  if (expanded.length) layout.expanded = expanded;
  if (state.recent.length) layout.recent = [...state.recent];
  if (state.pinned.length) layout.pinned = [...state.pinned];
  return layout;
}

// ---------- file texts

const withHeader = (meta, body) => `---\n${yaml.dump(meta, { lineWidth: -1 })}---\n${body}`;

// A page's Markdown, worked out once per version of the page (a page changes by replacement).
const markdownOfPage = new WeakMap();
export function pageMarkdown(node) {
  if (!markdownOfPage.has(node)) markdownOfPage.set(node, noteHtmlToMarkdown(node.content));
  return markdownOfPage.get(node);
}

// A page's header. Without `stamps` (created, updated) it holds what an edit can change, which
// planSync compares to decide whether the file needs writing.
function pageHeader(state, parents, id, pathOf, stamps = {}) {
  const node = state.nodes[id];
  const alsoIn = (parents[id] ?? []).filter((parent) => parent !== node.home).map(pathOf);
  const meta = { id, title: node.name, ...stamps };
  if (alsoIn.length) meta.also_in = alsoIn;
  if (node.mastery !== null && node.mastery !== undefined) meta.mastery = node.mastery;
  return meta;
}

// The Markdown file for a page, quick note, source or chat in `state`. `pathOf` gives folder paths
// (for a page's also_in).
export function fileText(state, id, now = Date.now(), pathOf = (x) => x, parents = parentIndex(state)) {
  const stamp = iso(now);
  const node = state.nodes[id];
  if (node?.type === "page") {
    return withHeader(pageHeader(state, parents, id, pathOf, { created: node.created ?? stamp, updated: stamp }), pageMarkdown(node));
  }
  const note = state.quickNotes.find((n) => n.id === id);
  if (note) return withHeader({ id, created: iso(note.createdAt || now) }, `${note.text.trim()}\n`);
  const source = state.sources.find((s) => s.id === id);
  if (source) {
    const meta = clean({
      id,
      title: source.title,
      type: source.type,
      url: source.url,
      file: source.file,
      use: source.use !== false,
      created: iso(source.createdAt || now),
      updated: iso(source.updatedAt || now),
      pages: source.pageCount,
      read_pages: source.readPages,
      truncated: source.truncated,
    });
    return withHeader(meta, `${(source.content ?? "").replace(/\n$/, "")}\n`);
  }
  const chat = (state.chats ?? []).find((c) => c.id === id);
  if (chat) {
    const meta = { id, title: chat.title, created: iso(chat.created || now), updated: iso(chat.updated || now), context: chat.context ?? [] };
    return withHeader(meta, formatTurns(chat.turns));
  }
  throw new Error(`No page, quick note, source or chat has the id ${id}`);
}

// ---------- state changes → file operations

const parentOf = (state, parents, id) =>
  state.nodes[id].type === "page" ? state.nodes[id].home : (parents[id] ?? [])[0] ?? null;

const depth = (path) => path.split("/").length;

// The file operations that make the folder match `next`, given it matched `prev` at `paths`,
// and where everything is once they have run. A write names the version of the file it replaces
// (`versions`, by id), so a file changed on disk meanwhile is kept instead of overwritten.
export function planSync(prev, next, paths, versions = {}) {
  const prevParents = parentIndex(prev);
  const nextParents = parentIndex(next);

  // Each path belongs to one node. Two siblings with the same name (two new subjects called
  // "Biology") get "Biology" and "Biology (2)", as the service would name them, so the pages
  // planned inside each go into the right folder.
  const claimed = new Map(Object.entries(paths).map(([id, path]) => [path, id]));
  const claim = (id, path, ext) => {
    const stem = path.slice(0, path.length - ext.length);
    let candidate = path;
    for (let n = 2; claimed.has(candidate) && claimed.get(candidate) !== id; n++) candidate = `${stem} (${n})${ext}`;
    claimed.set(candidate, id);
    return candidate;
  };

  // Where each node of `next` belongs. A node whose name and parent didn't change keeps its
  // current file name (it may differ from its title, for example "Notes (2).md").
  const after = { [UNSORTED]: UNSORTED_DIR };
  const pathAfter = (id) => {
    if (id in after) return after[id];
    const node = next.nodes[id];
    const parent = parentOf(next, nextParents, id);
    const parentPath = parent ? pathAfter(parent) : "";
    const before = prev.nodes[id];
    const same = before && paths[id] && before.name === node.name && parentOf(prev, prevParents, id) === parent;
    const ext = node.type === "page" ? ".md" : "";
    const base = same ? basename(paths[id]) : sanitizeName(node.name) + ext;
    after[id] = claim(id, parentPath ? `${parentPath}/${base}` : base, ext);
    return after[id];
  };

  const mkdirs = [];
  const moves = [];
  const writes = [];
  const trashes = [];
  const current = { ...paths };
  const relocate = (from, to) => {
    for (const [id, path] of Object.entries(current)) current[id] = movedPath(path, from, to);
  };

  // Names are claimed in the order the sidebar shows them, so the first of two "Biology"s keeps
  // the plain name.
  const claimInOrder = (id) => {
    pathAfter(id);
    next.nodes[id]?.children?.forEach(claimInOrder);
  };
  next.subjects.forEach(claimInOrder);
  next.nodes[UNSORTED]?.children?.forEach(claimInOrder);

  // Subjects and folders, shallow first.
  const containers = Object.values(next.nodes).filter((n) => isContainer(n) && n.id !== UNSORTED).map((n) => n.id);
  containers.sort((a, b) => depth(pathAfter(a)) - depth(pathAfter(b)));
  for (const id of containers) {
    const target = pathAfter(id);
    if (!prev.nodes[id] || !current[id]) {
      mkdirs.push({ op: "mkdir", id, path: target });
      current[id] = target;
    } else if (current[id] !== target) {
      moves.push({ op: "move", id, from: current[id], to: target });
      relocate(current[id], target);
    }
  }

  // Pages. One is written when its file would say something else: another header, or other
  // Markdown. A page that didn't change is the same object, so its Markdown isn't worked out;
  // the editor tidying its HTML (an empty paragraph after a final list) leaves the Markdown alone.
  const headerOf = (state, parents, id, pathOf) => JSON.stringify(pageHeader(state, parents, id, pathOf));
  const fileChanged = (id) =>
    headerOf(prev, prevParents, id, (p) => paths[p]) !== headerOf(next, nextParents, id, pathAfter) ||
    (prev.nodes[id] !== next.nodes[id] && pageMarkdown(prev.nodes[id]) !== pageMarkdown(next.nodes[id]));
  const pageText = (id) => fileText(next, id, Date.now(), pathAfter, nextParents);
  for (const node of Object.values(next.nodes)) {
    if (node.type !== "page") continue;
    const target = pathAfter(node.id);
    if (!prev.nodes[node.id] || !current[node.id]) {
      writes.push({ op: "write", id: node.id, path: target, text: pageText(node.id), create: true });
      current[node.id] = target;
      continue;
    }
    if (current[node.id] !== target) {
      moves.push({ op: "move", id: node.id, from: current[node.id], to: target });
      current[node.id] = target;
    }
    if (fileChanged(node.id)) {
      writes.push({ op: "write", id: node.id, path: target, text: pageText(node.id), create: false, base: versions[node.id] });
    }
  }

  // What's gone: whole folders go to the trash in one piece; pages inside them go with them.
  const gone = Object.keys(prev.nodes).filter((id) => !next.nodes[id] && current[id]);
  const goneDirs = gone.filter((id) => isContainer(prev.nodes[id])).map((id) => current[id]);
  const insideGoneDir = (path) => goneDirs.some((dir) => path.startsWith(`${dir}/`));
  for (const id of gone) {
    const path = current[id];
    if (!insideGoneDir(path)) trashes.push({ op: "trash", id, path });
    delete current[id];
  }

  // Quick notes, sources and chats: written when their file would say something else.
  const listOps = (prevList, nextList, newPath) => {
    if (prevList === nextList) return; // nothing in it changed
    const before = new Map(prevList.map((item) => [item.id, item]));
    const nowIds = new Set(nextList.map((item) => item.id));
    for (const item of nextList) {
      if (before.get(item.id) === item) continue;
      if (!before.has(item.id) || !paths[item.id]) {
        current[item.id] = newPath(item);
        writes.push({ op: "write", id: item.id, path: current[item.id], text: fileText(next, item.id), create: true });
      } else if (fileText(prev, item.id, 0) !== fileText(next, item.id, 0)) {
        writes.push({ op: "write", id: item.id, path: paths[item.id], text: fileText(next, item.id), create: false, base: versions[item.id] });
      }
    }
    for (const item of prevList) {
      if (!nowIds.has(item.id) && paths[item.id]) {
        trashes.push({ op: "trash", id: item.id, path: paths[item.id] });
        delete current[item.id];
      }
    }
  };
  listOps(prev.quickNotes, next.quickNotes, (note) => `${QUICK_NOTES_DIR}/${stampName(note.createdAt || Date.now())}.md`);
  listOps(prev.sources, next.sources, (source) => `${SOURCES_DIR}/${sanitizeName(source.title)}.md`);
  listOps(prev.chats ?? [], next.chats ?? [], (chat) => `${CHATS_DIR}/${stampName(chat.created || Date.now())} ${sanitizeName(chat.title)}.md`);

  const ops = [...mkdirs, ...moves, ...writes, ...trashes];
  const before = layoutOf(prev, (id) => paths[id] ?? id);
  const nowLayout = layoutOf(next, pathAfter);
  if (JSON.stringify(before) !== JSON.stringify(nowLayout)) ops.push({ op: "layout", layout: nowLayout });
  return { ops, paths: current };
}
