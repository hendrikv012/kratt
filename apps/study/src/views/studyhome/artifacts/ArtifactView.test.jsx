import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { SAMPLE_SNAPSHOT, fakeClient, installMemoryLocalStorage } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

const header = (id, title, type, extra = {}) => ({
  id,
  title,
  type,
  made_from: ["p1"],
  made_in: { kind: "chat", id: "c1" },
  created: "2026-10-27T10:00:00Z",
  updated: "2026-10-27T10:00:00Z",
  parts: 1,
  source_bytes: 100,
  ...extra,
});
const file = (id, title, type, body, extra) => ({
  path: `Artifacts/2026-10-27 10-00 ${title}.md`,
  id,
  meta: header(id, title, type, extra),
  body,
  version: `v-${id}`,
});

const CARDS = "### Front one\nBack one\n\n### Front two\nBack two\n\n### Front three\nBack three\n";
const SLIDES = "# Slide one\nHello\n---\n# Slide two\nWorld\n";
const QUIZ = "### Which cycle?\n- [ ] Calvin\n- [x] Krebs\n> It is the Krebs cycle.\n";

const snapshot = (extra = []) => ({
  ...SAMPLE_SNAPSHOT,
  folders: [...SAMPLE_SNAPSHOT.folders, "Artifacts"],
  files: [
    ...SAMPLE_SNAPSHOT.files,
    file("a1", "Cards", "flashcards", CARDS, { made_from: ["p1", "Biology", "s1", "gone"], parts: 2 }),
    file("a2", "Deck", "slides", SLIDES),
    file("a3", "Quiz", "quiz", QUIZ),
    ...extra,
  ],
});

beforeEach(() => {
  installMemoryLocalStorage();
  window.history.replaceState(null, "", "/?view=study-preview");
});
afterEach(() => {
  delete document.documentElement.requestFullscreen;
  delete document.exitFullscreen;
});

const start = async (snap = snapshot(), id = "a1") => {
  localStorage.setItem(
    "study-preview-settings-v3",
    JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, layout: { tabs: { list: ["home", `artifact:${id}`], active: `artifact:${id}` } } })
  );
  const client = fakeClient(snap);
  render(<StudyPreview client={client} />);
  await screen.findByRole("textbox", { name: "Title" });
  return client;
};
const press = (key, target = window, init = {}) => fireEvent.keyDown(target, { key, ...init });

