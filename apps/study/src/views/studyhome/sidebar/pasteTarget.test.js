import { describe, it, expect } from "vitest";
import * as op from "../data/operations";
import { UNSORTED } from "../data/tree";
import { pasteTarget } from "./pasteTarget";

function sample() {
  let r = op.addSubject(op.EMPTY_STATE, { name: "Biology" });
  let s = r.state;
  const bio = r.id;
  r = op.addChild(s, bio, "folder", "Cells");
  s = r.state;
  const cells = r.id;
  r = op.addChild(s, bio, "page", "Notes");
  s = r.state;
  const notes = r.id;
  r = op.addSubject(s, { name: "Chemistry" });
  s = r.state;
  const chem = r.id;
  r = op.addChild(s, chem, "page", "Atoms");
  return { s: r.state, bio, cells, notes, chem, atoms: r.id };
}

describe("pasteTarget", () => {
  it("subject goes right after the selected subject's subject", () => {
    const { s, bio, cells, chem } = sample();
    const sel = { id: cells, parentId: bio };
    expect(pasteTarget(s, { id: chem, parentId: null }, sel)).toEqual({
      toId: null,
      index: s.subjects.indexOf(bio) + 1,
    });
  });

  it("subject goes to the end with nothing or Unsorted selected", () => {
    const { s, bio } = sample();
    const copied = { id: bio, parentId: null };
    expect(pasteTarget(s, copied, null)).toEqual({ toId: null, index: s.subjects.length });
    expect(pasteTarget(s, copied, { id: UNSORTED, parentId: null })).toEqual({ toId: null, index: s.subjects.length });
  });

  it("folder or page goes inside a selected folder or subject, at the end", () => {
    const { s, bio, cells, notes } = sample();
    expect(pasteTarget(s, { id: notes, parentId: bio }, { id: cells, parentId: bio })).toEqual({
      toId: cells,
      index: s.nodes[cells].children.length,
    });
    expect(pasteTarget(s, { id: cells, parentId: bio }, { id: bio, parentId: null })).toEqual({
      toId: bio,
      index: s.nodes[bio].children.length,
    });
  });

  it("goes right after a selected page, in the list it is shown in", () => {
    const { s, bio, cells, notes } = sample();
    expect(pasteTarget(s, { id: cells, parentId: bio }, { id: notes, parentId: bio })).toEqual({
      toId: bio,
      index: s.nodes[bio].children.indexOf(notes) + 1,
    });
  });

  it("folder or page goes to the end of Unsorted with nothing or Unsorted selected", () => {
    const { s, bio, notes } = sample();
    const copied = { id: notes, parentId: bio };
    const end = { toId: UNSORTED, index: s.nodes[UNSORTED].children.length };
    expect(pasteTarget(s, copied, null)).toEqual(end);
    expect(pasteTarget(s, copied, { id: UNSORTED, parentId: null })).toEqual(end);
  });

  it("returns null when the copied item is gone", () => {
    const { s } = sample();
    expect(pasteTarget(s, { id: "gone", parentId: null }, null)).toBeNull();
  });
});
