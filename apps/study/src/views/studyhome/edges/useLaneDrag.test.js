import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement as h } from "react";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useLaneDrag } from "./useLaneDrag";
import { allowedIn } from "./lanes";

// jsdom has no PointerEvent; a MouseEvent carries the coordinates and button.
if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = class extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

afterEach(() => cleanup());

const box = (left, top, width, height) => () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });

// Two side lanes: left (0-200) holding a and b, right (600-800) empty; and a
// top lane (300-500 wide, 0-100 high) holding the clock, which only goes on
// the top or bottom edge.
const defs = { a: { lanes: "any" }, b: { lanes: "any" }, clock: { lanes: "edge" } };
const accepts = (id, lane) => allowedIn(defs[id], lane);
const handle = (handleProps) => (id) => h("div", { key: id, "data-slot": id }, h("div", { "data-testid": `handle-${id}`, ...handleProps(id) }, id));

function Lanes({ onDrop, onCancel }) {
  const { rootRef, drag, handleProps } = useLaneDrag({ onDrop, onCancel, accepts });
  return h(
    "div",
    { ref: rootRef },
    h(
      "div",
      { "data-drop-lane": "left", "data-testid": "left" },
      ["a", "b"].map(handle(handleProps))
    ),
    h("div", { "data-drop-lane": "right", "data-testid": "right" }),
    h("div", { "data-drop-lane": "top", "data-testid": "top" }, handle(handleProps)("clock")),
    h("p", { "data-testid": "state" }, drag ? `${drag.id} ${drag.lane} ${drag.index}` : "idle")
  );
}

const setup = () => {
  const fns = { onDrop: vi.fn(), onCancel: vi.fn() };
  const view = render(h(Lanes, fns));
  view.getByTestId("left").getBoundingClientRect = box(0, 0, 200, 600);
  view.getByTestId("right").getBoundingClientRect = box(600, 0, 200, 600);
  view.getByTestId("top").getBoundingClientRect = box(300, 0, 200, 100);
  view.container.querySelector('[data-slot="clock"]').getBoundingClientRect = box(300, 0, 200, 100);
  view.container.querySelector('[data-slot="a"]').getBoundingClientRect = box(0, 0, 200, 100);
  view.container.querySelector('[data-slot="b"]').getBoundingClientRect = box(0, 120, 200, 100);
  return { ...fns, ...view };
};

const startDrag = (view, id = "a", x = 20, y = 20) => {
  fireEvent.pointerDown(view.getByTestId(`handle-${id}`), { button: 0, clientX: x, clientY: y });
  fireEvent.pointerMove(window, { clientX: x + 20, clientY: y + 20 });
};

describe("useLaneDrag", () => {
  it("cancels a drag", () => {
    const view = setup();
    startDrag(view);
    expect(view.getByTestId("state").textContent).toBe("a left 0");
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300 });
    expect(view.onCancel).toHaveBeenCalledTimes(1);
    expect(view.onDrop).not.toHaveBeenCalled();
    expect(view.getByTestId("state").textContent).toBe("idle");

    startDrag(view);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(view.onCancel).toHaveBeenCalledTimes(2);
    expect(view.onDrop).not.toHaveBeenCalled();
    // The pointer going up after Escape does nothing more.
    fireEvent.pointerUp(window, { clientX: 700, clientY: 100 });
    expect(view.onDrop).not.toHaveBeenCalled();
  });

  it("waits for 5px before starting, so a click is not a drag", () => {
    const view = setup();
    fireEvent.pointerDown(view.getByTestId("handle-a"), { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 23, clientY: 22 });
    expect(view.getByTestId("state").textContent).toBe("idle");
    fireEvent.pointerUp(window, { clientX: 23, clientY: 22 });
    expect(view.onDrop).not.toHaveBeenCalled();
    expect(view.onCancel).not.toHaveBeenCalled();
  });

  it("drops into the lane under the pointer, before the card it is above", () => {
    const view = setup();
    startDrag(view, "b");
    fireEvent.pointerMove(window, { clientX: 100, clientY: 30 });
    expect(view.getByTestId("state").textContent).toBe("b left 0");
    fireEvent.pointerMove(window, { clientX: 700, clientY: 30 });
    expect(view.getByTestId("state").textContent).toBe("b right 0");
    fireEvent.pointerUp(window, { clientX: 700, clientY: 30 });
    expect(view.onDrop).toHaveBeenCalledWith("b", "right", 0);
    expect(view.onCancel).not.toHaveBeenCalled();
  });

  it("a lane that doesn't take the widget counts as outside", () => {
    const view = setup();
    startDrag(view, "clock", 320, 20);
    expect(view.getByTestId("state").textContent).toBe("clock top 0");
    fireEvent.pointerMove(window, { clientX: 100, clientY: 300 });
    // No placeholder in the left lane: it waits back home.
    expect(view.getByTestId("state").textContent).toBe("clock top 0");
    fireEvent.pointerUp(window, { clientX: 100, clientY: 300 });
    expect(view.onDrop).not.toHaveBeenCalled();
    expect(view.onCancel).toHaveBeenCalledTimes(1);
  });

  it("a pointer up right after Escape does not drop, even while the card glides home", () => {
    const animate = vi.fn(() => ({}));
    HTMLElement.prototype.animate = animate;
    try {
      const view = setup();
      startDrag(view);
      fireEvent.pointerMove(window, { clientX: 700, clientY: 30 });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      fireEvent.pointerUp(window, { clientX: 700, clientY: 30 });
      expect(view.onDrop).not.toHaveBeenCalled();
    } finally {
      delete HTMLElement.prototype.animate;
    }
  });
});
