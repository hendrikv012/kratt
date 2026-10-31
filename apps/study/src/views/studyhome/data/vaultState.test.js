import { describe, expect, it } from "vitest";
import { mutations } from "./operations";
import { UNSORTED, wikiTargets } from "./tree";
import { applyOps, planSync, sanitizeName, stateFromSnapshot } from "./vaultState";

const snapshot = {
  folders: ["Biology", "Biology/Cells", "Quick notes", "Sources", "Unsorted"],
  files: [
    { path: "Biology/Cells/Krebs cycle.md", id: "p1", meta: { id: "p1", title: "Krebs cycle", also_in: ["Biology"] }, body: "Runs in the **matrix**.\n", version: "v1" },
    { path: "Unsorted/Loose idea.md", id: "p2", meta: { id: "p2", title: "Loose idea" }, body: "Idea.\n", version: "v2" },
    { path: "Quick notes/2026-10-07 15-32.md", id: "q1", meta: { id: "q1", created: "2026-10-07T15:32:00Z" }, body: "Buy milk\n", version: "v3" },
    { path: "Sources/Lecture.md", id: "s1", meta: { id: "s1", title: "Lecture", type: "link", url: "https://e.org", use: true }, body: "Text.\n", version: "v4" },
  ],
  layout: { subjects: ["Biology"], colors: { Biology: "#4c90f0" } },
};

it("builds the app's state from the files", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const [subject] = state.subjects;
  expect(state.nodes[subject].name).toBe("Biology");
  const folder = state.nodes[subject].children.find((id) => state.nodes[id].type === "folder");
  expect(state.nodes[folder].children).toContain("p1");
  expect(state.nodes[subject].children).toContain("p1");
  expect(state.nodes.p1.content).toContain("<strong>matrix</strong>");
  expect(state.nodes[UNSORTED].children).toEqual(["p2"]);
  expect(state.quickNotes[0]).toMatchObject({ id: "q1", text: "Buy milk" });
  expect(state.sources[0]).toMatchObject({ id: "s1", title: "Lecture", url: "https://e.org", use: true });
  expect(paths.p1).toBe("Biology/Cells/Krebs cycle.md");
});

it("typing only rewrites that page", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const next = mutations.setContent(state, "p1", "<p>New text.</p>");
  const { ops } = planSync(state, next, paths);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ op: "write", id: "p1", path: "Biology/Cells/Krebs cycle.md", create: false });
  expect(ops[0].text).toMatch(/^---\nid: p1\ntitle: Krebs cycle\n[\s\S]*also_in:\n\s*- Biology\n---\nNew text\.\n$/);
});

it("opening a page writes nothing when the editor only tidies its HTML", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  // The editor adds an empty paragraph after a page that ends in a list, and reports it.
  const tidied = mutations.setContent(state, "p1", `${state.nodes.p1.content}<p></p>`);
  expect(planSync(state, tidied, paths).ops).toEqual([]);
});

it("renaming moves the file and keeps the id", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const { ops } = planSync(state, mutations.rename(state, "p1", "Citric: acid/cycle"), paths);
  expect(ops[0]).toEqual({ op: "move", id: "p1", from: "Biology/Cells/Krebs cycle.md", to: "Biology/Cells/Citric- acid-cycle.md" });
  expect(ops[1]).toMatchObject({ op: "write", id: "p1", path: "Biology/Cells/Citric- acid-cycle.md" });
  expect(ops[1].text).toContain("title: 'Citric: acid/cycle'");
});

it("a new subject with a page makes the folder first", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const { state: s1, id: subject } = mutations.addSubject(state, { name: "Chemistry" });
  const { state: s2, id: page } = mutations.addChild(s1, subject, "page", "Atoms");
  const { ops } = planSync(state, s2, paths);
  expect(ops.map((o) => o.op)).toEqual(["mkdir", "write", "layout"]);
  expect(ops[0]).toMatchObject({ path: "Chemistry" });
  expect(ops[1]).toMatchObject({ id: page, path: "Chemistry/Atoms.md", create: true });
});

it("deleting a page moves it to the trash", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  expect(planSync(state, mutations.deletePage(state, "p2"), paths).ops).toEqual([{ op: "trash", id: "p2", path: "Unsorted/Loose idea.md" }]);
});

