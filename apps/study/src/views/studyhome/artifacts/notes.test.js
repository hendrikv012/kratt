import { describe, expect, it } from "vitest";
import { ChatError, byteLength } from "../chats/chatService";
import { gatherFull, splitIntoParts } from "./notes";

// Small seeded PRNG so a failure reproduces.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ["word ", "é", "🙂", "\n", "\n\n", "\n# Head\n", "\n## Sub\n", "日本語 ", "line of text. "];
function randomMarkdown(rand, size) {
  let out = "";
  while (out.length < size) out += PIECES[Math.floor(rand() * PIECES.length)];
  return out;
}

const page = (id, name, html) => ({ id, type: "page", name, content: html });
function makeState() {
  const long = "x".repeat(3000);
  return {
    nodes: {
      s1: { id: "s1", type: "subject", name: "Bio", children: ["p1", "p2"] },
      p1: page("p1", "Cells", `<p>${long}</p>`),
      p2: page("p2", "Energy", "<p>ATP</p>"),
      p3: page("p3", "Loose", "<p>hi</p>"),
    },
    sources: [{ id: "src1", title: "Paper", content: "Source text" }],
  };
}

describe("gatherFull", () => {
  it("takes a page whole", () => {
    const state = makeState();
    const [note] = gatherFull(state, ["p1"]);
    expect(note.id).toBe("p1");
    expect(note.title).toBe("Cells");
    expect(byteLength(note.markdown)).toBeGreaterThan(2048);
    expect(note.markdown).toContain("x".repeat(3000));
  });
  it("takes a subject as every page, whole", async () => {
    const state = makeState();
    const { pagesInside } = await import("../data/tree");
    const notes = gatherFull(state, ["s1"]);
    expect(notes.map((n) => n.id)).toEqual(pagesInside(state, "s1"));
    expect(notes.length).toBe(2);
  });
  it("takes a source", () => {
    expect(gatherFull(makeState(), ["src1"])).toEqual([{ id: "src1", title: "Paper", markdown: "Source text" }]);
  });
  it("includes the same page once", () => {
    const notes = gatherFull(makeState(), ["p1", "s1", "p1"]);
    expect(notes.filter((n) => n.id === "p1").length).toBe(1);
  });
  it("skips unknown ids", () => {
    expect(gatherFull(makeState(), ["nope"])).toEqual([]);
  });
});

const note = (id, markdown, title = id) => ({ id, title, markdown });
const rebuild = (parts, id) =>
  parts
    .flatMap((p) => p.pieces)
    .filter((p) => p.noteId === id)
    .sort((a, b) => a.k - b.k)
    .map((p) => p.markdown)
    .join("");

describe("splitIntoParts", () => {
  it("packs small notes in order into one part", () => {
    const notes = [1, 2, 3].map((i) => note(`n${i}`, "a".repeat(100)));
    const parts = splitIntoParts(notes, 2048);
    expect(parts.length).toBe(1);
    expect(parts[0].pieces.length).toBe(3);
    expect(parts[0].pieces.every((p) => p.n === 1)).toBe(true);
    expect(parts[0].text).toBe(notes.map((n) => `## [[${n.title}]]\n${n.markdown}\n`).join(""));
  });

  it("no part is larger than room", () => {
    const rand = rng(42);
    for (const base of [8192, 24576, 49152]) {
      const room = base - 1500;
      const notes = Array.from({ length: 8 }, (_, i) => note(`n${i}`, randomMarkdown(rand, Math.floor(rand() * 60000)), `Title ${i} é`));
      for (const part of splitIntoParts(notes, room)) expect(byteLength(part.text)).toBeLessThanOrEqual(room);
    }
  });

  it("loses nothing", () => {
    const rand = rng(7);
    const random = Array.from({ length: 6 }, (_, i) => note(`r${i}`, randomMarkdown(rand, 1 + Math.floor(rand() * 40000))));
    const hard = note("hard", "é🙂a".repeat(100000 / 7));
    const headed = note("h", Array.from({ length: 40 }, (_, i) => `# Section ${i}\n\n${"para text. ".repeat(60)}\n\nmore\nlines\n`).join("\n"));
    const notes = [...random, hard, headed];
    for (const room of [700, 4096, 6692]) {
      const parts = splitIntoParts(notes, room);
      for (const n of notes) expect(rebuild(parts, n.id)).toBe(n.markdown);
    }
  });

  it("splits at a heading when one fits", () => {
    const md = "# A\n" + "a".repeat(3000) + "\n## B\n" + "b".repeat(3000);
    const parts = splitIntoParts([note("n", md)], 4096);
    const pieces = parts.flatMap((p) => p.pieces);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[1].markdown.startsWith("## B")).toBe(true);
  });

  it("falls back to a blank line, then a line break", () => {
    const blank = "a".repeat(3000) + "\n\n" + "b".repeat(3000);
    expect(splitIntoParts([note("n", blank)], 4096).flatMap((p) => p.pieces)[1].markdown.startsWith("b")).toBe(true);
    const line = "a".repeat(3000) + "\n" + "b".repeat(3000);
    expect(splitIntoParts([note("n", line)], 4096).flatMap((p) => p.pieces)[1].markdown.startsWith("b")).toBe(true);
  });

  it("labels pieces", () => {
    const parts = splitIntoParts([note("n", "a".repeat(2500), "T")], 1200);
    const pieces = parts.flatMap((p) => p.pieces);
    expect(pieces.length).toBe(3);
    pieces.forEach((p, i) => expect(p.k).toBe(i + 1));
    const text = parts.map((p) => p.text).join("");
    for (let k = 1; k <= 3; k++) expect(text).toContain(`## [[T]] (part ${k} of 3)\n`);
  });

  it("throws when room is too small", () => {
    expect.assertions(2);
    try {
      splitIntoParts([note("n", "a")], 511);
    } catch (error) {
      expect(error).toBeInstanceOf(ChatError);
      expect(error.code).toBe("too-long");
    }
  });

  it("cuts a very long title in the header only", () => {
    const title = "t".repeat(1000);
    const [part] = splitIntoParts([note("n", "body", title)], 2048);
    const header = part.text.split("\n")[0];
    expect(byteLength(header)).toBeLessThanOrEqual(200 + byteLength("## [[]]"));
    expect(part.pieces[0].title).toBe(title);
  });

  it("always moves forward on text made only of U+FFFD", { timeout: 5000 }, () => {
    const md = "\uFFFD".repeat(2000);
    const parts = splitIntoParts([note("f", md, "x")], 512);
    for (const part of parts) expect(byteLength(part.text)).toBeLessThanOrEqual(512);
    expect(rebuild(parts, "f")).toBe(md);
  });

  it("throws when room is not a number", () => {
    expect(() => splitIntoParts([note("n", "a")], NaN)).toThrow(ChatError);
    expect(() => splitIntoParts([note("n", "a")], undefined)).toThrow(ChatError);
  });
});
