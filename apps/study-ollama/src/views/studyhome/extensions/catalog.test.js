import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
let tauri = true;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a) => invoke(...a),
  isTauri: () => tauri,
}));

import { parseCatalog, loadCatalog, updateFor } from "./catalog.js";

const HASH = "a".repeat(64);
const good = (over = {}) => ({
  id: "acme.timer",
  name: "Timer",
  version: "1.0.0",
  download: "https://example.com/timer.zip",
  sha256: HASH,
  ...over,
});
const text = (extensions) => JSON.stringify({ version: 1, extensions });

beforeEach(() => {
  invoke.mockReset();
  tauri = true;
  vi.unstubAllGlobals();
  // The global test setup stubs localStorage with no-ops; use a real in-memory one.
  const store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

describe("parseCatalog", () => {
  it("parses a good catalog", () => {
    const r = parseCatalog(text([good(), good({ id: "acme.other", download: "file:///tmp/o.zip" })]));
    expect(r.entries).toHaveLength(2);
    expect(r.skipped).toBe(0);
    expect(r.entries[0].id).toBe("acme.timer");
  });

  it("skips malformed entries and lists the rest", () => {
    const noHash = good({ id: "acme.nohash" });
    delete noHash.sha256;
    const r = parseCatalog(
      text([good(), good({ id: "acme.two" }), noHash, good({ id: "acme.badver", version: "x" })]),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["acme.timer", "acme.two"]);
    expect(r.skipped).toBe(2);
  });

  it("skips bad ids, bad download schemes, non-objects", () => {
    const r = parseCatalog(
      text([
        good({ id: "Bad Id" }),
        good({ download: "http://example.com/a.zip" }),
        good({ sha256: "zz" }),
        null,
        "str",
      ]),
    );
    expect(r.entries).toEqual([]);
    expect(r.skipped).toBe(5);
  });

  it("reports bad JSON", () => {
    expect(parseCatalog("{nope")).toEqual({ entries: [], skipped: 0, error: "bad-json" });
  });

  it("treats a wrong shape as bad JSON", () => {
    expect(parseCatalog(JSON.stringify({ version: 1 })).error).toBe("bad-json");
  });
});

describe("parseCatalog field validation", () => {
  it("skips and counts entries with bad optional fields", () => {
    const r = parseCatalog(
      text([
        good({ id: "a.one", permissions: null }),
        good({ id: "a.two", permissions: "ai" }),
        good({ id: "a.three", permissions: [1] }),
        good({ id: "a.four", description: 5 }),
        good({ id: "a.five", author: {} }),
        good({ id: "a.six", icon: 3 }),
        good({ id: "a.seven", kinds: "widget" }),
        good({ id: "a.eight", kinds: [1] }),
        good({ id: "a.ok", permissions: ["ai"], description: "d", author: "me", icon: "x", kinds: ["widget"] }),
      ]),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["a.ok"]);
    expect(r.skipped).toBe(8);
  });

  it("normalises absent permissions to []", () => {
    expect(parseCatalog(text([good()])).entries[0].permissions).toEqual([]);
  });
});

describe("loadCatalog in a browser", () => {
  beforeEach(() => {
    tauri = false;
  });

  it("fetches https urls with fetch and caches", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => text([good()]) });
    vi.stubGlobal("fetch", f);
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(f).toHaveBeenCalledWith("https://example.com/catalog.json");
    expect(invoke).not.toHaveBeenCalled();
    expect(r.offline).toBe(false);
    expect(r.entries).toHaveLength(1);
    expect(localStorage.getItem("study-extensions-catalog-cache-v1")).toBeTruthy();
  });

  it("falls back to the cache when fetch fails or is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, text: async () => text([good()]) }));
    await loadCatalog("https://example.com/catalog.json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "" }));
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(r.offline).toBe(true);
    expect(r.entries).toHaveLength(1);
  });

  it("does not fetch non-https urls", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const url of ["http://example.com/c.json", "file:///tmp/c.json"]) {
      const r = await loadCatalog(url);
      expect(r).toMatchObject({ entries: [], offline: true });
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe("loadCatalog", () => {
  it("returns empty for an empty url without calling invoke", async () => {
    const r = await loadCatalog("");
    expect(r).toEqual({ entries: [], offline: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches, parses and caches", async () => {
    invoke.mockResolvedValue(text([good()]));
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(invoke).toHaveBeenCalledWith("ext_fetch_text", { url: "https://example.com/catalog.json" });
    expect(r.offline).toBe(false);
    expect(r.entries).toHaveLength(1);
    expect(typeof r.fetchedAt).toBe("number");
    expect(localStorage.getItem("study-extensions-catalog-cache-v1")).toBeTruthy();
  });

  it("falls back to the cache with offline: true when invoke rejects", async () => {
    invoke.mockResolvedValueOnce(text([good()]));
    await loadCatalog("https://example.com/catalog.json");
    invoke.mockRejectedValueOnce("network");
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(r.offline).toBe(true);
    expect(r.entries).toHaveLength(1);
  });

  it("returns empty offline when there is no cache", async () => {
    invoke.mockRejectedValueOnce("network");
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(r.offline).toBe(true);
    expect(r.entries).toEqual([]);
  });

  it("does not overwrite a good cache with unparseable text", async () => {
    invoke.mockResolvedValueOnce(text([good()]));
    await loadCatalog("https://example.com/catalog.json");
    invoke.mockResolvedValueOnce("<html>captive portal</html>");
    const r = await loadCatalog("https://example.com/catalog.json");
    expect(r.offline).toBe(true);
    expect(r.entries).toHaveLength(1);
  });
});

describe("updateFor", () => {
  const rec = { id: "acme.timer", version: "1.0.0", source: "catalog", granted: [] };
  it("is null for a file source", () => {
    expect(updateFor({ ...rec, source: "file" }, good({ version: "2.0.0" }))).toBeNull();
  });
  it("is null for the same version", () => {
    expect(updateFor(rec, good())).toBeNull();
  });
  it("reports a newer version with added permissions", () => {
    expect(updateFor({ ...rec, granted: ["notes"] }, good({ version: "1.1.0", permissions: ["notes", "ai"] }))).toEqual({
      version: "1.1.0",
      needs: ["ai"],
    });
  });
  it("tolerates a missing permissions list", () => {
    expect(updateFor(rec, good({ version: "1.0.1" }))).toEqual({ version: "1.0.1", needs: [] });
  });
});