describe("Artifact tab", () => {
  it("opens the right viewer for the type", async () => {
    await start();
    expect(screen.getByRole("button", { name: /Show back/ })).toBeTruthy();
    expect(screen.getByText("Flashcards")).toBeTruthy();
    expect(screen.getByText("Made from 4 notes · all of them, in 2 parts")).toBeTruthy();
  });

  it("shows slides and a quiz", async () => {
    await start(snapshot(), "a2");
    expect(screen.getByText("Slide one")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" }).value).toBe("Deck");
  });

  it("shows a quiz", async () => {
    await start(snapshot(), "a3");
    expect(screen.getByText("Which cycle?")).toBeTruthy();
  });

  it("chips open the page, subject or source", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Krebs cycle" }));
    expect(screen.getByRole("tab", { name: "Krebs cycle" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Biology" }));
    expect(screen.getByRole("tab", { name: "Biology" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Lecture" }));
    expect(screen.getByRole("tab", { name: "Lecture" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    expect(screen.getByText("deleted note")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "deleted note" })).toBeNull();
  });

  it("Made in opens the chat", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Made in Krebs cycle, step by step" }));
    const panel = within(await screen.findByRole("complementary", { name: "Kratt Chat" }));
    expect(panel.getByText("Walk me through one turn of the cycle, step by step.")).toBeTruthy();
  });

  it("Made in links to a page", async () => {
    const snap = snapshot();
    snap.files.find((f) => f.id === "a1").meta.made_in = { kind: "page", id: "p1" };
    await start(snap);
    fireEvent.click(screen.getByRole("button", { name: "Made in Krebs cycle" }));
    expect(screen.getByRole("tab", { name: "Krebs cycle" }).getAttribute("aria-selected")).toBe("true");
  });

  it("hides Made in when that chat is gone", async () => {
    const snap = snapshot();
    snap.files.find((f) => f.id === "a1").meta.made_in = { kind: "chat", id: "nope" };
    await start(snap);
    expect(screen.queryByRole("button", { name: /^Made in/ })).toBeNull();
  });

  it("rename saves", async () => {
    const client = await start();
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "Krebs cards" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(screen.getByRole("tab", { name: "Krebs cards" })).toBeTruthy();
    await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "a1").meta.title).toBe("Krebs cards"));
  });

  it("Delete asks first, then deletes and closes the tab", async () => {
    const client = await start();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = within(screen.getByRole("dialog", { name: "Delete artifact" }));
    fireEvent.click(dialog.getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Cards" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete artifact" })).getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Cards" })).toBeNull());
    await waitFor(() => expect(client.calls.some((c) => c.method === "trash" && c.path.includes("Cards"))).toBe(true));
  });

  it("finishing a quiz saves the score", async () => {
    const client = await start(snapshot(), "a3");
    press("2"); // Krebs
    press("Enter");
    await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "a3").meta.last_score).toMatchObject({ right: 1, of: 1 }));
  });

  it("finishing a flashcards pass saves the score", async () => {
    const client = await start();
    for (let i = 0; i < 3; i += 1) {
      press(" ");
      press("g");
    }
    await waitFor(() => expect(client.snapshotNow().files.find((f) => f.id === "a1").meta.last_score).toMatchObject({ right: 3, of: 3 }));
  });

  it("a broken body shows what couldn't be read", async () => {
    const snap = snapshot([file("a4", "Broken", "flashcards", "### Good\nYes\n\n### \nNo front\n\n### Empty\n", { made_from: [] })]);
    await start(snap, "a4");
    expect(screen.getByText("2 items couldn't be read")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show back/ })).toBeTruthy();
  });

  it("with nothing usable it shows the raw text", async () => {
    const snap = snapshot([file("a4", "Broken", "flashcards", "### \nOnly a back\n", { made_from: [] })]);
    await start(snap, "a4");
    expect(screen.getByText("1 item couldn't be read")).toBeTruthy();
    expect(document.querySelector("pre").textContent).toContain("Only a back");
  });

  it("Try again makes a new one from the same notes and opens it", async () => {
    const client = fakeClient(snapshot());
    client.notebookAsk = vi.fn(async () => ({ output: "# Fresh\n\n### New?\nYes\n" }));
    localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, ai: { onUrl: "http://localhost:5055", model: "online" }, layout: { tabs: { list: ["home", "artifact:a1"], active: "artifact:a1" } } })
    );
    render(<StudyPreview client={client} />);
    await screen.findByRole("textbox", { name: "Title" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" }).value).toBe("Fresh"));
    expect(screen.getByRole("tab", { name: "Cards" })).toBeTruthy();
    await waitFor(() => expect(client.snapshotNow().files.filter((f) => f.path.startsWith("Artifacts/"))).toHaveLength(4));
  });

  it("Try again shows progress while it works", async () => {
    const client = fakeClient(snapshot());
    let release;
    client.notebookAsk = vi.fn(() => new Promise((r) => (release = r)));
    localStorage.setItem(
      "study-preview-settings-v3",
      JSON.stringify({ appearance: { upgraded: 2, openingAnimation: false }, ai: { onUrl: "http://localhost:5055", model: "online" }, layout: { tabs: { list: ["home", "artifact:a1"], active: "artifact:a1" } } })
    );
    render(<StudyPreview client={client} />);
    await screen.findByRole("textbox", { name: "Title" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Kratt is making your cards|Making part/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Kratt is making/)).toBeNull();
    release?.({ output: "" });
  });
});

