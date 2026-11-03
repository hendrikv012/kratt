import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FlashcardsViewer from "./FlashcardsViewer.jsx";

const ITEMS = [
  { front: "Q1", back: "A1" },
  { front: "Q2", back: "A2" },
  { front: "Q3", back: "A3" },
];

const status = () => document.querySelector("[aria-live='polite']");
const flip = () => fireEvent.keyDown(document.querySelector(".st-viewer"), { key: " " });

describe("FlashcardsViewer", () => {
  it('shows the first front and "1 / 3"', () => {
    render(<FlashcardsViewer items={ITEMS} />);
    expect(screen.getByText("Q1")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("Space, Enter or a click flips; the status says Back", () => {
    render(<FlashcardsViewer items={ITEMS} />);
    expect(status().textContent).toMatch(/front: Q1/);
    flip();
    expect(status().textContent).toMatch(/Card 1 of 3, back: A1/);
    fireEvent.keyDown(document.querySelector(".st-viewer"), { key: "Enter" });
    expect(status().textContent).toMatch(/front:/);
    fireEvent.click(document.querySelector(".st-flashcard"));
    expect(status().textContent).toMatch(/back:/);
  });

  it("arrows move, and left on the first card stays", () => {
    render(<FlashcardsViewer items={ITEMS} />);
    const root = document.querySelector(".st-viewer");
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("Got it (g) and Again (a) only after a flip; each moves on", () => {
    render(<FlashcardsViewer items={ITEMS} />);
    const root = document.querySelector(".st-viewer");
    fireEvent.keyDown(root, { key: "g" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
    flip();
    fireEvent.keyDown(root, { key: "g" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(root, { key: "a" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    flip();
    fireEvent.keyDown(root, { key: "a" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  function finishAll(root) {
    flip();
    fireEvent.keyDown(root, { key: "g" });
    flip();
    fireEvent.keyDown(root, { key: "g" });
    flip();
    fireEvent.keyDown(root, { key: "a" });
  }

  it('summary at the end: "2 got, 1 again"; onFinish once', () => {
    const onFinish = vi.fn();
    render(<FlashcardsViewer items={ITEMS} onFinish={onFinish} />);
    finishAll(document.querySelector(".st-viewer"));
    expect(document.querySelector(".st-viewer-summary").textContent).toMatch(/2 got, 1 again/);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ right: 2, of: 3 });
  });

  it("Go through the 1 again shows only the missed card; no second onFinish", () => {
    const onFinish = vi.fn();
    render(<FlashcardsViewer items={ITEMS} onFinish={onFinish} />);
    finishAll(document.querySelector(".st-viewer"));
    fireEvent.click(screen.getByRole("button", { name: /Go through the 1 again/ }));
    expect(screen.getByText("Q3")).toBeTruthy();
    expect(screen.getByText("1 / 1")).toBeTruthy();
    flip();
    fireEvent.keyDown(document.querySelector(".st-viewer"), { key: "g" });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("Shuffle keeps every card", () => {
    render(<FlashcardsViewer items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: /Shuffle/ }));
    const root = document.querySelector(".st-viewer");
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push(document.querySelector(".st-flashcard-front").textContent.trim());
      fireEvent.keyDown(root, { key: "ArrowRight" });
    }
    expect(seen.sort()).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("the card button's name is the visible side's text, with a hint", () => {
    render(<FlashcardsViewer items={ITEMS} />);
    expect(screen.getByRole("button", { name: "Q1. Show back" })).toBeTruthy();
    flip();
    expect(screen.getByRole("button", { name: "A1. Show front" })).toBeTruthy();
  });

  it("Start over after a retry pass restarts the whole deck", () => {
    const onFinish = vi.fn();
    render(<FlashcardsViewer items={ITEMS} onFinish={onFinish} />);
    finishAll(document.querySelector(".st-viewer"));
    fireEvent.click(screen.getByRole("button", { name: /Go through the 1 again/ }));
    flip();
    fireEvent.keyDown(document.querySelector(".st-viewer"), { key: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByText("1 / 3")).toBeTruthy();
    finishAll(document.querySelector(".st-viewer"));
    expect(onFinish).toHaveBeenLastCalledWith({ right: 2, of: 3 });
  });

  it("letter keys work with Caps Lock; focus lands on the viewer at the end", () => {
    render(<FlashcardsViewer items={[{ front: "Q", back: "A" }]} />);
    flip();
    document.querySelector(".st-flashcard").focus();
    fireEvent.keyDown(document.querySelector(".st-viewer"), { key: "G" });
    expect(document.activeElement).toBe(document.querySelector(".st-viewer"));
  });

  it("a hidden earlier viewer does not claim keys from the visible one", () => {
    render(
      <div>
        <div hidden><FlashcardsViewer items={ITEMS} /></div>
        <FlashcardsViewer items={ITEMS} />
      </div>
    );
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const counts = [...document.querySelectorAll(".st-viewer-count")].map((n) => n.textContent);
    expect(counts).toEqual(["1 / 3", "2 / 3"]);
  });

  it("reduced motion uses a crossfade", () => {
    const study = document.createElement("div");
    study.className = "study";
    study.setAttribute("data-reduce-motion", "");
    document.body.appendChild(study);
    render(<FlashcardsViewer items={ITEMS} />, { container: study.appendChild(document.createElement("div")) });
    expect(document.querySelector(".st-flashcard").getAttribute("data-motion")).toBe("fade");
    study.remove();
  });

  it("renders HTML in card text as text", () => {
    render(<FlashcardsViewer items={[{ front: "<b>x</b>", back: "y" }]} />);
    expect(document.querySelector(".st-flashcard-front b")).toBeNull();
    expect(document.querySelector(".st-flashcard-front").textContent).toContain("<b>x</b>");
  });

  it("Review Focus 2: a key from an input in the parent does nothing", () => {
    render(
      <div>
        <input aria-label="note" />
        <FlashcardsViewer items={ITEMS} />
      </div>
    );
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
  });
});
