import { describe, it, expect } from "vitest";
import {
  LANES, SIZES, LANE_WIDTH, KIND_DEFAULTS, allowedIn, kindOfTab, kindLayout,
  moveWidget, setSize, setLaneWidth, addWidget, removeWidget, fitSideWidths, MIDDLE_MIN, SQUEEZED_MIN,
} from "./lanes.js";

const defs = {
  continue: { lanes: "side" }, review: { lanes: "side" }, deadlines: { lanes: "side" },
  chats: { lanes: "side" }, notes: { lanes: "side" }, local: { lanes: "side" }, pagesrc: { lanes: "side" },
  clock: { lanes: "any" }, legend: { lanes: "any" }, strip: { lanes: "edge" },
};
// Lanes as Home saved them before it became a grid.
const SAVED = {
  lanes: { left: ["continue", "review"], right: ["deadlines", "chats", "notes"], top: ["clock"], bottom: ["legend"] },
  size: { clock: "s", legend: "l" },
};
const home = () => kindLayout({ kinds: { home: SAVED } }, "home", defs);

describe("lanes model", () => {
  it("exports the constants", () => {
    expect(LANES).toEqual(["left", "right", "top", "bottom"]);
    expect(SIZES).toEqual(["s", "m", "l"]);
    expect(LANE_WIDTH).toEqual({ min: 220, max: 440, left: 272, right: 288 });
    expect(KIND_DEFAULTS.page.lanes.right).toEqual(["local", "pagesrc"]);
  });
  it("Home has no default lanes", () => {
    expect(KIND_DEFAULTS).not.toHaveProperty("home");
    expect(kindLayout({ kinds: {} }, "home", defs).lanes).toEqual({ left: [], right: [], top: [], bottom: [] });
  });
  it("moves between lanes at an index", () => {
    const kl = moveWidget(home(), "continue", "right", 1, defs);
    expect(kl.lanes.right).toEqual(["deadlines", "continue", "chats", "notes"]);
    expect(kl.lanes.left).toEqual(["review"]);
  });
  it("refuses a lane the widget may not use", () => {
    const kl = home();
    expect(moveWidget(kl, "local", "top", 0, defs)).toBe(kl);
  });
  it("clamps lane widths", () => {
    expect(setLaneWidth(home(), "left", 9999).widths.left).toBe(440);
    expect(setLaneWidth(home(), "left", 1).widths.left).toBe(220);
  });
  it("sanitizes damaged lanes", () => {
    const kl = kindLayout({ kinds: { home: { lanes: { left: ["continue", "continue", 5], right: "x", top: ["ext:gone/w"] }, size: { continue: "huge" } } } }, "home", defs);
    expect(kl.lanes.left).toEqual(["continue"]);
    expect(kl.lanes.right).toEqual([]);
    expect(kl.lanes.top).toEqual(["ext:gone/w"]);
    expect(kl.size.continue).toBe("m");
  });
  it("a widget with no saved or kind size takes its own default size", () => {
    const kl = kindLayout({ kinds: { graph: { lanes: { left: ["continue"] } } } }, "graph", { ...defs, continue: { lanes: "side", size: "s" } });
    expect(kl.size.continue).toBe("s");
    expect(kl.size.legend).toBe("l");
    const saved = kindLayout({ kinds: { graph: { lanes: { left: ["continue"] }, size: { continue: "l" } } } }, "graph", { ...defs, continue: { lanes: "side", size: "s" } });
    expect(saved.size.continue).toBe("l");
  });
  it("removes a widget repeated in a later lane", () => {
    const kl = kindLayout({ kinds: { home: { lanes: { left: ["continue"], right: ["continue", "notes"] } } } }, "home", defs);
    expect(kl.lanes.right).toEqual(["notes"]);
  });
  it("defaults widths and unknown kinds", () => {
    expect(home().widths).toEqual({ left: 272, right: 288 });
    const kl = kindLayout(undefined, "extensions", defs);
    expect(kl.lanes).toEqual({ left: [], right: [], top: [], bottom: [] });
    const w = kindLayout({ kinds: { home: { widths: { left: 9999, right: "x" } } } }, "home", defs).widths;
    expect(w).toEqual({ left: 440, right: 288 });
  });
  it("allowedIn follows the lane class", () => {
    expect(allowedIn({ lanes: "any" }, "top")).toBe(true);
    expect(allowedIn({}, "top")).toBe(true);
    expect(allowedIn(undefined, "bottom")).toBe(true);
    expect(allowedIn({ lanes: "side" }, "left")).toBe(true);
    expect(allowedIn({ lanes: "side" }, "right")).toBe(true);
    expect(allowedIn({ lanes: "side" }, "top")).toBe(false);
    expect(allowedIn({ lanes: "edge" }, "bottom")).toBe(true);
    expect(allowedIn({ lanes: "edge" }, "left")).toBe(false);
  });
  it("addWidget uses the lane or falls back to the first allowed one", () => {
    const kl = home();
    expect(addWidget(kl, "strip", undefined, defs).lanes.top).toEqual(["clock", "strip"]);
    expect(addWidget(kl, "strip", "left", defs).lanes.top).toEqual(["clock", "strip"]);
    expect(addWidget(kl, "local", "left", defs).lanes.left).toEqual(["continue", "review", "local"]);
    expect(addWidget(kl, "clock", "left", defs)).toBe(kl);
  });
  it("addWidget gives a new widget its own default size, else medium", () => {
    const kl = home();
    expect(addWidget(kl, "recent", "left", { ...defs, recent: { lanes: "side", size: "s" } }).size.recent).toBe("s");
    expect(addWidget(kl, "recent", "left", { ...defs, recent: { lanes: "side" } }).size.recent).toBe("m");
    expect(addWidget(kl, "recent", "left", { ...defs, recent: { lanes: "side", size: "huge" } }).size.recent).toBe("m");
  });
  it("removeWidget drops it from its lane", () => {
    const kl = removeWidget(home(), "review");
    expect(kl.lanes.left).toEqual(["continue"]);
    const same = home();
    expect(removeWidget(same, "nope")).toBe(same);
  });
  it("setSize rejects bad sizes", () => {
    const kl = home();
    expect(setSize(kl, "clock", "l").size.clock).toBe("l");
    expect(setSize(kl, "clock", "huge")).toBe(kl);
    expect(setSize(kl, "nope", "l")).toBe(kl);
  });
  it("moveWidget ignores unknown ids and handles same-lane reorder", () => {
    const kl = home();
    expect(moveWidget(kl, "nope", "left", 0, defs)).toBe(kl);
    expect(moveWidget(kl, "continue", "left", 1, defs).lanes.left).toEqual(["review", "continue"]);
  });
  it("kindOfTab maps tab ids", () => {
    expect(kindOfTab("home")).toBe("home");
    expect(kindOfTab("graph")).toBe("graph");
    expect(kindOfTab("sources")).toBe("sources");
    expect(kindOfTab("source:a")).toBe("source");
    expect(kindOfTab("quick-notes")).toBe("quick-notes");
    expect(kindOfTab("extensions")).toBe("extensions");
    expect(kindOfTab("chats")).toBe("chats");
    expect(kindOfTab("node:a")).toBe("page");
    expect(kindOfTab("node:a", { nodes: { a: { type: "page" } } })).toBe("page");
    expect(kindOfTab("node:a", { nodes: { a: { type: "subject" } } })).toBe("container");
    expect(kindOfTab("weird")).toBe("home");
  });
  it("does not mutate inputs", () => {
    const layout = { kinds: { home: { lanes: { left: ["continue"], right: [], top: [], bottom: [] }, size: {}, widths: {} } } };
    const snap = JSON.stringify(layout);
    const kl = kindLayout(layout, "home", defs);
    const klSnap = JSON.stringify(kl);
    moveWidget(kl, "continue", "right", 0, defs); addWidget(kl, "clock", "top", defs);
    removeWidget(kl, "continue"); setSize(kl, "continue", "l"); setLaneWidth(kl, "left", 300);
    expect(JSON.stringify(layout)).toBe(snap);
    expect(JSON.stringify(kl)).toBe(klSnap);
  });
});