describe("Full mode", () => {
  it("F enters full mode and asks the browser for full screen", async () => {
    const request = vi.fn(() => Promise.resolve());
    document.documentElement.requestFullscreen = request;
    await start();
    press("f");
    const dialog = screen.getByRole("dialog", { name: "Cards" });
    expect(dialog.closest(".study")).toBeTruthy();
    expect(request).toHaveBeenCalled();
    // Only one viewer is mounted: one card in the whole page.
    expect(screen.getAllByRole("button", { name: /Show back/ })).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Exit full screen" })).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("the Full screen button works too, and Exit leaves", async () => {
    await start();
    screen.getByRole("button", { name: "Full screen" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cards" })).getByRole("button", { name: "Exit full screen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Full screen" }));
  });

  it("Esc leaves", async () => {
    await start();
    press("f");
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc that was handled, or comes from a menu, stays in full mode", async () => {
    await start();
    press("f");
    const dialog = screen.getByRole("dialog", { name: "Cards" });
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);
    dialog.append(menu);
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Cards" })).toBeTruthy();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.addEventListener("keydown", (e) => e.preventDefault(), { once: true, capture: true });
    window.dispatchEvent(event);
    expect(screen.getByRole("dialog", { name: "Cards" })).toBeTruthy();
    menu.remove();
  });

  it("a refused full screen still shows the overlay", async () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.reject(new Error("denied")));
    await start();
    press("f");
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "Cards" })).toBeTruthy();
  });

  it("leaving browser full screen closes the overlay", async () => {
    await start();
    press("f");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
    fireEvent(document, new Event("fullscreenchange"));
    delete document.fullscreenElement;
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closing leaves browser full screen", async () => {
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => document.documentElement });
    await start();
    press("f");
    press("Escape");
    delete document.fullscreenElement;
    expect(exit).toHaveBeenCalled();
  });

  it("keeps your place in flashcards through full mode", async () => {
    await start();
    press("ArrowRight");
    expect(screen.getByText("2 / 3")).toBeTruthy();
    press("f");
    expect(screen.getByRole("dialog", { name: "Cards" })).toBeTruthy();
    expect(screen.getByText("2 / 3")).toBeTruthy();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("keeps your place in a quiz through full mode", async () => {
    const quiz = "### One?\n- [ ] A\n- [x] B\n\n### Two?\n- [x] A\n- [ ] B\n";
    await start(snapshot([file("a5", "Quiz2", "quiz", quiz, { made_from: [] })]), "a5");
    press("1");
    press("Enter");
    expect(screen.getByText("Two?")).toBeTruthy();
    press("f");
    expect(screen.getByRole("dialog", { name: "Quiz2" })).toBeTruthy();
    expect(screen.getByText("Two?")).toBeTruthy();
    press("Escape");
    expect(screen.getByText("Two?")).toBeTruthy();
  });

  it("gives focus back to a control inside the viewer", async () => {
    await start();
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Cards" }));
    press("Escape");
    expect(document.activeElement).toBe(next);
  });

  it("F does nothing while another dialog is open", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.append(other);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete artifact" })).getByRole("button", { name: "Cancel" }));
    press("f");
    expect(screen.queryByRole("dialog", { name: "Cards" })).toBeNull();
    other.remove();
    press("f");
    expect(screen.getByRole("dialog", { name: "Cards" })).toBeTruthy();
  });

  it("Esc in full mode doesn't reach other window listeners", async () => {
    await start();
    press("f");
    const other = vi.fn();
    window.addEventListener("keydown", other);
    press("Escape");
    window.removeEventListener("keydown", other);
    expect(other).not.toHaveBeenCalled();
  });

  it("no Full screen, and F ignored, when nothing is usable", async () => {
    const snap = snapshot([file("a4", "Broken", "flashcards", "### \nOnly a back\n", { made_from: [] })]);
    await start(snap, "a4");
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    press("f");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a blank title becomes Untitled and the type", async () => {
    await start();
    const input = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(screen.getByRole("tab", { name: "Untitled Flashcards" })).toBeTruthy();
    await waitFor(() => expect(input.value).toBe("Untitled Flashcards"));
  });

  it("slides fill the screen", async () => {
    await start(snapshot(), "a2");
    press("f");
    const dialog = screen.getByRole("dialog", { name: "Deck" });
    expect(within(dialog).getByText("Slide one")).toBeTruthy();
  });
});
