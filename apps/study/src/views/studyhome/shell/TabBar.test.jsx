import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  // Browsers send the click to the element holding pointer capture, so a tab
  // that captured on press would never see its own click. jsdom has no capture.
  it("selects on a plain click in a browser that routes clicks to the capturing element", () => {
    const { onSelect } = setup();
    let captor = null;
    Element.prototype.setPointerCapture = function () {
      captor = this;
    };
    const graph = screen.getByRole("tab", { name: /Graph/ });
    fireEvent.pointerDown(graph, { clientX: 130, pointerId: 1, button: 0 });
    fireEvent.pointerUp(captor ?? graph, { clientX: 130, pointerId: 1 });
    fireEvent.click(captor ?? graph);
    delete Element.prototype.setPointerCapture;
    expect(onSelect).toHaveBeenCalledWith("graph");
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

describe("TabBar pinned tabs", () => {
  const pinnedTabs = { list: ["home", "node:a", "node:b"], active: "home", pinned: ["node:a"] };
  it("marks a pinned tab and gives it no close", () => {
    const { onClose } = setup({ tabs: pinnedTabs, labelOf: (id) => ({ home: "Home", "node:a": "Cells", "node:b": "Atoms" })[id] });
    expect(screen.getByRole("tab", { name: /Cells/ }).getAttribute("title")).toBe("Cells (pinned)");
    expect(screen.queryByRole("button", { name: "Close Cells" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close Atoms" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tab", { name: /Cells/ }), { key: "Delete" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TabBar close under the mouse", () => {
  // jsdom has no layout: the mouse is "over" whatever `hovering` names.
  let hovering = null;
  beforeEach(() => {
    hovering = null;
    document.elementFromPoint = () => hovering;
  });
  afterEach(() => delete document.elementFromPoint);
  const hover = (el) => {
    hovering = el;
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
  };
  const ctrlDelete = (target = document.body, extra = {}) => {
    const e = new KeyboardEvent("keydown", { key: "Delete", ctrlKey: true, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(e);
    return e;
  };

  it("closes the hovered tab with Ctrl+Delete, once per press", () => {
    const { onClose } = setup();
    hover(screen.getByRole("tab", { name: /Cells/ }));
    expect(ctrlDelete().defaultPrevented).toBe(true);
    ctrlDelete(document.body, { repeat: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("node:a");
  });

  it("leaves Ctrl+Delete to the editor when no tab is hovered or focused", () => {
    const { onClose } = setup();
    const text = document.createElement("textarea");
    document.body.appendChild(text);
    hover(text);
    expect(ctrlDelete(text).defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    text.remove();
  });

  it("closes the focused tab when the mouse is elsewhere", () => {
    const { onClose } = setup();
    ctrlDelete(screen.getByRole("tab", { name: /Cells/ }));
    expect(onClose).toHaveBeenCalledWith("node:a");
  });

  it("keeps the keys over a tab that can't close, without closing it", () => {
    const { onClose } = setup({ tabs: { ...tabs, pinned: ["node:a"] } });
    hover(screen.getByRole("tab", { name: /Cells/ }));
    expect(ctrlDelete().defaultPrevented).toBe(true);
    hover(screen.getByRole("tab", { name: /Home/ }));
    ctrlDelete();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses a changed shortcut", () => {
    const { onClose } = setup({ shortcuts: { "tabs.closeHovered": "Alt+W" } });
    hover(screen.getByRole("tab", { name: /Cells/ }));
    ctrlDelete();
    expect(onClose).not.toHaveBeenCalled();
    ctrlDelete(document.body, { key: "w", ctrlKey: false, altKey: true });
    expect(onClose).toHaveBeenCalledWith("node:a");
  });
});

describe("TabBar centre", () => {
  it("shows what it's given in the middle", () => {
    setup({ centre: <time>12:00</time> });
    expect(screen.getByText("12:00")).toBeTruthy();
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
