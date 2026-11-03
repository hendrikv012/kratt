import { describe, expect, it } from "vitest";
import { coverageLine, madeFromChips } from "./madeFrom";

const state = {
  nodes: {
    p1: { id: "p1", type: "page", name: "Krebs cycle" },
    Biology: { id: "Biology", type: "subject", name: "Biology" },
    f1: { id: "f1", type: "folder", name: "Cells" },
  },
  sources: [{ id: "s1", title: "Lecture" }, { id: "s2", title: "" }],
};

describe("madeFromChips", () => {
  it("labels pages, subjects, sources and missing notes", () => {
    expect(madeFromChips(state, ["p1", "Biology", "f1", "s1", "s2", "gone"])).toEqual([
      { id: "p1", label: "Krebs cycle", kind: "page" },
      { id: "Biology", label: "Biology", kind: "subject" },
      { id: "f1", label: "Cells", kind: "subject" },
      { id: "s1", label: "Lecture", kind: "source" },
      { id: "s2", label: "Untitled source", kind: "source" },
      { id: "gone", label: "deleted note", kind: "missing" },
    ]);
  });
});

describe("coverageLine", () => {
  it("says what was covered", () => {
    expect(coverageLine({ madeFrom: ["a", "b", "c"], parts: 5 })).toBe("Made from 3 notes · all of them, in 5 parts");
    expect(coverageLine({ madeFrom: ["a"], parts: 1 })).toBe("Made from 1 note · all of it");
    expect(coverageLine({ madeFrom: ["a"], parts: 3 })).toBe("Made from 1 note · all of it, in 3 parts");
    expect(coverageLine({ madeFrom: ["a", "b"], parts: 1 })).toBe("Made from 2 notes · all of them");
  });
});
