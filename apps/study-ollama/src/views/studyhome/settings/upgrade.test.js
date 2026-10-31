import { describe, it, expect, vi, afterEach } from "vitest";
import { upgradeSettings } from "./upgrade.js";

afterEach(() => vi.unstubAllGlobals());

const prefersLight = (light) =>
  vi.stubGlobal("matchMedia", (q) => ({ matches: light && q === "(prefers-color-scheme: light)", media: q, addEventListener() {}, removeEventListener() {} }));

describe("upgradeSettings", () => {
  it("gives a converted light style dark graph dots, and a dark style light ones", () => {
    const s = upgradeSettings({ appearance: { styles: [{ id: "l", name: "Day", base: "light" }, { id: "d", name: "Night", base: "deep" }] } });
    const [light, dark] = s.appearance.customThemes;
    expect(light).toMatchObject({ base: "paper", graph: "#2d4f9a" });
    expect(dark).toMatchObject({ base: "night", graph: "#f0f0f0" });
  });
  it("gives new users Ember", () => {
    expect(upgradeSettings({}).appearance.themeId).toBe("ember");
  });
  it("keeps old users on their theme", () => {
    expect(upgradeSettings({ appearance: { theme: "dark" } }).appearance.themeId).toBe("black");
    expect(upgradeSettings({ appearance: { upgraded: 2, themeId: "black" } }).appearance.themeId).toBe("black");
  });
  it("keeps only a valid hex accent as a draft", () => {
    expect(upgradeSettings({ appearance: { theme: "black", accent: "" } }).appearance.themeDraft).toEqual({});
    expect(upgradeSettings({ appearance: { theme: "black", accent: "blue" } }).appearance.themeDraft).toEqual({});
    expect(upgradeSettings({ appearance: { theme: "black", accent: "#E0A03A" } }).appearance.themeDraft).toEqual({ accent: "#E0A03A" });
  });
  it("keeps only a valid hex accent on a converted style", () => {
    const s = upgradeSettings({ appearance: { styles: [{ id: "s1", name: "F", base: "black", accent: "nope" }] } });
    expect(s.appearance.customThemes[0].accent).toBe("#5b8fd9");
  });
  it("maps the old System theme to Paper when the computer prefers light", () => {
    prefersLight(true);
    expect(upgradeSettings({ appearance: { theme: "system" } }).appearance.themeId).toBe("paper");
  });
  it("maps the old System theme to Black when the computer prefers dark", () => {
    prefersLight(false);
    expect(upgradeSettings({ appearance: { theme: "system" } }).appearance.themeId).toBe("black");
  });

  it("maps old themes to the nearest new one", () => {
    expect(upgradeSettings({ appearance: { theme: "deep" } }).appearance.themeId).toBe("black");
    expect(upgradeSettings({ appearance: { theme: "light" } }).appearance.themeId).toBe("paper");
    expect(upgradeSettings({ appearance: { theme: "soft" } }).appearance.themeId).toBe("graphite");
  });
  it("keeps a changed accent as a draft", () => {
    expect(upgradeSettings({ appearance: { theme: "black", accent: "#e0a03a" } }).appearance.themeDraft).toEqual({ accent: "#e0a03a" });
  });
  it("turns color styles into my themes", () => {
    const s = upgradeSettings({ appearance: { styles: [{ id: "s1", name: "Forest", base: "black", accent: "#4caf6e" }] } });
    expect(s.appearance.customThemes[0]).toMatchObject({ id: "mine-s1", name: "Forest", accent: "#4caf6e", base: "black" });
  });
  it("selects a converted custom style", () => {
    const s = upgradeSettings({ appearance: { theme: "custom:s1", styles: [{ id: "s1", name: "F", base: "soft", accent: "#4caf6e" }] } });
    expect(s.appearance.themeId).toBe("mine-s1");
    expect(s.appearance.customThemes[0].base).toBe("graphite");
  });
  it("drops glass and glow", () => {
    const a = upgradeSettings({ appearance: { glass: "liquid", glow: 60, glowColor: "#fff", graphDecor: true } }).appearance;
    ["glass", "glow", "glowColor", "graphDecor", "styles", "theme", "accent", "pageFont"].forEach((k) => expect(a).not.toHaveProperty(k));
    expect(a.upgraded).toBe(2);
  });
  it("converts home columns into Home tiles, which take their default sizes", () => {
    const s = upgradeSettings({ home: { widgets: { left: [{ id: "note", size: "small" }], right: [{ id: "chats", size: "large" }] }, columns: {}, clock: { style: "analog" } } });
    expect(s.layout.home).toEqual({ order: ["clock", "notes", "chats"], size: {} });
    expect(s.layout.kinds).toEqual({});
    expect(s.home).toEqual({ clock: { style: "analog" } });
  });
  it("survives damaged values", () => {
    expect(upgradeSettings({ appearance: { customThemes: "x", styles: 5 } }).appearance.customThemes).toEqual([]);
    expect(upgradeSettings(null)).toBeTruthy();
    expect(upgradeSettings({ home: { widgets: { left: "x", right: [null, { id: 3 }] } } }).layout.home.order).toEqual(["clock"]);
  });
  it("is idempotent", () => {
    const once = upgradeSettings({ appearance: { theme: "deep", accent: "#e0a03a" }, home: { widgets: { left: [{ id: "note", size: "medium" }] } } });
    expect(upgradeSettings(once)).toEqual(once);
  });

  it("does not turn the global accent into a draft for a custom style", () => {
    const s = upgradeSettings({ appearance: { theme: "custom:s1", accent: "#e0a03a", styles: [{ id: "s1", name: "F", base: "black", accent: "#4caf6e" }] } });
    expect(s.appearance.themeId).toBe("mine-s1");
    expect(s.appearance.themeDraft).toEqual({});
  });
  it("drops unknown widget ids and keeps the first of a duplicate", () => {
    const s = upgradeSettings({ home: { widgets: { left: [{ id: "bogus", size: "small" }, { id: "recent", size: "large" }], right: [{ id: "recent", size: "small" }] } } });
    expect(s.layout.home.order).toEqual(["clock", "recent"]);
  });
  it("makes no draft when the accent matches the preset or the old default", () => {
    expect(upgradeSettings({ appearance: { theme: "black", accent: "#5b8fd9" } }).appearance.themeDraft).toEqual({});
    expect(upgradeSettings({ appearance: { theme: "black", accent: "#4c90f0" } }).appearance.themeDraft).toEqual({});
  });
  it("adds no Home layout when there was no home", () => {
    expect(upgradeSettings({ appearance: { theme: "soft" } }).layout).toBeUndefined();
  });
  it("keeps existing custom themes, and an existing Home layout over the old columns", () => {
    const mine = { id: "mine-x", name: "X" };
    const home = { lanes: { left: ["week"], right: [] }, size: {} };
    const s = upgradeSettings({ appearance: { customThemes: [mine] }, layout: { kinds: { home } }, home: { widgets: { left: [{ id: "note" }] } } });
    expect(s.appearance.customThemes).toEqual([mine]);
    expect(s.layout.home.order).toEqual(["clock", "week"]);
  });
  it("upgrades lanes to the grid once", () => {
    const saved = { appearance: { upgraded: 2 }, layout: { kinds: { home: { lanes: { top: ["clock"], left: ["continue"], right: ["chats"], bottom: [] } }, page: { lanes: {} } } } };
    const once = upgradeSettings(saved);
    expect(once.layout.home.order).toEqual(["clock", "continue", "chats"]);
    expect(once.layout.kinds).not.toHaveProperty("home");
    expect(once.layout.kinds.page).toEqual({ lanes: {} });
    expect(upgradeSettings(once)).toBe(once);
    // The legend leaves Home.
    expect(upgradeSettings({ appearance: { upgraded: 2 }, layout: { kinds: { home: { lanes: { top: [], left: [], right: [], bottom: ["legend", "notes"] } } } } }).layout.home.order).toEqual(["notes"]);
    // A grid already there is never replaced, and the stale lanes go.
    const kept = upgradeSettings({ appearance: { upgraded: 2 }, layout: { home: null, kinds: { home: { lanes: { left: ["notes"] } } } } });
    expect(kept.layout).toEqual({ home: null, kinds: {} });
    expect(upgradeSettings(kept)).toBe(kept);
  });
  it("fills lanes missing from the saved Home with the old defaults, as the lanes showed them", () => {
    const sides = upgradeSettings({ appearance: { upgraded: 2 }, layout: { kinds: { home: { lanes: { left: ["week"], right: [] } } } } });
    expect(sides.layout.home.order).toEqual(["clock", "week"]);
    const none = upgradeSettings({ appearance: { upgraded: 2 }, layout: { kinds: { home: { size: {} } } } });
    expect(none.layout.home.order).toEqual(["clock", "continue", "review", "deadlines", "chats", "notes"]);
  });
});
