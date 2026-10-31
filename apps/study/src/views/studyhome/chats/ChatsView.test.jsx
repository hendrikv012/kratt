import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

beforeEach(() => {
  installMemoryLocalStorage();
  // Skip the opening screen so nothing covers the app.
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
});

const C1 = "Chats/2026-10-20 09-58 Krebs cycle.md";
const TITLE = "Krebs cycle, step by step";

const renderApp = async (client) => {
  render(<StudyPreview client={client} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};
const openChats = async (client) => {
  const side = await renderApp(client);
  fireEvent.click(side.getByRole("button", { name: "See all" }));
  return within(screen.getByRole("region", { name: "Chats" }));
};
const panel = () => within(screen.getByRole("complementary", { name: "Kratt Chat" }));

describe("Chats screen", () => {
  it("lists, searches, renames and deletes", async () => {
    const client = fakeClient(SAMPLE_SNAPSHOT);
    const view = await openChats(client);
    expect(view.getByRole("heading", { name: "Chats" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Chats" }).getAttribute("aria-selected")).toBe("true");
    expect(view.getByText(TITLE)).toBeTruthy();
    expect(view.getByText(TITLE).closest("button").tabIndex).toBe(-1); // Open is the tab stop
    expect(view.getByText("One turn, from your notes: it runs in the matrix.")).toBeTruthy();

    const search = view.getByRole("searchbox", { name: "Search chats" });
    fireEvent.change(search, { target: { value: "krebs" } });
    expect(view.getByText(TITLE)).toBeTruthy();
    fireEvent.change(search, { target: { value: "MATRIX" } }); // turn text, any case
    expect(view.getByText(TITLE)).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(view.queryByText(TITLE)).toBeNull();
    expect(view.getByText("No chats match")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.click(view.getByRole("button", { name: `Rename ${TITLE}` }));
    const input = view.getByRole("textbox", { name: "Chat title" });
    fireEvent.change(input, { target: { value: "Cycle" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(view.getByText("Cycle")).toBeTruthy();
    await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "c1").meta.title).toBe("Cycle"));

    fireEvent.click(view.getByRole("button", { name: "Delete Cycle" }));
    const dialog = within(screen.getByRole("dialog", { name: "Delete chat" }));
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.queryByText("Cycle")).toBeNull();
    await waitFor(() => expect(client.calls.some((c) => c.method === "trash" && c.path === C1)).toBe(true));
  });

  it("Open shows the chat in the panel", async () => {
    const view = await openChats(fakeClient(SAMPLE_SNAPSHOT));
    fireEvent.click(view.getByRole("button", { name: `Open ${TITLE}` }));
    expect(panel().getByText("Walk me through one turn of the cycle, step by step.")).toBeTruthy();
  });

  it("empty state", async () => {
    const view = await openChats(fakeClient(EMPTY_SNAPSHOT));
    expect(view.getByText("No chats yet. Start one with New chat or Ctrl J.")).toBeTruthy();
    expect(view.queryByRole("searchbox")).toBeNull();
  });
});

describe("Latest chats widget", () => {
  it("shows one row at 2x1", async () => {
    localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, layout: { home: { order: ["chats"], size: { chats: "2x1" } } } })
    );
    const c1 = SAMPLE_SNAPSHOT.files.find((f) => f.id === "c1");
    const c2 = {
      ...c1,
      path: "Chats/2026-10-21 08-00 Osmosis.md",
      id: "c2",
      meta: { ...c1.meta, id: "c2", title: "Osmosis", created: "2026-10-21T08:00:00Z", updated: "2026-10-21T08:05:00Z" },
      version: "v6",
    };
    await renderApp(fakeClient({ ...SAMPLE_SNAPSHOT, files: [...SAMPLE_SNAPSHOT.files, c2] }));
    const tile = document.querySelector('[data-tile="chats"]');
    expect(tile.closest("[style]").style.getPropertyValue("--h")).toBe("1");
    expect(within(tile).getAllByRole("listitem")).toHaveLength(1);
    expect(within(tile).getByText("Osmosis")).toBeTruthy(); // the newest
  });

  it("widget opens a chat", async () => {
    await renderApp(fakeClient(SAMPLE_SNAPSHOT));
    const tile = within(document.querySelector('[data-tile="chats"]'));
    expect(tile.queryByRole("button", { name: /Rename|Delete/ })).toBeNull();
    fireEvent.click(tile.getByText(TITLE));
    expect(panel().getByRole("button", { name: TITLE })).toBeTruthy();
  });
});
