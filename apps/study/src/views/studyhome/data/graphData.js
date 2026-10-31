// Turns the study tree into dots and links for the force graph, the way
// Lokus and Obsidian draw a vault: every subject, folder and page is a dot;
// links are where things live, extra folders a page is in, and [[links]].

import { allPages, homeOf, masteryOf, pathTo, subjectOf, wikiTargets, UNSORTED } from "./tree";

const SIZE = { subject: 7, folder: 4.5, page: 3 };

// filters: { showFolders, showPages, subject (id or "all"), search }
// When folders are hidden, a page links straight to its subject instead.
export function buildGraph(state, parents, filters = {}) {
  const { showFolders = true, showPages = true, subject = "all" } = filters;
  const visibleType = (type) => type === "subject" || (type === "folder" ? showFolders : showPages);

  const nodes = Object.values(state.nodes)
    .filter((n) => n.id !== UNSORTED && visibleType(n.type))
    .map((n) => {
      const subjectId = subjectOf(state, parents, n.id);
      return {
        id: n.id,
        type: n.type,
        name: n.name,
        subject: subjectId,
        color: state.nodes[subjectId]?.color,
        mastery: masteryOf(state, n.id),
        size: SIZE[n.type],
      };
    })
    .filter((n) => subject === "all" || n.subject === subject);

  const shown = new Set(nodes.map((n) => n.id));
  // The nearest visible container on the way up from an item.
  const visibleParent = (id) => {
    const path = pathTo(state, parents, id);
    for (let i = path.length - 1; i >= 0; i--) if (shown.has(path[i])) return path[i];
    return null;
  };

  const links = [];
  const seen = new Set();
  const add = (source, target, kind) => {
    if (!source || !target || source === target || !shown.has(source) || !shown.has(target)) return;
    const key = [source, target].sort().join(":") + kind;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, kind });
  };

  nodes.forEach((n) => {
    if (n.type !== "subject") add(visibleParent(n.id), n.id, "tree");
  });
  Object.values(state.nodes).forEach((container) => {
    if (!container.children || container.id === UNSORTED) return;
    container.children.forEach((childId) => {
      if (state.nodes[childId].type === "page" && homeOf(state, parents, childId) !== container.id) {
        add(container.id, childId, "also");
      }
    });
  });
  allPages(state).forEach((page) => wikiTargets(state, page.id).forEach((target) => add(page.id, target, "wiki")));

  return { nodes, links };
}

// Just a page and what it's directly connected to: its folders, the pages
// it links to and the pages that link to it.
export function localGraph(state, parents, pageId) {
  const full = buildGraph(state, parents);
  const ends = (l) => [l.source.id ?? l.source, l.target.id ?? l.target];
  const near = new Set([pageId]);
  full.links.forEach((l) => {
    const [a, b] = ends(l);
    if (a === pageId) near.add(b);
    if (b === pageId) near.add(a);
  });
  return {
    nodes: full.nodes.filter((n) => near.has(n.id)),
    links: full.links.filter((l) => ends(l).every((id) => near.has(id))),
  };
}

// Ids of a dot and its direct neighbours, for hover highlighting.
export function neighbourhood(graph, id) {
  const ids = new Set([id]);
  graph.links.forEach((l) => {
    const a = l.source.id ?? l.source;
    const b = l.target.id ?? l.target;
    if (a === id) ids.add(b);
    if (b === id) ids.add(a);
  });
  return ids;
}

// ---------- The same data in the shape Lokus's graph view draws ----------
// Lokus draws notes as "document" dots and unresolved links as gray
// "placeholder" dots, sized by length and by how many dots point at them.
// Here pages are documents, subjects and folders are folders, and quick
// notes are placeholders: on their own until they're filed somewhere.
// Links point from an item to where it lives, so containers collect
// backlinks and grow, the way linked-to notes do in Lokus.

export const NOTE_PREFIX = "note:";

const wordCount = (html = "") => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
// Lokus's own sizing for a note (core/graph/GraphData.js).
const documentSize = (words) => Math.max(6, Math.min(20, 6 + Math.log10(words + 1) * 2));

export function lokusGraph(state, parents) {
  const base = buildGraph(state, parents);
  const nodes = base.nodes.map((n) => {
    const node = state.nodes[n.id];
    const words = n.type === "page" ? wordCount(node.content) : undefined;
    return {
      id: n.id,
      type: n.type === "page" ? "document" : "folder",
      kind: n.type,
      title: n.name,
      label: n.name,
      mastery: n.mastery,
      size: n.type === "page" ? documentSize(words) : 8,
      backlinkCount: 0,
      metadata: {
        path: pathTo(state, parents, n.id).map((id) => state.nodes[id].name).concat(n.name).join("/"),
        wordCount: words,
        created: node.createdAt,
        modified: node.updatedAt,
      },
    };
  });
  state.quickNotes.forEach((note) => {
    const text = note.text.length > 40 ? `${note.text.slice(0, 40).trim()}…` : note.text;
    nodes.push({
      id: NOTE_PREFIX + note.id,
      type: "placeholder",
      kind: "note",
      isPlaceholder: true,
      title: text,
      label: text,
      mastery: null,
      size: 6,
      backlinkCount: 0,
      metadata: { created: note.createdAt },
    });
  });

  // Tree links run parent -> child in buildGraph; Lokus points them the
  // other way (child -> where it lives). [[links]] keep their direction.
  const links = base.links.map((l) =>
    l.kind === "wiki" ? { source: l.source, target: l.target, kind: l.kind } : { source: l.target, target: l.source, kind: l.kind }
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  links.forEach((l) => {
    const target = byId.get(l.target);
    if (target) target.backlinkCount += 1;
  });
  return { nodes, links };
}

// A page and everything directly connected to it, in Lokus's shape.
export function lokusLocalGraph(state, parents, pageId) {
  const full = lokusGraph(state, parents);
  const near = neighbourhood(full, pageId);
  return {
    nodes: full.nodes.filter((n) => near.has(n.id)),
    links: full.links.filter((l) => near.has(l.source) && near.has(l.target)),
  };
}
