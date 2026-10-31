import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import TabBar from "./TabBar";
import { closeTab } from "./tabs";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, openKrebs, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("../../../editor/components/Editor.jsx", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

// jsdom has no PointerEvent; a MouseEvent carries the coordinates and button.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

const tabs = { list: ["home", "node:a", "graph"], active: "node:a" };
const labels = { home: "Home", "node:a": "Cells", graph: "Graph" };
const setup = (extra = {}) => {
  const fns = { onSelect: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };
  render(<TabBar tabs={tabs} labelOf={(id) => labels[id]} at="top" tools={<button>Tool</button>} {...fns} {...extra} />);
  return fns;
};

describe("TabBar", () => {
  it("renders tabs with the active one selected", () => {
    setup();
    const all = screen.getAllByRole("tab");
    expect(all.map((t) => t.textContent)).toEqual(["Home", "Cells", "Graph"]);
    expect(screen.getByRole("tab", { name: /Cells/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /Graph/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByText("Tool")).toBeTruthy();
  });

  it("selects on click", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /Graph/ }));
    expect(onSelect).toHaveBeenCalledWith("graph");
  });

  it("closes only page tabs", () => {
    const { onClose } = setup();
    expect(screen.queryByRole("button", { name: "Close Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Graph" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Cells" }));
    expect(onClose).toHaveBeenCalledWith("node:a");
  });

  it("reorders when a tab is dragged 100px right", () => {
    const { onReorder } = setup();
    const els = screen.getAllByRole("tab");
    els.forEach((el, i) => {
      el.getBoundingClientRect = () => ({ left: i * 60, right: i * 60 + 60, width: 60, top: 0, bottom: 30, height: 30 });
    });
    fireEvent.pointerDown(els[1], { clientX: 90, pointerId: 1, button: 0 });
    fireEvent.pointerMove(els[1], { clientX: 190, pointerId: 1 });
    fireEvent.pointerUp(els[1], { clientX: 190, pointerId: 1 });
    expect(onReorder).toHaveBeenCalledWith("node:a", 2);
  });

  it("moves focus with arrow keys", () => {
    setup();
    const [home, cells, graph] = screen.getAllByRole("tab");
    cells.focus();
    fireEvent.keyDown(cells, { key: "ArrowRight" });
    expect(document.activeElement).toBe(graph);
    fireEvent.keyDown(graph, { key: "ArrowRight" });
    expect(document.activeElement).toBe(home);
    fireEvent.keyDown(home, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(graph);
  });
  it("Delete closes a focused page tab and moves focus to the new active tab", () => {
    function Host() {
      const [t, setT] = useState(tabs);
      return <TabBar tabs={t} labelOf={(id) => labels[id] ?? id} onClose={(id) => setT((x) => closeTab(x, id))} />;
    }
    render(<Host />);
    const cells = screen.getByRole("tab", { name: /Cells/ });
    cells.focus();
    fireEvent.keyDown(cells, { key: "Delete" });
    expect(screen.queryByRole("tab", { name: /Cells/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("tab", { selected: true }));
  });

  it("Delete calls onClose for page tabs", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Cells/ }), { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("node:a");
  });

  it("Delete does nothing on Home or fixed tabs", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Home/ }), { key: "Delete" });
    fireEvent.keyDown(screen.getByRole("tab", { name: /Graph/ }), { key: "Delete" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TabBar pin menu", () => {
  it("pins and unpins a page from its tab menu", async () => {
    installMemoryLocalStorage();
    localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    window.history.replaceState(null, "", "/?view=study-preview");
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    const side = within(await screen.findByRole("navigation", { name: "Sidebar" }));
    await openKrebs(side);
    expect(side.queryByText("Pinned")).toBeNull();

    fireEvent.contextMenu(await screen.findByRole("tab", { name: "Krebs cycle" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin to sidebar" }));
    expect(side.getByText("Pinned")).toBeTruthy();
    expect(side.getByRole("link", { name: "Krebs cycle" })).toBeTruthy();

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Krebs cycle" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
    expect(side.queryByRole("link", { name: "Krebs cycle" })).toBeNull();
  });

  it("gives no pin item to tabs that aren't pages", async () => {
    installMemoryLocalStorage();
    localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
    window.history.replaceState(null, "", "/?view=study-preview");
    render(<StudyPreview client={fakeClient(SAMPLE_SNAPSHOT)} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Home" }));
    expect(screen.queryByRole("menuitem", { name: "Pin to sidebar" })).toBeNull();
  });
});
