import { describe, expect, it, vi } from "vitest";
import { createAiService, PROMPT_LIMIT, RATE_LIMIT } from "./onClient";
import { VaultOffline } from "../data/vaultClient";

const fakeClient = (impl = async (address, prompt) => ({ output: `answer to ${prompt}` })) => ({ notebookAsk: vi.fn(impl) });

describe("the AI behind extensions' ai.ask", () => {
  it("sends the prompt to the Open Notebook address in settings and returns the answer", async () => {
    const client = fakeClient();
    let address = "http://localhost:5055";
    const ai = createAiService({ client, address: () => address });
    await expect(ai.ask("a.one", "2+2?")).resolves.toBe("answer to 2+2?");
    address = "http://notes.local:5055";
    await ai.ask("a.one", "again");
    expect(client.notebookAsk.mock.calls).toEqual([
      ["http://localhost:5055", "2+2?"],
      ["http://notes.local:5055", "again"],
    ]);
  });

  it("allows each extension 20 asks in a rolling minute", async () => {
    let t = 0;
    const client = fakeClient();
    const ai = createAiService({ client, address: () => "http://localhost:5055", now: () => t });
    for (let i = 0; i < RATE_LIMIT; i++) await ai.ask("a.one", "q");
    await expect(ai.ask("a.one", "q")).rejects.toMatchObject({ code: "limit" });
    await expect(ai.ask("a.two", "q")).resolves.toBe("answer to q"); // its own allowance
    t = 61_000;
    await expect(ai.ask("a.one", "q")).resolves.toBe("answer to q");
    expect(client.notebookAsk).toHaveBeenCalledTimes(RATE_LIMIT + 2);
  });

  it("refuses a prompt over 50 KB without sending it", async () => {
    const client = fakeClient();
    const ai = createAiService({ client, address: () => "http://localhost:5055" });
    const tooLong = "é".repeat(PROMPT_LIMIT / 2 + 1); // two bytes each in UTF-8
    await expect(ai.ask("a.one", tooLong)).rejects.toMatchObject({ code: "limit" });
    expect(client.notebookAsk).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("ai-unavailable"), /Start Kratt's engine/],
    [new Error("ai-auth"), /password/],
    [new VaultOffline(), /Study folder service/],
    [new Error("The Open Notebook address must start with http:// or https://"), /http:\/\//],
  ])("answers %s as ai-unavailable with a plain message", async (failure, message) => {
    const ai = createAiService({ client: fakeClient(async () => Promise.reject(failure)), address: () => "x" });
    const error = await ai.ask("a.one", "q").catch((e) => e);
    expect(error).toMatchObject({ code: "ai-unavailable" });
    expect(error.message).toMatch(message);
  });

  it("sends the prompt to Ollama when the AI runs on this computer", async () => {
    const client = { notebookAsk: vi.fn(), localAsk: vi.fn(async (prompt) => ({ output: `local ${prompt}` })) };
    const ai = createAiService({ client, address: () => "x", local: () => true });
    expect(await ai.ask("a.one", "q")).toBe("local q");
    expect(client.notebookAsk).not.toHaveBeenCalled();
  });

  it("explains a local failure in plain words", async () => {
    const client = { localAsk: () => Promise.reject(new Error("model-missing")) };
    const error = await createAiService({ client, address: () => "x", local: () => true }).ask("a.one", "q").catch((e) => e);
    expect(error).toMatchObject({ code: "ai-unavailable" });
    expect(error.message).toMatch(/isn't installed in Ollama/);
  });
});
