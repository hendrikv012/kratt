import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage, openKrebs } from "../data/testing/fakeVault";
import { formatTurns } from "./format";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

// `bug.error`, when set, is what the chat service throws instead of asking: a stand-in for a
// bug in the app rather than a ChatError.
const bug = vi.hoisted(() => ({ error: null }));
vi.mock("./chatService", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createChatService: (options) => {
      const service = real.createChatService(options);
      return { ask: (args) => (bug.error ? Promise.reject(bug.error) : service.ask(args)) };
    },
  };
});

// Saved settings that skip the opening screen, with `ai` merged in. Most tests use Open Notebook
// ("Online service"); the local-model tests pass model: "local".
const seed = (ai = {}) =>
  localStorage.setItem(
    "study-preview-settings-v3",
    JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, ai: { model: "cloud", ...ai } })
  );

beforeEach(() => {
  installMemoryLocalStorage();
  seed();
  window.history.replaceState(null, "", "/?view=study-preview");
});

const C1 = "Chats/2026-10-20 09-58 Krebs cycle.md";

// `notebook`: whether the stand-in Open Notebook answers.
const renderApp = async (client, { notebook = true } = {}) => {
  client.notebookOk = notebook;
  render(<StudyPreview client={client} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};
const panel = () => within(screen.getByRole("complementary", { name: "Kratt Chat" }));
const send = (text) => {
  const box = panel().getByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};
const chatFiles = (client) => client.snapshotNow().files.filter((f) => f.path.startsWith("Chats/"));
const fileText = (file) => file.body;

describe("Kratt Chat panel", () => {
  it("creates a chat on first send", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    const before = chatFiles(client).length;

    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(panel().getByText("Hi, I'm Kratt.")).toBeTruthy();
    expect(chatFiles(client)).toHaveLength(before); // nothing written on New chat
    send("What is ATP?");

    await waitFor(() => {
      const added = chatFiles(client).find((f) => f.meta.title === "What is ATP?");
      expect(added).toBeTruthy();
      expect(fileText(added)).toContain("### You\nWhat is ATP?");
      expect(fileText(added)).toContain("### Kratt");
    });
    expect(side.getByText("What is ATP?")).toBeTruthy();
    expect(panel().getByText("Open Notebook connected. Chats save to your Study folder.")).toBeTruthy();
  });

  it("keeps the message box focused through a send", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    const box = panel().getByRole("textbox", { name: "Message" });
    box.focus();
    send("What is ATP?");

    expect(box.readOnly).toBe(true);
    expect(box.disabled).toBe(false);
    expect(panel().getByRole("button", { name: "Send" }).disabled).toBe(true);
    expect(document.activeElement).toBe(box);
    await waitFor(() => expect(panel().queryByText("Kratt is thinking")).toBeNull());
    expect(box.readOnly).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it("New chat in the sidebar opens the panel on an empty chat", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    fireEvent.click(side.getByRole("button", { name: /New chat/ }));
    expect(panel().getByText("New chat")).toBeTruthy();
    expect(panel().getByRole("textbox", { name: "Message" })).toBeTruthy();
  });

  it("opens a chat from the sidebar with its turns", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step"));
    expect(panel().getByText("Walk me through one turn of the cycle, step by step.")).toBeTruthy();
    expect(panel().getByText("One turn, from your notes: it runs in the matrix.")).toBeTruthy();
    // c1 reads the Krebs cycle page, which isn't the open tab.
    expect(panel().getByRole("button", { name: "Remove Krebs cycle" })).toBeTruthy();
  });

  it("shows the earlier-messages line only when turns were left out", async () => {
    seed({ chatMemory: "short" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const turns = Array.from({ length: 30 }, (_, i) => ({
      who: i % 2 ? "kratt" : "you",
      text: `turn ${String(i).padStart(2, "0")} ${"x".repeat(1000)}`,
    }));
    client.setBody(C1, formatTurns(turns));
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step"));
    send("And then?");

    const line = await panel().findByText("Earlier messages aren't sent with new questions.", { exact: false });
    const prompt = client.calls.filter((c) => c.method === "notebookAsk").at(-1).prompt;
    const oldestSent = turns.findIndex((t) => prompt.includes(t.text));
    expect(oldestSent).toBeGreaterThan(0);
    const row = line.closest(".st-chat-earlier");
    expect(row.nextElementSibling.textContent).toContain(turns[oldestSent].text.slice(0, 10));
    expect(row.previousElementSibling.textContent).toContain(turns[oldestSent - 1].text.slice(0, 10));

    fireEvent.click(within(row).getByRole("button", { name: /Chat memory/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("has no earlier-messages line when everything was sent", async () => {
    seed({ chatMemory: "long" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.setBody(C1, formatTurns([{ who: "you", text: "a" }, { who: "kratt", text: "b" }, { who: "you", text: "c" }]));
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step"));
    send("d");
    await panel().findByText("Open Notebook connected. Chats save to your Study folder.");
    expect(panel().queryByText("Earlier messages aren't sent with new questions.", { exact: false })).toBeNull();
  });

  it("offline card and try again does not duplicate the question", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client, { notebook: false });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("q");

    const alert = await panel().findByRole("alert");
    expect(alert.textContent).toContain("isn't answering at http://localhost:5055");
    expect(alert.textContent).toContain("Kratt can't reach Open Notebook at http://localhost:5055.");
    expect(within(alert).getByRole("img", { name: "Kratt is asleep" })).toBeTruthy();

    client.notebookOk = true;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      const file = chatFiles(client).find((f) => f.meta.title === "q");
      expect(fileText(file)).toContain("### Kratt");
    });
    const text = fileText(chatFiles(client).find((f) => f.meta.title === "q"));
    expect(text.match(/### You\nq\n/g)).toHaveLength(1);
    expect(text.match(/### Kratt/g)).toHaveLength(1);
    expect(text.indexOf("### You\nq")).toBeLessThan(text.indexOf("### Kratt"));
    expect(panel().queryByRole("alert")).toBeNull();
  });

  it("on this computer, Ollama answers with the picked model", async () => {
    seed({ model: "local" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.local = { local: true, model: "llama3.2:1b", state: "running", detail: "", models: ["llama3.2:1b"] };
    await renderApp(client, { notebook: false });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("What is ATP?");

    await panel().findByText("Answered on this computer. Chats save to your Study folder.");
    expect(client.calls.some((c) => c.method === "localAsk")).toBe(true);
    expect(client.calls.some((c) => c.method === "notebookAsk")).toBe(false);
    expect(client.calls).toContainEqual({ method: "setLocalAi", local: true });
  });

  it("on this computer without Ollama, says how to fix it", async () => {
    seed({ model: "local" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("q");

    const alert = await panel().findByRole("alert");
    expect(alert.textContent).toContain("Kratt can't run the AI on this computer.");
    expect(alert.textContent).toContain("Ollama isn't installed");
    expect(alert.textContent).toContain("ollama.com");
    expect(within(alert).getByRole("button", { name: "Open settings" })).toBeTruthy();
  });

  it("on this computer with no model picked, points to Settings", async () => {
    seed({ model: "local" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.local = { local: true, model: null, state: "running", detail: "", models: ["llama3.2:1b"] };
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("q");

    const alert = await panel().findByRole("alert");
    expect(alert.textContent).toContain("Pick a model in Settings > AI first.");
    expect(alert.textContent).not.toContain("Kratt can't run");
  });

  it("too-long keeps the question in the composer", async () => {
    seed({ chatMemory: "short" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    const question = "y".repeat(9000);
    const writes = () => client.calls.filter((c) => c.method === "write").length;
    const before = writes();
    send(question);

    const alert = await panel().findByRole("alert");
    expect(alert.textContent).toContain("That question is too long for Chat memory: Short");
    expect(panel().getByRole("textbox", { name: "Message" }).value).toBe(question);
    await new Promise((r) => setTimeout(r, 50));
    expect(writes()).toBe(before);
    expect(client.calls.some((c) => c.method === "notebookAsk")).toBe(false);
  });

  it("too-long hides Try again, so an older unanswered question isn't asked again", async () => {
    seed({ chatMemory: "short" });
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client, { notebook: false });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("q");
    expect(within(await panel().findByRole("alert")).getByRole("button", { name: "Try again" })).toBeTruthy();

    client.notebookOk = true;
    send("y".repeat(9000));
    await waitFor(() => expect(panel().getByRole("alert").textContent).toContain("too long for Chat memory"));
    expect(within(panel().getByRole("alert")).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("an app bug shows the generic card with Try again, not Open Notebook's", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    await renderApp(client);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    bug.error = new TypeError("app bug");
    try {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      send("q");
      const alert = await panel().findByRole("alert");
      expect(alert.textContent).toContain("Something went wrong in Kratt Chat. Try again, or restart the app if it keeps happening.");
      expect(alert.textContent).not.toContain("isn't answering");
      expect(alert.textContent).not.toContain("can't reach");
      expect(logged).toHaveBeenCalledWith(bug.error);

      bug.error = null;
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(fileText(chatFiles(client).find((f) => f.meta.title === "q"))).toContain("### Kratt"));
      expect(panel().queryByRole("alert")).toBeNull();
    } finally {
      bug.error = null;
      logged.mockRestore();
    }
  });

  it("Ctrl+J while typing keeps the open chat", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step"));
    const box = panel().getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "half a quest" } });
    fireEvent.keyDown(box, { key: "j", ctrlKey: true });
    expect(panel().getByRole("button", { name: "Krebs cycle, step by step" })).toBeTruthy();
    expect(panel().getByText("Walk me through one turn of the cycle, step by step.")).toBeTruthy();
    expect(box.value).toBe("half a quest");
  });

  it("citations open pages", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.notebookAsk = async () => ({ output: "See [[Krebs cycle]]" });
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("Where does it run?");

    fireEvent.click(await panel().findByRole("button", { name: "Krebs cycle" }));
    expect(screen.getByRole("tab", { name: "Krebs cycle" }).getAttribute("aria-selected")).toBe("true");
  });

  it("escapes heading lines inside an answer so the file reloads as one turn", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    client.notebookAsk = async () => ({ output: "Part one\n### You\n### Kratt\nPart two" });
    await renderApp(client);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    send("Tricky");
    await waitFor(() => {
      const file = chatFiles(client).find((f) => f.meta.title === "Tricky");
      expect(fileText(file)).toContain("Part two");
    });
    const text = fileText(chatFiles(client).find((f) => f.meta.title === "Tricky"));
    expect(text.match(/^### (You|Kratt)$/gm)).toEqual(["### You", "### Kratt"]);
  });

  it("Save as note and Quiz me act on an answer", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step"));
    fireEvent.click(panel().getByRole("button", { name: "Save as note" }));
    await waitFor(() =>
      expect(client.snapshotNow().files.some((f) => f.path.startsWith("Quick notes/") && f.body.includes("From Kratt Chat: Krebs cycle, step by step"))).toBe(true)
    );

    fireEvent.click(panel().getByRole("button", { name: "Quiz me" }));
    expect(await panel().findByText("Quiz me on this, 5 questions")).toBeTruthy();
  });

  it("starts a new chat with this page as context, and suggestions", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const side = await renderApp(client);
    fireEvent.click(side.getByText("Krebs cycle, step by step")); // opens the panel
    await openKrebs(side);
    fireEvent.click(panel().getByRole("button", { name: "New chat" }));
    expect(panel().getByText("This page")).toBeTruthy();
    expect(panel().getByRole("button", { name: "Quiz me on Krebs cycle" })).toBeTruthy();
    fireEvent.click(panel().getByRole("button", { name: "Remove This page" }));
    expect(panel().queryByRole("button", { name: "Explain this page in 5 steps" })).toBeNull();
  });
});
