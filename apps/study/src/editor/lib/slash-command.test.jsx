import { it, expect, vi, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import MathExtensions from "../extensions/Math.js";
import SlashCommand, { SLASH_SUGGESTION_KEY } from "./SlashCommand.js";
import slashCommand from "./slash-command.jsx";
import TableBubbleMenu from "../components/TableBubbleMenu.jsx";

// An editor like the page's: the slash menu plus the table bubble menu, inside the app's root.
let editor;
function Host({ tick }) {
  editor = useEditor({ extensions: [StarterKit, SlashCommand], content: "<p>Cells</p><p></p>" });
  return (
    <div className="study" data-tick={tick}>
      <EditorContent editor={editor} />
      {editor && <TableBubbleMenu editor={editor} />}
    </div>
  );
}

async function openMenu(view) {
  await waitFor(() => expect(editor).toBeTruthy());
  act(() => {
    editor.commands.focus("end");
    editor.commands.insertContent("/");
  });
  await waitFor(() => expect(document.querySelector("[cmdk-root]")).toBeTruthy());
  return view;
}

const menus = () => document.querySelectorAll("[cmdk-root]");
const titles = () => [...document.querySelectorAll("[cmdk-item]")].map((el) => el.dataset.value);
const suggestionActive = () => SLASH_SUGGESTION_KEY.getState(editor.state).active;

afterEach(() => {
  act(() => editor?.destroy());
  editor = null;
  document.querySelectorAll("[data-tippy-root]").forEach((el) => el.remove());
});

it("keeps the table bubble menu's plugin when the page re-renders", async () => {
  const view = render(<Host tick={0} />);
  await waitFor(() => expect(editor).toBeTruthy());
  const unregister = vi.spyOn(editor, "unregisterPlugin");
  view.rerender(<Host tick={1} />);
  view.rerender(<Host tick={2} />);
  expect(unregister).not.toHaveBeenCalled();
});

it("keeps the slash menu open when the page re-renders", async () => {
  const view = await openMenu(render(<Host tick={0} />));
  view.rerender(<Host tick={1} />);
  await new Promise((r) => setTimeout(r, 50));
  expect(menus()).toHaveLength(1);
});

it("shows the menu inside the app's root, so it gets the person's theme", async () => {
  await openMenu(render(<Host tick={0} />));
  expect(menus()[0].closest(".study")).not.toBeNull();
});

it("closes on Escape, and Enter afterwards is just a new line", async () => {
  await openMenu(render(<Host tick={0} />));
  fireEvent.keyDown(editor.view.dom, { key: "Escape" });
  await waitFor(() => expect(menus()).toHaveLength(0));
  expect(suggestionActive()).toBe(false);
  // Before, the hidden menu stayed live and Enter ran its first command (Kanban Board's prompt).
  const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
  fireEvent.keyDown(editor.view.dom, { key: "Enter" });
  expect(prompt).not.toHaveBeenCalled();
});

it("closes when the person clicks outside it", async () => {
  await openMenu(render(<Host tick={0} />));
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(menus()).toHaveLength(0));
  expect(suggestionActive()).toBe(false);
});

it("never shows two menus at once", async () => {
  await openMenu(render(<Host tick={0} />));
  // A second renderer starting (the editor rebuilt its plugin views mid-open) replaces the first.
  const other = slashCommand.render();
  act(() => other.onStart({ editor, range: { from: 1, to: 2 }, query: "", items: [], clientRect: () => new DOMRect(), command() {} }));
  expect(menus()).toHaveLength(1);
  act(() => other.onExit());
  expect(menus()).toHaveLength(0);
});

it("lists Kratt and no longer offers Load Gmail", async () => {
  await openMenu(render(<Host tick={0} />));
  expect(titles()).toContain("Kratt");
  expect(titles()).not.toContain("Load Gmail");
  expect(titles()).toEqual(expect.arrayContaining(["Kanban Board", "Linked Task", "Simple Task", "Template"]));
});

it("/Kratt removes the typed command and asks the page to open Ask Kratt", async () => {
  await openMenu(render(<Host tick={0} />));
  const asked = vi.fn();
  window.addEventListener("kratt:ask", asked);
  act(() => {
    editor.commands.insertContent("kratt");
  });
  await waitFor(() => expect(titles()).toEqual(["Kratt"]));
  fireEvent.keyDown(editor.view.dom, { key: "Enter" });
  window.removeEventListener("kratt:ask", asked);
  expect(asked).toHaveBeenCalledTimes(1);
  expect(asked.mock.calls[0][0].detail.editor).toBe(editor);
  expect(editor.getText()).not.toContain("/kratt");
  expect(menus()).toHaveLength(0);
});

it("stays closed after Escape until the person types a new \"/\"", async () => {
  await openMenu(render(<Host tick={0} />));
  fireEvent.keyDown(editor.view.dom, { key: "Escape" });
  act(() => {
    editor.commands.focus();
    editor.commands.insertContent("x");
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(menus()).toHaveLength(0);
  act(() => {
    editor.commands.insertContent(" /");
  });
  await waitFor(() => expect(menus()).toHaveLength(1));
});

it("Block Math leaves the cursor after the formula, so typing doesn't replace it", () => {
  editor = new Editor({ extensions: [StarterKit, ...MathExtensions], content: "<p>Cells</p><p>/block</p>" });
  vi.spyOn(window, "prompt").mockReturnValue("x^2");
  const blockMath = slashCommand.items({ query: "block", editor }).flatMap((g) => g.commands).find((c) => c.title === "Block Math");
  blockMath.command({ editor, range: { from: 8, to: 14 } });
  editor.commands.insertContent("after");
  expect(editor.getHTML()).toContain('data-type="math-block"');
  expect(editor.getText()).toContain("after");
});
