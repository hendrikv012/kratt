import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, cleanup, waitFor, createEvent, act } from "@testing-library/react";
import SourcesView from "./SourcesView";
import { StudyProvider, useStudy } from "../data/StudyProvider";
import { EMPTY_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";

const src = (id, title, subjects, updated) => ({
  path: `Sources/${title}.md`,
  id,
  meta: { id, title, type: "text", use: false, subjects, created: updated, updated },
  body: "Text.\n",
  version: `v-${id}`,
});

const SNAP = {
  folders: ["Biology", "Chemistry", "Physics", "Sources"],
  files: [
    src("s1", "Lecture", ["Biology", "Chemistry"], "2026-10-03T00:00:00Z"),
    src("s2", "Notes", ["Biology"], "2026-10-02T00:00:00Z"),
    src("s3", "Loose", undefined, "2026-10-01T00:00:00Z"),
  ],
  layout: { subjects: ["Biology", "Chemistry", "Physics"] },
};

let open, toast;
beforeEach(() => {
  installMemoryLocalStorage();
  open = vi.fn();
  toast = vi.fn();
});

const view = (snap = SNAP) => (
  <StudyProvider client={fakeClient(snap)}>
    <ShellContext.Provider value={{ open, toast }}>
      <SourcesView />
    </ShellContext.Provider>
  </StudyProvider>
);
const group = (name) => screen.getByRole("region", { name });
const header = (name) => within(group(name)).getAllByRole("button")[0];
const rowOf = (name, title) => within(group(name)).getByText(title).closest("tr");
const press = (key) => fireEvent.keyDown(window, { key });
// The provider loads asynchronously: wait for every row before interacting.
const ready = (n = 4, container = document) =>
  waitFor(() => expect(container.querySelectorAll("tbody tr")).toHaveLength(n));
const inGroup = (name, title) => within(group(name)).queryByText(title) !== null;
const drop = (el, init) => {
  const e = createEvent.drop(el);
  if (init?.ctrlKey) Object.defineProperty(e, "ctrlKey", { value: true });
  fireEvent(el, e);
};
const dragTo = (from, title, to, init) => {
  fireEvent.dragStart(rowOf(from, title));
  fireEvent.dragOver(group(to));
  drop(group(to), init);
};

it("shows a group per subject in subject order, Unsorted last", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  const names = screen.getAllByRole("region").map((g) => g.getAttribute("aria-label"));
  expect(names).toEqual(["Biology", "Chemistry", "Physics", "Unsorted"]);
  expect(header("Biology").textContent).toContain("Biology · 2");
  expect(header("Chemistry").textContent).toContain("Chemistry · 1");
  expect(header("Physics").textContent).toContain("Physics · 0");
});

it("a source in two subjects shows in both groups", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  expect(within(group("Biology")).getByText("Lecture")).toBeTruthy();
  expect(within(group("Chemistry")).getByText("Lecture")).toBeTruthy();
});

it("empty subject starts collapsed with a hint", async () => {
  render(view());
  await screen.findByRole("region", { name: "Physics" });
  expect(header("Physics").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(header("Physics"));
  expect(screen.getByText("Drag sources here")).toBeTruthy();
});

it("collapsing hides rows and is remembered", async () => {
  const { unmount } = render(view());
  await screen.findByRole("region", { name: "Biology" });
  fireEvent.click(header("Biology"));
  expect(screen.queryByText("Notes")).toBeNull();
  expect(window.localStorage.getItem("kratt.sources.collapsed")).toContain('"Biology":true');
  unmount();
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  expect(header("Biology").getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Notes")).toBeNull();
});

it("hover selects one row instance", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  fireEvent.mouseEnter(rowOf("Chemistry", "Lecture"));
  const selected = document.querySelectorAll("tr[data-selected]");
  expect(selected).toHaveLength(1);
  expect(selected[0]).toBe(rowOf("Chemistry", "Lecture"));
});

it("Enter opens the selected visible row after collapsing", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  fireEvent.mouseEnter(rowOf("Biology", "Notes"));
  fireEvent.click(header("Biology"));
  press("Enter");
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith({ view: "source", id: "s1" });
});

it("ArrowDown walks across groups", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  await ready();
  expect(rowOf("Biology", "Lecture").hasAttribute("data-selected")).toBe(true);
  press("ArrowDown");
  press("ArrowDown");
  press("ArrowDown");
  press("Enter");
  expect(open).toHaveBeenLastCalledWith({ view: "source", id: "s3" });
  cleanup();
  open.mockClear();
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  await ready();
  press("ArrowDown");
  press("ArrowDown");
  expect(rowOf("Chemistry", "Lecture").hasAttribute("data-selected")).toBe(true);
  press("Enter");
  expect(open).toHaveBeenLastCalledWith({ view: "source", id: "s1" });
});

it("arrows still move the selection after clicking a group header", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  const head = header("Physics");
  head.focus();
  fireEvent.click(head);
  expect(rowOf("Biology", "Lecture").hasAttribute("data-selected")).toBe(true);
  fireEvent.keyDown(head, { key: "ArrowDown", bubbles: true });
  expect(rowOf("Biology", "Notes").hasAttribute("data-selected")).toBe(true);
  fireEvent.keyDown(head, { key: "Enter", bubbles: true });
  expect(open).not.toHaveBeenCalled();
});

it("ticking use still works", async () => {
  render(view());
  await screen.findByRole("region", { name: "Biology" });
  const box = within(group("Biology")).getByLabelText("Use Notes");
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  expect(within(group("Biology")).getByLabelText("Use Notes").checked).toBe(true);
});

