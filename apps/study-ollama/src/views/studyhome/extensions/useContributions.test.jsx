import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, render, act, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false, convertFileSrc: (p) => p }));
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./ExtensionFrame.jsx", async () => {
  const { useEffect } = await import("react");
  return {
    default: (props) => {
      useEffect(() => {
        mounts.count++;
      }, []);
      return <div data-testid="frame">{`${props.kind}:${props.contributionId}:${props.record.id}:${props.context?.pageId ?? ""}`}</div>;
    },
  };
});

import { ExtensionsProvider, useExtensions } from "./ExtensionsProvider.jsx";
import { useContributions } from "./useContributions.js";
import { widgetDef, useWidgetDefs } from "../widgets/registry.js";
import ThemeCards from "../settings/appearance/ThemeCards.jsx";
import { resolveTheme } from "../theme/themes.js";

const colors = Object.fromEntries(
  "background foreground card popover primary secondary muted accent border sidebar".split(" ").map((k) => [k, "#101010"])
);
const record = {
  id: "acme.timer",
  version: "1.2.0",
  enabled: true,
  granted: [],
  failures: [],
  manifest: {
    id: "acme.timer",
    name: "Timer",
    version: "1.2.0",
    contributes: {
      widgets: [{ id: "clock", title: "Clock", entry: "w.html" }],
      blocks: [],
      tools: [],
      commands: [],
      themes: [{ id: "dusk", name: "Harbor", base: "midnight", colors, accent: "#ff8800", subjects: [] }],
    },
  },
};

let store;
beforeEach(() => {
  store = new Map([["study-extensions-v1", JSON.stringify({ [record.id]: record })]]);
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

const wrapper = ({ children }) => <ExtensionsProvider catalogUrl="">{children}</ExtensionsProvider>;
const both = () => ({ ext: useExtensions(), found: useContributions() });

describe("useContributions", () => {
  it("registers an enabled extension's widget and removes it when disabled", () => {
    const { result } = renderHook(both, { wrapper });
    const def = widgetDef("ext:acme.timer/clock");
    expect(def).toMatchObject({
      title: "Clock",
      source: { kind: "extension", id: "acme.timer", name: "Timer" },
      lanes: "any",
      size: "m",
    });
    const { unmount } = render(<def.Component pageId="p1" />, { wrapper });
    expect(screen.getByTestId("frame").textContent).toBe("widget:clock:acme.timer:p1");
    unmount();
    act(() => result.current.ext.actions.setEnabled("acme.timer", false));
    expect(widgetDef("ext:acme.timer/clock").title).toBe("Missing widget");
  });

  it("keeps the same def and does not remount the frame when records change", () => {
    mounts.count = 0;
    let before;
    const Probe = () => {
      const ext = useExtensions();
      useContributions();
      const def = useWidgetDefs()["ext:acme.timer/clock"];
      if (!def) return null;
      before ??= def;
      expect(def).toBe(before);
      return (
        <>
          <button onClick={() => ext.actions.setGranted("acme.timer", "network", true)}>grant</button>
          <button onClick={() => ext.actions.reportFailure("acme.timer")}>fail</button>
          <def.Component pageId="p1" />
        </>
      );
    };
    render(<Probe />, { wrapper });
    expect(mounts.count).toBe(1);
    act(() => screen.getByText("grant").click());
    act(() => screen.getByText("fail").click());
    expect(screen.getByTestId("frame")).toBeTruthy();
    expect(mounts.count).toBe(1);
  });

  it("unregisters on unmount", () => {
    const { unmount } = renderHook(both, { wrapper });
    unmount();
    expect(widgetDef("ext:acme.timer/clock").title).toBe("Missing widget");
  });

  it("offers extension themes under namespaced ids", () => {
    const { result } = renderHook(both, { wrapper });
    const [theme] = result.current.found.themes;
    expect(theme).toMatchObject({ id: "ext:acme.timer/dusk", name: "Harbor" });
    expect(theme.choices.accent).toBe("#ff8800");
  });

  it("offers an extension theme under From extensions and resolves it by id", () => {
    const { result } = renderHook(both, { wrapper });
    const themes = result.current.found.themes;
    const picked = vi.fn();
    render(<ThemeCards currentId="ext:acme.timer/dusk" customThemes={[]} extensionThemes={themes} onPick={picked} onDelete={() => {}} />);
    const card = screen.getByRole("button", { name: "Theme: Harbor" });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    act(() => card.click());
    expect(picked).toHaveBeenCalledWith("ext:acme.timer/dusk");
    expect(resolveTheme({ themeId: "ext:acme.timer/dusk" }, themes).source).toBe("extension");
    expect(resolveTheme({ themeId: "ext:gone/x" }, themes).id).toBe("ember");
  });
});
