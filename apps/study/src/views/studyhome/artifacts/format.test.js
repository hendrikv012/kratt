import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TYPES,
  TYPE_LABELS,
  formatArtifact,
  itemCount,
  itemProblem,
  parseArtifact,
  problemsIn,
  usableItems,
} from "./format";

const SAMPLES = {
  flashcards: [
    { front: "What is ATP?", back: "The cell's energy currency.\n\nMade in the mitochondria." },
    { front: "Define osmosis", back: "Water moving across a membrane." },
  ],
  slides: [
    { title: "Cells", body: "- membrane\n- nucleus" },
    { title: "Energy", body: "ATP powers work." },
  ],
  quiz: [
    {
      question: "2+2?",
      choices: [{ text: "3", right: false }, { text: "4", right: true }],
      why: "Basic sums.\nTwice two.",
      rest: "",
    },
    {
      question: "Capital of France?",
      choices: [{ text: "Paris", right: true }, { text: "Rome", right: false }],
      why: "",
      rest: "Pick one.",
    },
  ],
};

describe("artifact formats", () => {
  it("exports the types and labels", () => {
    expect(ARTIFACT_TYPES).toEqual(["flashcards", "slides", "quiz"]);
    expect(TYPE_LABELS).toEqual({ flashcards: "Flashcards", slides: "Slides", quiz: "Quiz" });
  });

  it("round-trips each type", () => {
    for (const t of ARTIFACT_TYPES) {
      expect(parseArtifact(t, formatArtifact(t, SAMPLES[t]))).toEqual(SAMPLES[t]);
    }
  });

  it("keeps text before the first item", () => {
    const items = parseArtifact("flashcards", "intro\n\n### Q\nA\n");
    expect(items[0]).toEqual({ front: "", back: "intro" });
    expect(items[1]).toEqual({ front: "Q", back: "A" });
    expect(formatArtifact("flashcards", items)).toContain("intro");
    expect(parseArtifact("flashcards", formatArtifact("flashcards", items))).toEqual(items);
  });

  it("reads CRLF files", () => {
    const lf = "intro\n\n### Q\nA\n";
    expect(parseArtifact("flashcards", lf.replace(/\n/g, "\r\n"))).toEqual(parseArtifact("flashcards", lf));
  });

  it("a heading inside a back survives", () => {
    const items = [{ front: "Q", back: "one\n### not a card\ntwo" }];
    expect(parseArtifact("flashcards", formatArtifact("flashcards", items))).toHaveLength(1);
  });

  it("a --- line inside a slide survives", () => {
    const items = [{ title: "T", body: "above\n---\nbelow" }];
    expect(parseArtifact("slides", formatArtifact("slides", items))).toHaveLength(1);
    expect(formatArtifact("slides", items)).toContain(" ---");
  });

  it("slide titles are the first # line", () => {
    expect(parseArtifact("slides", "# Cells\ntext")).toEqual([{ title: "Cells", body: "text" }]);
    expect(parseArtifact("slides", "# Cells\n## Sub\ntext")).toEqual([{ title: "Cells", body: "## Sub\ntext" }]);
    expect(formatArtifact("slides", [{ title: "Cells", body: "text" }])).toBe("# Cells\ntext\n");
    const untitled = [{ title: "", body: "# looks like a title" }];
    expect(parseArtifact("slides", formatArtifact("slides", untitled))).toEqual([{ title: "", body: "# looks like a title" }].map((x) => ({ ...x, body: ` ${x.body}` })));
  });

  it("quiz parsing", () => {
    expect(parseArtifact("quiz", "### 2+2?\n- [ ] 3\n- [x] 4\n> because\n")).toEqual([
      { question: "2+2?", choices: [{ text: "3", right: false }, { text: "4", right: true }], why: "because", rest: "" },
    ]);
    expect(parseArtifact("quiz", "### Q\n- [X] a\n- [ ] b\n")[0].choices[0].right).toBe(true);
  });

  it("problems", () => {
    const choices = (...r) => r.map((right, i) => ({ text: `c${i}`, right }));
    const q = (c) => ({ question: "Q", choices: c, why: "", rest: "" });
    expect(problemsIn("quiz", [])).toEqual(["Kratt made no questions."]);
    expect(itemProblem("quiz", q(choices(false, false)), 2)).toBe("Question 3 has no correct answer.");
    expect(itemProblem("quiz", q(choices(true, true)), 2)).toBe("Question 3 has more than one correct answer.");
    expect(itemProblem("quiz", q(choices(true)), 2)).toBe("Question 3 needs at least two choices.");
    expect(itemProblem("quiz", q(choices(true, false)), 2)).toBeNull();
    expect(itemProblem("flashcards", { front: "", back: "b" }, 0)).toBe("Card 1 has an empty front.");
    expect(itemProblem("flashcards", { front: "f", back: "" }, 0)).toBe("Card 1 has an empty back.");
    expect(itemProblem("slides", { title: "", body: "" }, 0)).toBe("Slide 1 is empty.");
  });

  it("usableItems drops only broken items", () => {
    const items = [{ front: "a", back: "b" }, { front: "", back: "x" }, { front: "c", back: "d" }];
    expect(usableItems("flashcards", items)).toEqual([items[0], items[2]]);
    expect(problemsIn("flashcards", items)).toEqual(["Card 2 has an empty front."]);
  });

  it("itemCount", () => {
    expect(itemCount("flashcards", 1)).toBe("1 card");
    expect(itemCount("flashcards", 10)).toBe("10 cards");
    expect(itemCount("slides", 1)).toBe("1 slide");
    expect(itemCount("quiz", 5)).toBe("5 questions");
  });
});
