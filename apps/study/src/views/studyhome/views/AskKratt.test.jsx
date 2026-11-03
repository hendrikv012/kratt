import { it, expect, vi, afterEach } from "vitest";
import { render, act, waitFor, screen, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import AskKratt from "./AskKratt";
import { WikiLink } from "../../../editor/extensions/WikiLink";
import { noteHtmlToMarkdown } from "../../../core/markdown/noteFile";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import { SAMPLE_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";
import { CHAT_MESSAGES } from "../chats/chatService";

let editor;
let api;
afterEach(() => editor?.destroy());

function setup({ notebookOk = true, output, make, local = false } = {}) {
  const client = fakeClient(SAMPLE_SNAPSHOT);
  client.notebookOk = notebookOk;
  if (output) client.notebookAsk = vi.fn(async () => ({ output }));
  // The note as typed so far, with the cursor on the empty line /Kratt was typed on.
  editor = new Editor({ extensions: [StarterKit, WikiLink], content: "<p>Runs in the matrix.</p><p></p>" });
  editor.commands.focus("end");
  const shell = { route: { view: "node", id: "p1" }, chat: { open: vi.fn(), address: "http://localhost:5055", memory: "normal", local } };
  const onClose = vi.fn();
  function Harness() {
    api = useStudy();
    return api.state.nodes.p1 ? <AskKratt editor={editor} pageId="p1" make={make} onClose={onClose} /> : null;
  }
  render(
    <StudyProvider client={client}>
      <ShellContext.Provider value={shell}>
        <Harness />
      </ShellContext.Provider>
    </StudyProvider>
  );
  return { client, shell, onClose };
}

const ask = async (question) => {
  const box = await screen.findByRole("textbox", { name: "Ask Kratt about this note" });
  fireEvent.change(box, { target: { value: question } });
  fireEvent.keyDown(box, { key: "Enter" });
};

it("asks about this note and puts Kratt's answer in the note", async () => {
  const { client } = setup({ output: "It makes **ATP**, see [[Krebs cycle]]." });
  await ask("What does it make?");
  await screen.findByText("Kratt's answer is in your note.");
  const prompt = client.notebookAsk.mock.calls[0][1];
  expect(prompt).toContain("## [[Krebs cycle]]");
  expect(prompt).toContain("You: What does it make?");
  const html = editor.getHTML();
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<strong>Kratt</strong>");
  expect(html).toContain("<strong>ATP</strong>");
  expect(html.indexOf("Runs in the matrix.")).toBeLessThan(html.indexOf("<blockquote>"));
});

it("doesn't let the answer add HTML of its own", async () => {
  setup({ output: 'Fine <img src="https://tracker.example/x.png"> <b>bold</b>' });
  await ask("Hi?");
  await screen.findByText("Kratt's answer is in your note.");
  expect(editor.getHTML()).not.toContain("<img");
  expect(editor.getText()).toContain("<b>bold</b>");
});

it("continues the question and answer in Kratt Chat, with this note as context", async () => {
  const { shell } = setup({ output: "It makes ATP." });
  await ask("What does it make?");
  fireEvent.click(await screen.findByRole("button", { name: "Continue in chat" }));
  const chat = api.state.chats.find((c) => c.turns.some((t) => t.text === "What does it make?"));
  expect(chat.context).toEqual(["p1"]);
  expect(chat.turns.map((t) => [t.who, t.text])).toEqual([
    ["you", "What does it make?"],
    ["kratt", "It makes ATP."],
  ]);
  expect(shell.chat.open).toHaveBeenCalledWith(chat.id);
});

it("says what's wrong when Open Notebook isn't answering, and adds nothing to the note", async () => {
  setup({ notebookOk: false });
  const before = editor.getHTML();
  await ask("What does it make?");
  await screen.findByText(CHAT_MESSAGES["ai-unavailable"]("http://localhost:5055"));
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(editor.getHTML()).toBe(before);
});

it("closes on Escape without asking", async () => {
  const { client, onClose } = setup({ output: "x" });
  const box = await screen.findByRole("textbox", { name: "Ask Kratt about this note" });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
  expect(client.notebookAsk).not.toHaveBeenCalled();
});


it("makes a quiz at the cursor and preserves its wiki link in Markdown", async () => {
  const { client } = setup({ output: "### Where?\n- [x] Matrix\n- [ ] Nucleus\n> In the matrix." });
  const input = await screen.findByRole("textbox", { name: "Ask Kratt about this note" });
  fireEvent.change(input, { target: { value: "Cell respiration" } });
  fireEvent.click(screen.getByRole("button", { name: "Make quiz" }));
  await screen.findByText("Your artifact is linked in this note.");
  const artifact = api.state.artifacts[0];
  expect(artifact.madeIn).toEqual({ kind: "page", id: "p1" });
  expect(artifact.madeFrom).toEqual(["p1"]);
  expect(client.notebookAsk.mock.calls[0][1]).toContain("Topic: Cell respiration");
  const md = noteHtmlToMarkdown(editor.getHTML());
  expect(md).toContain(`[[artifact:${artifact.id}|Quiz · Cell respiration]]`);
  expect(md.indexOf("Runs in the matrix.")).toBeLessThan(md.indexOf("[[artifact:"));
});

it("opens in slides mode and Enter makes slides without a topic", async () => {
  setup({ make: "slides", output: "# Cells\nCell facts." });
  fireEvent.keyDown(await screen.findByRole("textbox", { name: "Topic for slides" }), { key: "Enter" });
  await screen.findByText("Your artifact is linked in this note.");
  expect(api.state.artifacts[0].type).toBe("slides");
});

it("closing during generation ignores the late result and inserts nothing", async () => {
  const { client, onClose } = setup();
  let resolve;
  client.notebookAsk = vi.fn(() => new Promise((r) => { resolve = r; }));
  await screen.findByRole("textbox");
  const before = editor.getHTML();
  fireEvent.click(screen.getByRole("button", { name: "Make flashcards" }));
  await waitFor(() => expect(client.notebookAsk).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await act(async () => resolve({ output: "### Q\nA" }));
  expect(onClose).toHaveBeenCalled();
  expect(api.state.artifacts).toEqual([]);
  expect(editor.getHTML()).toBe(before);
});

it("uses the selected local model for note artifacts", async () => {
  const { client } = setup({ local: true });
  vi.spyOn(client, "notebookAsk");
  client.localAsk = vi.fn(async () => ({ output: "### Q\nA" }));
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByRole("button", { name: "Make flashcards" }));
  await screen.findByText("Your artifact is linked in this note.");
  expect(client.localAsk).toHaveBeenCalled();
  expect(client.notebookAsk).not.toHaveBeenCalled();
});
