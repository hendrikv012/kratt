import { describe, it, expect } from "vitest";
import { PRESETS, bridgeVars, contrastRatio, resolveTheme, themeVars } from "./themes";
import { KRATT_STYLES, styleOf, themeIdFor } from "./styles";

// Spec 1b table: ground raise hover line text soft body accent ink kratt
const TABLE = {
  ember: "#0e0e0e #161616 #1c1c1c #232323 #ece8e3 #a19c96 #d6d1cb #ff8a3d #0e0e0e #ff8a3d",
  "ember-light": "#f6f3ee #ffffff #ece8e1 #dcd6cc #1b1917 #5f5a54 #2b2825 #b04d0c #ffffff #d9661b",
  deepred: "#100d0d #191414 #201919 #2a2121 #efe6e4 #a89a98 #dccfcc #e5605a #100d0d #c8423e",
  "deepred-light": "#f5f1ef #ffffff #ece5e2 #dcd2ce #1d1716 #645856 #2e2624 #a3302e #ffffff #a3302e",
  chrome: "#0e0f10 #16181a #1d1f22 #25282b #e9ecef #9ca3ab #d3d8dd #c3c7cc #0e0f10 #c3c7cc",
  "chrome-light": "#f2f3f4 #ffffff #e7e9eb #d6d9dc #16181a #565d65 #26292c #454b53 #ffffff #7c8289",
  green: "#0c0f0d #141815 #1a1f1b #222924 #e6ece7 #97a49b #cdd8d0 #4cbb7f #0c0f0d #34935c",
  "green-light": "#f1f4f1 #ffffff #e5ebe6 #d2dbd4 #141a16 #56605a #242b26 #24613f #ffffff #24613f",
  calmsteel: "#0d0f11 #15181b #1b1f23 #23282d #e6eaee #9aa3ad #ced5dc #a3adb9 #0d0f11 #8a939e",
  "calmsteel-light": "#f1f3f5 #ffffff #e6e9ec #d3d8dd #15181b #575f68 #262a2e #4f5862 #ffffff #6b737d",
};
const KEYS = ["--st-bg", "--st-surface", "--st-hover", "--st-line", "--st-text", "--st-text-soft", "--st-text-body", "--st-accent", "--st-accent-ink", "--st-kratt"];
const rows = Object.entries(TABLE).map(([id, row]) => [id, Object.fromEntries(row.split(" ").map((x, i) => [KEYS[i], x]))]);

describe("Kratt styles", () => {
  it("has ten presets", () => {
    rows.forEach(([id]) => expect(PRESETS.some((p) => p.id === id)).toBe(true));
  });

  it.each(rows)("%s matches the spec table", (id, want) => {
    const v = bridgeVars(PRESETS.find((p) => p.id === id));
    KEYS.forEach((k) => expect(v[k]).toBe(want[k]));
  });

  it.each(rows)("%s is readable", (id) => {
    const v = bridgeVars(PRESETS.find((p) => p.id === id));
    const c = (a, b) => contrastRatio(v[a], v[b]);
    expect(c("--st-text", "--st-bg")).toBeGreaterThanOrEqual(7);
    expect(c("--st-text-body", "--st-bg")).toBeGreaterThanOrEqual(7);
    expect(c("--st-text-soft", "--st-bg")).toBeGreaterThanOrEqual(4.5);
    expect(c("--st-text-soft", "--st-surface")).toBeGreaterThanOrEqual(4.5);
    expect(c("--st-accent", "--st-bg")).toBeGreaterThanOrEqual(4.5);
    expect(c("--st-accent", "--st-surface")).toBeGreaterThanOrEqual(4.5);
    expect(c("--st-accent-ink", "--st-accent")).toBeGreaterThanOrEqual(4.5);
    expect(c("--st-kratt", "--st-surface")).toBeGreaterThanOrEqual(3);
  });

  it("mode round-trips", () => {
    expect(themeIdFor("green", "light")).toBe("green-light");
    expect(themeIdFor("green", "dark")).toBe("green");
    expect(styleOf("green-light")).toEqual({ style: "green", mode: "light" });
    expect(styleOf("ember")).toEqual({ style: "ember", mode: "dark" });
    expect(styleOf("paper")).toBeNull();
    expect(KRATT_STYLES.every((s) => styleOf(themeIdFor(s, "light")).style === s)).toBe(true);
  });

  it("picks a readable ink for an accent that isn't the style's own", () => {
    const green = PRESETS.find((p) => p.id === "green-light");
    const v = bridgeVars({ ...green, accent: "#ffd34d" });
    expect(contrastRatio(v["--st-accent-ink"], "#ffd34d")).toBeGreaterThanOrEqual(4.5);
    const ember = PRESETS.find((p) => p.id === "ember");
    expect(bridgeVars(ember)["--st-accent-ink"]).toBe("#0e0e0e");
    expect(bridgeVars({ ...ember, accent: "#FF8A3D" })["--st-accent-ink"]).toBe("#0e0e0e");
  });

  it("--st-kratt falls back to the accent, and resolveTheme carries kratt", () => {
    const black = PRESETS.find((p) => p.id === "black");
    expect(themeVars(black)["--st-kratt"]).toBe(black.accent);
    expect(bridgeVars(black)["--st-kratt"]).toBe(black.accent);
    expect(resolveTheme({ themeId: "green-light" }).choices.kratt).toBe("#24613f");
    expect(resolveTheme({ themeId: "black" }).choices.kratt).toBeUndefined();
  });
});
