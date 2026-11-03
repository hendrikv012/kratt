import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuizViewer from "./QuizViewer.jsx";

const mk = (n, rightIdx = 0) => ({
  question: `Question ${n}`,
  choices: [0, 1, 2].map((i) => ({ text: `Q${n} choice ${i}`, right: i === rightIdx })),
  why: `Because ${n}`,
  rest: "",
});
const ITEMS = [mk(1), mk(2), mk(3)];

const root = () => document.querySelector(".st-viewer");
const status = () => document.querySelector("[aria-live='polite']");
const key = (k) => fireEvent.keyDown(root(), { key: k });
const choiceBtn = (text) => screen.getByText(text).closest("button");
const next = () => screen.getByRole("button", { name: /next|see score/i });

describe("QuizViewer", () => {
  it("shows the question and its choices as real text", () => {
    render(<QuizViewer items={ITEMS} />);
    expect(screen.getByText("Question 1")).toBeTruthy();
    expect(choiceBtn("Q1 choice 1")).toBeTruthy();
    expect(status().textContent).toMatch(/Question 1 of 3.*Question 1/);
  });

  it("a click picks; shows Right plus why; choices lock", () => {
    render(<QuizViewer items={ITEMS} />);
    fireEvent.click(choiceBtn("Q1 choice 0"));
    expect(status().textContent).toMatch(/Right/);
    expect(status().textContent).toMatch(/Because 1/);
    expect(screen.getByText("Because 1")).toBeTruthy();
    fireEvent.click(choiceBtn("Q1 choice 1"));
    expect(status().textContent).toMatch(/Right/);
    expect(status().textContent).not.toMatch(/Not quite/);
  });

  it("number keys pick; a wrong pick says Not quite and the right answer", () => {
    render(<QuizViewer items={ITEMS} />);
    key("2");
    expect(status().textContent).toMatch(/Not quite/);
    expect(status().textContent).toMatch(/Q1 choice 0/);
    expect(status().textContent).toMatch(/Because 1/);
    key("1"); // locked
    expect(status().textContent).toMatch(/Not quite/);
  });

  it("the right choice is marked in text for screen readers", () => {
    render(<QuizViewer items={ITEMS} />);
    key("3");
    expect(choiceBtn("Q1 choice 0").textContent).toMatch(/right answer/i);
    expect(choiceBtn("Q1 choice 2").textContent).toMatch(/your pick/i);
  });

  it("Enter or Next goes on only after a pick", () => {
    render(<QuizViewer items={ITEMS} />);
    key("Enter");
    expect(screen.getByText("Question 1")).toBeTruthy();
    fireEvent.click(next());
    expect(screen.getByText("Question 1")).toBeTruthy();
    key("1");
    key("Enter");
    expect(screen.getByText("Question 2")).toBeTruthy();
    expect(status().textContent).toMatch(/Question 2 of 3/);
    key("1");
    fireEvent.click(next());
    expect(screen.getByText("Question 3")).toBeTruthy();
  });

  it('shows "3 of 5" at the end and calls onFinish once', () => {
    const onFinish = vi.fn();
    render(<QuizViewer items={[mk(1), mk(2), mk(3), mk(4), mk(5)]} onFinish={onFinish} />);
    [1, 1, 1, 2, 2].forEach((k) => {
      key(String(k));
      key("Enter");
    });
    expect(screen.getByText("3 of 5")).toBeTruthy();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ right: 3, of: 5 });
  });

  it("focus moves to the score after the last question", () => {
    render(<QuizViewer items={[mk(1)]} />);
    choiceBtn("Q1 choice 0").focus();
    fireEvent.click(choiceBtn("Q1 choice 0"));
    fireEvent.click(next());
    expect(document.activeElement).toBe(root());
  });

  it("Retry the wrong ones asks only those and does not call onFinish", () => {
    const onFinish = vi.fn();
    render(<QuizViewer items={ITEMS} onFinish={onFinish} />);
    [1, 2, 1].forEach((k) => {
      key(String(k));
      key("Enter");
    });
    expect(screen.getByText("2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry the wrong/i }));
    expect(screen.getByText("Question 2")).toBeTruthy();
    key("1");
    key("Enter");
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("Start over after a retry restarts the full quiz", () => {
    const onFinish = vi.fn();
    render(<QuizViewer items={ITEMS} onFinish={onFinish} />);
    [2, 1, 1].forEach((k) => {
      key(String(k));
      key("Enter");
    });
    fireEvent.click(screen.getByRole("button", { name: /retry the wrong/i }));
    key("1");
    key("Enter");
    fireEvent.click(screen.getByRole("button", { name: /start over/i }));
    expect(screen.getByText("Question 1")).toBeTruthy();
    expect(status().textContent).toMatch(/Question 1 of 3/);
    [1, 1, 1].forEach((k) => {
      key(String(k));
      key("Enter");
    });
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(onFinish).toHaveBeenCalledTimes(2);
  });

  it("no Retry button on a perfect run", () => {
    render(<QuizViewer items={[mk(1)]} />);
    key("1");
    key("Enter");
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("HTML in question, choices, why and rest shows as text", () => {
    const item = {
      question: "<b>q</b>",
      choices: [{ text: "<i>a</i>", right: true }, { text: "b", right: false }],
      why: "<u>w</u>",
      rest: "<s>r</s>",
    };
    render(<QuizViewer items={[item]} />);
    expect(document.querySelector("b, i")).toBeNull();
    expect(screen.getByText("<b>q</b>")).toBeTruthy();
    key("1");
    expect(document.querySelector("u, s")).toBeNull();
    expect(screen.getByText("<u>w</u>")).toBeTruthy();
    expect(screen.getByText("<s>r</s>")).toBeTruthy();
  });

  it("renders Markdown in the question", () => {
    render(<QuizViewer items={[{ ...mk(1), question: "Is **this** bold?" }]} />);
    expect(document.querySelector("strong").textContent).toBe("this");
  });

  it("empty items says there are no questions", () => {
    render(<QuizViewer items={[]} />);
    expect(screen.getByText(/no questions/i)).toBeTruthy();
  });

  it("after a click on a choice, focus is on Next and Enter advances", () => {
    render(<QuizViewer items={ITEMS} />);
    choiceBtn("Q1 choice 1").focus();
    fireEvent.click(choiceBtn("Q1 choice 1"));
    expect(document.activeElement).toBe(next());
    fireEvent.keyDown(document.activeElement, { key: "Enter" });
    fireEvent.click(document.activeElement); // the browser's native Enter on a button
    expect(screen.getByText("Question 2")).toBeTruthy();
    expect(document.activeElement).toBe(next());
  });

  it("Retry and Start over leave focus on the viewer, not body", () => {
    render(<QuizViewer items={ITEMS} />);
    [2, 1, 1].forEach((k) => {
      key(String(k));
      key("Enter");
    });
    const retryBtn = screen.getByRole("button", { name: /retry the wrong/i });
    retryBtn.focus();
    fireEvent.click(retryBtn);
    expect(document.activeElement).toBe(root());
    key("1");
    key("Enter");
    const again = screen.getByRole("button", { name: /start over/i });
    again.focus();
    fireEvent.click(again);
    expect(document.activeElement).toBe(root());
  });

  it("Next is aria-disabled before a pick; a key past the last choice does nothing", () => {
    render(<QuizViewer items={ITEMS} />);
    expect(next().getAttribute("aria-disabled")).toBe("true");
    key("9");
    expect(status().textContent).toMatch(/Question 1 of 3/);
    expect(next().getAttribute("aria-disabled")).toBe("true");
    key("1");
    expect(next().getAttribute("aria-disabled")).toBeNull();
  });
});
