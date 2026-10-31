import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";
import { HOME_ORDER } from "../home/grid";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const KEY = "study-preview-settings-v3";

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
  installMemoryLocalStorage();
  // Skip the opening screen.
  localStorage.setItem(KEY, JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview&settings=layout");
});

afterEach(() => {
  cleanup();
  delete document.elementFromPoint;
});

const openEditor = async () => {
  render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  return within(await screen.findByRole("dialog", { name: "Settings" }));
};
const order = (dialog) =>
  dialog.getAllByRole("button", { name: /, \d×\d$/ }).map((b) => b.getAttribute("aria-label").split(",")[0]);
const savedHome = () => JSON.parse(localStorage.getItem(KEY)).layout?.home;

describe("Home screen editor", () => {
  it("moves a tile with the keyboard", async () => {
    const user = userEvent.setup();
    const dialog = await openEditor();
    dialog.getByRole("button", { name: "Clock, 2×1" }).focus();
    await user.keyboard(" ");
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock picked up, place 2 of 7");
    await user.keyboard("{ArrowLeft}");
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock, place 1 of 7");
    await user.keyboard(" ");
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock dropped, place 1 of 7");
    expect(savedHome().order[0]).toBe("clock");
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Clock, 2×1" }));
  });

  it("escape puts it back", async () => {
    const user = userEvent.setup();
    const dialog = await openEditor();
    const before = order(dialog);
    dialog.getByRole("button", { name: "Clock, 2×1" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}");
    expect(order(dialog)).not.toEqual(before);
    await user.keyboard("{Escape}");
    expect(order(dialog)).toEqual(before);
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock put back");
    expect(savedHome()).toBeFalsy();
    // Escape only cancels the move; Settings stays open.
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("resizes from the size buttons", async () => {
    const dialog = await openEditor();
    fireEvent.click(dialog.getByRole("button", { name: "Clock, 2×1" }));
    const sizes = dialog.getByRole("radiogroup", { name: "Size of Clock" });
    expect(within(sizes).getAllByRole("radio").map((r) => r.textContent)).toEqual(["1×1", "2×1", "2×2"]);
    fireEvent.click(within(sizes).getByRole("radio", { name: "1×1" }));
    expect(dialog.getByRole("button", { name: "Clock, 1×1" })).toBeTruthy();
    expect(savedHome().size.clock).toBe("1x1");
  });

  it("reset with undo", async () => {
    const user = userEvent.setup();
    const dialog = await openEditor();
    dialog.getByRole("button", { name: "Clock, 2×1" }).focus();
    await user.keyboard(" {ArrowLeft} ");
    const moved = order(dialog);
    expect(moved[0]).toBe("Clock");
    fireEvent.click(dialog.getByRole("button", { name: "Reset home screen" }));
    expect(order(dialog)[0]).toBe("Graph");
    expect(order(dialog)).toHaveLength(HOME_ORDER.length);
    fireEvent.click(within(screen.getByText("Layout saved").closest(".st-toast")).getByRole("button", { name: "Undo" }));
    expect(order(dialog)).toEqual(moved);
  });

  it("switches widgets on and off", async () => {
    const dialog = await openEditor();
    expect(dialog.getByRole("button", { name: "Deadlines and exams, 2×1" })).toBeTruthy();
    fireEvent.click(dialog.getByRole("switch", { name: "Remove Deadlines and exams on Home" }));
    expect(dialog.queryByRole("button", { name: "Deadlines and exams, 2×1" })).toBeNull();
  });

  it("repeats the place when a tile can't move further", async () => {
    const user = userEvent.setup();
    const dialog = await openEditor();
    dialog.getByRole("button", { name: "Graph, 4×2" }).focus();
    await user.keyboard(" {ArrowLeft}");
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Graph, place 1 of 7");
  });

  it("puts a held tile back when the focus leaves it", async () => {
    const user = userEvent.setup();
    const dialog = await openEditor();
    const before = order(dialog);
    dialog.getByRole("button", { name: "Clock, 2×1" }).focus();
    await user.keyboard(" {ArrowRight}");
    expect(document.activeElement).toBe(dialog.getByRole("button", { name: "Clock, 2×1" }));
    act(() => dialog.getByRole("button", { name: "Reset home screen" }).focus());
    expect(order(dialog)).toEqual(before);
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock put back");
    expect(savedHome()).toBeFalsy();
  });

  // Drags Clock onto Graph: the pointer is "over" Graph once it moves.
  const dragClockOverGraph = (dialog) => {
    const graph = dialog.getByRole("button", { name: "Graph, 4×2" });
    document.elementFromPoint = () => graph;
    fireEvent.pointerDown(dialog.getByRole("button", { name: "Clock, 2×1" }), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 20, clientY: 100 });
    expect(order(dialog).slice(0, 2)).toEqual(["Clock", "Graph"]);
  };

  it("drags a tile with the pointer and saves on drop", async () => {
    const dialog = await openEditor();
    dragClockOverGraph(dialog);
    fireEvent.pointerUp(window);
    expect(savedHome().order.slice(0, 2)).toEqual(["clock", "graph"]);
  });

  it("escape mid-drag puts the tile back and keeps Settings open", async () => {
    const dialog = await openEditor();
    const before = order(dialog);
    dragClockOverGraph(dialog);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(order(dialog)).toEqual(before);
    expect(dialog.getByRole("status", { name: "Tile moves" }).textContent).toBe("Clock put back");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    fireEvent.pointerUp(window);
    expect(savedHome()).toBeFalsy();
  });

  it("closing Settings mid-drag saves nothing", async () => {
    const dialog = await openEditor();
    dragClockOverGraph(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    fireEvent.pointerUp(window);
    expect(savedHome()).toBeFalsy();
    expect(screen.queryByText("Layout saved")).toBeNull();
  });
});
