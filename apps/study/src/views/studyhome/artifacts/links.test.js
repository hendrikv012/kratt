import { describe, expect, it } from "vitest";
import { artifactLink, splitArtifactLinks } from "./links";

describe("artifact links", () => {
  it("writes a link with the type and title, without characters that break it", () => {
    expect(artifactLink({ id: "a1", type: "slides", title: "Cells | intro" })).toBe("[[artifact:a1|Slides · Cells - intro]]");
    expect(artifactLink({ id: "a2", type: "quiz", title: "[Krebs]" })).toBe("[[artifact:a2|Quiz · -Krebs-]]");
  });

  it("splits text around artifact links", () => {
    expect(splitArtifactLinks("See [[artifact:a1|Slides · X]] now")).toEqual(["See ", { id: "a1", label: "Slides · X" }, " now"]);
    expect(splitArtifactLinks("[[artifact:a1|A]][[artifact:a2|B]]")).toEqual([{ id: "a1", label: "A" }, { id: "a2", label: "B" }]);
  });

  it("leaves page links and plain text alone", () => {
    expect(splitArtifactLinks("See [[Page]] and more")).toEqual(["See [[Page]] and more"]);
    expect(splitArtifactLinks("")).toEqual([]);
  });
});
