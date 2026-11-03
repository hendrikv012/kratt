import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import SourcesView from "./SourcesView";
import { useSettings } from "../useSettings";
import { StudyProvider } from "../data/StudyProvider";
import { fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";

const source = (id, title, subjects, body = "Source content.") => ({
  path: `Sources/${id}.md`, id, meta: { id, title, subjects, type: "text", use: false, created: "2026-11-01", updated: "2026-11-01" }, body, version: id,
});
const snapshot = {
  folders: ["Biology", "Chemistry", "Sources"], layout: { subjects: ["Biology", "Chemistry"] },
  files: [source("cells", "Cells", ["Biology"], "Cells make energy."), source("loose", "Loose", [])],
};
let open;
beforeEach(() => { installMemoryLocalStorage(); open = vi.fn(); });
function Wrapper() {
  const [settings, set] = useSettings();
  return <ShellContext.Provider value={{ open, toast: vi.fn(), sourcesLayout: settings.layout.sources,
    setSourcesLayout: (patch) => set("layout", (layout) => ({ sources: { ...layout.sources, ...patch } })) }}><SourcesView /></ShellContext.Provider>;
}
function mount(snap = snapshot) {
  return render(<StudyProvider client={fakeClient(snap)}><Wrapper /></StudyProvider>);
}
const subject = (name) => screen.findByRole("button", { name: new RegExp(`^Open ${name},`) });
const choose = (style) => fireEvent.change(screen.getByLabelText("Box style"), { target: { value: style } });

it("opens subjects into source boxes and source boxes into their content", async () => {
  mount(); fireEvent.click(await subject("Biology"));
  expect(screen.getByRole("heading", { name: "Biology" })).toBe(document.activeElement);
  fireEvent.click(screen.getByRole("button", { name: "Open Cells" }));
  expect(open).toHaveBeenCalledWith({ view: "source", id: "cells" });
  fireEvent.click(screen.getByRole("button", { name: "All subjects" }));
  expect(await subject("Chemistry")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Cells" })).toBeNull();
});

it("remembers box style and the open subject across remounts", async () => {
  const view = mount(); fireEvent.click(await subject("Biology")); choose("preview");
  expect(screen.getByText("Cells make energy.")).toBeTruthy();
  view.unmount(); mount();
  await screen.findByRole("button", { name: "Open Cells" });
  expect(screen.getByLabelText("Box style").value).toBe("preview");
  expect(screen.getByText("Cells make energy.")).toBeTruthy();
  choose("simple"); expect(screen.queryByText("Cells make energy.")).toBeNull();
  choose("list"); expect(document.querySelector("tbody tr")).toBeTruthy();
});

it("shows empty subjects and creates a source directly in the open subject", async () => {
  mount(); fireEvent.click(await subject("Chemistry"));
  expect(screen.getByText("No sources yet")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "New source" })[0]);
  fireEvent.click(screen.getByRole("tab", { name: "Enter text" }));
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Atoms" } });
  fireEvent.change(screen.getByLabelText("Text content"), { target: { value: "Atoms have electrons." } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add source" }));
  expect(await screen.findByRole("button", { name: "Open Atoms" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All subjects" }));
  expect((await subject("Chemistry")).getAttribute("aria-label")).toBe("Open Chemistry, 1 source");
});

it("keeps selection and subject menus independent from opening the card", async () => {
  mount(); fireEvent.click(await subject("Biology"));
  fireEvent.click(screen.getByLabelText("Use Cells"));
  expect(screen.getByLabelText("Use Cells").checked).toBe(true); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "More for Cells" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Biology" }));
  expect(screen.getByText("No sources yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All subjects" })); fireEvent.click(await subject("Unsorted"));
  expect(screen.getByRole("button", { name: "Open Cells" })).toBeTruthy();
});

it("dragging a source to another subject keeps the existing move behavior", async () => {
  mount(); fireEvent.click(await subject("Biology"));
  fireEvent.dragStart(screen.getByRole("article", { name: "Cells" }));
  const target = within(screen.getByLabelText("Move source to subject")).getByText("Chemistry");
  fireEvent.dragOver(target); fireEvent.drop(target);
  expect(screen.getByText("No sources yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All subjects" })); fireEvent.click(await subject("Chemistry"));
  expect(screen.getByRole("button", { name: "Open Cells" })).toBeTruthy();
});

it("sorts cards and deletes with confirmation", async () => {
  mount({ ...snapshot, files: [...snapshot.files, source("atoms", "Atoms", ["Biology"])] });
  fireEvent.click(await subject("Biology"));
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "title" } });
  fireEvent.click(screen.getByRole("button", { name: "Sort ascending" }));
  expect(screen.getAllByRole("article").map((n) => n.getAttribute("aria-label"))).toEqual(["Atoms", "Cells"]);
  fireEvent.click(screen.getByRole("button", { name: "More for Atoms" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(screen.getByRole("button", { name: "Open Atoms" })).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Open Atoms" })).toBeNull());
});

it("renders Unsorted for an empty vault and falls back from unknown styles and deleted subjects", async () => {
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ layout: { sources: { style: "broken", subjectId: "gone" } } }));
  mount({ folders: [], files: [], layout: {} });
  expect((await screen.findByLabelText("Box style")).value).toBe("rich");
  fireEvent.click(await subject("Unsorted")); expect(screen.getByText("No sources yet")).toBeTruthy();
});
