import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act, createEvent } from "@testing-library/react";
import { useState } from "react";
import SourcesView from "./SourcesView";
import { StudyProvider } from "../data/StudyProvider";
import { fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";
import { ShellContext } from "../ShellContext";
import { UploadsProvider } from "./UploadsProvider";
import { useSettings } from "../useSettings";

const source = (id, title, subjects, extra = {}) => ({ path: `Sources/${id}.md`, id,
  meta: { id, title, subjects, type: "text", created: "2026-10-01", updated: "2026-10-01", ...extra }, body: `Content of ${title}`, version: id });
const SNAP = { folders: ["Biology", "Chemistry", "Physics", "Sources"], layout: { subjects: ["Chemistry", "Biology", "Physics"] },
  files: [source("cells", "Cells", ["Biology", "Chemistry"]), source("atoms", "Atoms", ["Biology"]), source("loose", "Loose", [])] };
let open, toast;
beforeEach(() => { installMemoryLocalStorage(); open = vi.fn(); toast = vi.fn(); });
function Wrapper({ subjectId }) {
  const [route, setRoute] = useState(subjectId);
  const [settings, set] = useSettings();
  return <ShellContext.Provider value={{ toast, open: (next) => { open(next); if (next.view === "subject-sources") setRoute(next.id); else if (next.view === "sources") setRoute(null); },
    sourcesLayout: settings.layout.sources, setSourcesLayout: (patch) => set("layout", (layout) => ({ sources: { ...layout.sources, ...patch } })) }}>
    <UploadsProvider><SourcesView key={route || "overview"} subjectId={route} /></UploadsProvider>
  </ShellContext.Provider>;
}
const mount = (subjectId, snapshot = SNAP, client = fakeClient(snapshot)) => ({ ...render(<StudyProvider client={client}><Wrapper subjectId={subjectId} /></StudyProvider>), client });
const box = (name) => screen.findByRole("button", { name: new RegExp(`^Open ${name},`) });
function transfer() { const data = {}; return { types: ["application/x-study-source"], setData: (k, v) => { data[k] = v; }, getData: (k) => data[k] || "" }; }
async function dragTo(target, from = "Loose", copy = false) {
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByText(from).closest("tr") || screen.getByRole("article", { name: from }), { dataTransfer });
  const to = typeof target === "function" ? target() : target;
  fireEvent.dragOver(to, { dataTransfer });
  const event = createEvent.drop(to, { dataTransfer }); Object.defineProperty(event, "ctrlKey", { value: copy }); fireEvent(to, event);
}