it("a quick note and a source become their own files", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const { ops } = planSync(state, mutations.setSourcesUse(mutations.addQuickNote(state, "Call Sam"), ["s1"], false), paths);
  expect(ops.find((o) => o.op === "write" && o.create).path).toMatch(/^Quick notes\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}\.md$/);
  expect(ops.find((o) => o.id === "s1").text).toContain("use: false");
});

it("two new subjects with the same name get their own folders, and their pages follow", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const subject = mutations.addSubject(state, { name: "Biology" });
  const page = mutations.addChild(subject.state, subject.id, "page", "Mitosis");
  const added = subject.id;
  const { ops } = planSync(state, page.state, paths);
  expect(ops.find((op) => op.op === "mkdir" && op.id === added).path).toBe("Biology (2)");
  expect(ops.find((op) => op.op === "write" && op.create).path).toBe("Biology (2)/Mitosis.md");
});

it("pages are saved and read in the same Markdown as Lokus notes", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const table = '<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>A</p></th></tr><tr><td colspan="1" rowspan="1"><p>1</p></td></tr></tbody></table>';
  const [op] = planSync(state, mutations.setContent(state, "p1", `${table}<p><s>gone</s> <u>under</u></p>`), paths).ops;
  expect(op.text).toMatch(/---\n\| A \|\n\| --- \|\n\| 1 \|\n\n~~gone~~ <u>under<\/u>\n$/);
  const reread = stateFromSnapshot({ ...snapshot, files: [{ ...snapshot.files[0], body: "~~gone~~ and [[Glycolysis|the first step]]\n" }] });
  expect(reread.state.nodes.p1.content).toContain("<s>gone</s>");
  expect(reread.state.nodes.p1.content).toContain('target="Glycolysis|the first step"');
});

it("a page read from its file links to the pages it names, as the graph shows", () => {
  const body = "See [[Krebs cycle]] and [[Krebs cycle|the cycle]].\n";
  const { state } = stateFromSnapshot({ ...snapshot, files: snapshot.files.map((f) => (f.id === "p2" ? { ...f, body } : f)) });
  expect(wikiTargets(state, "p2")).toEqual(["p1"]);
});

it("a change to a page's header alone rewrites its file", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const next = { ...state, nodes: { ...state.nodes, p1: { ...state.nodes.p1, mastery: 0.8 } } };
  const { ops } = planSync(state, next, paths);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ op: "write", id: "p1", create: false });
  expect(ops[0].text).toContain("mastery: 0.8");
});

it("says where everything is once the plan has run", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  let next = mutations.rename(state, "p1", "Citric acid cycle");
  next = mutations.deletePage(next, "p2");
  next = mutations.addQuickNote(next, "Call Sam");
  const after = planSync(state, next, paths).paths;
  expect(after.p1).toBe("Biology/Cells/Citric acid cycle.md");
  expect(after).not.toHaveProperty("p2");
  expect(after[next.quickNotes[0].id]).toMatch(/^Quick notes\/.+\.md$/);
  // Krebs cycle is also in Biology, so it outlives its folder and moves up.
  expect(planSync(state, mutations.deleteContainerAndContents(state, "Biology/Cells"), paths).paths.p1).toBe("Biology/Krebs cycle.md");
  const emptied = planSync(state, mutations.deleteContainerAndContents(state, "Biology"), paths).paths;
  for (const id of ["Biology", "Biology/Cells", "p1"]) expect(emptied).not.toHaveProperty(id);
});

it("names are kept short enough for any file system, like the service's", () => {
  const name = sanitizeName("é".repeat(300));
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
  expect(name).toBe("é".repeat(100));
});

it("drops pins whose page is gone", () => {
  const { state } = stateFromSnapshot({ ...snapshot, layout: { ...snapshot.layout, pinned: ["p1", "gone", "Biology"] } });
  expect(state.pinned).toEqual(["p1"]);
});

it("writes pins to the layout", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const { ops } = planSync(state, mutations.pinPage(state, "p1"), paths);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ op: "layout" });
  expect(ops[0].layout.pinned).toEqual(["p1"]);
});

