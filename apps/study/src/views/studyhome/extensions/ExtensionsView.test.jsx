import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false, convertFileSrc: (p) => p }));

import { ExtensionsProvider } from "./ExtensionsProvider.jsx";
import ExtensionsView from "./ExtensionsView.jsx";

let store;
const seed = (records) => store.set("study-extensions-v1", JSON.stringify(records));
beforeEach(() => {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});
const view = () => render(<ExtensionsProvider catalogUrl=""><ExtensionsView /></ExtensionsProvider>);

describe("ExtensionsView", () => {
  it("shows the empty state with no extensions", () => {
    view();
    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByText("Extensions add widgets, page blocks, tools and themes to Study.")).toBeTruthy();
    expect(screen.getByRole("searchbox").disabled).toBe(true);
    expect(screen.getByText("No extensions installed. Installing extensions isn't available yet.")).toBeTruthy();
  });

  it("lists an installed extension's name and version", () => {
    seed({ "acme.timer": { id: "acme.timer", version: "1.2.0", enabled: true, granted: [], manifest: { id: "acme.timer", name: "Timer", version: "1.2.0", contributes: {} } } });
    view();
    expect(screen.getByText("Timer")).toBeTruthy();
    expect(screen.getByText("1.2.0")).toBeTruthy();
    expect(screen.queryByText(/No extensions installed/)).toBeNull();
  });
});
