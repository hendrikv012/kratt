import { describe, it, expect } from "vitest";
import {
  PRESETS, THEME_KEYS, DEFAULT_THEME_ID, UI_FONTS, READ_FONTS,
  themeVars, bridgeVars, isDark, isPixelFont, contrastRatio, resolveTheme, mapExtensionTheme, contrastInk, tripletHex,
} from "./themes.js";

const REQUIRED = ["--st-c-background","--st-c-foreground","--st-c-card","--st-c-card-foreground","--st-c-popover","--st-c-popover-foreground","--st-c-primary","--st-c-primary-foreground","--st-c-secondary","--st-c-secondary-foreground","--st-c-muted","--st-c-muted-foreground","--st-c-accent","--st-c-accent-foreground","--st-c-border","--st-c-input","--st-c-ring","--st-c-destructive","--st-c-destructive-foreground","--st-c-sidebar","--st-c-sidebar-foreground","--st-c-sidebar-accent","--st-c-sidebar-border","--st-c-graph-node","--st-c-graph-link","--st-c-graph-label","--st-c-graph-note","--st-radius","--st-ui-size","--st-font-sans","--st-font-display","--st-display-stretch","--st-display-weight","--st-display-tracking","--st-font-mono","--st-font-reading"];

describe("theme model", () => {
  it.each(PRESETS)("$id yields every variable", (t) => {
    const v = themeVars(t);
    REQUIRED.forEach((k) => expect(v[k], k).toBeTruthy());
    expect(Object.keys(v).some((k) => k.includes("subject"))).toBe(false);
  });
  it("black is true black", () => expect(themeVars(PRESETS.find((p) => p.id === "black"))["--st-c-background"]).toBe("0 0% 0%"));
  it("exposes keys, default id and font ids", () => {
    expect(THEME_KEYS).toEqual(["base","accent","graph","radius","density","uiFont","readingFont"]);
    expect(DEFAULT_THEME_ID).toBe("ember");
    expect(UI_FONTS.archivo.family).toContain("Archivo");
    expect(UI_FONTS.plex.font).toBe("plexsans");
    expect(READ_FONTS.sans.font).toBeUndefined();
  });
  it("primary text is readable on light and dark accents", () => {
    expect(contrastInk("#5b8fd9")).toBe("dark");
    expect(contrastInk("#2f55a4")).toBe("light");
  });
  it("bridge feeds Lokus's editor RGB tokens", () => {
    expect(bridgeVars(PRESETS.find((p) => p.id === "black"))["--bg"]).toBe("0 0 0");
    expect(bridgeVars(PRESETS.find((p) => p.id === "paper"))["--text"]).toMatch(/^\d+ \d+ \d+$/);
    const b = bridgeVars(PRESETS.find((p) => p.id === "black"));
    ["--st-bg","--st-sidebar","--st-surface","--st-hover","--st-line","--st-text","--st-text-soft","--st-text-faint","--st-accent","--st-accent-ink","--st-sans","--st-mono","--st-page-font","--panel","--panel-secondary","--border","--muted","--editor-placeholder","--accent","--text-secondary"].forEach((k) => expect(b[k], k).toBeTruthy());
    expect(b["--st-bg"]).toBe("#000000");
  });
  it("resolves drafts over the chosen theme and falls back to the default", () => {
    expect(resolveTheme({ themeId: "steel", themeDraft: { accent: "#c4574f" }, customThemes: [] }).choices.accent).toBe("#c4574f");
    expect(resolveTheme({ themeId: "nope", themeDraft: {}, customThemes: [] }).id).toBe("ember");
  });
  it("finds mine and extension themes", () => {
    const mine = { id: "m1", name: "Mine", choices: { ...PRESETS[0], accent: "#111111" } };
    expect(resolveTheme({ themeId: "m1", customThemes: [mine] }).source).toBe("mine");
    const r = resolveTheme({ themeId: "x.t", customThemes: [] }, [{ id: "x.t", name: "X", base: "light", accent: "#aa3355" }]);
    expect(r.source).toBe("extension");
    expect(r.choices.accent).toBe("#aa3355");
    expect(r.id).toBe("x.t");
    expect(r.name).toBe("X");
    const m = resolveTheme({ themeId: "m1", customThemes: [mine] });
    expect(m.id).toBe("m1");
    expect(m.name).toBe("Mine");
  });
  it("survives damaged persisted data", () => {
    expect(resolveTheme({ themeId: "steel", customThemes: null }).id).toBe("steel");
    expect(resolveTheme({ themeId: "m1", customThemes: "x" }).id).toBe("ember");
    expect(resolveTheme({ themeId: "m1", customThemes: [null, { id: "m1", name: "M", choices: { base: "paper" } }] }).choices.base).toBe("paper");
    expect(resolveTheme({ themeId: "zz", customThemes: [] }, [null, undefined]).id).toBe("ember");
    const r = resolveTheme({ themeId: "m1", customThemes: [{ id: "m1", name: "M", choices: { base: "paper" } }] });
    expect(r.choices.accent).toBe("#5b8fd9");
    expect(r.choices.uiFont).toBe("archivo");
  });
  it("pins HSL to RGB math and raw accent", () => {
    const paper = PRESETS.find((p) => p.id === "paper");
    expect(bridgeVars(paper)["--text"]).toBe("29 27 22");
    expect(bridgeVars(paper)["--st-accent"]).toBe("#2f55a4");
    expect(bridgeVars(paper)["--accent"]).toBe("47 85 164");
    expect(mapExtensionTheme({ base: "light", accent: "red" }).accent).toBe("#5b8fd9");
    expect(mapExtensionTheme({ base: "black" }).uiFont).toBe("archivo");
  });
  it("maps an extension theme in the old shape", () => {
    const c = mapExtensionTheme({ base: "light", accent: "#aa3355", subjects: Array(8).fill("#000000") });
    expect(isDark(c)).toBe(false);
    expect(c.accent).toBe("#aa3355");
    expect(c.graph).toBe("#2d4f9a");
    expect(mapExtensionTheme({ base: "deep", accent: "#aa3355" }).graph).toBe("#f0f0f0");
    expect(mapExtensionTheme({ base: "black", accent: "#aa3355" }).base).toBe("black");
  });
});

