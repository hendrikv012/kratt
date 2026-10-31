import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import Toasts, { useToasts, TOAST_DURATION, MAX_TOASTS } from "./Toasts";

let api;
function Harness() {
  const toasts = useToasts();
  api = toasts;
  return <Toasts items={toasts.items} />;
}

afterEach(() => vi.useRealTimers());

describe("toasts", () => {
  it("shows a message for 4 seconds", () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => api.toast("Saved"));
    expect(screen.getByRole("status").textContent).toContain("Saved");
    act(() => vi.advanceTimersByTime(TOAST_DURATION - 1));
    expect(screen.queryByText("Saved")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).toBeNull();
    expect(TOAST_DURATION).toBe(4000);
  });

  it("keeps at most 3, dropping the oldest", () => {
    render(<Harness />);
    act(() => ["one", "two", "three", "four"].forEach((t) => api.toast(t)));
    expect(MAX_TOASTS).toBe(3);
    expect(screen.queryByText("one")).toBeNull();
    expect(["two", "three", "four"].map((t) => screen.getByText(t).textContent)).toEqual(["two", "three", "four"]);
  });

  it("keeps the same toast function across renders", () => {
    const { rerender } = render(<Harness />);
    const first = api.toast;
    rerender(<Harness />);
    expect(api.toast).toBe(first);
  });

  it("runs and dismisses an action", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Harness />);
    act(() => api.toast("Layout saved", { label: "Undo", run }));
    expect(screen.getByRole("status").textContent).toContain("Layout saved");
    const undoButton = screen.getByRole("button", { name: "Undo" });
    expect(run).not.toHaveBeenCalled();
    act(() => undoButton.click());
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("Layout saved")).toBeNull();
  });

  it("clears timers when action is clicked and does not reappear after 4s", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Harness />);
    act(() => api.toast("Layout saved", { label: "Undo", run }));
    const undoButton = screen.getByRole("button", { name: "Undo" });
    act(() => undoButton.click());
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("Layout saved")).toBeNull();
    // Verify timers are cleared for this toast
    expect(vi.getTimerCount()).toBe(0);
    // Advance time way past the original toast duration to ensure no timers fire
    act(() => vi.advanceTimersByTime(TOAST_DURATION + 5000));
    expect(screen.queryByText("Layout saved")).toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });

  it("guards against double click running the action twice", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Harness />);
    act(() => api.toast("Layout saved", { label: "Undo", run }));
    const undoButton = screen.getByRole("button", { name: "Undo" });
    // Capture button and click it twice
    act(() => {
      undoButton.click();
      undoButton.click();
    });
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("Layout saved")).toBeNull();
  });

  it("allows the same action object to be used on multiple toasts", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const sharedAction = { label: "Undo", run };
    render(<Harness />);
    // Create two toasts with the same action object
    act(() => {
      api.toast("First saved", sharedAction);
      api.toast("Second saved", sharedAction);
    });
    expect(screen.getByText("First saved")).toBeInTheDocument();
    expect(screen.getByText("Second saved")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Undo" });
    expect(buttons).toHaveLength(2);
    expect(run).not.toHaveBeenCalled();
    // Click first toast's button
    act(() => buttons[0].click());
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("First saved")).toBeNull();
    expect(screen.getByText("Second saved")).toBeInTheDocument();
    // Click second toast's button
    act(() => buttons[1].click());
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Second saved")).toBeNull();
  });

  it("waits while its Undo has focus, then finishes its time", () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => api.toast("Layout saved", { label: "Undo", run: () => {} }));
    act(() => vi.advanceTimersByTime(1000));
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => undo.focus());
    act(() => vi.advanceTimersByTime(TOAST_DURATION * 3));
    expect(screen.queryByText("Layout saved")).not.toBeNull();
    act(() => undo.blur());
    act(() => vi.advanceTimersByTime(TOAST_DURATION - 1000 - 1));
    expect(screen.queryByText("Layout saved")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Layout saved")).toBeNull();
  });

  it("waits while the pointer is over it", () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => api.toast("Layout saved", { label: "Undo", run: () => {} }));
    const box = screen.getByText("Layout saved").closest(".st-toast-content");
    fireEvent.mouseEnter(box);
    act(() => vi.advanceTimersByTime(TOAST_DURATION * 2));
    expect(screen.queryByText("Layout saved")).not.toBeNull();
    fireEvent.mouseLeave(box);
    act(() => vi.advanceTimersByTime(TOAST_DURATION));
    expect(screen.queryByText("Layout saved")).toBeNull();
  });

  it("dismiss(id) removes a toast before its time", () => {
    render(<Harness />);
    let id;
    act(() => {
      id = api.toast("Layout saved");
    });
    act(() => api.dismiss(id));
    expect(screen.queryByText("Layout saved")).toBeNull();
  });
});
