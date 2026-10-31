import { describe, expect, it } from "vitest";
import * as op from "../data/operations";
import { UNSORTED } from "../data/tree";
import { placementFor, zoneOf } from "./dropZone";
import { visibleRows } from "./treeRows";

function sample() {
  let r = op.addSubject(op.EMPTY_STATE, { name: "Biology" });
  let s = r.state;
  const bio = r.id;
  r = op.addChild(s, bio, "folder", "Cells");
  s = r.state;
  const cells = r.id;
  r = op.addChild(s, cells, "folder", "Respiration");
  s = r.state;
  const resp = r.id;
  r = op.addChild(s, resp, "page", "Krebs");
  s = r.state;
  const krebs = r.id;
  r = op.addChild(s, cells, "page", "Glycolysis");
  s = r.state;
  const gly = r.id;
  r = op.addChild(s, bio, "page", "Notes");
  s = r.state;
  const notes = r.id;
  r = op.addSubject(s, { name: "Chemistry" });
  s = { ...r.state, expanded: { [bio]: true, [cells]: true } };
  return { s, bio, cells, resp, krebs, gly, notes, chem: r.id };
}
const rowOf = (s, id, parentId) => visibleRows(s).find((r) => r.id === id && r.parentId === parentId);

describe("zoneOf", () => {
  const rect = { top: 0, height: 40 };
  it("splits container rows in three", () => {
    expect(zoneOf(rect, 5, true)).toBe("before");
    expect(zoneOf(rect, 20, true)).toBe("into");
    expect(zoneOf(rect, 35, true)).toBe("after");
  });
  it("splits other rows in half", () => {
    expect(zoneOf(rect, 19, false)).toBe("before");
    expect(zoneOf(rect, 21, false)).toBe("after");
  });
});

describe("placementFor", () => {
  it("before a row takes its index", () => {
    const { s, bio, cells, notes } = sample();
    expect(placementFor(s, rowOf(s, cells, bio), "before", { id: notes, from: bio })).toMatchObject({
      toId: bio, index: 0, depth: 1, kind: "line", side: "before", anchorKey: `${bio}/${cells}`,
    });
  });

  it("into appends", () => {
    const { s, bio, krebs, resp } = sample();
    expect(placementFor(s, rowOf(s, bio, null), "into", { id: krebs, from: resp })).toMatchObject({
      toId: bio, index: s.nodes[bio].children.length, kind: "into",
    });
  });

  it("after an expanded folder with children goes first inside it", () => {
    const { s, bio, cells, krebs, resp } = sample();
    expect(placementFor(s, rowOf(s, cells, bio), "after", { id: krebs, from: resp })).toMatchObject({
      toId: cells, index: 0, depth: 2, kind: "line",
    });
  });

  it("after a collapsed row, or onto the current spot, is a no-op", () => {
    const { s, bio, cells, notes } = sample();
    const collapsed = { ...s, expanded: { [bio]: true } };
    expect(placementFor(collapsed, rowOf(collapsed, cells, bio), "after", { id: notes, from: bio })).toBeNull();
  });

  it("a collapsed row's after is its index + 1 for other lists", () => {
    const { s, bio, cells, krebs, resp } = sample();
    const collapsed = { ...s, expanded: { [bio]: true } };
    expect(placementFor(collapsed, rowOf(collapsed, cells, bio), "after", { id: krebs, from: resp })).toMatchObject({
      toId: bio, index: 1, depth: 1,
    });
  });

  it("dropping next to its own spot is a no-op", () => {
    const { s, bio, cells, notes } = sample();
    expect(placementFor(s, rowOf(s, notes, bio), "before", { id: notes, from: bio })).toBeNull();
    expect(placementFor(s, rowOf(s, notes, bio), "after", { id: notes, from: bio })).toBeNull();
    expect(placementFor(s, rowOf(s, notes, bio), "before", { id: cells, from: bio })).toBeNull(); // cells is just before notes
    const shut = { ...s, expanded: { [bio]: true } };
    expect(placementFor(shut, rowOf(shut, cells, bio), "after", { id: notes, from: bio })).toBeNull(); // notes is just after cells
  });

  it("subtracts one when moving forward in the same list", () => {
    const { s, bio, cells, notes } = sample();
    expect(placementFor(s, rowOf(s, notes, bio), "after", { id: cells, from: bio })).toMatchObject({ toId: bio, index: 1 });
  });

  it("forward drag from index 0 to after index 1 gives 1", () => {
    const { s, cells, gly, resp } = sample();
    // cells children: [resp, gly]; drag resp after gly -> index 1
    const p = placementFor(s, rowOf(s, gly, cells), "after", { id: resp, from: cells });
    expect(p).toMatchObject({ toId: cells, index: 1 });
  });

  it("refuses a folder into its own contents", () => {
    const { s, bio, cells, resp } = sample();
    expect(placementFor(s, rowOf(s, resp, cells), "into", { id: cells, from: bio })).toBeNull();
  });

  it("refuses a page onto a container that already lists it", () => {
    const { s, cells, resp, krebs } = sample();
    expect(placementFor(s, rowOf(s, resp, cells), "into", { id: krebs, from: cells })).toBeNull();
  });

  it("moves subjects only among subjects", () => {
    const { s, bio, chem, cells } = sample();
    expect(placementFor(s, rowOf(s, bio, null), "before", { id: chem, from: null })).toMatchObject({ toId: null, index: 0 });
    expect(placementFor(s, rowOf(s, chem, null), "after", { id: bio, from: null })).toMatchObject({ toId: null, index: 1 });
    expect(placementFor(s, rowOf(s, bio, null), "before", { id: bio, from: null })).toBeNull();
    expect(placementFor(s, rowOf(s, cells, bio), "before", { id: chem, from: null })).toBeNull();
    expect(placementFor(s, rowOf(s, cells, bio), "into", { id: chem, from: null })).toBeNull();
    expect(placementFor(s, rowOf(s, bio, null), "into", { id: chem, from: null })).toBeNull();
  });

  it("a folder can be dropped into the Unsorted header", () => {
    const { s, bio, cells } = sample();
    const header = { key: "root/unsorted", id: UNSORTED, parentId: null, depth: -1 };
    expect(placementFor(s, header, "into", { id: cells, from: bio })).toMatchObject({ toId: UNSORTED, kind: "into", index: 0 });
  });
});
