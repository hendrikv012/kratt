import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef } from "react";
import { useWorkHide } from "./useWorkHide";

const box = (top, bottom) => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top });

function Harness({ enabled = true, edge = "top", keepOpen = () => false }) {
  const containerRef = useRef(null);
  const barRef = useRef(null);
  const tucked = useWorkHide({ enabled, edge, containerRef, barRef, keepOpen });
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={barRef} data-testid="bar" data-tucked={String(tucked)}>
        <button>Tab</button>
      </div>
      <textarea aria-label="Page" />
      <div data-testid="page">Text</div>
    </div>
  );
}

const tucked = () => screen.getByTestId("bar").dataset.tucked === "true";
const move = (x, y) => act(() => void fireEvent.mouseMove(document, { clientX: x, clientY: y }));
const type = (key, extra) => act(() => void fireEvent.keyDown(screen.getByLabelText("Page"), { key, ...extra }));

function mount(props) {
  render(<Harness {...props} />);
  screen.getByTestId("container").getBoundingClientRect = () => box(0, 600);
}

describe("useWorkHide", () => {
  it("tucks while typing and comes back near the top edge", () => {
    mount();
    expect(tucked()).toBe(false);
    type("a");
    expect(tucked()).toBe(true);
    move(100, 300);
    expect(tucked()).toBe(true);
    move(100, 40);
    expect(tucked()).toBe(false);
  });

  it("tucks on scrolling the page", () => {
    mount();
    act(() => void fireEvent.wheel(screen.getByTestId("page"), { deltaY: 100 }));
    expect(tucked()).toBe(true);
  });

  it("doesn't count shortcuts or arrow keys as typing", () => {
    mount();
    type("k", { ctrlKey: true });
    type("ArrowDown");
    expect(tucked()).toBe(false);
  });

  it("comes back when the bar gets focus", () => {
    mount();
    type("a");
    act(() => screen.getByRole("button", { name: "Tab" }).focus());
    expect(tucked()).toBe(false);
  });

  it("stays while kept open", () => {
    mount({ keepOpen: () => true });
    type("a");
    expect(tucked()).toBe(false);
  });

  it("is never tucked when off", () => {
    mount({ enabled: false });
    type("a");
    expect(tucked()).toBe(false);
  });

  it("comes back near the bottom edge for a bottom bar", () => {
    mount({ edge: "bottom" });
    type("a");
    move(100, 40);
    expect(tucked()).toBe(true);
    move(100, 570);
    expect(tucked()).toBe(false);
  });
});
