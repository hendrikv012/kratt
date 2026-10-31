import { describe, it, expect, vi } from "vitest";

vi.mock("@fontsource-variable/archivo/wdth.css", () => {
  throw new Error("missing");
});

import { loadFont } from "./fonts";

describe("loadFont", () => {
  it("resolves false when the import fails, and never rejects", async () => {
    await expect(loadFont("archivo")).resolves.toBe(false);
  });
  it("bundles Pixelify Sans with VT323", async () => {
    await expect(loadFont("pixelify")).resolves.toBe(true);
  });
  it("resolves false for an unknown id", async () => {
    await expect(loadFont("comic")).resolves.toBe(false);
  });
});