it("Chats folder is never a subject", () => {
  const { state, paths } = stateFromSnapshot({
    folders: ["Chats", "Chats/old"],
    files: [
      { path: "Chats/a.md", id: "c1", meta: { id: "c1", title: "Krebs", created: "2026-10-20T09:58:00Z", updated: "2026-10-20T10:12:00Z", context: ["p1"] }, body: "### You\nWhy?\n\n### Kratt\nBecause.\n", version: "v1" },
      { path: "Chats/old/b.md", id: "c2", meta: { id: "c2", title: "Old" }, body: "### You\nHi\n", version: "v2" },
    ],
    layout: {},
  });
  expect(state.subjects.map((id) => state.nodes[id].name)).not.toContain("Chats");
  expect(state.nodes.Chats).toBeUndefined();
  expect(state.chats).toHaveLength(1);
  expect(state.chats[0]).toEqual({
    id: "c1",
    title: "Krebs",
    created: Date.parse("2026-10-20T09:58:00Z"),
    updated: Date.parse("2026-10-20T10:12:00Z"),
    context: ["p1"],
    turns: [{ who: "you", text: "Why?" }, { who: "kratt", text: "Because." }],
  });
  expect(paths.c1).toBe("Chats/a.md");
});

it("lists chats newest first", () => {
  const chat = (id, updated) => ({ path: `Chats/${id}.md`, id, meta: { id, title: id, created: updated, updated }, body: "", version: id });
  const { state } = stateFromSnapshot({
    folders: ["Chats"],
    files: [chat("old", "2026-10-01T09:00:00Z"), chat("new", "2026-10-20T09:00:00Z"), chat("mid", "2026-10-10T09:00:00Z")],
    layout: {},
  });
  expect(state.chats.map((c) => c.id)).toEqual(["new", "mid", "old"]);
});

it("writes a new chat and its turns", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const now = Date.parse("2026-10-20T09:58:00Z");
  const { state: added } = mutations.addChat(state, { id: "c9", title: "Krebs cycle, step by step", context: ["p1"], now });
  const next = mutations.appendTurn(added, "c9", { who: "you", text: "Walk me through it." }, now + 60e3);
  const { ops } = planSync(state, next, paths);
  const writes = ops.filter((o) => o.op === "write");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ id: "c9", create: true });
  expect(writes[0].path).toMatch(/^Chats\/\d{4}-\d{2}-\d{2} \d{2}-\d{2} Krebs cycle, step by step\.md$/);
  expect(writes[0].text).toContain("### You\nWalk me through it.\n");
  expect(writes[0].text).toMatch(/^---\nid: c9\ntitle: Krebs cycle, step by step\ncreated: '?2026-10-20T09:58:00\.000Z'?\nupdated: '?2026-10-20T09:59:00\.000Z'?\ncontext:\n\s*- p1\n---\n### You\n/);

  // Read back, the file gives the same chat.
  const back = stateFromSnapshot(applyOps(snapshot, ops));
  expect(back.state.chats.find((c) => c.id === "c9")).toEqual(next.chats.find((c) => c.id === "c9"));
});

it("a chat that didn't change writes nothing; one that did is rewritten in place", () => {
  const files = [{ path: "Chats/2026-10-20 09-58 Krebs.md", id: "c1", meta: { id: "c1", title: "Krebs", created: "2026-10-20T09:58:00Z", updated: "2026-10-20T09:58:00Z", context: [] }, body: "### You\nWhy?\n", version: "v1" }];
  const { state, paths, versions } = stateFromSnapshot({ folders: ["Chats"], files, layout: {} });
  expect(planSync(state, mutations.visit(state, "nothing"), paths).ops).toEqual([]);
  const renamed = mutations.renameChat(state, "c1", "Krebs, renamed");
  const { ops } = planSync(state, renamed, paths, { c1: versions["Chats/2026-10-20 09-58 Krebs.md"] });
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ op: "write", path: "Chats/2026-10-20 09-58 Krebs.md", create: false, base: "v1" });
  expect(ops[0].text).toContain("title: Krebs, renamed");
});

it("deletes a chat to the trash", () => {
  const files = [{ path: "Chats/2026-10-20 09-58 Krebs.md", id: "c1", meta: { id: "c1", title: "Krebs" }, body: "### You\nWhy?\n", version: "v1" }];
  const { state, paths } = stateFromSnapshot({ folders: ["Chats"], files, layout: {} });
  expect(planSync(state, mutations.deleteChat(state, "c1"), paths).ops).toEqual([{ op: "trash", id: "c1", path: "Chats/2026-10-20 09-58 Krebs.md" }]);
});