describe("fitSideWidths", () => {
  it("keeps the chosen widths when the middle has room", () => {
    expect(fitSideWidths(1143, 272, 288)).toEqual({ left: 272, right: 288 });
  });

  it("squeezes both side lanes so the middle keeps its minimum", () => {
    // Two 16px gaps, the middle's minimum, and 400px left for the lanes.
    const { left, right } = fitSideWidths(32 + MIDDLE_MIN + 400, 272, 288);
    expect({ left, right }).toEqual({ left: 200, right: 200 });
  });

  it("lets a lane narrower than its share keep its width", () => {
    expect(fitSideWidths(32 + MIDDLE_MIN + 500, 230, 440)).toEqual({ left: 230, right: 270 });
  });

  it("never squeezes a lane below SQUEEZED_MIN; the middle gives way then", () => {
    expect(fitSideWidths(700, 272, 288)).toEqual({ left: SQUEEZED_MIN, right: SQUEEZED_MIN });
  });

  it("an empty lane (0) stays 0 and costs no gap", () => {
    expect(fitSideWidths(16 + MIDDLE_MIN + 250, 0, 288)).toEqual({ left: 0, right: 250 });
  });

  it("without a measured width nothing changes", () => {
    expect(fitSideWidths(null, 272, 288)).toEqual({ left: 272, right: 288 });
  });
});
