import { describe, expect, it } from "vitest";
import { wantsArtifact } from "./intent";

describe("wantsArtifact", () => {
  it.each([
    ["Make me flashcards on this", "flashcards"],
    ["can you create a slide deck", "slides"],
    ["give me a quiz", "quiz"],
    ["turn this into flash cards", "flashcards"],
    ["GENERATE a presentation", "slides"],
  ])("matches %s", (q, type) => expect(wantsArtifact(q)).toBe(type));

  it.each(["what are slides in biology", "quiz me on this", "I made cards yesterday", "", null])("ignores %s", (q) =>
    expect(wantsArtifact(q)).toBeNull()
  );
});
