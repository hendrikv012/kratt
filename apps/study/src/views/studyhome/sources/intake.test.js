import { describe, it, expect } from "vitest";
import { intakeFrom, dedupe, MAX_FILE_BYTES } from "./intake";

const file = (name, size = 10) => ({ name, size });
const fileEntry = (f) => ({ isFile: true, isDirectory: false, name: f.name, file: (ok) => ok(f) });
// readEntries hands back `batch` entries per call, then an empty array.
const dirEntry = (name, children, batch = 100) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader() {
    let i = 0;
    return {
      readEntries(ok) {
        const out = children.slice(i, i + batch);
        i += batch;
        ok(out);
      },
    };
  },
});
const item = (entry) => ({ kind: "file", webkitGetAsEntry: () => entry });
const transfer = (entries, data = {}) => ({
  items: entries.map(item),
  files: [],
  getData: (t) => data[t] ?? "",
});

describe("intakeFrom", () => {
  it("walks nested folders into relative paths", async () => {
    const tree = dirEntry("Napoleon", [
      fileEntry(file("a.pdf")),
      dirEntry("maps", [fileEntry(file("m1.png"))]),
    ]);
    const r = await intakeFrom(transfer([tree]));
    expect(r.files.map((f) => f.relPath).sort()).toEqual(["Napoleon/a.pdf", "Napoleon/maps/m1.png"]);
  });

  it("reads every batch of a large directory", async () => {
    const kids = Array.from({ length: 250 }, (_, i) => fileEntry(file(`f${i}.txt`)));
    const r = await intakeFrom(transfer([dirEntry("big", kids)]));
    expect(r.files).toHaveLength(250);
  });

  it("skips hidden files and OS junk", async () => {
    const tree = dirEntry("d", [
      fileEntry(file(".DS_Store")),
      fileEntry(file("Thumbs.db")),
      fileEntry(file("desktop.ini")),
      fileEntry(file("ok.txt")),
    ]);
    const r = await intakeFrom(transfer([tree]));
    expect(r.files.map((f) => f.relPath)).toEqual(["d/ok.txt"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["hidden", "hidden", "hidden"]);
  });

  it("skips files over 50 GB as too large", async () => {
    const r = await intakeFrom(transfer([fileEntry(file("huge.mov", 51 * 1024 ** 3))]));
    expect(r.files).toEqual([]);
    expect(r.skipped).toEqual([{ name: "huge.mov", reason: "too large" }]);
    expect(MAX_FILE_BYTES).toBe(50 * 1000 ** 3);
  });

  it("reads links from text/uri-list, ignoring comments", async () => {
    const r = await intakeFrom(
      transfer([], { "text/uri-list": "# a comment\nhttps://a.com/x\nhttp://b.org\n" })
    );
    expect(r.links).toEqual(["https://a.com/x", "http://b.org"]);
  });

  it("reads http lines from plain text, ignoring sentences", async () => {
    const r = await intakeFrom(
      transfer([], { "text/plain": "Look at this:\nhttps://a.com\nand this https://nope.com\nhttps://b.com" })
    );
    expect(r.links).toEqual(["https://a.com", "https://b.com"]);
    const none = await intakeFrom(transfer([], { "text/plain": "just a sentence" }));
    expect(none.links).toEqual([]);
  });

  it("falls back to transfer.files without entries", async () => {
    const f = file("x.pdf");
    const r = await intakeFrom({ files: [f], getData: () => "" });
    expect(r.files).toEqual([{ file: f, relPath: "x.pdf" }]);
  });
});

describe("intakeFrom robustness", () => {
  it("keeps links when entries resolve asynchronously", async () => {
    let live = true;
    const slow = {
      isFile: true,
      name: "a.pdf",
      file: (ok) => setTimeout(() => ok(file("a.pdf")), 5),
    };
    const t = {
      items: [item(slow)],
      files: [],
      getData: (type) => (live && type === "text/uri-list" ? "https://a.com" : ""),
    };
    const p = intakeFrom(t);
    live = false; // the event has ended once the handler yields
    const r = await p;
    expect(r.links).toEqual(["https://a.com"]);
    expect(r.files).toHaveLength(1);
  });

  it("merges files whose item had no entry", async () => {
    const a = file("a.pdf"), b = file("b.pdf");
    const t = {
      items: [item(fileEntry(a)), { kind: "file", webkitGetAsEntry: () => null }],
      files: [a, b],
      getData: () => "",
    };
    const r = await intakeFrom(t);
    expect(r.files.map((f) => f.relPath).sort()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("reports an unreadable directory and keeps the rest", async () => {
    const bad = {
      isFile: false, isDirectory: true, name: "bad", fullPath: "/bad",
      createReader: () => ({ readEntries: (ok, err) => err(new Error("x")) }),
    };
    const r = await intakeFrom(transfer([bad, fileEntry(file("ok.txt"))]));
    expect(r.files.map((f) => f.relPath)).toEqual(["ok.txt"]);
    expect(r.skipped).toEqual([{ name: "/bad", reason: "unreadable" }]);
  });

  it("reports a file that fails to open", async () => {
    const bad = { isFile: true, name: "x.txt", file: (ok, err) => err(new Error("x")) };
    const r = await intakeFrom(transfer([bad, fileEntry(file("ok.txt"))]));
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toEqual([{ name: "x.txt", reason: "unreadable" }]);
  });
});

describe("dedupe", () => {
  const state = {
    sources: [
      { id: "s1", type: "link", url: "https://a.com" },
      { id: "s2", type: "file", fileName: "a.pdf", fileSize: 10 },
    ],
  };
  it("finds url and name+size matches", () => {
    const r = dedupe(state, {
      files: [{ file: file("a.pdf", 10), relPath: "a.pdf" }, { file: file("a.pdf", 11), relPath: "a.pdf" }],
      links: ["https://a.com", "https://new.com"],
    });
    expect(r.existing.sort()).toEqual(["s1", "s2"]);
    expect(r.files).toHaveLength(1);
    expect(r.links).toEqual(["https://new.com"]);
  });
});

it("deduplicates files and links within one drop", () => {
  const f = file("same.png");
  const result = dedupe({ sources: [] }, { files: [{ file: f }, { file: f }], links: ["https://example.com", "https://example.com"] });
  expect(result.files).toHaveLength(1); expect(result.links).toHaveLength(1);
});
it("preserves picked folder paths and skips hidden ancestor folders", async () => {
  const result = await intakeFrom({ files: [{ ...file("a.txt"), webkitRelativePath: "Folder/nested/a.txt" }, { ...file("b.txt"), webkitRelativePath: "Folder/.git/b.txt" }] });
  expect(result.files.map((f) => f.relPath)).toEqual(["Folder/nested/a.txt"]);
  expect(result.skipped).toEqual([{ name: "b.txt", reason: "hidden" }]);
});

it("does not add a directory placeholder or lose a loose file with the same name", async () => {
  const directory = dirEntry("same", [fileEntry(file("inside.png"))]);
  const loose = file("same", 20);
  const result = await intakeFrom({ items: [{ ...item(directory), getAsFile: () => file("same", 0) }, { kind: "file", getAsFile: () => ({ ...loose }) }], files: [file("same", 0), loose] });
  expect(result.files.map((f) => f.relPath)).toEqual(["same/inside.png", "same"]);
});
it("keeps earlier batches if a later directory read fails", async () => {
  let first = true;
  const directory = { isDirectory: true, name: "partial", createReader: () => ({ readEntries(ok, fail) { if (first) { first = false; ok([fileEntry(file("kept.txt"))]); } else fail(new Error("denied")); } }) };
  const result = await intakeFrom(transfer([directory]));
  expect(result.files.map((f) => f.relPath)).toEqual(["partial/kept.txt"]);
  expect(result.skipped[0].reason).toBe("unreadable");
});
