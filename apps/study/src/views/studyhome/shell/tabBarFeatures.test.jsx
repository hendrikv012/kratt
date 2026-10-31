import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, openKrebs, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph and the editor can't draw in the test DOM.
vi.mock("../../../editor/components/Editor.jsx", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

// jsdom has no layout: the mouse is "over" whatever `hovering` names.
let hovering = null;
const hover = (el) => {
  hovering = el;
  fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
};
const ctrlDelete = () => fireEvent.keyDown(document.body, { key: "Delete", ctrlKey: true });

beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
  hovering = null;
  document.elementFromPoint = () => hovering;
});
afterEach(() => delete document.elementFromPoint);

const mount = async () => {
  render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};

describe("tab bar and sidebar shortcuts", () => {
  it("Ctrl+Delete on the selected sidebar subject asks to delete it", async () => {
    const side = await mount();
    const row = side.getByText("Biology").closest(".st-tree-row");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Delete", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: 'Delete "Biology"?' })).toBeTruthy();
  });

  it("Ctrl+Delete with the mouse over a sidebar row but focus elsewhere does nothing in the sidebar", async () => {
    const side = await mount();
    hover(side.getByText("Biology"));
    ctrlDelete();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Ctrl+Delete over a tab closes it, not a sidebar item", async () => {
    const side = await mount();
    await openKrebs(side);
    hover(await screen.findByRole("tab", { name: "Krebs cycle" }));
    ctrlDelete();
    expect(screen.queryByRole("tab", { name: "Krebs cycle" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pins a subject to the tab bar from the sidebar, where it can't be closed", async () => {
    const side = await mount();
    const row = side.getByText("Biology").closest(".st-tree-row");
    fireEvent.click(within(row).getByRole("button", { name: "More for Biology" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "Pin to tab bar" }));
    const tab = screen.getByRole("tab", { name: "Biology" });
    expect(tab.getAttribute("title")).toBe("Biology (pinned)");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "Biology"]);
    hover(tab);
    ctrlDelete();
    expect(screen.getByRole("tab", { name: "Biology" })).toBeTruthy();

    fireEvent.contextMenu(tab);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin from tab bar" }));
    expect(screen.getByRole("tab", { name: "Biology" }).getAttribute("title")).toBe("Biology");
  });

  it("pins a fixed view from its tab menu, but never Home", async () => {
    localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, layout: { tabs: { list: ["home", "chats", "graph"], active: "home" } } })
    );
    await mount();
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Graph" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin to tab bar" }));
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("title"))).toEqual(["Home", "Graph (pinned)", "Chats"]);
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Home" }));
    expect(screen.queryByRole("menuitem", { name: "Pin to tab bar" })).toBeNull();
  });
});

describe("Settings > Shortcuts", () => {
  const openShortcuts = async () => {
    window.history.replaceState(null, "", "/?view=study-preview&settings=shortcuts");
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    return within(await screen.findByRole("dialog", { name: "Settings" }));
  };

  it("lists the new shortcuts and changes one, refusing taken keys", async () => {
    const dialog = await openShortcuts();
    expect(dialog.getByText("Close the tab under the mouse")).toBeTruthy();
    expect(dialog.getByText("Delete the selected item (asks first)")).toBeTruthy();

    fireEvent.click(dialog.getByRole("button", { name: "Change Close the tab under the mouse" }));
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(dialog.getByText("Ctrl+K is already Search.")).toBeTruthy();

    fireEvent.click(dialog.getByRole("button", { name: "Change Close the tab under the mouse" }));
    fireEvent.keyDown(window, { key: "w", altKey: true });
    expect(JSON.parse(localStorage.getItem("study-preview-settings-v3")).shortcuts).toEqual({ "tabs.closeHovered": "Alt+W" });

    // Escape while listening stops listening and leaves Settings open.
    fireEvent.click(dialog.getByRole("button", { name: "Change Close the tab under the mouse" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();

    fireEvent.click(dialog.getByRole("button", { name: "Reset Close the tab under the mouse" }));
    expect(JSON.parse(localStorage.getItem("study-preview-settings-v3")).shortcuts["tabs.closeHovered"]).toBeUndefined();
  });
});