it("a copied subject's link to its copied page survives saving and reading the files", () => {
  const files = [
    { path: "Biology/Krebs cycle.md", id: "k1", meta: { id: "k1", title: "Krebs cycle" }, body: "Steps.\n", version: "v1" },
    { path: "Biology/Notes.md", id: "n1", meta: { id: "n1", title: "Notes" }, body: "See [[Krebs cycle]].\n", version: "v2" },
  ];
  const base = { folders: ["Biology"], files, layout: { subjects: ["Biology"] } };
  const { state, paths } = stateFromSnapshot(base);
  const { state: next, id } = mutations.duplicate(state, state.subjects[0], null, null, 1);
  const { ops } = planSync(state, next, paths);
  const back = stateFromSnapshot(applyOps(base, ops)).state;
  const copied = back.nodes[back.subjects[1]].children.map((c) => back.nodes[c]);
  const notes = copied.find((p) => p.name === "Notes");
  const krebs = copied.find((p) => p.name === "Krebs cycle");
  expect(back.nodes[back.subjects[1]].name).toBe(next.nodes[id].name);
  expect(wikiTargets(back, notes.id)).toEqual([krebs.id]);
  expect(wikiTargets(back, "n1")).toEqual(["k1"]);
});

it("a copied page keeps its link to a page outside the copy through saving and reading", () => {
  const files = [
    { path: "Biology/Notes.md", id: "n1", meta: { id: "n1", title: "Notes" }, body: "See [[Bonds]].\n", version: "v1" },
    { path: "Chemistry/Bonds.md", id: "b1", meta: { id: "b1", title: "Bonds" }, body: "Atoms.\n", version: "v2" },
  ];
  const base = { folders: ["Biology", "Chemistry"], files, layout: { subjects: ["Biology", "Chemistry"] } };
  const { state, paths } = stateFromSnapshot(base);
  const { state: next } = mutations.duplicate(state, state.subjects[0], null, null, 1);
  const back = stateFromSnapshot(applyOps(base, planSync(state, next, paths).ops)).state;
  const copySubject = back.subjects.find((s) => back.nodes[s].name === "Biology (copy)");
  const copy = back.nodes[copySubject].children.map((c) => back.nodes[c]).find((p) => p.name === "Notes");
  expect(wikiTargets(back, copy.id)).toEqual(["b1"]);
});

