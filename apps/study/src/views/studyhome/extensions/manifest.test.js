import { describe, it, expect } from "vitest";
import { validateManifest, validateTheme, kindsOf } from "./manifest.js";
import { COLOR_ROLES } from "../theme/legacyPalettes.js";

const hex = "#112233";
const theme = () => ({
  id: "nord", name: "Nord", base: "deep",
  colors: Object.fromEntries(COLOR_ROLES.map((r) => [r.key, hex])),
  accent: "#4c90f0", glow: null, subjects: Array(8).fill(hex),
});
const good = () => ({
  id: "study.flashcards", name: "Flashcards", version: "1.2.0", author: "Study team",
  description: "Turn any page into flashcards.", icon: "icon.png", minAppVersion: "1.0.0",
  permissions: ["pages.read", "mastery.write"],
  contributes: {
    widgets: [{ id: "w", title: "W", description: "d", entry: "widget.html", sizes: ["small", "medium"] }],
    blocks: [{ id: "deck", title: "Flashcard deck", icon: "deck.svg", entry: "block.html", slash: "flashcards" }],
    tools: [{ id: "t", title: "T", icon: "icon.png", entry: "tool.html" }],
    themes: [theme()],
    commands: [{ id: "review", title: "Review due cards", keywords: ["flashcards"], entry: "command.html" }],
  },
});
const opts = { appVersion: "1.3.3" };
const errorsOf = (m, o = opts) => {
  const r = validateManifest(m, o);
  return r.ok ? [] : r.errors;
};

describe("validateManifest", () => {
  it("accepts a good manifest", () => {
    const r = validateManifest(good(), opts);
    expect(r.ok).toBe(true);
    expect(kindsOf(r.manifest).sort()).toEqual(["block", "command", "theme", "tool", "widget"]);
  });
  it("fills empty contributes arrays", () => {
    const m = good();
    m.contributes = { commands: m.contributes.commands };
    const r = validateManifest(m, opts);
    expect(r.manifest.contributes.widgets).toEqual([]);
  });
  it("rejects non-objects", () => {
    expect(validateManifest(null, opts).ok).toBe(false);
  });
  it("rejects bad fields with plain messages", () => {
    let m = good(); delete m.name;
    expect(errorsOf(m)).toContain("Missing name");
    m = good(); m.id = "Flashcards";
    expect(errorsOf(m)).toContain("Id must look like author.name (lowercase)");
    m = good(); m.version = "1.2";
    expect(errorsOf(m)).toContain("Version must look like 1.2.0");
    m = good(); m.permissions = ["files.write"];
    expect(errorsOf(m)).toContain("Unknown permission: files.write");
    m = good(); m.permissions = ["network:*.evil.com"];
    expect(errorsOf(m)).toContain("Network permission needs a plain host name: *.evil.com");
    m = good(); m.contributes = {};
    expect(errorsOf(m)).toContain("Adds nothing: list at least one widget, block, tool, theme or command");
    m = good(); m.contributes.tools[0].id = "deck";
    expect(errorsOf(m)).toContain("Duplicate id: deck");
    m = good(); m.contributes.blocks[0].entry = "../x.html";
    expect(errorsOf(m)).toContain("Bad path: ../x.html");
    m = good(); m.minAppVersion = "99.0.0";
    expect(errorsOf(m)).toContain("Needs a newer version of the app");
    m = good(); m.description = "x".repeat(301);
    expect(errorsOf(m)).toContain("Description is too long (300 characters max)");
  });
  it("checks files when given", () => {
    const files = new Set(["icon.png", "deck.svg", "widget.html", "tool.html", "command.html"]);
    expect(errorsOf(good(), { ...opts, files })).toContain("File not found in the extension: block.html");
    files.add("block.html");
    expect(validateManifest(good(), { ...opts, files }).ok).toBe(true);
  });
  it("accepts a valid network permission", () => {
    const m = good(); m.permissions = ["network:api.example.com"];
    expect(validateManifest(m, opts).ok).toBe(true);
  });
});

describe("validateTheme", () => {
  it("accepts a good theme", () => expect(validateTheme(theme())).toEqual([]));
  it("reports problems", () => {
    let t = theme(); delete t.colors.text;
    expect(validateTheme(t)).toContain("Theme Nord is missing the Text color");
    t = theme(); t.accent = "blue";
    expect(validateTheme(t)).toContain("Theme Nord: accent must be a #rrggbb color");
    t = theme(); t.subjects = Array(7).fill(hex);
    expect(validateTheme(t)).toContain("Theme Nord needs exactly 8 subject colors");
  });
});

describe("hostile input", () => {
  const withPerm = (p) => { const m = good(); m.permissions = [p]; return errorsOf(m); };
  it("rejects bad hosts", () => {
    for (const host of ["api.x.com:8080", "api.x.com/path", "user@api.x.com", "API.Example.com", "a".repeat(64) + ".com", Array(60).fill("abcd").join(".") + ".com"]) {
      expect(withPerm(`network:${host}`)).toContain(`Network permission needs a plain host name: ${host}`);
    }
  });
  it("rejects bad paths", () => {
    for (const p of ["/abs.html", "a\\b.html", "./x", "a/./b", "%2e%2e/x", "a/../b", "https:evil.com", "data:text/html,x", "a?b", "a#b", "a\u0000b", "a\nb", "", "a//b"]) {
      const m = good(); m.contributes.blocks[0].entry = p;
      expect(errorsOf(m)).toContain(`Bad path: ${p}`);
    }
  });
  it("rejects wrong types without throwing", () => {
    let m = good(); m.permissions = {};
    expect(validateManifest(m, opts).ok).toBe(false);
    m = good(); m.permissions = [1];
    expect(errorsOf(m)).toContain("Unknown permission: 1");
  });
  it("reports a bad icon", () => {
    const m = good(); m.icon = "../icon.png";
    expect(errorsOf(m)).toContain("Bad path: ../icon.png");
  });
  it("reports a bad theme through validateManifest", () => {
    const m = good(); m.contributes.themes[0].subjects = Array(7).fill(hex);
    expect(errorsOf(m)).toContain("Theme Nord needs exactly 8 subject colors");
  });
});
