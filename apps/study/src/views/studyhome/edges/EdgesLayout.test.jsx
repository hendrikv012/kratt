import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";
import { EXTENSION_EMPTY } from "../widgets/registry";

// The canvas graph can't draw in the test DOM; stand in a list of its dots.
vi.mock("react-force-graph-2d", () => ({
  default: ({ graphData }) => (
    <ul aria-label="Graph">
      {graphData.nodes.map((n) => (
        <li key={n.id}>{n.label}</li>
      ))}
    </ul>
  ),
}));

// jsdom has no PointerEvent; a MouseEvent carries the coordinates and button.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

beforeEach(() => {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?view=study-preview");
});
afterEach(() => cleanup());

const sidebar = () => screen.getByRole("navigation", { name: "Sidebar" });
const renderStudy = async () => {
  render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
};
const lane = (name) => screen.getByRole("region", { name: `${name} edge` });
const widget = (name) => screen.getByRole("region", { name });
const slotOf = (name) => widget(name).closest("[data-slot]");
const renameTo = (name) => {
  const title = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(title, { target: { value: name } });
  fireEvent.blur(title);
};
// Home is a grid, so the lanes are tried on a page: its right lane holds
// "Connected to this page" and "Sources for this page".
const openPage = () => {
  fireEvent.click(screen.getByRole("button", { name: /Add your first subject/ }));
  renameTo("Biology");
  fireEvent.click(screen.getByRole("button", { name: /New page/ }));
};
const SRC = "Sources for this page";
const LOCAL = "Connected to this page";
const openMenu = async (trigger) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.findByRole("menu");
};

