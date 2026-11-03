import { describe, expect, it, vi } from "vitest";
import { ChatError, MEMORY, byteLength } from "../chats/chatService";
import { chatTitle } from "../chats/format";
import { splitIntoParts } from "./notes";
import { TARGETS, buildArtifactPrompt, createArtifactMaker, fixedPromptBytes, retryPrompt, targetFor } from "./maker";

const CARDS = "# Krebs\n\n### A?\nOne\n\n### B?\nTwo\n\n### C?\nThree\n";
const note = { id: "p1", title: "Krebs cycle", markdown: "It runs in the matrix and makes ATP." };
const make = (maker, extra = {}) => maker.make({ type: "flashcards", notes: [note], topic: "", memory: "normal", ...extra });

describe("targetFor", () => {
  it("scales with the part and stays within the limits", () => {
    expect(targetFor("flashcards", 4000)).toBe(10);
    expect(targetFor("flashcards", 10)).toBe(TARGETS.flashcards.min);
    expect(targetFor("slides", 100000)).toBe(TARGETS.slides.max);
    expect(targetFor("quiz", 3000)).toBe(5);
  });
});

describe("buildArtifactPrompt", () => {
  it("names the format, target and topic", () => {
    const prompt = buildArtifactPrompt({ type: "quiz", partText: "THE NOTES", part: 1, of: 1, topic: "Krebs", made: [], target: 5 });
    expect(prompt).toContain("- [x]");
    expect(prompt).toContain("about 5");
    expect(prompt).toContain("Topic: Krebs");
    expect(prompt).toContain("THE NOTES");
    expect(prompt).not.toContain("Part 1 of 1");
  });

  it("lists what earlier parts made", () => {
    const prompt = buildArtifactPrompt({ type: "slides", partText: "x", part: 2, of: 3, topic: "T", made: ["Cells", "Atoms"], target: 4 });
    expect(prompt).toContain("Part 2 of 3");
    expect(prompt).toContain("Cells\nAtoms");
  });

  it("fixedPromptBytes is the prompt without notes and with the full made allowance", () => {
    for (const type of ["flashcards", "slides", "quiz"]) {
      const worst = buildArtifactPrompt({ type, partText: "", part: 12, of: 12, topic: "T", made: ["m".repeat(1024)], target: TARGETS[type].max });
      expect(fixedPromptBytes(type, "T")).toBeGreaterThanOrEqual(byteLength(worst));
    }
  });
});

describe("retry and made limits", () => {
  it("a retry prompt with many problems still fits Chat memory", () => {
    const problems = Array.from({ length: 200 }, (_, i) => `Question ${i + 1} has no correct answer.`);
    for (const type of ["flashcards", "slides", "quiz"]) {
      const room = MEMORY.short - fixedPromptBytes(type, "T");
      const partText = "n".repeat(room);
      const prompt = buildArtifactPrompt({ type, partText, part: 99, of: 99, topic: "T", made: ["m".repeat(1024)], target: TARGETS[type].max });
      const retry = retryPrompt(prompt, problems);
      expect(byteLength(retry)).toBeLessThanOrEqual(MEMORY.short);
      expect(retry).toContain("- …");
      expect(retry).toContain("Question 1 has no correct answer.");
    }
  });

  it("the made list, line breaks included, stays within 1024 bytes", () => {
    const made = Array.from({ length: 300 }, (_, i) => `Card ${i}`);
    const prompt = buildArtifactPrompt({ type: "flashcards", partText: "", part: 2, of: 2, topic: "T", made, target: 5 });
    const list = prompt.slice(prompt.indexOf("already made:\n") + 14, prompt.indexOf("\nTopic:"));
    expect(byteLength(list)).toBeLessThanOrEqual(1024);
    expect(list.endsWith("Card 299")).toBe(true);
  });
});

