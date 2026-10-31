import { describe, it, expect } from "vitest";
import { openTab, closeTab, reorderTabs, sanitizeTabs, tabIdOf, routeOf } from "./tabs";

describe("tabs", () => {
  it("opens, activates and closes tabs", () => {
    let t = openTab({ list: ["home"], active: "home" }, "node:a");
    expect(t).toEqual({ list: ["home", "node:a"], active: "node:a" });
    t = closeTab(t, "node:a");
    expect(t.active).toBe("home");
  });
  it("activates an open tab without duplicating it", () => {
    const t = openTab({ list: ["home", "graph"], active: "graph" }, "home");
    expect(t).toEqual({ list: ["home", "graph"], active: "home" });
  });
  it("closing the active tab moves to its left neighbour", () => {
    const t = closeTab({ list: ["home", "graph", "sources"], active: "graph" }, "graph");
    expect(t).toEqual({ list: ["home", "sources"], active: "home" });
  });
  it("closing an inactive tab keeps the active one", () => {
    const t = closeTab({ list: ["home", "graph", "sources"], active: "sources" }, "graph");
    expect(t).toEqual({ list: ["home", "sources"], active: "sources" });
  });
  it("never closes Home", () => expect(closeTab({ list: ["home"], active: "home" }, "home").list).toEqual(["home"]));
  it("reorders", () => {
    const t = reorderTabs({ list: ["home", "a", "b"], active: "a" }, "b", 1);
    expect(t.list).toEqual(["home", "b", "a"]);
    expect(t.active).toBe("a");
  });
  it("drops tabs for deleted items", () =>
    expect(
      sanitizeTabs({ list: ["home", "node:gone", "source:s1"], active: "node:gone" }, { nodes: {}, sources: [{ id: "s1" }] })
    ).toEqual({ list: ["home", "source:s1"], active: "home" }));
  it("drops unknown ids and keeps Home", () =>
    expect(sanitizeTabs({ list: ["bogus", "graph"], active: "bogus" }, { nodes: {}, sources: [] })).toEqual({
      list: ["home", "graph"],
      active: "home",
    }));
  it("returns the same object when nothing changes", () => {
    const t = { list: ["home"], active: "home" };
    expect(sanitizeTabs(t, { nodes: {}, sources: [] })).toBe(t);
  });
  it("round-trips routes", () => {
    expect(routeOf(tabIdOf({ view: "node", id: "x" }))).toEqual({ view: "node", id: "x" });
    expect(routeOf(tabIdOf({ view: "source", id: "s" }))).toEqual({ view: "source", id: "s" });
    expect(routeOf(tabIdOf({ view: "quick-notes" }))).toEqual({ view: "quick-notes" });
  });
  it("falls back to Home for damaged saved tabs", () => {
    const home = { list: ["home"], active: "home" };
    const st = { nodes: {}, sources: [] };
    for (const bad of [null, undefined, 5, "x", { list: 5, active: "home" }, { list: "graph", active: "graph" }, { list: {}, active: "home" }]) {
      expect(sanitizeTabs(bad, st)).toEqual(home);
    }
    expect(sanitizeTabs({ list: ["home", "graph"], active: 7 }, st)).toEqual({ list: ["home", "graph"], active: "home" });
  });
});