it("shows reference subject boxes in sidebar order with Unsorted as a list below", async () => {
  mount(); await box("Biology");
  expect([...document.querySelectorAll('.st-src-subject-box')].map((b) => b.textContent.split(/\d/)[0])).toEqual(["Chemistry", "Biology", "Physics"]);
  expect(screen.queryByRole("button", { name: /^Open Unsorted/ })).toBeNull();
  expect(within(screen.getByRole("region", { name: "Unsorted sources" })).getByText("Loose").closest("tr")).toBeTruthy();
  expect(screen.queryByLabelText("Box style")).toBeNull();
  expect(screen.getByRole("button", { name: "Search", exact: true }).disabled).toBe(true);
});
it("opens a dedicated subject route and only its sources, with the same Kratt panel", async () => {
  mount(); fireEvent.click(await box("Biology"));
  expect(open).toHaveBeenCalledWith({ view: "subject-sources", id: "Biology" });
  expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Atoms", "Cells"]);
  expect(screen.queryByText("Loose")).toBeNull();
  expect(screen.getByRole("heading", { name: "Find sources with Kratt" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open Cells" }));
  expect(open).toHaveBeenCalledWith({ view: "source", id: "cells" });
});
it("moves an Unsorted row onto a subject box without creating a subject", async () => {
  const { client } = mount(); await dragTo(await box("Physics"));
  expect(screen.queryByText("Loose")).toBeNull();
  expect((await box("Physics")).getAttribute("aria-label")).toBe("Open Physics, 1 source");
  expect(document.querySelectorAll('.st-src-subject-box')).toHaveLength(3);
});
it.each([false, true])("subject dragging moves or adds membership (copy=%s)", async (copy) => {
  mount("Biology"); await screen.findByRole("button", { name: "Open Atoms" });
  await dragTo(() => within(screen.getByLabelText("Move source to subject")).getByText("Physics"), "Atoms", copy);
  expect(Boolean(screen.queryByRole("button", { name: "Open Atoms" }))).toBe(copy);
  fireEvent.click(screen.getByRole("button", { name: "All subjects" })); fireEvent.click(await box("Physics"));
  expect(screen.getByRole("button", { name: "Open Atoms" })).toBeTruthy();
});
it("Subjects checklist can link a source to multiple subjects", async () => {
  mount(); await box("Biology");
  fireEvent.click(screen.getByRole("button", { name: "More for Loose" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Subjects…" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("Biology")); fireEvent.click(within(dialog).getByLabelText("Physics"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
  expect((await box("Biology")).getAttribute("aria-label")).toBe("Open Biology, 3 sources");
  expect((await box("Physics")).getAttribute("aria-label")).toBe("Open Physics, 1 source");
});
it("removes membership without deleting a shared source, and warns before deleting it", async () => {
  mount("Biology"); await screen.findByRole("button", { name: "Open Cells" });
  fireEvent.click(screen.getByRole("button", { name: "More for Cells" })); fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(within(screen.getByRole("dialog")).getByText(/also in Chemistry/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "More for Cells" })); fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Biology" }));
  expect(screen.queryByRole("button", { name: "Open Cells" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All subjects" })); fireEvent.click(await box("Chemistry"));
  expect(screen.getByRole("button", { name: "Open Cells" })).toBeTruthy();
});
it("sorts and remembers each subject's choice", async () => {
  const first = mount("Biology"); await screen.findByRole("button", { name: "Open Cells" });
  fireEvent.change(screen.getByLabelText("Sort Biology sources"), { target: { value: "za" } });
  expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Cells", "Atoms"]);
  first.unmount(); mount("Biology"); await screen.findByRole("button", { name: "Open Cells" });
  expect(screen.getByLabelText("Sort Biology sources").value).toBe("za");
});
it.each([[null,"Unsorted"],["Biology","Biology"]])("pastes URLs into the current collection (%s), but ignores editing controls", async (id, name) => {
  mount(id); await screen.findByRole("region", { name: `${name} sources` });
  const clipboardData = { getData: () => "https://example.com/one\nhttps://example.com/two" };
  fireEvent.paste(screen.getByLabelText("What do you want to learn about?"), { clipboardData });
  await act(async () => {});
  expect(screen.queryByText("example.com/one")).toBeNull();
  fireEvent.paste(document.body, { clipboardData });
  expect(await screen.findByText("example.com/one")).toBeTruthy();
  expect(screen.getByText("example.com/two")).toBeTruthy();
});
it("drops onto a box into that subject, and onto the page into Unsorted", async () => {
  const { client } = mount(); const target = await box("Physics");
  const dataTransfer = { types: ["Files"], files: [new File(["pic"], "photo.png")], getData: () => "" };
  fireEvent.drop(target, { dataTransfer });
  await waitFor(() => expect(target.getAttribute("aria-label")).toBe("Open Physics, 1 source"));
  expect(screen.queryByText("photo")).toBeNull();
  fireEvent.drop(document.querySelector(".st-src"), { dataTransfer: { ...dataTransfer, files: [new File(["vid"], "movie.mp4")] } });
  expect(await screen.findByText("movie")).toBeTruthy();
  await waitFor(() => expect(client.calls.filter((c) => c.method === "upload")).toHaveLength(2));
});
it("shows drop overlay, failed status, and refuses new intake while offline", async () => {
  const snap = { ...SNAP, files: [...SNAP.files, source("failed", "Failed", ["Physics"], { upload: "uploading" })] };
  const { client } = mount("Physics", snap); await screen.findByText("Original not saved");
  fireEvent.dragOver(document.querySelector(".st-src"), { dataTransfer: { types: ["Files"] } });
  expect(screen.getByText("Drop to add to Physics")).toBeTruthy();
  client.fail = true;
  fireEvent.drop(document.querySelector(".st-src"), { dataTransfer: { files: [new File(["a"], "not-added.png")], getData: () => "" } });
  await waitFor(() => expect(toast).toHaveBeenCalledWith("The Study folder service isn't running"));
  expect(screen.queryByText("not-added")).toBeNull();
});
it.each([["Add link","Add URL"],["Upload files","Upload file"],["Paste text","Enter text"]])("opens %s in the right mode", async (button, tab) => {
  mount("Physics"); await screen.findByRole("region", { name: "Physics sources" }); fireEvent.click(screen.getByRole("button", { name: button }));
  expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
});
it("creates pasted text in its subject, keeping the dialog paste out of global intake", async () => {
  mount("Physics"); await screen.findByRole("region", { name: "Physics sources" }); fireEvent.click(screen.getByRole("button", { name: "Paste text" }));
  fireEvent.change(screen.getByLabelText("Text content"), { target: { value: "Gravity" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add source" }));
  expect(await screen.findByRole("button", { name: "Open Gravity" })).toBeTruthy();
});
it("Unsorted rows open from keyboard and their menu has no Remove-from action", async () => {
  mount(); await box("Biology"); const row = screen.getByText("Loose").closest("tr");
  fireEvent.keyDown(row, { key: "Enter" }); expect(open).toHaveBeenCalledWith({ view: "source", id: "loose" });
  fireEvent.click(screen.getByRole("button", { name: "More for Loose" }));
  expect(screen.queryByRole("menuitem", { name: /Remove from/ })).toBeNull();
});
