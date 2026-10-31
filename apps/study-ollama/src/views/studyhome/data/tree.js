// Read-only questions about the study tree. State shape (see operations.js):
//   nodes:    { [id]: { id, type: "subject" | "folder" | "page", name, ... } }
//   subjects: [subject ids, in order]
//   plus the built-in "unsorted" container (see UNSORTED below)
// Subjects and folders list their contents in `children`. A page can sit in
// several folders; `home` names the one it lives in (its place in the graph
// and the default breadcrumb). A folder is in exactly one container.

// "Unsorted" is a built-in container for things that belong to no subject,
// e.g. what was kept when a subject was deleted. It always exists, can't be
// renamed or deleted, and isn't a subject.
export const UNSORTED = "unsorted";
export const UNSORTED_COLOR = "#8a9099";

export const isContainer = (node) => node.type === "subject" || node.type === "folder" || node.type === "unsorted";

// { childId: [parentIds] }, built once per state.
export function parentIndex(state) {
  const parents = {};
  Object.values(state.nodes).forEach((node) => {
    if (!isContainer(node)) return;
    node.children.forEach((childId) => (parents[childId] ??= []).push(node.id));
  });
  return parents;
}

export function homeOf(state, parents, id) {
  const node = state.nodes[id];
  const list = parents[id] ?? [];
  return node.type === "page" && list.includes(node.home) ? node.home : list[0] ?? null;
}

// Children that live here, as opposed to pages only linked in from elsewhere.
export function homeChildren(state, parents, containerId) {
  return state.nodes[containerId].children.filter((id) => homeOf(state, parents, id) === containerId);
}

// Containers from the subject down to `id`, following `via` for the last
// step when a page is opened from a folder it's linked into.
export function pathTo(state, parents, id, via = null) {
  const path = [];
  let current = via && (parents[id] ?? []).includes(via) ? via : homeOf(state, parents, id);
  while (current) {
    path.unshift(current);
    current = homeOf(state, parents, current);
  }
  return path;
}

// The subject an item is under, or UNSORTED for loose items.
export function subjectOf(state, parents, id) {
  const type = state.nodes[id].type;
  return type === "subject" || type === "unsorted" ? id : pathTo(state, parents, id)[0];
}

// Every folder inside a container (not the container itself), deepest last.
export function foldersInside(state, containerId) {
  const found = [];
  const walk = (id) =>
    state.nodes[id].children.forEach((childId) => {
      if (state.nodes[childId].type !== "folder") return;
      found.push(childId);
      walk(childId);
    });
  walk(containerId);
  return found;
}

// Unique pages anywhere inside a container.
export function pagesInside(state, containerId) {
  const containers = [containerId, ...foldersInside(state, containerId)];
  const pages = new Set();
  containers.forEach((id) => state.nodes[id].children.forEach((c) => state.nodes[c].type === "page" && pages.add(c)));
  return [...pages];
}

// True if `targetId` is `id` or sits somewhere inside it.
export function contains(state, id, targetId) {
  return id === targetId || (isContainer(state.nodes[id]) && foldersInside(state, id).includes(targetId));
}

export const allPages = (state) => Object.values(state.nodes).filter((n) => n.type === "page");

// Average mastery of the pages inside a container, or null if none studied.
export function containerMastery(state, containerId) {
  const known = pagesInside(state, containerId)
    .map((id) => state.nodes[id].mastery)
    .filter((m) => m !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

export function masteryOf(state, id) {
  const node = state.nodes[id];
  return node.type === "page" ? node.mastery : containerMastery(state, id);
}

// Page ids a page links to with [[wiki links]], resolved by page name. A wiki link is an
// <a> once the editor has shown the page, and a <span> as read from its file.
export function wikiTargets(state, pageId) {
  const html = state.nodes[pageId].content || "";
  const byName = new Map(allPages(state).map((p) => [p.name.trim().toLowerCase(), p.id]));
  const targets = new Set();
  for (const match of html.matchAll(/<(?:a|span)\b[^>]*data-type="wiki-link"[^>]*>/g)) {
    const href = /href="([^"]*)"/.exec(match[0])?.[1] ?? "";
    const id = state.nodes[href.replace(/\.md$/, "")]?.id ?? byName.get(decodeURIComponent(href).trim().toLowerCase());
    if (id && id !== pageId) targets.add(id);
  }
  return [...targets];
}
