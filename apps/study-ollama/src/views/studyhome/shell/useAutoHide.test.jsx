import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef } from "react";
import { useAutoHide } from "./useAutoHide";

const box = (top, bottom) => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top });

function Harness({ enabled = true, edge = "top", keepOpen = () => false }) {
  const containerRef = useRef(null);
  const barRef = useRef(null);
  const shown = useAutoHide({ enabled, edge, containerRef, barRef, keepOpen });
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={barRef} data-testid="bar" data-shown={String(shown)}>
        <button>Tab</button>
      </div>
    </div>
  );
}

const shown = () => screen.getByTestId("bar").dataset.shown === "true";
const move = (x, y) => act(() => void fireEvent.mouseMove(document, { clientX: x, clientY: y }));
const wait = (ms) => act(() => void vi.advanceTimersByTime(ms));

function mount(props) {
  const result = render(<Harness {...props} />);
  const atBottom = props?.edge === "bottom";
  screen.getByTestId("container").getBoundingClientRect = () => box(0, 600);
  screen.getByTestId("bar").getBoundingClientRect = () => (atBottom ? box(556, 600) : box(0, 44));
  return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutoHide", () => {
  it("appears near the top edge and hides 450ms after leaving", () => {
    mount();
    expect(shown()).toBe(false);
    move(100, 300);
    expect(shown()).toBe(false);
    move(100, 6);
    expect(shown()).toBe(true);
    move(100, 30); // still over the bar
    wait(1000);
    expect(shown()).toBe(true);
    move(100, 300);
    wait(449);
    expect(shown()).toBe(true);
    wait(2);
    expect(shown()).toBe(false);
  });

  it("stays through the 12px margin around the bar", () => {
    mount();
    move(100, 5);
    move(100, 52);
    wait(1000);
    expect(shown()).toBe(true);
    move(100, 57);
    wait(500);
    expect(shown()).toBe(false);
  });

  it("works at the bottom edge", () => {
    mount({ edge: "bottom" });
    move(100, 300);
    expect(shown()).toBe(false);
    move(100, 595);
    expect(shown()).toBe(true);
    move(100, 300);
    wait(500);
    expect(shown()).toBe(false);
  });

  it("appears when the pointer leaves the window through the edge", () => {
    mount();
    act(() => void fireEvent.mouseOut(document, { clientX: 100, clientY: 2, relatedTarget: null }));
    expect(shown()).toBe(true);
  });

  it("stays while a menu from the bar is open, then hides once it closes", () => {
    let open = true;
    mount({ keepOpen: () => open });
    move(100, 5);
    move(100, 300);
    wait(1000);
    expect(shown()).toBe(true);
    open = false;
    wait(500);
    expect(shown()).toBe(false);
  });

  it("shows when the bar gets keyboard focus and hides after focus leaves", () => {
    mount();
    act(() => screen.getByRole("button", { name: "Tab" }).focus());
    expect(shown()).toBe(true);
    wait(1000);
    expect(shown()).toBe(true);
    act(() => screen.getByRole("button", { name: "Tab" }).blur());
    wait(500);
    expect(shown()).toBe(false);
  });

  it("lets go after a mouse click on the bar", () => {
    const original = Element.prototype.matches;
    // A click focuses the button without focus-visible.
    Element.prototype.matches = function (q) {
      return q === ":focus-visible" ? false : original.call(this, q);
    };
    try {
      mount();
      move(100, 5);
      act(() => screen.getByRole("button", { name: "Tab" }).focus());
      move(100, 300);
      wait(500);
      expect(shown()).toBe(false);
    } finally {
      Element.prototype.matches = original;
    }
  });

  it("keeps the bar while the pointer rests over it and a menu closes", () => {
    let open = true;
    mount({ keepOpen: () => open });
    move(100, 20);
    wait(1000);
    open = false;
    wait(1000);
    expect(shown()).toBe(true);
  });

  it("hides when disabled afterwards", () => {
    const { rerender } = mount();
    move(100, 5);
    expect(shown()).toBe(true);
    rerender(<Harness enabled={false} />);
    rerender(<Harness enabled />);
    expect(shown()).toBe(false);
  });

  it("does nothing when disabled", () => {
    mount({ enabled: false });
    move(100, 5);
    expect(shown()).toBe(true);
  });
});
