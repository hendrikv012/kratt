import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { registerWidget, widgetDef, allowedIn, groupBySource, useWidgetDefs } from "./registry";
import "./builtin";

const ext = { kind: "extension", id: "a", name: "A" };
const offs = [];
const track = (off) => { offs.push(off); return off; };
afterEach(() => { offs.splice(0).forEach((off) => off()); });
const make = (title = "W") => ({ title, source: ext, lanes: "any", size: "m", Component: () => null });

describe("widget registry", () => {
  it("unknown ids come back as Missing widget", () => {
    const d = widgetDef("ext:x/y");
    expect(d.title).toBe("Missing widget");
    expect(d.body).toBe("The extension that added this widget isn't installed. Remove it, or install the extension again.");
  });

  it("registers the built-in ids", () => {
    for (const id of "continue review deadlines chats notes recent week clock legend local pagesrc outline".split(" ")) {
      expect(widgetDef(id).title).not.toBe("Missing widget");
    }
    expect(widgetDef("clock").bare).toBe(true);
    expect(widgetDef("legend").bare).toBe(true);
  });

  it("registering adds to the extension group", () => {
    const off = track(registerWidget("ext:a/w", make()));
    const groups = groupBySource(["ext:a/w", "recent"]);
    expect(groups[0]).toMatchObject({ source: "builtin", items: ["recent"] });
    expect(groups[1].items).toEqual(["ext:a/w"]);
    off();
    expect(groupBySource(["ext:a/w"])[1].items).toEqual([]);
    expect(groupBySource([])[1].empty).toBe("Widgets from extensions you install show up here.");
  });

  it("side-only widgets may not go on top", () => {
    expect(allowedIn(widgetDef("local"), "top")).toBe(false);
    expect(allowedIn(widgetDef("local"), "left")).toBe(true);
    expect(allowedIn(widgetDef("pagesrc"), "bottom")).toBe(false);
    expect(allowedIn(widgetDef("outline"), "top")).toBe(false);
  });

  it("registering an existing id replaces it, and the old unregister keeps the new def", () => {
    const off1 = track(registerWidget("ext:a/r", make("One")));
    const off2 = track(registerWidget("ext:a/r", make("Two")));
    off1();
    expect(widgetDef("ext:a/r").title).toBe("Two");
    off2();
    expect(widgetDef("ext:a/r").title).toBe("Missing widget");
  });

  it("useWidgetDefs changes only on register and unregister", () => {
    const { result, rerender } = renderHook(() => useWidgetDefs());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    let off;
    act(() => { off = track(registerWidget("ext:a/hook", make())); });
    expect(result.current).not.toBe(first);
    expect(result.current["ext:a/hook"].title).toBe("W");
    const second = result.current;
    rerender();
    expect(result.current).toBe(second);
    act(() => off());
    expect(result.current["ext:a/hook"]).toBeUndefined();
  });
});
