import { describe, it, expect } from "vitest";
import * as op from "./operations";
import { parentIndex, pathTo, pagesInside, wikiTargets, homeOf } from "./tree";

// Builds: Biology / Cells / Respiration / Krebs, plus Biology / Notes page
// and a Chemistry subject.
function sample() {
  let s = op.EMPTY_STATE;
  let r = op.addSubject(s, { name: "Biology" });
  s = r.state;
  const bio = r.id;
  r = op.addChild(s, bio, "folder", "Cells");
  s = r.state;
  const cells = r.id;
  r = op.addChild(s, cells, "folder", "Respiration");
  s = r.state;
  const resp = r.id;
  r = op.addChild(s, resp, "page", "Krebs");
  s = r.state;
  const krebs = r.id;
  r = op.addChild(s, bio, "page", "Notes");
  s = r.state;
  const notes = r.id;
  r = op.addSubject(s, { name: "Chemistry" });
  return { s: r.state, bio, cells, resp, krebs, notes, chem: r.id };
}

describe("study tree operations", () => {
  it("nests folders to any depth and finds the path", () => {
    const { s, bio, cells, resp, krebs } = sample();
    expect(pathTo(s, parentIndex(s), krebs)).toEqual([bio, cells, resp]);
  });

  it("gives each new subject a free colour", () => {
    const { s, bio, chem } = sample();
    expect(s.nodes[bio].color).not.toBe(s.nodes[chem].color);
  });

  it("deleting only a folder moves its contents up into its place", () => {
    const { s, bio, cells, resp, notes } = sample();
    const next = op.deleteFolderKeepContents(s, cells, bio);
    expect(next.nodes[cells]).toBeUndefined();
    expect(next.nodes[bio].children).toEqual([resp, notes]);
  });

  it("a page moved up from a deleted folder now lives in the new place", () => {
    const { s, resp, krebs, cells } = sample();
    const next = op.deleteFolderKeepContents(s, resp, cells);
    expect(homeOf(next, parentIndex(next), krebs)).toBe(cells);
  });

  it("deleting a folder with contents removes everything inside", () => {
    const { s, cells, resp, krebs } = sample();
    const next = op.deleteContainerAndContents(s, cells);
    [cells, resp, krebs].forEach((id) => expect(next.nodes[id]).toBeUndefined());
  });

  it("a page linked elsewhere survives its folder being deleted", () => {
    const { s, cells, krebs, chem } = sample();
    const linked = op.link(s, krebs, chem);
    expect(op.deletionSummary(linked, cells)).toMatchObject({ folders: 1, pages: 1, survivors: 1 });
    const next = op.deleteContainerAndContents(linked, cells);
    expect(next.nodes[krebs]).toBeDefined();
    expect(homeOf(next, parentIndex(next), krebs)).toBe(chem);
  });

  it("links one page into many folders", () => {
    const { s, krebs, cells, chem } = sample();
    const next = op.link(op.link(s, krebs, cells), krebs, chem);
    expect(parentIndex(next)[krebs]).toHaveLength(3);
    expect(op.link(next, krebs, chem)).toBe(next); // already there
  });

  it("removing a page from its last folder deletes it", () => {
    const { s, resp, krebs } = sample();
    expect(op.removeFromFolder(s, krebs, resp).nodes[krebs]).toBeUndefined();
  });

  it("moves items, but never a folder into its own contents", () => {
    const { s, bio, cells, resp, krebs, chem } = sample();
    const moved = op.move(s, krebs, resp, chem);
    expect(moved.nodes[chem].children).toContain(krebs);
    expect(moved.nodes[resp].children).not.toContain(krebs);
    expect(op.move(s, cells, bio, resp)).toBe(s);
  });

  it("counts unique pages inside a container", () => {
    const { s, bio, krebs, cells } = sample();
    expect(pagesInside(op.link(s, krebs, cells), bio)).toHaveLength(2);
  });

  it("reads [[wiki links]] between pages by name", () => {
    const { s, krebs, notes } = sample();
    const html = '<p>See <a data-type="wiki-link" class="wiki-link" href="Krebs">Krebs</a></p>';
    expect(wikiTargets(op.setContent(s, notes, html), notes)).toEqual([krebs]);
  });

  it("deleting a subject clears it from recent pages too", () => {
    const { s, bio, krebs } = sample();
    const next = op.deleteContainerAndContents(op.visit(s, krebs), bio);
    expect(next.recent).toEqual([]);
    expect(next.subjects).toHaveLength(1);
  });
});

