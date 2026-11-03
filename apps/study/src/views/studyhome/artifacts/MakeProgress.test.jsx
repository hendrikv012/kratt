import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MakeProgress from "./MakeProgress";

describe("MakeProgress", () => {
  it("counts the parts when there are several", () => {
    const onCancel = vi.fn();
    render(<MakeProgress type="quiz" progress={{ part: 2, of: 5 }} onCancel={onCancel} />);
    expect(screen.getByText("Making part 2 of 5…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("says what Kratt is making with one part or no progress yet", () => {
    const { rerender } = render(<MakeProgress type="quiz" progress={{ part: 1, of: 1 }} onCancel={() => {}} />);
    expect(screen.getByText("Kratt is making your questions…")).toBeTruthy();
    rerender(<MakeProgress type="slides" progress={null} onCancel={() => {}} />);
    expect(screen.getByText("Kratt is making your slides…")).toBeTruthy();
    rerender(<MakeProgress type="flashcards" progress={null} onCancel={() => {}} />);
    expect(screen.getByText("Kratt is making your cards…")).toBeTruthy();
  });
});