describe("a source's subjects", () => {
  const withSubjects = (list) => ({
    ...snapshot,
    files: snapshot.files.map((f) => (f.id === "s1" ? { ...f, meta: { ...f.meta, subjects: list } } : f)),
  });
  const sourceWrites = (ops) => ops.filter((o) => o.op === "write" && o.id === "s1");

  it("reads a source's subjects", () => {
    const { state } = stateFromSnapshot(withSubjects(["Biology", "Gone", "Biology"]));
    expect(state.sources[0].subjects).toEqual(["Biology"]);
  });

  it("an old source without subjects is Unsorted and isn't rewritten", () => {
    const { state, paths } = stateFromSnapshot(snapshot);
    expect(state.sources[0].subjects).toEqual([]);
    const { ops } = planSync(state, mutations.setContent(state, "p1", "<p>x</p>"), paths);
    expect(ops.filter((o) => o.id === "s1")).toEqual([]);
  });

  it("adding a subject rewrites only that source", () => {
    const { state, paths, versions } = stateFromSnapshot(snapshot);
    const { ops } = planSync(state, mutations.addSourceToSubject(state, "s1", "Biology"), paths, { s1: versions["Sources/Lecture.md"] });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "write", id: "s1", path: "Sources/Lecture.md", create: false, base: "v4" });
    expect(ops[0].text).toMatch(/\nsubjects:\n\s*- Biology\n/);
  });

  it("removing the last subject drops the key", () => {
    const { state, paths } = stateFromSnapshot(withSubjects(["Biology"]));
    const [write] = sourceWrites(planSync(state, mutations.setSourceSubjects(state, "s1", []), paths).ops);
    expect(write.text).not.toContain("subjects:");
  });

  it("renaming a subject rewrites its linked sources", () => {
    const { state, paths } = stateFromSnapshot(withSubjects(["Biology"]));
    const { ops } = planSync(state, mutations.rename(state, "Biology", "Bio"), paths);
    expect(ops).toContainEqual({ op: "move", id: "Biology", from: "Biology", to: "Bio" });
    const [write] = sourceWrites(ops);
    expect(write.text).toMatch(/- Bio\n/);
    expect(write.text).not.toMatch(/- Biology/);
  });

  it("a new subject is written by its folder name", () => {
    const { state, paths } = stateFromSnapshot(snapshot);
    const { state: added, id } = mutations.addSubject(state, { name: "Physics" });
    const [write] = sourceWrites(planSync(state, mutations.addSourceToSubject(added, "s1", id), paths).ops);
    expect(write.text).toMatch(/- Physics\n/);
  });

  it("renaming a source keeps its subjects", () => {
    const { state, paths } = stateFromSnapshot(withSubjects(["Biology"]));
    const [write] = sourceWrites(planSync(state, mutations.updateSource(state, "s1", { title: "Talk" }), paths).ops);
    expect(write.text).toMatch(/title: Talk/);
    expect(write.text).toMatch(/- Biology/);
  });

  it("a linked source isn't rewritten when a page is edited", () => {
    const { state, paths } = stateFromSnapshot(withSubjects(["Biology"]));
    const { ops } = planSync(state, mutations.setContent(state, "p1", "<p>x</p>"), paths);
    expect(ops.filter((o) => o.id === "s1")).toEqual([]);
  });

  it("renaming another subject doesn't rewrite a source", () => {
    const { state, paths } = stateFromSnapshot({ ...withSubjects(["Biology"]), folders: [...snapshot.folders, "Chemistry"] });
    const { ops } = planSync(state, mutations.rename(state, "Chemistry", "Chem"), paths);
    expect(ops).toContainEqual({ op: "move", id: "Chemistry", from: "Chemistry", to: "Chem" });
    expect(ops.filter((o) => o.id === "s1")).toEqual([]);
  });

  describe.each(["deleteSubjectKeepContents", "deleteContainerAndContents"])("%s", (remove) => {
    const deleting = (list) => {
      const { state, paths, versions } = stateFromSnapshot({ ...withSubjects(list), folders: [...snapshot.folders, "Chemistry"] });
      return planSync(state, mutations[remove](state, "Biology"), paths, { s1: versions["Sources/Lecture.md"] }).ops;
    };

    it("unlinks the source and never trashes it", () => {
      const ops = deleting(["Biology"]);
      const [write] = sourceWrites(ops);
      expect(write).toMatchObject({ op: "write", id: "s1", base: "v4" });
      expect(write.text).not.toContain("subjects:");
      expect(ops.filter((o) => o.op === "trash" && o.id === "s1")).toEqual([]);
    });

    it("keeps the source's other subjects", () => {
      const ops = deleting(["Biology", "Chemistry"]);
      const [write] = sourceWrites(ops);
      expect(write.text).toMatch(/\nsubjects:\n\s*- Chemistry\n/);
      expect(write.text).not.toMatch(/- Biology/);
      expect(ops.filter((o) => o.op === "trash" && o.id === "s1")).toEqual([]);
    });
  });

  it("reads a single hand-written subject as a list", () => {
    const { state } = stateFromSnapshot(withSubjects("Biology"));
    expect(state.sources[0].subjects).toEqual(["Biology"]);
  });

  describe("other header keys", () => {
    const withExtra = (meta) => ({
      ...snapshot,
      files: snapshot.files.map((f) => (f.id === "s1" ? { ...f, meta: { ...f.meta, ...meta } } : f)),
    });

    it("are kept when the source is rewritten", () => {
      const { state, paths } = stateFromSnapshot(withExtra({ tags: ["a", "b"], aliases: "Talk" }));
      const [write] = sourceWrites(planSync(state, mutations.addSourceToSubject(state, "s1", "Biology"), paths).ops);
      expect(write.text).toMatch(/\ntags:\n\s*- a\n\s*- b\n/);
      expect(write.text).toMatch(/\naliases: Talk\n/);
      expect(write.text).toMatch(/- Biology\n/);
    });

    it("never override the keys the app writes", () => {
      const { state, paths } = stateFromSnapshot(withExtra({ tags: ["a"] }));
      const [write] = sourceWrites(planSync(state, mutations.updateSource(state, "s1", { title: "Talk" }), paths).ops);
      expect(write.text.match(/\ntitle:/g)).toHaveLength(1);
      expect(write.text).toMatch(/\ntitle: Talk\n/);
    });

    it("don't make an unchanged source rewrite", () => {
      const { state, paths } = stateFromSnapshot(withExtra({ tags: ["a", "b"], subjects: ["Biology"] }));
      const { ops } = planSync(state, mutations.setContent(state, "p1", "<p>x</p>"), paths);
      expect(ops.filter((o) => o.id === "s1")).toEqual([]);
    });
  });
});
