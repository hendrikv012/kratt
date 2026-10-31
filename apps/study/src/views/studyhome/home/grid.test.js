import { describe, expect, it } from "vitest";
import { addTile, fromLanes, HOME_ORDER, homeLayout, homeSizeOf, homeTileList, moveTile, removeTile, setTileSize, sizesOf, spanOf } from "./grid";

const defs = {
  graph: { sizes: ["2x2", "4x2", "6x2"], homeSize: "4x2" },
  clock: { sizes: ["1x1", "2x1", "2x2"], homeSize: "2x1" },
  continue: { sizes: ["2x1", "2x2"], homeSize: "2x1" },
  review: { sizes: ["2x1", "2x2"], homeSize: "2x2" },
  chats: { sizes: ["2x1", "2x2"], homeSize: "2x2" },
  deadlines: { sizes: ["1x1", "2x1"], homeSize: "2x1" },
  notes: { sizes: ["2x1", "2x2"], homeSize: "2x1" },
  week: { sizes: ["2x1", "2x2"], homeSize: "2x1" },
  legend: { home: false },
  local: { page: true },
};

describe("home grid model", () => {
  it("defaults", () => {
    const hl = homeLayout(undefined, defs);
    expect(hl.order).toEqual(HOME_ORDER);
    expect(hl.size.graph).toBe("4x2");
  });

  it("cleans saved data", () => {
    const hl = homeLayout({ order: ["clock", "clock", 4, null, "ext.gone", "notes"], size: { clock: "6x2", notes: "2x2" } }, defs);
    expect(hl.order).toEqual(["clock", "ext.gone", "notes"]);
    expect(hl.size.clock).toBe("2x1");
    expect(hl.size.notes).toBe("2x2");
    expect(hl.size["ext.gone"]).toBe("2x1");
  });

  it("edits", () => {
    const hl = homeLayout(undefined, defs);
    expect(moveTile(hl, "clock", 0).order[0]).toBe("clock");
    expect(moveTile(hl, "nope", 0)).toBe(hl);
    expect(setTileSize(hl, "clock", "6x2", defs)).toBe(hl);
    expect(setTileSize(hl, "clock", "2x2", defs).size.clock).toBe("2x2");
    expect(addTile(hl, "week", defs).size.week).toBe("2x1");
    expect(addTile(hl, "clock", defs)).toBe(hl);
    expect(removeTile(hl, "nope")).toBe(hl);
    const removed = removeTile(hl, "clock");
    expect(removed.order).not.toContain("clock");
    expect(removed.size.clock).toBeUndefined();
    expect(hl.order).toEqual(HOME_ORDER);
  });

  it("upgrades lanes order", () => {
    expect(fromLanes({ left: ["continue"], right: ["chats"], top: ["clock"], bottom: ["legend"] }).order).toEqual(["clock", "continue", "chats", "legend"]);
  });

  it("extension defaults", () => {
    expect(sizesOf({})).toEqual(["2x1", "2x2"]);
    expect(homeSizeOf({})).toBe("2x1");
    expect(spanOf("4x2")).toEqual({ w: 4, h: 2 });
  });

  it("lists placed tiles first, then the rest off, skipping page and home:false", () => {
    const list = homeTileList(homeLayout({ order: ["clock", "ext.gone"] }, defs), defs);
    expect(list.slice(0, 2)).toEqual([{ id: "clock", on: true }, { id: "ext.gone", on: true }]);
    const ids = list.map((t) => t.id);
    expect(ids).not.toContain("legend");
    expect(ids).not.toContain("local");
    expect(list.find((t) => t.id === "week")).toEqual({ id: "week", on: false });
  });
});
