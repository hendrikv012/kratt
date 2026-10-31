import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a) => invoke(...a), isTauri: () => false }));

import { ExtensionsProvider, useExtensions } from "./ExtensionsProvider.jsx";

const manifest = (over = {}) => ({
  id: "acme.timer", name: "Timer", version: "1.0.0", permissions: [],
  contributes: { widgets: [{ id: "w", title: "W", entry: "w.html" }], blocks: [], tools: [], themes: [], commands: [] },
  ...over,
});
const wrapper = ({ children }) => <ExtensionsProvider catalogUrl="">{children}</ExtensionsProvider>;

let store;
beforeEach(() => {
  invoke.mockReset();
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

describe("ExtensionsProvider", () => {
  it("works without Tauri and persists records", async () => {
    const { result } = renderHook(() => useExtensions(), { wrapper });
    expect(result.current.canInstall).toBe(false);
    await act(async () => {
      invoke.mockResolvedValue(undefined);
      await result.current.actions.install({ stagingId: "s", manifest: manifest() }, { source: "file", granted: [] });
    });
    expect(result.current.records["acme.timer"].enabled).toBe(true);
    expect(JSON.parse(store.get("study-extensions-v1"))["acme.timer"].version).toBe("1.0.0");
    expect(result.current.contributions.widgets[0]).toMatchObject({ extId: "acme.timer", extName: "Timer", version: "1.0.0", id: "w" });
  });

  it("leaves disabled extensions out of contributions", async () => {
    const { result } = renderHook(() => useExtensions(), { wrapper });
    await act(async () => {
      await result.current.actions.install({ stagingId: "s", manifest: manifest() }, { source: "file", granted: [] });
    });
    act(() => result.current.actions.setEnabled("acme.timer", false));
    expect(result.current.enabled).toEqual([]);
    expect(result.current.contributions.widgets).toEqual([]);
  });

  it("uninstall clears the record and the extension's storage", async () => {
    store.set("study-extension-data-v1:acme.timer", "{}");
    const { result } = renderHook(() => useExtensions(), { wrapper });
    await act(async () => {
      await result.current.actions.install({ stagingId: "s", manifest: manifest() }, { source: "file", granted: [] });
    });
    await act(async () => {
      await result.current.actions.uninstall("acme.timer");
    });
    expect(result.current.records).toEqual({});
    expect(store.has("study-extension-data-v1:acme.timer")).toBe(false);
  });

  it("survives unreadable storage", async () => {
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    const { result } = renderHook(() => useExtensions(), { wrapper });
    await waitFor(() => expect(result.current.catalog.loading).toBe(false));
    expect(result.current.records).toEqual({});
  });

  it("keeps enabled and contributions identical across catalog changes", async () => {
    const { result } = renderHook(() => useExtensions(), { wrapper });
    await act(async () => {
      await result.current.actions.install({ stagingId: "s", manifest: manifest() }, { source: "file", granted: [] });
    });
    const { enabled, contributions } = result.current;
    await act(async () => {
      await result.current.catalog.refresh();
    });
    expect(result.current.enabled).toBe(enabled);
    expect(result.current.contributions).toBe(contributions);
    act(() => result.current.actions.setEnabled("acme.timer", false));
    expect(result.current.enabled).not.toBe(enabled);
    expect(result.current.contributions).not.toBe(contributions);
  });
});
