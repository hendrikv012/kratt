import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubjectBox from "./SubjectBox";
import { sortSources } from "./sorting";
import { typeSummary } from "./boxSummary";
const group = { id: "Biology", name: "Biology", color: "#85b878", sources: [
  { id: "one", title: "Cells", type: "link", createdAt: 1, updatedAt: 9 },
  { id: "two", title: "Atoms", type: "file", fileName: "atoms.pdf", createdAt: 2, updatedAt: 8 },
  { id: "three", title: "Map", type: "file", fileName: "map.png", createdAt: 3, updatedAt: 7 },
] };
it.each(["rich", "simple", "preview"])("renders the reference %s box with a native keyboard-accessible button", (style) => {
  const open = vi.fn(); render(<SubjectBox group={group} style={style} onOpen={open} />);
  const button = screen.getByRole("button", { name: "Open Biology, 3 sources" }); fireEvent.click(button); expect(open).toHaveBeenCalledOnce();
  if (style === "rich") expect(screen.getByText("1 link · 1 PDF · 1 image")).toBeTruthy();
  if (style === "preview") expect(screen.getByText("Cells")).toBeTruthy();
  if (style === "simple") expect(screen.queryByText("Cells")).toBeNull();
});
it("summarizes types including images", () => expect(typeSummary(group.sources)).toBe("1 link · 1 PDF · 1 image"));
it.each([["az",["Atoms","Cells","Map"]],["za",["Map","Cells","Atoms"]],["newest",["Map","Atoms","Cells"]],["oldest",["Cells","Atoms","Map"]],["updated",["Cells","Atoms","Map"]],["type",["Cells","Atoms","Map"]]])("sorts by %s without mutating source order", (sort, titles) => {
  expect(sortSources(group.sources, sort).map((s) => s.title)).toEqual(titles);
  expect(group.sources[0].title).toBe("Cells");
});