describe("pinned pages", () => {
  it("pinPage is idempotent", () => {
    const { s, krebs } = sample();
    expect(op.pinPage(op.pinPage(s, krebs), krebs).pinned).toEqual([krebs]);
    expect(op.unpinPage(s, "x")).toBe(s);
    expect(op.unpinPage(op.pinPage(s, krebs), krebs).pinned).toEqual([]);
  });

  it("deleting a page unpins it", () => {
    const { s, krebs } = sample();
    expect(op.deletePage(op.pinPage(s, krebs), krebs).pinned).toEqual([]);
  });
});

describe("graph data", () => {
  it("makes a dot for every subject, folder and page, with tree, also and wiki links", async () => {
    const { buildGraph } = await import("./graphData");
    const { s, krebs, notes, chem } = sample();
    const html = '<a data-type="wiki-link" href="Krebs">Krebs</a>';
    const state = op.setContent(op.link(s, krebs, chem), notes, html);
    const { nodes, links } = buildGraph(state, parentIndex(state));
    expect(nodes).toHaveLength(Object.keys(state.nodes).length - 1); // Unsorted itself is not a dot
    expect(links.filter((l) => l.kind === "also")).toEqual([{ source: chem, target: krebs, kind: "also" }]);
    expect(links.filter((l) => l.kind === "wiki")).toHaveLength(1);
  });

  it("with folders hidden, pages link straight to their subject", async () => {
    const { buildGraph } = await import("./graphData");
    const { s, bio, krebs } = sample();
    const { nodes, links } = buildGraph(s, parentIndex(s), { showFolders: false });
    expect(nodes.every((n) => n.type !== "folder")).toBe(true);
    expect(links).toContainEqual({ source: bio, target: krebs, kind: "tree" });
  });

  it("in Lokus's shape: pages are documents, quick notes loose placeholders, links point to where things live", async () => {
    const { lokusGraph, NOTE_PREFIX } = await import("./graphData");
    const { s, resp, krebs } = sample();
    const state = op.addQuickNote(s, "Ask about mitosis");
    const { nodes, links } = lokusGraph(state, parentIndex(state));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId[krebs].type).toBe("document");
    expect(byId[resp].type).toBe("folder");
    expect(links).toContainEqual({ source: krebs, target: resp, kind: "tree" });
    expect(byId[resp].backlinkCount).toBe(1);
    const note = nodes.find((n) => n.id.startsWith(NOTE_PREFIX));
    expect(note).toMatchObject({ type: "placeholder", label: "Ask about mitosis" });
    expect(links.some((l) => l.source === note.id || l.target === note.id)).toBe(false);
  });

  it("filters to one subject", async () => {
    const { buildGraph } = await import("./graphData");
    const { s, chem } = sample();
    expect(buildGraph(s, parentIndex(s), { subject: chem }).nodes.map((n) => n.id)).toEqual([chem]);
  });

  it("a local graph is a page and what it's directly connected to", async () => {
    const { localGraph } = await import("./graphData");
    const { s, resp, krebs, notes, chem } = sample();
    const html = '<a data-type="wiki-link" href="Krebs">Krebs</a>';
    const state = op.setContent(op.link(s, krebs, chem), notes, html);
    const ids = localGraph(state, parentIndex(state), krebs).nodes.map((n) => n.id).sort();
    expect(ids).toEqual([resp, krebs, notes, chem].sort());
  });
});

describe("unsorted", () => {
  it("deleting only a subject sends its contents to Unsorted", async () => {
    const { UNSORTED } = await import("./tree");
    const { s, bio, cells, notes } = sample();
    const next = op.deleteSubjectKeepContents(s, bio);
    expect(next.nodes[bio]).toBeUndefined();
    expect(next.nodes[UNSORTED].children).toEqual([cells, notes]);
    expect(homeOf(next, parentIndex(next), notes)).toBe(UNSORTED);
    expect(next.subjects).not.toContain(bio);
  });

  it("Unsorted can't be renamed or deleted", async () => {
    const { UNSORTED } = await import("./tree");
    const { s } = sample();
    expect(op.rename(s, UNSORTED, "Other")).toBe(s);
    expect(op.deleteContainerAndContents(s, UNSORTED).nodes[UNSORTED]).toBeDefined();
  });

  it("loose items are dots with no link to a subject", async () => {
    const { buildGraph } = await import("./graphData");
    const { s, bio, cells } = sample();
    const next = op.deleteSubjectKeepContents(s, bio);
    const { nodes, links } = buildGraph(next, parentIndex(next));
    expect(nodes.find((n) => n.id === cells)).toBeDefined();
    expect(links.some((l) => l.target === cells)).toBe(false);
  });
});

