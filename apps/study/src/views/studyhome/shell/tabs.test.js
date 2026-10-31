import { describe, it, expect } from "vitest";
import { openTab, closeTab, reorderTabs, sanitizeTabs, tabIdOf, routeOf, pinTab, unpinTab } from "./tabs";

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
  it("pins a tab, opening it if needed, right after Home", () => {
    let t = pinTab({ list: ["home", "graph", "node:a"], active: "node:a" }, "node:a");
    expect(t).toEqual({ list: ["home", "node:a", "graph"], active: "node:a", pinned: ["node:a"] });
    t = pinTab(t, "source:s");
    expect(t).toEqual({ list: ["home", "node:a", "source:s", "graph"], active: "node:a", pinned: ["node:a", "source:s"] });
    expect(pinTab(t, "home")).toBe(t);
  });
  it("unpins a tab to the start of the unpinned ones", () => {
    const t = unpinTab({ list: ["home", "node:a", "graph", "x"], active: "home", pinned: ["node:a", "graph"] }, "node:a");
    expect(t).toEqual({ list: ["home", "graph", "node:a", "x"], active: "home", pinned: ["graph"] });
  });
  it("never closes a pinned tab", () => {
    const t = { list: ["home", "node:a"], active: "node:a", pinned: ["node:a"] };
    expect(closeTab(t, "node:a")).toBe(t);
  });
  it("keeps the pins when opening and closing other tabs", () => {
    const t = { list: ["home", "node:a"], active: "home", pinned: ["node:a"] };
    expect(closeTab(openTab(t, "graph"), "graph").pinned).toEqual(["node:a"]);
  });
  it("keeps pinned and unpinned tabs on their own side when reordering", () => {
    const t = { list: ["home", "p1", "p2", "a", "b"], active: "home", pinned: ["p1", "p2"] };
    expect(reorderTabs(t, "p1", 2).list).toEqual(["home", "p2", "p1", "a", "b"]);
    expect(reorderTabs(t, "p1", 4).list).toEqual(["home", "p2", "p1", "a", "b"]);
    expect(reorderTabs(t, "b", 1).list).toEqual(["home", "p1", "p2", "b", "a"]);
  });
  it("cleans pinned tabs with the rest and keeps them first", () => {
    const st = { nodes: { a: {} }, sources: [] };
    expect(sanitizeTabs({ list: ["home", "graph", "node:a", "node:gone"], active: "graph", pinned: ["node:a", "node:gone", "chats"] }, st)).toEqual({
      list: ["home", "node:a", "graph"],
      active: "graph",
      pinned: ["node:a"],
    });
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
