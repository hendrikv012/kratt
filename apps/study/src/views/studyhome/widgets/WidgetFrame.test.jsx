import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { registerWidget } from "./registry";
import WidgetFrame from "./WidgetFrame";
import "./builtin";

const ext = { kind: "extension", id: "t", name: "T" };
const Boom = () => { throw new Error("boom"); };
const offs = [];
const spies = [];
const reg = (id, title, Component) => {
  const off = registerWidget(id, { title, source: ext, lanes: "any", size: "m", Component });
  offs.push(off);
  return off;
};
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  spies.splice(0).forEach((s) => s.mockRestore());
});

describe("WidgetFrame", () => {
  it("without onMenu it is just the card: no handle, no menu", () => {
    render(<WidgetFrame id="deadlines" size="2x1" />);
    const card = screen.getByRole("region", { name: "Deadlines and exams" });
    expect(within(card).queryByRole("button", { name: "Widget options" })).toBeNull();
    expect(card.querySelector("[tabindex]")).toBeNull();
  });
  it("a crashing widget shows a message and the rest keeps working", () => {
    spies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
    reg("ext:t/boom", "Boom", Boom);
    reg("ext:t/ok", "Fine", () => <p>all good</p>);
    render(<><WidgetFrame id="ext:t/boom" lane="left" size="m" onMenu={() => {}} /><WidgetFrame id="ext:t/ok" lane="left" size="m" onMenu={() => {}} /></>);
    expect(screen.getByText("This widget stopped working")).toBeTruthy();
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("the error boundary resets when the widget id changes", () => {
    spies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
    reg("ext:t/boom", "Boom", Boom);
    reg("ext:t/ok", "Fine", () => <p>all good</p>);
    const { rerender } = render(<WidgetFrame id="ext:t/boom" lane="left" size="m" onMenu={() => {}} />);
    expect(screen.getByText("This widget stopped working")).toBeTruthy();
    rerender(<WidgetFrame id="ext:t/ok" lane="left" size="m" onMenu={() => {}} />);
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("the chevron opens the menu", async () => {
    const onMenu = vi.fn();
    render(<WidgetFrame id="deadlines" lane="left" size="m" onMenu={onMenu} />);
    const chevron = screen.getByRole("button", { name: "Widget options" });
    fireEvent.pointerDown(chevron, { button: 0, ctrlKey: false });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Move to")).toBeTruthy();
    expect(within(menu).getByText("Size")).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove" }));
    expect(onMenu).toHaveBeenCalledWith({ type: "remove" });
  });

  it("Enter on the header opens the menu", async () => {
    render(<WidgetFrame id="deadlines" lane="left" size="m" onMenu={() => {}} />);
    const header = screen.getByRole("heading", { name: "Deadlines and exams" }).parentElement;
    expect(header.getAttribute("tabindex")).toBe("0");
    header.focus();
    fireEvent.keyDown(header, { key: "Enter" });
    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("an empty widget keeps its place with a short message", () => {
    render(<WidgetFrame id="deadlines" lane="right" size="s" onMenu={() => {}} />);
    expect(screen.getByRole("region", { name: "Deadlines and exams" })).toBeTruthy();
    expect(screen.getByText("No deadlines yet.")).toBeTruthy();
  });

  it("a widget that is not installed shows the missing message", () => {
    render(<WidgetFrame id="ext:gone/w" lane="left" size="m" onMenu={() => {}} />);
    expect(screen.getByText("Missing widget")).toBeTruthy();
    expect(screen.getByText(/isn't installed/)).toBeTruthy();
  });

  it("the chevron is a plain button reachable by Tab, hidden at rest by CSS opacity", () => {
    render(<WidgetFrame id="deadlines" lane="left" size="m" onMenu={() => {}} />);
    const chevron = screen.getByRole("button", { name: "Widget options" });
    expect(chevron.className).toContain("st-wf-chevron");
    expect(chevron.getAttribute("tabindex")).not.toBe("-1");
  });

  it("the legend lists every mastery level", () => {
    render(<WidgetFrame id="legend" lane="bottom" size="l" onMenu={() => {}} />);
    const legend = screen.getByRole("group", { name: "Legend" });
    ["Known well", "Shaky", "Weak", "Not learned yet"].forEach((w) => expect(within(legend).getByText(w)).toBeTruthy());
  });

  it("a bare widget is its own drag handle", () => {
    const { container } = render(<WidgetFrame id="legend" lane="bottom" size="l" onMenu={() => {}} handleProps={{ "data-h": "1" }} />);
    const root = container.firstChild;
    expect(root.getAttribute("tabindex")).toBe("0");
    expect(root.getAttribute("data-h")).toBe("1");
  });
});
