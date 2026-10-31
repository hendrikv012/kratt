import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { relativeTime } from "../chats/summary";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

beforeEach(() => {
  installMemoryLocalStorage();
  // Skip the opening screen so nothing covers the sidebar.
  localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false } }));
  window.history.replaceState(null, "", "/?view=study-preview");
});

const PINNED = { ...SAMPLE_SNAPSHOT, layout: { ...SAMPLE_SNAPSHOT.layout, pinned: ["p1"] } };
const NO_CHATS = { ...SAMPLE_SNAPSHOT, files: SAMPLE_SNAPSHOT.files.filter((f) => !f.path.startsWith("Chats/")) };
const renderSidebar = async (snapshot = SAMPLE_SNAPSHOT) => {
  render(<StudyPreview client={fakeClient(snapshot)} />);
  return within(await screen.findByRole("navigation", { name: "Sidebar" }));
};

describe("sidebar", () => {
  it("lists sections in order", async () => {
    await renderSidebar();
    const text = screen.getByRole("navigation", { name: "Sidebar" }).textContent;
    const at = ["KRATT", "Find", "Home", "Graph", "Notes", "New chat", "Chats", "Subjects"].map((word) => text.indexOf(word));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).not.toContain("Library");
    expect(text).not.toContain("AI chats");
  });

  it("hides empty sections", async () => {
    const side = await renderSidebar(NO_CHATS);
    expect(side.queryByText("Due for review")).toBeNull();
    expect(side.queryByText("Pinned")).toBeNull();
    expect(side.getByText("No chats yet")).toBeTruthy();
  });

  it("lists chats from the Chats folder with their time", async () => {
    const updated = Date.parse("2026-10-20T10:12:00Z");
    const before = relativeTime(updated);
    const side = await renderSidebar();
    const row = side.getByText("Krebs cycle, step by step").closest("button");
    expect([before, relativeTime(updated)]).toContain(row.querySelector(".st-side-meta").textContent);
    expect(side.queryByText("No chats yet")).toBeNull();
  });

  it("shows pinned pages", async () => {
    const side = await renderSidebar(PINNED);
    expect(side.getByText("Pinned")).toBeTruthy();
    fireEvent.click(side.getByRole("link", { name: "Krebs cycle" }));
    expect(screen.getByRole("tab", { name: "Krebs cycle" })).toBeTruthy();
  });

  it("section switches hide sections", async () => {
    window.history.replaceState(null, "", "/?view=study-preview&settings=layout");
    render(<StudyPreview client={fakeClient(PINNED)} />);
    // Settings cover the app and hide the sidebar from the accessibility tree.
    const pinned = await screen.findByRole("switch", { name: "Pinned" });
    const side = within(document.querySelector(".st-sidebar"));
    expect(side.getByText("Pinned")).toBeTruthy();
    fireEvent.click(pinned);
    expect(side.queryByText("Pinned")).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 9, 20, 12, 0).getTime();
  it("says now, minutes, hours, weekday, then date", () => {
    expect(relativeTime(now - 30e3, now)).toBe("now");
    expect(relativeTime(now - 12 * 60e3, now)).toBe("12m");
    expect(relativeTime(now - 2 * 3600e3, now)).toBe("2h");
    expect(relativeTime(now - 2 * 86400e3, now)).toBe("Sun");
    expect(relativeTime(now - 10 * 86400e3, now)).toBe("10 Oct");
  });
});
