import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { loadFont } from "./fonts";

const root = () => document.documentElement.style;

describe("useTheme", () => {
  it("puts the theme on the page root and takes it away on unmount", () => {
    const { unmount } = renderHook(() => useTheme({ themeId: "black", themeDraft: {}, customThemes: [] }, []));
    expect(root().getPropertyValue("--st-c-background")).toBe("0 0% 0%");
    unmount();
    expect(root().getPropertyValue("--st-c-background")).toBe("");
  });
  it("never touches Lokus's own variables on the page root", () => {
    renderHook(() => useTheme({ themeId: "paper", themeDraft: {}, customThemes: [] }, []));
    expect(root().getPropertyValue("--bg")).toBe("");
  });
  it("hands the bridge variables back for the study root", () => {
    const { result } = renderHook(() => useTheme({ themeId: "paper", themeDraft: {}, customThemes: [] }, []));
    expect(result.current.bridgeStyle["--bg"]).toMatch(/^\d+ \d+ \d+$/);
  });
  it("swaps the previous theme's properties for the new ones", () => {
    const { rerender } = renderHook(({ id }) => useTheme({ themeId: id, themeDraft: {}, customThemes: [] }, []), { initialProps: { id: "black" } });
    const before = root().getPropertyValue("--st-c-background");
    expect(root().length).toBeGreaterThan(0);
    rerender({ id: "paper" });
    expect(root().getPropertyValue("--st-c-background")).not.toBe(before);
    const keys = Array.from({ length: root().length }, (_, i) => root().item(i));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith("--st-") || k === "color-scheme")).toBe(true);
  });
  it("reports the scheme of the theme", () => {
    const dark = renderHook(() => useTheme({ themeId: "black", themeDraft: {}, customThemes: [] }, []));
    expect(dark.result.current.scheme).toBe("dark");
    const light = renderHook(() => useTheme({ themeId: "paper", themeDraft: {}, customThemes: [] }, []));
    expect(light.result.current.scheme).toBe("light");
  });
  it("marks pixel themes", () => {
    const ember = renderHook(() => useTheme({ themeId: "ember", themeDraft: {}, customThemes: [] }, []));
    expect(ember.result.current.pixel).toBe(true);
    const black = renderHook(() => useTheme({ themeId: "black", themeDraft: {}, customThemes: [] }, []));
    expect(black.result.current.pixel).toBe(false);
  });
  it("loadFont resolves false for an unknown font", async () => {
    expect(await loadFont("comic")).toBe(false);
  });
});
