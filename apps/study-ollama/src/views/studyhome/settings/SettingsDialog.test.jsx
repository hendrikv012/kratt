import { describe, it, expect, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent, within, cleanup, act } from "@testing-library/react";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";

beforeEach(() => {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?view=study-preview");
});

afterEach(() => cleanup());

const renderStudy = async () => {
  render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
};
const openSettings = async (section) => {
  window.history.replaceState(null, "", `/?view=study-preview&settings=${section}`);
  render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
  // The dialog hides the rest of the page from assistive tech, so wait for it.
  return screen.findByRole("dialog", { name: "Settings" });
};
const lightness = () => parseFloat(document.documentElement.style.getPropertyValue("--st-c-background").split(" ")[2]);

describe("Settings dialog", () => {
  it("opens on Appearance with Ctrl+,", async () => {
    await renderStudy();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Appearance" })).toBeTruthy();
  });

  it("picking a theme applies it live", async () => {
    const dialog = await openSettings("appearance");
    expect(lightness()).toBeLessThan(10);
    fireEvent.click(within(dialog).getByRole("button", { name: "Theme: Paper" }));
    expect(lightness()).toBeGreaterThan(90);
  });

  it("picks a Kratt style and mode", async () => {
    const dialog = await openSettings("appearance");
    const before = document.documentElement.style.getPropertyValue("--st-c-background");
    fireEvent.click(within(dialog).getByRole("button", { name: /Racing green/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Light" }));
    const saved = JSON.parse(window.localStorage.getItem("study-preview-settings-v3"));
    expect(saved.appearance.themeId).toBe("green-light");
    expect(document.documentElement.style.getPropertyValue("--st-c-background")).not.toBe(before);
    expect(within(dialog).getByRole("button", { name: /Racing green/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("editing shows Unsaved changes, saving keeps it as my theme", async () => {
    const dialog = await openSettings("appearance");
    expect(within(dialog).queryByText("Unsaved changes")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    expect(within(dialog).getByText("Unsaved changes")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Theme name" }), { target: { value: "Exam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as my theme" }));
    const mine = within(dialog).getByRole("group", { name: "Your themes" });
    expect(within(mine).getByRole("button", { name: "Theme: Exam" })).toBeTruthy();
    expect(within(dialog).queryByText("Unsaved changes")).toBeNull();
  });

  it("discarding drops the unsaved changes", async () => {
    const dialog = await openSettings("appearance");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    expect(within(dialog).queryByText("Unsaved changes")).toBeNull();
  });

  it("deleting my theme can be undone", async () => {
    const dialog = await openSettings("appearance");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Theme name" }), { target: { value: "Exam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save as my theme" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Exam" }));
    expect(within(dialog).queryByRole("button", { name: "Theme: Exam" })).toBeNull();
    const undo = screen.getByRole("button", { name: "Undo" });
    await act(async () => {
      fireEvent.pointerDown(undo);
      fireEvent.click(undo);
    });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Theme: Exam" })).toBeTruthy();
  });

  it("lists no extension themes yet", async () => {
    const dialog = await openSettings("appearance");
    expect(within(dialog).getByText("Themes from extensions you install show up here.")).toBeTruthy();
  });

  it("calls the chat Kratt Chat in the AI section", async () => {
    const dialog = await openSettings("ai");
    expect(within(dialog).getByText("Keep Kratt Chat closed until I open it")).toBeTruthy();
    expect(within(dialog).getByRole("switch", { name: "Keep Kratt Chat closed" })).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/AI chat/i);
  });

  it("keeps the studying, AI, notifications, shortcuts, data and about sections", async () => {
    const dialog = await openSettings("appearance");
    const nav = within(dialog).getByRole("navigation", { name: "Settings sections" });
    for (const label of ["Appearance", "Layout and home screen", "Studying", "AI", "Notifications", "Shortcuts", "Data", "Extensions", "About"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(within(nav).getByRole("button", { name: "Data" }));
    expect(within(dialog).getByRole("heading", { name: "Data" })).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Layout and home screen" }));
    expect(within(dialog).getByRole("heading", { name: "Layout and home screen" })).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Extensions" }));
    expect(within(dialog).getByText("No extensions installed. Installing extensions isn't available yet.")).toBeTruthy();
  });

  it("the clock widget follows its settings", async () => {
    const dialog = await openSettings("layout");
    const style = within(dialog).getByRole("radiogroup", { name: "Clock style" });
    fireEvent.click(within(style).getByRole("radio", { name: "Analog" }));
    expect(within(style).getByRole("radio", { name: "Analog" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Clock hours" })).getByRole("radio", { name: "12-hour" }));
    expect(document.querySelector(".st-topbar-clock").textContent).toMatch(/AM|PM/i);
    fireEvent.click(within(dialog).getByRole("switch", { name: "Show date" }));
    fireEvent.keyDown(dialog, { key: "Escape" });

    // On Home, the Clock widget in the top lane draws an analog face without the date.
    const clock = () => screen.getByRole("region", { name: "Clock" });
    expect(clock().querySelector(".st-clock").dataset.style).toBe("analog");
    expect(within(clock()).getByRole("img")).toBeTruthy();
    expect(clock().querySelector(".st-clock-date")).toBeNull();

    // Digital, 12-hour, with seconds and the date.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const again = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(within(again).getByRole("navigation")).getByRole("button", { name: "Layout and home screen" }));
    fireEvent.click(within(within(again).getByRole("radiogroup", { name: "Clock style" })).getByRole("radio", { name: "Digital" }));
    fireEvent.click(within(again).getByRole("switch", { name: "Show seconds" }));
    fireEvent.click(within(again).getByRole("switch", { name: "Show date" }));
    fireEvent.keyDown(again, { key: "Escape" });
    const time = clock().querySelector(".st-clock-time").textContent;
    expect(time).toMatch(/AM|PM/i);
    expect(time).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(clock().querySelector(".st-clock-date")).toBeTruthy();
  });

  it("has no glass, glow or colors settings", async () => {
    const dialog = await openSettings("appearance");
    for (const text of ["Glass", "Glow", "Colors"]) expect(within(dialog).queryByText(text)).toBeNull();
  });

  it("picking another theme over unsaved changes says so and can be undone", async () => {
    const dialog = await openSettings("appearance");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Theme: Paper" }));
    expect(within(dialog).queryByText("Unsaved changes")).toBeNull();
    expect(within(dialog).getByText("Changes discarded")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    expect(within(dialog).getByText("Unsaved changes")).toBeTruthy();
    expect(lightness()).toBeLessThan(10);
  });

  it("picking a theme with no unsaved changes shows no message", async () => {
    const dialog = await openSettings("appearance");
    fireEvent.click(within(dialog).getByRole("button", { name: "Theme: Paper" }));
    expect(screen.queryByText("Changes discarded")).toBeNull();
  });

  it("an Undo shown while Settings is open sits in the dialog, announced, and Tab reaches it", async () => {
    const user = userEvent.setup();
    const dialog = await openSettings("appearance");
    await user.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    await user.click(within(dialog).getByRole("button", { name: "Theme: Paper" }));
    const undo = within(dialog).getByRole("button", { name: "Undo" });
    expect(undo.closest("[aria-live]")).toBeTruthy();
    expect(dialog.contains(undo.closest("[aria-live]"))).toBe(true);
    let reached = false;
    // From the first control, Shift+Tab wraps to the end of the dialog, where the toasts sit.
    within(dialog).getByRole("button", { name: "Appearance" }).focus();
    for (let i = 0; i < 4 && !reached; i++) {
      await user.tab({ shift: true });
      reached = document.activeElement === undo;
    }
    expect(reached).toBe(true);
    await user.keyboard("{Enter}");
    expect(within(dialog).getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("Tab reaches the Undo of a deleted theme without leaving Settings", async () => {
    const user = userEvent.setup();
    const dialog = await openSettings("appearance");
    await user.click(within(dialog).getByRole("button", { name: "Accent: Red" }));
    await user.click(within(dialog).getByRole("button", { name: "Save as my theme" }));
    await user.click(within(dialog).getByRole("button", { name: /^Delete / }));
    let reached = false;
    // From the first control, Shift+Tab wraps to the end of the dialog, where the toasts sit.
    within(dialog).getByRole("button", { name: "Appearance" }).focus();
    for (let i = 0; i < 4 && !reached; i++) {
      await user.tab({ shift: true });
      reached = document.activeElement?.textContent === "Undo";
    }
    expect(reached).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Settings > Extensions lists what is installed", async () => {
    window.localStorage.setItem(
      "study-extensions-v1",
      JSON.stringify({ "acme.timer": { id: "acme.timer", version: "1.2.0", enabled: true, granted: [], manifest: { id: "acme.timer", name: "Timer", version: "1.2.0", contributes: {} } } })
    );
    const dialog = await openSettings("extensions");
    expect(within(dialog).getByText("Timer")).toBeTruthy();
    expect(within(dialog).getByText("1.2.0")).toBeTruthy();
    expect(within(dialog).queryByText(/No extensions installed/)).toBeNull();
  });
});
