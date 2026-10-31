import { describe, it, expect } from "vitest";
import { BINDABLE, clashes, comboOf, keysOf, matches } from "./shortcuts";

describe("shortcuts", () => {
  it("names a key press", () => {
    expect(comboOf({ key: "Delete", ctrlKey: true })).toBe("Ctrl+Delete");
    expect(comboOf({ key: "Delete", metaKey: true, shiftKey: true })).toBe("Ctrl+Shift+Delete");
    expect(comboOf({ key: "k", ctrlKey: true })).toBe("Ctrl+K");
    expect(comboOf({ key: "H", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+H");
    // Shift is part of the character for printable keys.
    expect(comboOf({ key: "?", shiftKey: true })).toBe("?");
    expect(comboOf({ key: "Control", ctrlKey: true })).toBeNull();
  });

  it("uses the default until changed", () => {
    expect(keysOf({}, "tabs.closeHovered")).toBe("Ctrl+Delete");
    expect(keysOf({ "tabs.closeHovered": "Alt+W" }, "tabs.closeHovered")).toBe("Alt+W");
  });

  it("has copy, paste and delete for the sidebar", () => {
    expect(keysOf({}, "sidebar.copy")).toBe("Ctrl+C");
    expect(keysOf({}, "sidebar.paste")).toBe("Ctrl+V");
    expect(keysOf({}, "sidebar.delete")).toBe("Ctrl+Delete");
    expect(keysOf({ "sidebar.deleteHovered": "Ctrl+Shift+Delete" }, "sidebar.delete")).toBe("Ctrl+Shift+Delete");
    expect(clashes({}, "sidebar.copy", "Ctrl+V")).toEqual(["Paste a copy"]);
    expect(BINDABLE.some((b) => b.id === "sidebar.deleteHovered")).toBe(false);
  });

  it("ignores held-key repeats", () => {
    expect(matches({ key: "Delete", ctrlKey: true }, {}, "tabs.closeHovered")).toBe(true);
    expect(matches({ key: "Delete", ctrlKey: true, repeat: true }, {}, "tabs.closeHovered")).toBe(false);
  });

  it("reports clashes with fixed shortcuts and the same context only", () => {
    expect(clashes({}, "tabs.closeHovered", "Ctrl+K")).toEqual(["Search"]);
    expect(clashes({}, "tabs.closeHovered", "Ctrl+E")).toEqual(["Edit layout"]);
    // The sidebar's Ctrl+Delete is in another context, so it doesn't clash.
    expect(clashes({}, "tabs.closeHovered", "Ctrl+Delete")).toEqual([]);
  });
});
