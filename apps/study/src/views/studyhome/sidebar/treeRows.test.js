import { describe, expect, it } from "vitest";
import * as op from "../data/operations";
import { visibleRows } from "./treeRows";

function sample() {
  let r = op.addSubject(op.EMPTY_STATE, { name: "Biology" });
  let s = r.state;
  const bio = r.id;
  r = op.addChild(s, bio, "folder", "Cells");
  s = r.state;
  const cells = r.id;
  r = op.addChild(s, cells, "page", "Respiration");
  s = r.state;
  const resp = r.id;
  r = op.addChild(s, bio, "page", "Notes");
  s = r.state;
  const notes = r.id;
  r = op.addSubject(s, { name: "Chemistry" });
  return { s: r.state, bio, cells, resp, notes, chem: r.id };
}

describe("visibleRows", () => {
  it("lists one row per subject when collapsed", () => {
    const { s, bio, chem } = sample();
    const rows = visibleRows({ ...s, expanded: {} });
    expect(rows.map((r) => r.id)).toEqual([bio, chem]);
    expect(rows[0]).toEqual({ key: `root/${bio}`, id: bio, parentId: null, depth: 0, index: 0 });
  });

  it("descends into expanded containers only", () => {
    const { s, bio, cells, resp, notes, chem } = sample();
    const rows = visibleRows({ ...s, expanded: { [bio]: true, [cells]: true } });
    expect(rows.map((r) => [r.id, r.depth])).toEqual([[bio, 0], [cells, 1], [resp, 2], [notes, 1], [chem, 0]]);
  });

  it("shows a linked page twice with different keys", () => {
    const { s, bio, cells, resp, chem } = sample();
    const linked = op.link(s, resp, chem);
    const rows = visibleRows({ ...linked, expanded: { [bio]: true, [cells]: true, [chem]: true } }).filter((r) => r.id === resp);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  it("puts Unsorted's children after the subjects", () => {
    const { s, bio, notes } = sample();
    const next = op.moveTo(s, notes, bio, "unsorted", 0);
    const last = visibleRows(next).at(-1);
    expect(last).toMatchObject({ id: notes, parentId: "unsorted", depth: 0, index: 0 });
  });
});
