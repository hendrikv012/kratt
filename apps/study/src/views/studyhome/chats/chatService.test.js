import { describe, expect, it } from "vitest";
import { stateFromSnapshot } from "../data/vaultState";
import { VaultOffline } from "../data/vaultClient";
import { SAMPLE_SNAPSHOT } from "../data/testing/fakeVault";
import { buildPrompt, ChatError, citationsIn, createChatService, gatherContext, INSTRUCTIONS, MEMORY } from "./chatService";

const bytes = (s) => new TextEncoder().encode(s).length;
const { state } = stateFromSnapshot(SAMPLE_SNAPSHOT);

const turns = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? "kratt" : "you", text: `${i}:` + "x".repeat(897) }));

describe("buildPrompt", () => {
  it("fits each memory budget", () => {
    const sent = {};
    for (const memory of ["short", "normal", "long"]) {
      const { prompt, sentFrom } = buildPrompt({ question: "Why?", context: [], turns, memory });
      expect(bytes(prompt)).toBeLessThanOrEqual(MEMORY[memory]);
      sent[memory] = sentFrom;
    }
    expect(sent.short).toBeGreaterThan(sent.long);
  });

  it("drops oldest turns first", () => {
    const { prompt, sentFrom } = buildPrompt({ question: "Why?", context: [], turns, memory: "short" });
    expect(prompt).toContain(turns[39].text);
    expect(prompt).not.toContain(turns[0].text);
    expect(sentFrom).toBeGreaterThan(0);
    expect(buildPrompt({ question: "Why?", context: [], turns: [], memory: "short" }).sentFrom).toBe(0);
  });

  it("context takes at most half and the page goes first", () => {
    const page = { title: "Big page", markdown: Array.from({ length: 300 }, (_, i) => `Paragraph ${i} ` + "y".repeat(90)).join("\n\n") };
    expect(bytes(page.markdown)).toBeGreaterThan(30000);
    const other = { title: "Subject page", markdown: "Short." };
    const { prompt } = buildPrompt({ question: "Why?", context: [page, other], turns: [], memory: "normal" });
    const notes = prompt.slice(prompt.indexOf("# Notes\n") + 8, prompt.indexOf("\n# Conversation"));
    expect(bytes(notes)).toBeLessThanOrEqual(12288);
    expect(notes.endsWith("\n")).toBe(true);
    expect(notes.slice(0, notes.indexOf("## [[Subject page]]"))).toMatch(/Paragraph \d+ y{90}\n$/); // cut on a whole paragraph
    expect(prompt.indexOf("[[Big page]]")).toBeGreaterThan(-1);
    expect(prompt.indexOf("[[Big page]]")).toBeLessThan(prompt.indexOf("[[Subject page]]") === -1 ? Infinity : prompt.indexOf("[[Subject page]]"));
  });

  it("refuses a question too long for the budget", () => {
    const question = "q".repeat(9000);
    try {
      buildPrompt({ question, context: [], turns: [], memory: "short" });
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatError);
      expect(error.code).toBe("too-long");
    }
    expect(bytes(INSTRUCTIONS)).toBeLessThan(MEMORY.short);
  });
});

describe("gatherContext", () => {
  it("gives a page whole and a subject's pages cut", () => {
    expect(gatherContext(state, ["p1"])).toEqual([{ title: "Krebs cycle", markdown: "Runs in the **matrix**.\n" }]);
    expect(gatherContext(state, ["Biology"]).map((c) => c.title)).toEqual(["Krebs cycle"]);
  });
});

describe("citationsIn", () => {
  it("finds citations", () => {
    expect(citationsIn("See [[krebs cycle]] and [[Nope]]", state)).toEqual([{ id: "p1", title: "Krebs cycle" }]);
  });
});

describe("createChatService", () => {
  const ask = (rejection) =>
    createChatService({ client: { notebookAsk: () => Promise.reject(rejection) }, address: () => "http://x:1" }).ask({
      question: "Why?",
      context: [],
      turns: [],
      memory: "normal",
    });

  it("returns the answer and where the sent turns start", async () => {
    const client = { notebookAsk: async () => ({ output: "Because." }) };
    const result = await createChatService({ client, address: () => "a" }).ask({ question: "Why?", context: [], turns: [], memory: "normal" });
    expect(result).toEqual({ answer: "Because.", sentFrom: 0 });
  });

  it("maps errors", async () => {
    await expect(ask(new VaultOffline())).rejects.toMatchObject({ code: "offline" });
    await expect(ask(new Error("ai-auth"))).rejects.toMatchObject({ code: "ai-auth" });
    await expect(ask(new Error("boom"))).rejects.toMatchObject({ code: "ai-unavailable" });
  });

  it("asks Ollama, not Open Notebook, when the AI runs on this computer", async () => {
    const client = { localAsk: async (prompt) => ({ output: prompt.includes("Why?") ? "Local." : "?" }), notebookAsk: () => Promise.reject(new Error("no")) };
    const result = await createChatService({ client, address: () => "a", local: () => true }).ask({ question: "Why?", context: [], turns: [], memory: "normal" });
    expect(result.answer).toBe("Local.");
  });

  it("maps local errors to messages that say what to do", async () => {
    const askLocal = (rejection) =>
      createChatService({ client: { localAsk: () => Promise.reject(rejection) }, address: () => "a", local: () => true }).ask({
        question: "Why?",
        context: [],
        turns: [],
        memory: "normal",
      });
    await expect(askLocal(new Error("ollama-missing"))).rejects.toMatchObject({ code: "ollama-missing", message: expect.stringContaining("ollama.com") });
    await expect(askLocal(new Error("no-model"))).rejects.toMatchObject({ code: "no-model", message: expect.stringContaining("Settings > AI") });
    await expect(askLocal(new Error("boom"))).rejects.toMatchObject({ code: "ollama-unavailable" });
    await expect(askLocal(new VaultOffline())).rejects.toMatchObject({ code: "offline" });
  });
});
