import { describe, it, expect } from "vitest";
import * as op from "./operations";
import { parentIndex, pathTo, pagesInside, wikiTargets, homeOf, foldersInside } from "./tree";

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

describe("moveTo and moveSubject", () => {
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
  it("returns the same state for no-ops", () => {
    const { s, bio, chem, cells, notes } = sample();
    expect(op.moveTo(s, cells, bio, bio, 0)).toBe(s);
    expect(op.moveTo(s, notes, bio, bio, 99)).toBe(s);
    expect(op.moveTo(s, chem, bio, bio, 0)).toBe(s);
    expect(op.moveSubject(s, bio, 0)).toBe(s);
  });
});

describe("duplicate", () => {
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
    expect(state.nodes[notesCopy].content).toContain('href="Bonds"');
    expect(state.nodes[notesCopy].content).toContain('target="Bonds"');
  });
  it("gives a copied page a fresh created date, not the original's", () => {
    let { s, bio, notes } = sample();
    s = { ...s, nodes: { ...s.nodes, [notes]: { ...s.nodes[notes], created: 1234 } } };
    const { state, id } = op.duplicate(s, bio, null, null, 1);
    const notesCopy = state.nodes[id].children.find((c) => state.nodes[c].name === "Notes");
    expect(state.nodes[notesCopy].created).toBeUndefined();
    expect(state.nodes[notes].created).toBe(1234);
  });
  it("copies a page whose link has a stray % in its name", () => {
    let { s, bio, notes } = sample();
    s = op.setContent(s, notes, '<p><span data-type="wiki-link" target="100% done" href="100% done"></span></p>');
    const { state, id } = op.duplicate(s, bio, null, null, 1);
    const notesCopy = state.nodes[id].children.find((c) => state.nodes[c].name === "Notes");
    expect(state.nodes[notesCopy].content).toContain('href="100% done"');
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
    const r = op.duplicate(s, "unsorted", null, null, 0);
    expect(r.state).toBe(s);
    expect(r.id).toBeUndefined();
  });
  it("a name shared by several pages resolves to the one in the linking page's subject", () => {
    let { s, bio, notes, chem, krebs } = sample();
    const r = op.addChild(s, chem, "page", "Krebs");
    s = op.setContent(r.state, notes, '<p><span data-type="wiki-link" target="Krebs" href="Krebs"></span></p>');
    expect(wikiTargets(s, notes)).toEqual([krebs]);
  });
});

describe("source subjects", () => {
  function withSource() {
    const base = sample();
    const s = op.addSources(base.s, [{ type: "link", title: "L" }]);
    return { ...base, s, id: s.sources[0].id };
  }

  it("new sources start with no subjects", () => {
    const { s } = withSource();
    expect(s.sources[0].subjects).toEqual([]);
  });

  it("adds a subject once", () => {
    const { s, id, bio } = withSource();
    const a = op.addSourceToSubject(s, id, bio);
    expect(a.sources[0].subjects).toEqual([bio]);
    expect(op.addSourceToSubject(a, id, bio)).toBe(a);
  });

  it("ignores ids that are not subjects", () => {
    const { s, id, bio, chem, cells } = withSource();
    expect(op.addSourceToSubject(s, id, cells)).toBe(s);
    expect(op.setSourceSubjects(s, id, [bio, "nope", bio, chem]).sources[0].subjects).toEqual([bio, chem]);
  });

  it("moves between subjects", () => {
    const { s, id, bio, chem } = withSource();
    const a = op.addSourceToSubject(s, id, bio);
    expect(op.moveSourceToSubject(a, id, bio, chem).sources[0].subjects).toEqual([chem]);
  });

  it("removes a subject", () => {
    const { s, id, bio, chem } = withSource();
    const a = op.setSourceSubjects(s, id, [bio, chem]);
    const b = op.removeSourceFromSubject(a, id, bio);
    expect(b.sources[0].subjects).toEqual([chem]);
    expect(op.removeSourceFromSubject(b, id, bio)).toBe(b);
  });

  it("membership changes keep updatedAt", () => {
    const { s, id, bio, chem } = withSource();
    const at = s.sources[0].updatedAt;
    const a = op.addSourceToSubject(s, id, bio);
    const b = op.moveSourceToSubject(a, id, bio, chem);
    const c = op.removeSourceFromSubject(b, id, chem);
    const d = op.setSourceSubjects(c, id, [bio]);
    [a, b, c, d].forEach((x) => expect(x.sources[0].updatedAt).toBe(at));
  });

  it("deleting a subject keeps its sources and drops the link", () => {
    const { s, id, bio, chem } = withSource();
    const a = op.setSourceSubjects(s, id, [bio, chem]);
    [op.deleteSubjectKeepContents, op.deleteContainerAndContents].forEach((del) => {
      const next = del(a, bio);
      expect(next.sources).toHaveLength(1);
      expect(next.sources[0].subjects).toEqual([chem]);
    });
  });

  it("renaming a source keeps its subjects", () => {
    const { s, id, bio } = withSource();
    const a = op.addSourceToSubject(s, id, bio);
    expect(op.updateSource(a, id, { title: "New" }).sources[0].subjects).toEqual([bio]);
  });
});
