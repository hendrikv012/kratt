import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import QuickFind from "./QuickFind";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const make = (runs = {}) => [
  {
    id: "test",
    items: () => [
      { id: "p1", group: "Pages", title: "Cell review", subtitle: "Biology", run: runs.p1 ?? vi.fn() },
      { id: "p2", group: "Pages", title: "Cell cycle", run: runs.p2 ?? vi.fn() },
      { id: "s1", group: "Subjects", title: "Chemistry", color: "#4c90f0", run: vi.fn() },
    ],
  },
];

describe("QuickFind", () => {
  test("renders nothing when closed", () => {
    render(<QuickFind open={false} onClose={() => {}} providers={make()} recentIds={[]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("typing filters the results", () => {
    render(<QuickFind open onClose={() => {}} providers={make()} recentIds={[]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "chem" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Chemistry"]);
  });

  test("ArrowDown then Enter runs the second item and closes", () => {
    const p2 = vi.fn();
    const onClose = vi.fn();
    render(<QuickFind open onClose={onClose} providers={make({ p2 })} recentIds={["p1", "p2"]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "cell" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p2).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes", () => {
    const onClose = vi.fn();
    render(<QuickFind open onClose={onClose} providers={make()} recentIds={[]} />);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  test("options sit in a listbox and the input points at the active one", () => {
    render(<QuickFind open onClose={() => {}} providers={make()} recentIds={[]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "cell" } });
    const list = screen.getByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
  });

  test("shows a hint when nothing matches", () => {
    render(<QuickFind open onClose={() => {}} providers={make()} recentIds={[]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});

describe("quick find in the study app", () => {
  beforeEach(() => {
    const store = {};
    Object.defineProperty(window, "localStorage", {
      value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
      writable: true,
    });
    window.history.replaceState(null, "", "/?view=study-preview");
  });

  test("Ctrl+K and the Search button open it; actions are searchable", async () => {
    render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "new subject" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
