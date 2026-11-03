import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const snap = { ...SAMPLE_SNAPSHOT, folders: [...SAMPLE_SNAPSHOT.folders, "Artifacts"] };

beforeEach(() => {
  installMemoryLocalStorage();
  localStorage.setItem(
    "study-preview-settings-v3",
    JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, ai: { onUrl: "http://localhost:5055", model: "online" } })
  );
  window.history.replaceState(null, "", "/?view=study-preview");
});

const start = async (ask) => {
  const client = fakeClient(snap);
  client.notebookAsk = ask ?? vi.fn(async () => ({ output: "# Fresh\n\n### New?\nYes\n" }));
  render(<StudyPreview client={client} />);
  const side = within(await screen.findByRole("navigation", { name: "Sidebar" }));
  fireEvent.click(side.getAllByRole("button", { name: "See all" })[1]);
  screen.getByRole("button", { name: "New artifact" }).focus();
  fireEvent.click(screen.getByRole("button", { name: "New artifact" }));
  return { client, dialog: within(screen.getByRole("dialog", { name: "New artifact" })) };
};
const pick = (dialog, name) => {
  fireEvent.keyDown(dialog.getByRole("button", { name: "Add note" }), { key: "Enter" });
  fireEvent.click(within(screen.getByRole("menu")).getByText(name));
};
const make = (dialog) => dialog.getByRole("button", { name: "Make" });

describe("New artifact dialog", () => {
  it("Make is disabled until a type and at least one note are picked", async () => {
    const { dialog } = await start();
    expect(make(dialog).disabled).toBe(true);
    fireEvent.click(dialog.getByRole("radio", { name: "Quiz" }));
    expect(make(dialog).disabled).toBe(true);
    pick(dialog, "Krebs cycle");
    expect(dialog.getByText("Krebs cycle")).toBeTruthy();
    expect(make(dialog).disabled).toBe(false);
    fireEvent.click(dialog.getByRole("button", { name: "Remove Krebs cycle" }));
    expect(make(dialog).disabled).toBe(true);
  });

  it("offers sources too", async () => {
    const { dialog } = await start();
    fireEvent.keyDown(dialog.getByRole("button", { name: "Add note" }), { key: "Enter" });
    expect(within(screen.getByRole("menu")).getByText("Lecture")).toBeTruthy();
  });

  it("making shows progress and opens the new artifact", async () => {
    let release;
    const { client } = await start(vi.fn(() => new Promise((r) => (release = r))));
    const dialog = within(screen.getByRole("dialog", { name: "New artifact" }));
    fireEvent.click(dialog.getByRole("radio", { name: "Flashcards" }));
    pick(dialog, "Krebs cycle");
    fireEvent.click(make(dialog));
    expect(await dialog.findByText(/Kratt is making your cards|Making part/)).toBeTruthy();
    release({ output: "# Fresh\n\n### New?\nYes\n" });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" }).value).toBe("Fresh"));
    expect(screen.queryByRole("dialog", { name: "New artifact" })).toBeNull();
    await waitFor(() => {
      const saved = client.snapshotNow().files.filter((f) => f.path.startsWith("Artifacts/"));
      expect(saved).toHaveLength(1);
      expect(saved[0].meta.made_in ?? null).toBeNull();
    });
  });

  it("Cancel stops it and saves nothing", async () => {
    let release;
    const { client, dialog } = await start(vi.fn(() => new Promise((r) => (release = r))));
    fireEvent.click(dialog.getByRole("radio", { name: "Slides" }));
    pick(dialog, "Krebs cycle");
    fireEvent.click(make(dialog));
    fireEvent.click(await dialog.findByRole("button", { name: "Cancel" }));
    expect(dialog.queryByText(/Kratt is making/)).toBeNull();
    release({ output: "# Late\n\n# One\nHi\n" });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.snapshotNow().files.filter((f) => f.path.startsWith("Artifacts/"))).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "New artifact" })).toBeTruthy();
  });

  it("errors show in the dialog with Try again", async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error("ai-unavailable")).mockResolvedValue({ output: "# Fresh\n\n### New?\nYes\n" });
    const { dialog } = await start(ask);
    fireEvent.click(dialog.getByRole("radio", { name: "Flashcards" }));
    pick(dialog, "Krebs cycle");
    fireEvent.click(make(dialog));
    expect((await dialog.findByRole("alert")).textContent).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" }).value).toBe("Fresh"));
  });

  it("closing the dialog mid-make saves nothing", async () => {
    let release;
    const { client, dialog } = await start(vi.fn(() => new Promise((r) => (release = r))));
    fireEvent.click(dialog.getByRole("radio", { name: "Flashcards" }));
    pick(dialog, "Krebs cycle");
    fireEvent.click(make(dialog));
    await dialog.findByText(/Kratt is making/);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "New artifact" })).toBeNull();
    release({ output: "# Late\n\n### New?\nYes\n" });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.snapshotNow().files.filter((f) => f.path.startsWith("Artifacts/"))).toHaveLength(0);
  });
});


it("keeps Tab in the artifact dialog and returns focus to its opener", async () => {
  const { dialog } = await start();
  const first = dialog.getByRole("radio", { name: "Flashcards" });
  const last = dialog.getByRole("button", { name: "Close" }); // Make is disabled until notes are selected.
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "New artifact" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "New artifact" }));
});