describe("sources", () => {
  it("adds several at once, newest first, all ticked; untick, edit and delete", () => {
    let s = op.addSources(op.EMPTY_STATE, [{ type: "link", url: "https://a.org", title: "a.org" }]);
    s = op.addSources(s, [
      { type: "text", title: "Lecture 1", content: "Cells divide." },
      { type: "file", title: "slides", fileName: "slides.pdf", fileSize: 2048 },
    ]);
    expect(s.sources.map((x) => x.title)).toEqual(["Lecture 1", "slides", "a.org"]);
    expect(s.sources.every((x) => x.use && x.createdAt && x.content !== undefined)).toBe(true);

    const [lecture, slides] = s.sources;
    s = op.setSourcesUse(s, [slides.id], false);
    expect(s.sources.find((x) => x.id === slides.id).use).toBe(false);
    s = op.updateSource(s, lecture.id, { title: "Lecture one" });
    expect(s.sources.find((x) => x.id === lecture.id).title).toBe("Lecture one");
    s = op.deleteSource(s, slides.id);
    expect(s.sources).toHaveLength(2);
  });
});

describe("mastery", () => {
  it("sets a page's mastery, or clears it with null", () => {
    const { s, krebs } = sample();
    const known = op.setMastery(s, krebs, 0.8);
    expect(known.nodes[krebs].mastery).toBe(0.8);
    expect(op.setMastery(known, krebs, null).nodes[krebs].mastery).toBeNull();
    expect(op.mutations.setMastery).toBe(op.setMastery);
  });

  it("ignores anything that isn't a page or a value in 0..1", () => {
    const { s, bio, krebs } = sample();
    expect(op.setMastery(s, bio, 0.5)).toBe(s);
    expect(op.setMastery(s, "gone", 0.5)).toBe(s);
    expect(op.setMastery(s, krebs, 1.5)).toBe(s);
    expect(op.setMastery(s, krebs, Number.NaN)).toBe(s);
  });
});

describe("chats", () => {
  it("adds, appends, renames and deletes, newest first", () => {
    expect(op.EMPTY_STATE.chats).toEqual([]);
    let r = op.addChat(op.EMPTY_STATE, { id: "a", title: "First", context: ["p1"], now: 1000 });
    expect(r.id).toBe("a");
    expect(r.state.chats).toEqual([{ id: "a", title: "First", created: 1000, updated: 1000, context: ["p1"], turns: [] }]);
    let s = op.addChat(r.state, { id: "b", title: "Second", now: 2000 }).state;
    expect(s.chats.map((c) => c.id)).toEqual(["b", "a"]);

    s = op.appendTurn(s, "a", { who: "you", text: "Why?" }, 3000);
    s = op.appendTurn(s, "a", { who: "kratt", text: "Because." }, 4000);
    expect(s.chats.map((c) => c.id)).toEqual(["a", "b"]);
    expect(s.chats[0]).toMatchObject({ updated: 4000, created: 1000, turns: [{ who: "you", text: "Why?" }, { who: "kratt", text: "Because." }] });

    s = op.renameChat(s, "b", "  Renamed  ");
    expect(s.chats.find((c) => c.id === "b").title).toBe("Renamed");
    expect(op.renameChat(s, "b", " ").chats.find((c) => c.id === "b").title).toBe("New chat");

    s = op.setChatContext(s, "a", ["p2", "s1"]);
    expect(s.chats.find((c) => c.id === "a").context).toEqual(["p2", "s1"]);

    s = op.deleteChat(s, "a");
    expect(s.chats.map((c) => c.id)).toEqual(["b"]);
    for (const name of ["addChat", "appendTurn", "renameChat", "setChatContext", "deleteChat"]) expect(op.mutations[name]).toBe(op[name]);
  });
});
