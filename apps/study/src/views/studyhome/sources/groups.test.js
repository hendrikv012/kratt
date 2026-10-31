import { describe, it, expect, beforeEach } from "vitest";
import { UNSORTED } from "../data/tree";
import { installMemoryLocalStorage } from "../data/testing/fakeVault";
import {
  sourceGroups,
  dropAction,
  dropMessage,
  COLLAPSED_KEY,
  readCollapsed,
  writeCollapsed,
  isCollapsed,
} from "./groups";

const state = {
  subjects: ["A", "B"],
  nodes: {
    A: { name: "Alpha", color: "#111" },
    B: { name: "B", color: "#222" },
  },
  sources: [
    { id: "x", subjects: ["B"] },
    { id: "y", subjects: ["A", "B"] },
    { id: "z", subjects: [] },
  ],
};
const byId = (a, b) => a.id.localeCompare(b.id);

describe("sourceGroups", () => {
  it("groups follow subject order with Unsorted last", () => {
    const g = sourceGroups(state, byId);
    expect(g.map((x) => x.id)).toEqual(["A", "B", UNSORTED]);
    expect(g[0].sources.map((s) => s.id)).toEqual(["y"]);
    expect(g[1].sources.map((s) => s.id)).toEqual(["x", "y"]);
    expect(g[0]).toMatchObject({ name: "Alpha", color: "#111" });
    expect(g[2]).toMatchObject({ name: "Unsorted", color: undefined });
  });
  it("treats a missing subjects list as none", () => {
    const g = sourceGroups({ ...state, sources: [{ id: "q" }] }, byId);
    expect(g[2].sources.map((s) => s.id)).toEqual(["q"]);
  });
  it("no Unsorted group when every source has a subject", () => {
    const g = sourceGroups({ ...state, sources: [state.sources[0]] }, byId);
    expect(g.map((x) => x.id)).toEqual(["A", "B"]);
  });
  it("empty subjects still get a group", () => {
    const g = sourceGroups({ ...state, sources: [] }, byId);
    expect(g.map((x) => x.sources)).toEqual([[], []]);
  });
});

describe("dropAction", () => {
  const act = (s, from, to, copy = false) => dropAction(state, s, from, to, copy);
  it("follows the drop rules", () => {
    expect(act("x", "B", "B")).toEqual({ type: "none" });
    expect(act("y", "A", "B")).toEqual({ type: "none" });
    expect(act("z", UNSORTED, "A")).toEqual({ type: "add", subjectId: "A" });
    expect(act("x", "B", UNSORTED)).toEqual({ type: "remove", subjectId: "B" });
    expect(act("z", UNSORTED, UNSORTED)).toEqual({ type: "none" });
    expect(act("x", "B", "A")).toEqual({ type: "move", subjectId: "A", fromId: "B" });
    expect(act("x", "B", "A", true)).toEqual({ type: "add", subjectId: "A" });
  });
});

describe("dropMessage", () => {
  it("words each action", () => {
    expect(dropMessage({ type: "move", subjectId: "B", fromId: "A" }, state)).toBe("Moved to B");
    expect(dropMessage({ type: "add", subjectId: "B" }, state)).toBe("Added to B");
    expect(dropMessage({ type: "remove", subjectId: "A" }, state)).toBe("Removed from Alpha");
    expect(dropMessage({ type: "none" }, state)).toBeNull();
  });
});

describe("collapse storage", () => {
  // A fresh in-memory storage per test; the stubs below die with it.
  beforeEach(() => installMemoryLocalStorage());

  it("round-trips", () => {
    writeCollapsed({ A: true });
    expect(readCollapsed()).toEqual({ A: true });
  });
  it("survives broken storage", () => {
    window.localStorage.getItem = () => {
      throw new Error("denied");
    };
    expect(readCollapsed()).toEqual({});
    window.localStorage.setItem = () => {
      throw new Error("denied");
    };
    expect(() => writeCollapsed({ A: true })).not.toThrow();
  });
  it("ignores invalid JSON", () => {
    window.localStorage.setItem(COLLAPSED_KEY, "{nope");
    expect(readCollapsed()).toEqual({});
    window.localStorage.setItem(COLLAPSED_KEY, "[1]");
    expect(readCollapsed()).toEqual({});
  });
});

it("isCollapsed defaults", () => {
  expect(isCollapsed({}, { id: "A", sources: [] })).toBe(true);
  expect(isCollapsed({}, { id: "A", sources: [1] })).toBe(false);
  expect(isCollapsed({ A: false }, { id: "A", sources: [] })).toBe(false);
  expect(isCollapsed({ A: true }, { id: "A", sources: [1] })).toBe(true);
});