describe("createArtifactMaker", () => {
  it("makes an artifact from one part", async () => {
    const send = vi.fn(async () => CARDS);
    const onProgress = vi.fn();
    const result = await make(createArtifactMaker({ send }), { onProgress });
    expect(result).toMatchObject({ title: "Krebs", parts: 1, sourceBytes: byteLength(note.markdown) });
    expect(result.items).toHaveLength(3);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain(note.markdown);
    expect(onProgress).toHaveBeenCalledWith({ part: 1, of: 1 });
  });

  it("retries once, telling Kratt what was wrong", async () => {
    const send = vi.fn().mockResolvedValueOnce("### Q\n- [ ] a\n- [ ] b\n").mockResolvedValueOnce("### Q\n- [ ] a\n- [x] b\n");
    const result = await make(createArtifactMaker({ send }), { type: "quiz" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toContain("Question 1 has no correct answer.");
    expect(send.mock.calls[1][0]).toContain("Answer again, in exactly the format above.");
    expect(result.items).toHaveLength(1);
  });

  it("fails after one retry", async () => {
    for (const [type, word] of [["quiz", "questions"], ["flashcards", "cards"], ["slides", "slides"]]) {
      const send = vi.fn(async () => "   ");
      await expect(make(createArtifactMaker({ send }), { type })).rejects.toMatchObject({
        name: "ChatError",
        code: "artifact-unreadable",
        message: `Kratt couldn't make these ${word}. Try again.`,
      });
      expect(send).toHaveBeenCalledTimes(2);
    }
  });

  it("keeps nothing when the retry is only partly right", async () => {
    const mixed = "### Q\n- [ ] a\n- [x] b\n\n### Bad\n- [ ] a\n- [ ] b\n";
    const send = vi.fn(async () => mixed);
    await expect(make(createArtifactMaker({ send }), { type: "quiz" })).rejects.toMatchObject({ code: "artifact-unreadable" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("slides are titled by their first slide, which stays", async () => {
    const send = async () => "# Cells\nSmall\n\n---\n\n# Atoms\nSmaller\n";
    const result = await make(createArtifactMaker({ send }), { type: "slides", topic: "Something else" });
    expect(result.title).toBe("Cells");
    expect(result.items.map((i) => i.title)).toEqual(["Cells", "Atoms"]);
  });

  it("passes send errors through", async () => {
    const send = async () => {
      throw new ChatError("offline", "No service");
    };
    await expect(make(createArtifactMaker({ send }))).rejects.toMatchObject({ code: "offline" });
  });

  it("cancels without sending when already aborted, and after an answer", async () => {
    const send = vi.fn(async () => CARDS);
    const early = new AbortController();
    early.abort();
    await expect(make(createArtifactMaker({ send }), { signal: early.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(send).not.toHaveBeenCalled();
    const late = new AbortController();
    const slow = async () => {
      late.abort();
      return CARDS;
    };
    await expect(make(createArtifactMaker({ send: slow }), { signal: late.signal })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("title falls back to the topic, then the first note", async () => {
    const send = async () => "### A?\nOne\n";
    expect((await make(createArtifactMaker({ send }), { topic: "Why do cells need ATP and how is it made in mitochondria?" })).title).toBe(chatTitle("Why do cells need ATP and how is it made in mitochondria?"));
    expect((await make(createArtifactMaker({ send }))).title).toBe("Krebs cycle");
  });
});

describe("several parts", () => {
  const big = (id, n = 400) => ({ id, title: id, markdown: Array.from({ length: n }, (_, i) => `Paragraph ${id}${i} ` + "y".repeat(90)).join("\n\n") });
  const roomFor = (type, notes, memory) => MEMORY[memory] - fixedPromptBytes(type, notes.map((n) => n.title).join(", "));
  const tail = (prompt) => prompt.slice(prompt.indexOf("# Notes\n") + 8);
  const counting = (type = "flashcards") => {
    let n = 0;
    return vi.fn(async () => {
      n++;
      if (type === "slides") return `# Slide ${n}a\nx\n\n---\n\n# Slide ${n}b\ny\n`;
      return `### Card ${n}a?\nA\n\n### Card ${n}b?\nB\n`;
    });
  };
  const rebuild = (parts, id) =>
    parts.flatMap((p) => p.pieces).filter((p) => p.noteId === id).sort((a, b) => a.k - b.k).map((p) => p.markdown).join("");

  it("every part is sent", async () => {
    const notes = [big("a", 330), big("b", 330)];
    const parts = splitIntoParts(notes, roomFor("flashcards", notes, "short"));
    expect(parts.length).toBeGreaterThan(2);
    const send = counting();
    const result = await make(createArtifactMaker({ send }), { notes, memory: "short" });
    expect(send).toHaveBeenCalledTimes(parts.length);
    send.mock.calls.forEach(([prompt], i) => {
      expect(byteLength(prompt)).toBeLessThanOrEqual(MEMORY.short);
      expect(tail(prompt)).toBe(parts[i].text);
    });
    expect(result.parts).toBe(parts.length);
    expect(result.items).toHaveLength(parts.length * 2);
  });

  it("nothing is left out", async () => {
    const notes = [big("a", 200), big("b", 200)];
    const parts = splitIntoParts(notes, roomFor("flashcards", notes, "short"));
    const send = counting();
    await make(createArtifactMaker({ send }), { notes, memory: "short" });
    const sent = send.mock.calls.map(([p]) => tail(p));
    parts.forEach((part, i) => part.pieces.forEach((piece) => expect(sent[i]).toContain(piece.markdown)));
    for (const n of notes) expect(rebuild(parts, n.id)).toBe(n.markdown);
  });

  it("target scales with the part", async () => {
    const send = vi.fn(async () => CARDS);
    await make(createArtifactMaker({ send }), { notes: [{ id: "x", title: "x", markdown: "z".repeat(4000) }] });
    expect(send.mock.calls[0][0]).toContain("about 10 cards");
    await make(createArtifactMaker({ send }), { notes: [{ id: "x", title: "x", markdown: "z".repeat(200) }] });
    expect(send.mock.calls[1][0]).toContain("about 3 cards");
  });

  it("later parts list what's made", async () => {
    const notes = [big("a", 200)];
    const send = counting();
    await make(createArtifactMaker({ send }), { notes, memory: "short" });
    expect(send.mock.calls[0][0]).not.toContain("Card 1a");
    expect(send.mock.calls[1][0]).toContain("Card 1a?\nCard 1b?");
    const longFronts = (n) => `### ${"F".repeat(100)}${n}?\nA\n\n`;
    let k = 0;
    const many = vi.fn(async () => {
      k++;
      return Array.from({ length: 20 }, (_, i) => longFronts(k * 100 + i)).join("");
    });
    await make(createArtifactMaker({ send: many }), { notes: [big("a", 300)], memory: "short" });
    const last = many.mock.calls[2][0];
    const list = last.slice(last.indexOf("already made:\n") + 14, last.indexOf("\nTopic:"));
    expect(byteLength(list)).toBeLessThanOrEqual(1024);
    expect(list.endsWith("219?")).toBe(true);
    expect(list).not.toContain("F".repeat(100) + "100?");
  });

  it("joining removes duplicates", async () => {
    const notes = [big("a", 200)];
    const cards = vi.fn().mockResolvedValueOnce("### Krebs cycle\nfirst\n").mockResolvedValue("### ' krebs  CYCLE '\nsecond\n".replace("' krebs  CYCLE '", " krebs  CYCLE ") + "\n### Other\nx\n");
    const r = await make(createArtifactMaker({ send: cards }), { notes, memory: "short" });
    expect(r.items.filter((i) => i.front.trim().toLowerCase().replace(/\s+/g, " ") === "krebs cycle")).toEqual([{ front: "Krebs cycle", back: "first" }]);
    const q = (t) => `### ${t}\n- [ ] a\n- [x] b\n> why\n`;
    const quiz = vi.fn().mockResolvedValueOnce(q("What is ATP?")).mockResolvedValue(q(" what is  atp? ") + "\n" + q("Other?"));
    const rq = await make(createArtifactMaker({ send: quiz }), { type: "quiz", notes, memory: "short" });
    expect(rq.items.filter((i) => /what is\s+atp\?/i.test(i.question))).toHaveLength(1);
    const slides = vi.fn().mockResolvedValueOnce("# Cells\nx\n\n---\n\n# Atoms\ny\n").mockResolvedValue("# cells \nrepeat\n\n---\n\n# Ions\nz\n");
    const rs = await make(createArtifactMaker({ send: slides }), { type: "slides", notes, memory: "short" });
    expect(rs.items.map((i) => i.title)).toEqual(["Cells", "Atoms", "Ions", "Ions", "Ions"].slice(0, rs.items.length));
    expect(rs.items.filter((i) => i.title.trim().toLowerCase() === "cells")).toHaveLength(1);
  });

  it("slides: part 2's first slide matching the topic is dropped", async () => {
    const slides = vi.fn().mockResolvedValueOnce("# Intro\nx\n").mockResolvedValue("# Mitosis  Notes\nrepeat\n\n---\n\n# Ions\nz\n");
    const r = await make(createArtifactMaker({ send: slides }), { type: "slides", notes: [big("a", 200)], topic: "mitosis notes", memory: "short" });
    expect(r.items.some((i) => /mitosis/i.test(i.title))).toBe(false);
  });

  it("a failing part stops everything", async () => {
    const notes = [big("a", 135)];
    expect(splitIntoParts(notes, roomFor("flashcards", notes, "short")).length).toBe(3);
    const send = vi.fn().mockResolvedValueOnce(CARDS).mockResolvedValue("junk");
    await expect(make(createArtifactMaker({ send }), { notes, memory: "short" })).rejects.toMatchObject({
      code: "artifact-unreadable",
      message: "Kratt couldn't make part 2 of 3 of these cards. Try again.",
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("progress", async () => {
    const notes = [big("a", 135)];
    const onProgress = vi.fn();
    await make(createArtifactMaker({ send: counting() }), { notes, memory: "short", onProgress });
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([{ part: 1, of: 3 }, { part: 2, of: 3 }, { part: 3, of: 3 }]);
  });

  it("cancel", async () => {
    const notes = [big("a", 135)];
    const ctl = new AbortController();
    let n = 0;
    const send = vi.fn(async () => {
      if (++n === 2) ctl.abort();
      return `### Card ${n}?\nA\n`;
    });
    await expect(make(createArtifactMaker({ send }), { notes, memory: "short", signal: ctl.signal })).rejects.toMatchObject({ name: "ChatError", code: "cancelled" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("multi-byte notes keep every prompt within Chat memory", async () => {
    const notes = [{ id: "m", title: "m", markdown: "é🙂a".repeat(100000 / 7 | 0) + "é🙂a".repeat(0) }];
    notes[0].markdown = "é🙂a".repeat(Math.ceil(100000 / byteLength("é🙂a")));
    const send = vi.fn(async () => "### A?\n1\n\n### B?\n2\n\n### C?\n3\n");
    await make(createArtifactMaker({ send }), { notes, memory: "short" });
    expect(send.mock.calls.length).toBeGreaterThan(1);
    for (const [prompt] of send.mock.calls) expect(byteLength(prompt)).toBeLessThanOrEqual(8192);
  });
});


it("reserves enough prompt space for more than 99 parts, including retries", () => {
  const room = MEMORY.short - fixedPromptBytes("flashcards", "Topic");
  const prompt = buildArtifactPrompt({ type: "flashcards", topic: "Topic", part: 10000, of: 10000, partText: "x".repeat(room), made: ["m".repeat(1024)], target: 15 });
  expect(byteLength(retryPrompt(prompt, ["A".repeat(500)]))).toBeLessThanOrEqual(MEMORY.short);
});