describe("Edges layout", () => {
  it("moving a widget saves and offers Undo", async () => {
    await renderStudy();
    openPage();
    const menu = await openMenu(within(widget(SRC)).getByRole("button", { name: "Widget options" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Left edge" }));
    expect(within(lane("Left")).getByRole("region", { name: SRC })).toBeTruthy();
    expect(within(lane("Right")).queryByRole("region", { name: SRC })).toBeNull();

    const toast = screen.getByText("Layout saved").closest(".st-toast");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(within(lane("Right")).getByRole("region", { name: SRC })).toBeTruthy();
  });

  it("sizes snap between small, medium and large", async () => {
    await renderStudy();
    openPage();
    const handle = () => slotOf(SRC).querySelector("[data-size-handle]");
    expect(slotOf(SRC).dataset.size).toBe("s");

    // Every 56px of pull is one step.
    fireEvent.pointerDown(handle(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 130 });
    expect(slotOf(SRC).dataset.size).toBe("m");
    fireEvent.pointerUp(window, { clientX: 100, clientY: 130 });
    expect(slotOf(SRC).dataset.size).toBe("m");
    expect(screen.getByText("Layout saved")).toBeTruthy();

    fireEvent.pointerDown(handle(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 400 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 400 });
    expect(slotOf(SRC).dataset.size).toBe("l");

    fireEvent.pointerDown(handle(), { button: 0, clientX: 100, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 0 });
    expect(slotOf(SRC).dataset.size).toBe("s");
  });

  it("edit mode shows drop areas on empty lanes and Done ends it", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    expect(screen.queryByText("Drop widgets here")).toBeNull();

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    const bar = screen.getByRole("toolbar", { name: "Edit layout" });
    expect(screen.getAllByText("Drop widgets here")).toHaveLength(4);

    fireEvent.click(within(bar).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("toolbar", { name: "Edit layout" })).toBeNull();
    expect(screen.queryByText("Drop widgets here")).toBeNull();

    // Settings > Layout > Edit layout closes Settings and starts editing.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(within(dialog).getByRole("navigation")).getByRole("button", { name: "Layout and home screen" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit layout" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Edit layout" })).toBeTruthy();
  });

  it("Ctrl+E typed in an editor or a field leaves edit mode alone", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.querySelector(".study").appendChild(editable);
    fireEvent.keyDown(editable, { key: "e", ctrlKey: true });
    expect(screen.queryByRole("toolbar", { name: "Edit layout" })).toBeNull();

    const input = document.createElement("input");
    document.querySelector(".study").appendChild(input);
    fireEvent.keyDown(input, { key: "e", ctrlKey: true });
    expect(screen.queryByRole("toolbar", { name: "Edit layout" })).toBeNull();

    // Something that already handled the key keeps it.
    const handled = document.createElement("div");
    handled.addEventListener("keydown", (e) => e.preventDefault());
    document.querySelector(".study").appendChild(handled);
    fireEvent.keyDown(handled, { key: "e", ctrlKey: true });
    expect(screen.queryByRole("toolbar", { name: "Edit layout" })).toBeNull();

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "Edit layout" })).toBeTruthy();
  });

  it("the lane a card is lifted from rises above the other lanes", async () => {
    await renderStudy();
    openPage();
    const head = within(widget(SRC)).getByRole("heading", { name: SRC }).parentElement;
    expect(lane("Right").dataset.lifted).toBeUndefined();
    fireEvent.pointerDown(head, { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 });
    expect(lane("Right").dataset.lifted).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(lane("Right").dataset.lifted).toBeUndefined();
  });

  it("Escape cancels a size or width pull", async () => {
    await renderStudy();
    openPage();
    const handle = slotOf(SRC).querySelector("[data-size-handle]");
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 200 });
    expect(slotOf(SRC).dataset.size).toBe("l");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 200 });
    expect(slotOf(SRC).dataset.size).toBe("s");

    const line = within(lane("Right")).getByRole("separator");
    fireEvent.pointerDown(line, { button: 0, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 100 });
    expect(within(lane("Right")).getByRole("separator").getAttribute("aria-valuenow")).toBe("388");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 100 });
    expect(within(lane("Right")).getByRole("separator").getAttribute("aria-valuenow")).toBe("288");
    expect(screen.queryByText("Layout saved")).toBeNull();
  });

  it("Add widget lists built-in and an empty From extensions group", async () => {
    await renderStudy();
    openPage();
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    const bar = screen.getByRole("toolbar", { name: "Edit layout" });
    const menu = await openMenu(within(bar).getByRole("button", { name: "Add widget" }));
    expect(within(menu).getByText("Built in")).toBeTruthy();
    expect(within(menu).getByText("From extensions")).toBeTruthy();
    expect(within(menu).getByText(EXTENSION_EMPTY)).toBeTruthy();
    // Widgets already on the screen are not offered again.
    expect(within(menu).queryByRole("menuitem", { name: LOCAL })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Recent pages" }));
    expect(widget("Recent pages")).toBeTruthy();
    expect(screen.getByText("Layout saved")).toBeTruthy();
  });

  it("each kind of screen keeps its own arrangement", async () => {
    await renderStudy();
    openPage();
    const menu = await openMenu(within(widget(SRC)).getByRole("button", { name: "Widget options" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Left edge" }));

    fireEvent.click(within(sidebar()).getByText("Graph"));
    expect(within(lane("Bottom")).getByRole("region", { name: "Legend" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: SRC })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Untitled/ }));
    expect(within(lane("Left")).getByRole("region", { name: SRC })).toBeTruthy();
  });

  it("arrow keys move a widget along its lane", async () => {
    await renderStudy();
    openPage();
    const head = () => within(widget(SRC)).getByRole("heading", { name: SRC }).parentElement;
    const order = () => [...lane("Right").querySelectorAll("[data-slot]")].map((s) => s.dataset.slot);
    expect(order()).toEqual(["local", "pagesrc"]);
    fireEvent.keyDown(head(), { key: "ArrowUp" });
    expect(order()).toEqual(["pagesrc", "local"]);
    fireEvent.keyDown(head(), { key: "ArrowRight" });
    expect(order()).toEqual(["local", "pagesrc"]);
  });

  it("a lane's width handle works from the keyboard", async () => {
    await renderStudy();
    openPage();
    const right = within(lane("Right")).getByRole("separator", { name: "Resize the right edge" });
    expect(right.getAttribute("aria-valuenow")).toBe("288");
    fireEvent.keyDown(right, { key: "ArrowRight" });
    expect(within(lane("Right")).getByRole("separator").getAttribute("aria-valuenow")).toBe("272");
  });

  it("with Show near the edge on, edit mode makes room for the tab bar on its own side", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, tabBar: "auto" } }));
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    const main = () => document.querySelector(".st-main");
    expect(main().dataset.barRoom).toBeUndefined();
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "Edit layout" })).toBeTruthy();
    expect(main().dataset.barRoom).toBe("top");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(main().dataset.barRoom).toBeUndefined();
  });

  it("a tab bar at the bottom makes room at the bottom, and an always-shown bar needs none", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, tabBar: "auto" }, layout: { tabsAt: "bottom" } }));
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(document.querySelector(".st-main").dataset.barRoom).toBe("bottom");
    cleanup();
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2 } }));
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "Edit layout" })).toBeTruthy();
    expect(document.querySelector(".st-main").dataset.barRoom).toBeUndefined();
  });

  it("focus mode hides the edit toolbar, and Ctrl+E does nothing in focus mode or in Settings", async () => {
    await renderStudy();
    fireEvent.click(within(sidebar()).getByText("Sources"));
    const toolbar = () => screen.queryByRole("toolbar", { name: "Edit layout" });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(toolbar()).toBeTruthy();
    fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    expect(toolbar()).toBeNull();
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    expect(toolbar()).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(toolbar()).toBeNull();
  });

  it("a new layout change replaces the older Layout saved, so Undo can't drop it", async () => {
    await renderStudy();
    openPage();
    const toLeft = async (name) => {
      const menu = await openMenu(within(widget(name)).getByRole("button", { name: "Widget options" }));
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Left edge" }));
    };
    await toLeft(SRC);
    await toLeft(LOCAL);
    expect(screen.getAllByText("Layout saved")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(lane("Right")).getByRole("region", { name: LOCAL })).toBeTruthy();
    expect(within(lane("Left")).getByRole("region", { name: SRC })).toBeTruthy();
  });
});
