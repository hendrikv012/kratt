import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("./fonts", () => ({ loadFont: vi.fn(() => Promise.resolve(true)) }));

import { loadFont } from "./fonts";
import { useTheme } from "./useTheme";

describe("useTheme fonts", () => {
  it("loads the interface font and the page font of the theme", () => {
    renderHook(() => useTheme({ themeId: "paper", themeDraft: {}, customThemes: [] }, []));
    // Paper: Instrument Sans for the interface, Source Serif for pages
    expect(loadFont).toHaveBeenCalledWith("instrumentsans");
    expect(loadFont).toHaveBeenCalledWith("sourceserif");
  });
});
