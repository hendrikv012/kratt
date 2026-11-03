import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SlidesViewer from "./SlidesViewer.jsx";

const ITEMS = [
  { title: "Intro", body: "Hello **world**" },
  { title: "Second", body: "Two" },
  { title: "Third", body: "Three" },
  { title: "Fourth", body: "Four" },
];

const status = () => document.querySelector("[aria-live='polite']");
const root = () => document.querySelector(".st-viewer");
afterEach(() => { delete window.matchMedia; });
const key = (k) => fireEvent.keyDown(root(), { key: k });

describe("SlidesViewer", () => {
  it('shows slide 1 title and "1 / 4"', () => {
    render(<SlidesViewer items={ITEMS} />);
    expect(screen.getByRole("heading", { name: "Intro" })).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
  });

  it("arrows, Space, PageDown and a click go forward; left and PageUp go back; it stops at the ends", () => {
    render(<SlidesViewer items={ITEMS} />);
    key("ArrowLeft");
    expect(screen.getByText("1 / 4")).toBeTruthy();
    key("ArrowRight");
    expect(screen.getByText("2 / 4")).toBeTruthy();
    key(" ");
    expect(screen.getByText("3 / 4")).toBeTruthy();
    key("PageDown");
    expect(screen.getByText("4 / 4")).toBeTruthy();
    key("ArrowRight");
    fireEvent.click(document.querySelector(".st-slide"));
    expect(screen.getByText("4 / 4")).toBeTruthy();
    key("ArrowLeft");
    expect(screen.getByText("3 / 4")).toBeTruthy();
    key("PageUp");
    expect(screen.getByText("2 / 4")).toBeTruthy();
    fireEvent.click(document.querySelector(".st-slide"));
    expect(screen.getByText("3 / 4")).toBeTruthy();
  });

  it("buttons have names and disable at the ends", () => {
    render(<SlidesViewer items={ITEMS} />);
    expect(screen.getByRole("button", { name: "Previous slide" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it('status announces "Slide 2 of 4: <title>"', () => {
    render(<SlidesViewer items={ITEMS} />);
    expect(status().textContent).toBe("Slide 1 of 4: Intro");
    key("ArrowRight");
    expect(status().textContent).toBe("Slide 2 of 4: Second");
  });

  it("falls back to the body text when a slide has no title", () => {
    render(<SlidesViewer items={[{ body: "Just **text**" }]} />);
    expect(status().textContent).toBe("Slide 1 of 1: Just text");
  });

  it("renders slide body HTML as text (Review Focus 4)", () => {
    const body = '<img src=x onerror="alert(1)"><script>x</script>';
    render(<SlidesViewer items={[{ title: "T", body }]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".st-slide").textContent).toContain("<img");
  });

  it("keeps the stage and frame classes the 16:9 CSS keys on", () => {
    render(<SlidesViewer items={ITEMS} />);
    const frame = document.querySelector(".st-slides-stage > .st-slide");
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("role")).toBe("group");
    expect(frame.getAttribute("aria-roledescription")).toBe("slide");
    expect(frame.getAttribute("aria-label")).toBe("Slide 1 of 4");
  });

  it("keeps focus on the frame when moving", () => {
    render(<SlidesViewer items={ITEMS} />);
    const frame = document.querySelector(".st-slide");
    frame.focus();
    key("ArrowRight");
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(document.activeElement).toBe(document.querySelector(".st-slide"));
    expect(document.activeElement).toBe(frame);
  });

  it("a click on a link inside the slide does not advance", () => {
    render(<SlidesViewer items={[{ title: "T", body: "[go](https://example.com)" }, ...ITEMS]} />);
    const link = screen.getByRole("link", { name: "go" });
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    fireEvent.click(link);
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("a click with selected text does not advance", () => {
    render(<SlidesViewer items={ITEMS} />);
    const spy = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked" });
    fireEvent.click(document.querySelector(".st-slide"));
    spy.mockRestore();
    expect(screen.getByText("1 / 4")).toBeTruthy();
  });

  it("reduced motion turns the slide animation off", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<SlidesViewer items={ITEMS} />);
    expect(document.querySelector(".st-slide-inner").getAttribute("data-motion")).toBe("none");
  });

  it("disables Previous at the start and Next at the end", () => {
    render(<SlidesViewer items={ITEMS} />);
    const next = screen.getByRole("button", { name: "Next slide" });
    expect(next.disabled).toBe(false);
    key("PageDown"); key("PageDown"); key("PageDown");
    expect(next.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Previous slide" }).disabled).toBe(false);
  });

  it("says so when there are no slides", () => {
    render(<SlidesViewer items={[]} />);
    expect(screen.getByText("No slides.")).toBeTruthy();
  });
});