describe("tripletHex", () => {
  it("turns a theme variable back into #rrggbb", () => {
    expect(tripletHex("0 0% 94.1%")).toBe("#f0f0f0");
    expect(tripletHex(themeVars(PRESETS.find((p) => p.id === "black"))["--st-c-graph-node"])).toBe(PRESETS.find((p) => p.id === "black").graph);
  });
  it("gives null for anything else", () => {
    expect(tripletHex("")).toBeNull();
    expect(tripletHex("#fff")).toBeNull();
  });
});

describe("Ember", () => {
  const ember = PRESETS.find((p) => p.id === "ember");
  it("is the default and the first preset", () => {
    expect(DEFAULT_THEME_ID).toBe("ember");
    expect(PRESETS[0].id).toBe("ember");
  });
  it("paints the v3 greys", () => {
    const v = bridgeVars(ember);
    expect(v["--st-bg"]).toBe("#0e0e0e");
    expect(v["--st-surface"]).toBe("#161616");
    expect(v["--st-hover"]).toBe("#1c1c1c");
    expect(v["--st-accent"]).toBe("#ff8a3d");
    expect(v["--st-accent-wash"]).toBe("#301f15");
    expect(isDark(ember)).toBe(true);
  });
  it("keeps text readable", () => {
    const v = bridgeVars(ember);
    expect(contrastRatio(v["--st-text"], v["--st-bg"])).toBeGreaterThanOrEqual(15);
    expect(contrastRatio(v["--st-text-soft"], v["--st-bg"])).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(v["--st-text-soft"], v["--st-surface"])).toBeGreaterThanOrEqual(4.5);
  });
  it("uses Pixelify for the interface, VT323 for numbers, Geist for notes", () => {
    const v = themeVars(ember);
    expect(v["--st-font-sans"]).toContain("Pixelify Sans");
    expect(v["--st-font-numeric"]).toContain("VT323");
    expect(v["--st-font-reading"]).toContain("Geist");
    expect(v["--st-ui-size"]).toBe("15px");
    expect(isPixelFont(ember)).toBe(true);
    expect(isPixelFont(PRESETS.find((p) => p.id === "black"))).toBe(false);
  });
});
