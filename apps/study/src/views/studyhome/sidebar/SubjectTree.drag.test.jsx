import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, createEvent, within, act } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph and the editor can't draw in the test DOM.
vi.mock("../../../editor/components/Editor.jsx", () => ({ default: () => null }));
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
});

const TWO_SUBJECTS = {
  ...SAMPLE_SNAPSHOT,
  folders: [...SAMPLE_SNAPSHOT.folders, "Chemistry"],
  layout: { subjects: ["Biology", "Chemistry"], colors: { Biology: "#4c90f0", Chemistry: "#e0803a" } },
};
// jsdom has no DragEvent, so pointer fields are put on the event by hand, and
// the row is 40 px tall, starting at 0.
const send = (type, el, { dataTransfer: dt, ...fields } = {}) => {
  el.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 0, width: 0 });
  const event = createEvent[type](el, { dataTransfer: dt });
  Object.entries(fields).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
  fireEvent(el, event);
};
// Krebs cycle is only in Cells (the sample also links it into Biology, where it could not be dropped).
const UNLINKED = {
  ...SAMPLE_SNAPSHOT,
  files: SAMPLE_SNAPSHOT.files.map((f) => (f.id === "p1" ? { ...f, meta: { id: "p1", title: "Krebs cycle" } } : f)),
};
const dataTransfer = () => ({ setData() {}, effectAllowed: "", dropEffect: "" });
const mount = async (snapshot = SAMPLE_SNAPSHOT) => {
  render(<StudyPreview client={fakeClient(snapshot)} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};
const rowOf = (side, name) => side.getByText(name).closest(".st-tree-row");
const expand = (side, name) => fireEvent.click(rowOf(side, name).querySelector('button[aria-label="Expand"]'));
const names = () => [...document.querySelectorAll(".st-tree-row .st-tree-name")].map((n) => n.textContent);
const openAll = async (snapshot) => {
  const side = await mount(snapshot);
  expand(side, "Biology");
  expand(side, "Cells");
  return side;
};

describe("sidebar drag and drop", () => {
  it("clears the drop line when the pointer is over a gap in the tree", async () => {
    const side = await openAll(UNLINKED);
    const dt = dataTransfer();
    const krebs = document.querySelector(`.st-tree-row[data-tree-id="p1"][data-parent-id="${rowOf(side, "Cells").dataset.treeId}"]`);
    fireEvent.dragStart(krebs, { dataTransfer: dt });
    send("dragOver", rowOf(side, "Cells"), { dataTransfer: dt, clientY: 5 });
    expect(document.querySelectorAll(".st-drop-line")).toHaveLength(1);
    send("dragOver", document.querySelector(".st-tree-area"), { dataTransfer: dt, clientY: 5 });
    expect(document.querySelector(".st-drop-line")).toBeNull();
  });

  it("drops above a folder as its sibling, with a drop line", async () => {
    const side = await openAll(UNLINKED);
    const dt = dataTransfer();
    const krebs = document.querySelector(`.st-tree-row[data-tree-id="p1"][data-parent-id="${rowOf(side, "Cells").dataset.treeId}"]`);
    fireEvent.dragStart(krebs, { dataTransfer: dt });
    const cells = rowOf(side, "Cells");
    send("dragOver", cells, { dataTransfer: dt, clientY: 5 });
    expect(document.querySelectorAll(".st-drop-line")).toHaveLength(1);
    send("drop", cells, { dataTransfer: dt });
    expect(document.querySelector(".st-drop-line")).toBeNull();
    const list = names();
    expect(list.slice(0, 3)).toEqual(["Biology", "Krebs cycle", "Cells"]);
    expect(list.indexOf("Krebs cycle", list.indexOf("Cells"))).toBe(-1);
  });

  it("highlights the folder when the pointer is in its middle", async () => {
    const side = await openAll();
    const dt = dataTransfer();
    fireEvent.dragStart(rowOf(side, "Loose idea"), { dataTransfer: dt });
    const cells = rowOf(side, "Cells");
    send("dragOver", cells, { dataTransfer: dt, clientY: 20 });
    expect(cells.getAttribute("data-drop")).toBe("into");
    expect(document.querySelector(".st-drop-line")).toBeNull();
  });

  it("keeps the highlight when the pointer moves onto a child of the row", async () => {
    const side = await openAll();
    const dt = dataTransfer();
    fireEvent.dragStart(rowOf(side, "Loose idea"), { dataTransfer: dt });
    const cells = rowOf(side, "Cells");
    send("dragOver", cells, { dataTransfer: dt, clientY: 20 });
    send("dragLeave", cells, { relatedTarget: cells.querySelector("svg") });
    expect(cells.getAttribute("data-drop")).toBe("into");
    send("dragLeave", cells, { relatedTarget: document.body });
    expect(cells.getAttribute("data-drop")).toBeNull();
  });

  describe("auto-expand", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    const hoverCollapsedCells = async () => {
      const side = await mount();
      expand(side, "Biology");
      const dt = dataTransfer();
      fireEvent.dragStart(rowOf(side, "Loose idea"), { dataTransfer: dt });
      send("dragOver", rowOf(side, "Cells"), { dataTransfer: dt, clientY: 20 });
      return side;
    };

    it("opens a collapsed folder after 600 ms", async () => {
      const side = await hoverCollapsedCells();
      act(() => vi.advanceTimersByTime(599));
      expect(within(rowOf(side, "Cells")).getByRole("button", { name: "Expand" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(1));
      expect(within(rowOf(side, "Cells")).getByRole("button", { name: "Collapse" })).toBeTruthy();
    });
  });

  it("reorders subjects by dragging", async () => {
    const side = await mount(TWO_SUBJECTS);
    const first = rowOf(side, "Biology");
    expect(first.getAttribute("draggable")).toBe("true");
    const dt = dataTransfer();
    fireEvent.dragStart(first, { dataTransfer: dt });
    send("dragOver", rowOf(side, "Chemistry"), { dataTransfer: dt, clientY: 35 });
    send("drop", rowOf(side, "Chemistry"), { dataTransfer: dt });
    expect(names().slice(0, 2)).toEqual(["Chemistry", "Biology"]);
  });

  it("keeps a page where it was when dropped with Ctrl held", async () => {
    const side = await openAll();
    const dt = dataTransfer();
    fireEvent.dragStart(rowOf(side, "Loose idea"), { dataTransfer: dt });
    const cells = rowOf(side, "Cells");
    send("dragOver", cells, { dataTransfer: dt, clientY: 20, ctrlKey: true });
    send("drop", cells, { dataTransfer: dt, ctrlKey: true });
    expect(names().filter((n) => n === "Loose idea")).toHaveLength(2);
  });

  it("changes nothing when the drag ends without a drop", async () => {
    const side = await openAll();
    const before = names();
    const dt = dataTransfer();
    const loose = rowOf(side, "Loose idea");
    fireEvent.dragStart(loose, { dataTransfer: dt });
    send("dragOver", rowOf(side, "Cells"), { dataTransfer: dt, clientY: 5 });
    fireEvent.dragEnd(loose, { dataTransfer: dt });
    expect(names()).toEqual(before);
    expect(document.querySelector(".st-drop-line")).toBeNull();
    expect(document.querySelector("[data-drop]")).toBeNull();
  });
});
