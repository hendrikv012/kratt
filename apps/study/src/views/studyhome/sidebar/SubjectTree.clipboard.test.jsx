import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph and the editor can't draw in the test DOM.
vi.mock("../../../editor/components/Editor.jsx", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const seed = (extra = {}) =>
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, ...extra }));

beforeEach(() => {
  installMemoryLocalStorage();
  seed();
  window.history.replaceState(null, "", "/?view=study-preview");
});

const mount = async () => {
  render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};
const rowOf = (side, name) => side.getByText(name).closest(".st-tree-row");
const expand = (side, name) => fireEvent.click(rowOf(side, name).querySelector('button[aria-label="Expand"]'));
const names = () => [...document.querySelectorAll(".st-tree-row .st-tree-name")].map((n) => n.textContent);
const pick = (side, name) => {
  const row = rowOf(side, name);
  fireEvent.focus(row);
  return row;
};
const copy = (el) => fireEvent.keyDown(el, { key: "c", ctrlKey: true });
const paste = (el) => fireEvent.keyDown(el, { key: "v", ctrlKey: true });
const del = (el) => fireEvent.keyDown(el, { key: "Delete", ctrlKey: true });

describe("sidebar copy, paste and delete keys", () => {
  it("copies and pastes a subject right after itself", async () => {
    const side = await mount();
    const row = pick(side, "Biology");
    copy(row);
    expect(await screen.findByText('Copied "Biology"')).toBeTruthy();
    paste(row);
    const list = names();
    expect(list[list.indexOf("Biology") + 1]).toBe("Biology (copy)");
    expand(side, "Biology (copy)");
    expand(side, "Cells");
    expect(names().filter((n) => n === "Krebs cycle").length).toBeGreaterThan(0);
  });

  it("pastes a loose page into the selected folder", async () => {
    const side = await mount();
    const loose = pick(side, "Loose idea");
    copy(loose);
    expand(side, "Biology");
    const cells = pick(side, "Cells");
    paste(cells);
    expect(await side.findByText("Loose idea (copy)")).toBeTruthy();
    expect(side.getByText("Loose idea")).toBeTruthy();
    const copyRow = rowOf(side, "Loose idea (copy)");
    expect(Number(copyRow.getAttribute("aria-level"))).toBe(Number(cells.getAttribute("aria-level")) + 1);
  });

  it("selects and focuses the pasted copy, opening the collapsed folder", async () => {
    const side = await mount();
    const loose = pick(side, "Loose idea");
    copy(loose);
    expand(side, "Biology");
    const cells = pick(side, "Cells");
    expect(cells.getAttribute("aria-expanded")).toBe("false");
    paste(cells);
    const copyRow = rowOf(side, "Loose idea (copy)");
    expect(cells.getAttribute("aria-expanded")).toBe("true");
    expect(copyRow.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(copyRow);
  });

  it("asks to delete the selected row, and cancel keeps it", async () => {
    const side = await mount();
    del(pick(side, "Biology"));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "Biology"?' });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(side.getByText("Biology")).toBeTruthy();
  });

  it("leaves keys outside the tree alone", async () => {
    const side = await mount();
    pick(side, "Biology");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    for (const target of [document.body, editable]) {
      copy(target);
      paste(target);
      del(target);
    }
    expect(screen.queryByText(/Copied/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(names().filter((n) => n.startsWith("Biology"))).toEqual(["Biology"]);
  });

  it("leaves the rename field its keys", async () => {
    const side = await mount();
    fireEvent.keyDown(pick(side, "Biology"), { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "Name" });
    copy(input);
    paste(input);
    del(input);
    expect(screen.queryByText(/Copied/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(names().filter((n) => n.startsWith("Biology"))).toEqual([]);
  });

  it("says so when the copied item was deleted", async () => {
    const side = await mount();
    const loose = pick(side, "Loose idea");
    copy(loose);
    del(loose);
    const dialog = await screen.findByRole("dialog", { name: 'Delete "Loose idea"?' });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Delete/ }));
    await vi.waitFor(() => expect(side.queryByText("Loose idea")).toBeNull());
    const before = names();
    paste(pick(side, "Biology"));
    expect(await screen.findByText("The copied item was deleted")).toBeTruthy();
    expect(names()).toEqual(before);
  });

  it("follows a rebound copy key", async () => {
    seed({ shortcuts: { "sidebar.copy": "Ctrl+Shift+C" } });
    const side = await mount();
    const row = pick(side, "Biology");
    copy(row);
    expect(screen.queryByText(/Copied/)).toBeNull();
    fireEvent.keyDown(row, { key: "C", ctrlKey: true, shiftKey: true });
    expect(await screen.findByText('Copied "Biology"')).toBeTruthy();
  });

  it("shows Copy with its keys in the menu, and Paste disabled until something is copied", async () => {
    const side = await mount();
    const row = pick(side, "Biology");
    fireEvent.click(within(row).getByRole("button", { name: "More for Biology" }));
    const item = screen.getByRole("menuitem", { name: /^Copy/ });
    expect(item.querySelector("kbd.st-menu-hint").textContent).toBe("Ctrl+C");
    expect(screen.getByRole("menuitem", { name: /^Paste/ }).disabled).toBe(true);
    fireEvent.click(item);
    expect(await screen.findByText('Copied "Biology"')).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "More for Biology" }));
    expect(screen.getByRole("menuitem", { name: /^Paste/ }).disabled).toBe(false);
  });
});
