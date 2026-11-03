import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const file = (id, title, type, updated, made_from, extra = {}) => ({
  path: `Artifacts/${title}.md`,
  id,
  meta: { id, title, type, made_from, made_in: null, created: updated, updated, parts: 1, source_bytes: 10, ...extra },
  body: type === "slides" ? "# One\nHi\n" : type === "quiz" ? "### Q?\n- [ ] A\n- [x] B\n" : "### F\nB\n",
  version: `v-${id}`,
});

const withSources = SAMPLE_SNAPSHOT.files.map((f) => (f.id === "s1" ? { ...f, meta: { ...f.meta, subjects: ["Biology"] } } : f));
const SNAP = {
  ...SAMPLE_SNAPSHOT,
  folders: [...SAMPLE_SNAPSHOT.folders, "Chemistry", "Artifacts"],
  layout: { ...SAMPLE_SNAPSHOT.layout, subjects: ["Biology", "Chemistry"] },
  files: [
    ...withSources,
    { path: "Chemistry/Acids.md", id: "p9", meta: { id: "p9", title: "Acids" }, body: "Sour.\n", version: "v9" },
    { path: "Sources/Titration.md", id: "s2", meta: { id: "s2", title: "Titration", type: "link", url: "https://e.org/t", use: true, subjects: ["Chemistry"] }, body: "Text.\n", version: "v5" },
    file("a1", "Cell cards", "flashcards", "2026-10-20T10:00:00Z", ["p1", "Biology", "s1"], { last_score: { right: 3, of: 5, at: "2026-10-21T10:00:00Z" } }),
    file("a2", "Biology deck", "slides", "2026-10-22T10:00:00Z", ["Biology"]),
    file("a3", "Lecture quiz", "quiz", "2026-10-21T10:00:00Z", ["s1"]),
    file("a4", "Acid cards", "flashcards", "2026-10-19T10:00:00Z", ["p9"]),
    file("a5", "Titration quiz", "quiz", "2026-10-18T10:00:00Z", ["s2"]),
  ],
};

beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
});

const openView = async (snap = SNAP) => {
  render(<StudyPreview client={fakeClient(snap)} />);
  const side = within(await screen.findByRole("navigation", { name: "Sidebar" }));
  const see = side.getAllByRole("button", { name: "See all" });
  fireEvent.click(see[1]); // Chats first, Artifacts second
  return within(screen.getByRole("region", { name: "Artifacts" }));
};
const titles = (view) => view.getAllByRole("listitem").map((li) => li.querySelector(".st-chats-title").textContent);

describe("Artifacts view", () => {
  it("lists all, newest first, with made-from names, date and score", async () => {
    const view = await openView();
    expect(screen.getByRole("tab", { name: "Artifacts" }).getAttribute("aria-selected")).toBe("true");
    expect(titles(view)).toEqual(["Biology deck", "Lecture quiz", "Cell cards", "Acid cards", "Titration quiz"]);
    const row = view.getByText("Cell cards").closest("li");
    expect(row.textContent).toContain("Flashcards");
    expect(row.textContent).toContain("Krebs cycle, Biology +1");
    expect(row.textContent).toContain("3 of 5");
    expect(view.getByText("Biology deck").closest("li").textContent).not.toContain(" of ");
  });

  it("a row opens the artifact tab", async () => {
    const view = await openView();
    fireEvent.click(view.getByText("Lecture quiz"));
    expect(screen.getByRole("tab", { name: "Lecture quiz" }).getAttribute("aria-selected")).toBe("true");
  });

  it("filters by type", async () => {
    const view = await openView();
    fireEvent.change(view.getByRole("combobox", { name: "Type" }), { target: { value: "quiz" } });
    expect(titles(view)).toEqual(["Lecture quiz", "Titration quiz"]);
  });

  it("filters by subject: the subject, a page inside it, or a source of it", async () => {
    const view = await openView();
    const subject = view.getByRole("combobox", { name: "Subject" });
    fireEvent.change(subject, { target: { value: "Biology" } });
    expect(titles(view)).toEqual(["Biology deck", "Lecture quiz", "Cell cards"]);
    fireEvent.change(subject, { target: { value: "Chemistry" } });
    expect(titles(view)).toEqual(["Acid cards", "Titration quiz"]);
  });

  it("searches titles", async () => {
    const view = await openView();
    const search = view.getByRole("searchbox", { name: "Search artifacts" });
    fireEvent.change(search, { target: { value: "ACID" } });
    expect(titles(view)).toEqual(["Acid cards"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(view.getByText("No artifacts match")).toBeTruthy();
  });

  it("empty state with Kratt", async () => {
    const view = await openView({ ...EMPTY_SNAPSHOT });
    expect(view.getByText("No artifacts yet. Ask Kratt to make flashcards, slides or a quiz from your notes.")).toBeTruthy();
    expect(view.getByRole("img", { name: "Kratt" })).toBeTruthy();
    expect(view.queryByRole("searchbox")).toBeNull();
  });
});
