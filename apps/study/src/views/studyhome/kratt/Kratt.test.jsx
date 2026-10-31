import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Kratt from "./Kratt";
import StudyPreview from "../StudyPreview";
import { EMPTY_SNAPSHOT, fakeClient } from "../data/testing/fakeVault";

// The canvas graph can't draw in the test DOM.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

beforeEach(() => {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    value: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem() {}, clear() {} },
    writable: true,
  });
  window.history.replaceState(null, "", "/?view=study-preview");
});

describe("Kratt", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Kratt />);
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("is an image with a label", () => {
    render(<Kratt mode="think" label="Kratt is thinking" />);
    expect(screen.getByRole("img", { name: "Kratt is thinking" }).getAttribute("data-mode")).toBe("think");
  });

  it("keeps the logo's proportions", () => {
    const { container } = render(<Kratt size={30} />);
    expect(container.querySelector("svg").getAttribute("height")).toBe("24");
  });

  it("Kratt moves off marks the app still", async () => {
    window.localStorage.setItem("study-preview-settings-v3", JSON.stringify({ appearance: { upgraded: 2, krattMoves: false } }));
    const { container } = render(<StudyPreview client={fakeClient(EMPTY_SNAPSHOT)} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    expect(container.querySelector(".study").hasAttribute("data-kratt-still")).toBe(true);
  });
});