it("no sources shows the empty state", async () => {
  render(view(EMPTY_SNAPSHOT));
  expect(await screen.findByText("No sources yet")).toBeTruthy();
});

it("dropping moves a source", async () => {
  render(view());
  await ready();
  dragTo("Biology", "Notes", "Chemistry");
  await waitFor(() => expect(inGroup("Chemistry", "Notes")).toBe(true));
  expect(inGroup("Biology", "Notes")).toBe(false);
  expect(toast).toHaveBeenCalledWith("Moved to Chemistry");
});

it("Ctrl+drop adds", async () => {
  render(view());
  await ready();
  dragTo("Biology", "Notes", "Chemistry", { ctrlKey: true });
  await waitFor(() => expect(inGroup("Chemistry", "Notes")).toBe(true));
  expect(inGroup("Biology", "Notes")).toBe(true);
  expect(toast).toHaveBeenCalledWith("Added to Chemistry");
});

it("dropping from Unsorted adds", async () => {
  render(view());
  await ready();
  dragTo("Unsorted", "Loose", "Physics");
  await waitFor(() => expect(inGroup("Physics", "Loose")).toBe(true));
  expect(screen.queryByRole("region", { name: "Unsorted" })).toBeNull();
});

it("dropping onto Unsorted removes from the group dragged from", async () => {
  render(view());
  await ready();
  dragTo("Biology", "Notes", "Unsorted");
  await waitFor(() => expect(inGroup("Unsorted", "Notes")).toBe(true));
  expect(inGroup("Biology", "Notes")).toBe(false);
});

it("dropping onto a group it is in does nothing", async () => {
  render(view());
  await ready();
  fireEvent.dragStart(rowOf("Biology", "Lecture"));
  fireEvent.dragOver(group("Chemistry"));
  expect(group("Chemistry").hasAttribute("data-over")).toBe(false);
  drop(group("Chemistry"));
  expect(toast).not.toHaveBeenCalled();
});

it("a cancelled drag leaves no drop target", async () => {
  render(view());
  await ready();
  fireEvent.dragStart(rowOf("Biology", "Notes"));
  fireEvent.dragOver(group("Chemistry"));
  expect(group("Chemistry").hasAttribute("data-over")).toBe(true);
  fireEvent.dragEnd(rowOf("Biology", "Notes"));
  expect(document.querySelectorAll("section[data-over]")).toHaveLength(0);
  fireEvent.dragOver(group("Chemistry"));
  expect(document.querySelectorAll("section[data-over]")).toHaveLength(0);
});

it("Subjects… sets the checked subjects", async () => {
  render(view());
  await ready();
  fireEvent.click(within(group("Unsorted")).getByLabelText("More for Loose"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Subjects…" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("Biology"));
  fireEvent.click(within(dialog).getByLabelText("Physics"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(inGroup("Biology", "Loose")).toBe(true));
  expect(inGroup("Physics", "Loose")).toBe(true);
});

it("Remove from only appears in a subject group", async () => {
  render(view());
  await ready();
  fireEvent.click(within(group("Unsorted")).getByLabelText("More for Loose"));
  expect(screen.queryByRole("menuitem", { name: /Remove from/ })).toBeNull();
  fireEvent.click(within(group("Chemistry")).getByLabelText("More for Lecture"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Chemistry" }));
  await waitFor(() => expect(inGroup("Chemistry", "Lecture")).toBe(false));
  expect(inGroup("Biology", "Lecture")).toBe(true);
  expect(toast).toHaveBeenCalledWith("Removed from Chemistry");
});

it("deleting warns about other subjects", async () => {
  render(view());
  await ready();
  fireEvent.click(within(group("Biology")).getByLabelText("Delete Lecture"));
  expect(within(screen.getByRole("dialog")).getByText(/It is also in Chemistry\./)).toBeTruthy();
});

it("Subjects dialog without subjects", async () => {
  const snap = { ...SNAP, folders: ["Sources"], layout: { subjects: [] }, files: [src("s3", "Loose", undefined, "2026-10-01T00:00:00Z")] };
  render(view(snap));
  await ready(1);
  fireEvent.click(screen.getByLabelText("More for Loose"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Subjects…" }));
  expect(screen.getByText("Make a subject in the sidebar first")).toBeTruthy();
});

it("the menu marks Delete as dangerous", async () => {
  render(view());
  await ready();
  fireEvent.click(within(group("Unsorted")).getByLabelText("More for Loose"));
  expect(screen.getByRole("menuitem", { name: "Delete" }).hasAttribute("data-danger")).toBe(true);
});

it("keys work again when the source in the Subjects dialog is deleted", async () => {
  let actions;
  const Probe = () => {
    actions = useStudy().actions;
    return null;
  };
  render(
    <StudyProvider client={fakeClient(SNAP)}>
      <ShellContext.Provider value={{ open, toast }}>
        <SourcesView />
        <Probe />
      </ShellContext.Provider>
    </StudyProvider>
  );
  await ready();
  fireEvent.click(within(group("Unsorted")).getByLabelText("More for Loose"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Subjects…" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  act(() => actions.deleteSource("s3"));
  await ready(3);
  expect(screen.queryByRole("dialog")).toBeNull();
  press("ArrowDown");
  press("Enter");
  expect(open).toHaveBeenLastCalledWith({ view: "source", id: "s2" });
});
