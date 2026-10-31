import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
let tauri = true;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a) => invoke(...a),
  isTauri: () => tauri,
}));

import { stageFromCatalog, stageFromFile, commitStaged, discardStaged, removeFiles, canInstall, ExtensionError } from "./installer.js";

const good = { id: "acme.timer", name: "Timer", author: "Acme", description: "A timer", version: "1.0.0", permissions: [], contributes: { tools: [{ id: "t", title: "T", entry: "t.html" }] } };
const staged = (json = good, files = ["extension.json", "t.html"]) => ({ stagingId: "s1", manifestJson: JSON.stringify(json), files });
const entry = (download) => ({ id: "acme.timer", version: "1.0.0", download, sha256: "a".repeat(64) });

beforeEach(() => {
  invoke.mockReset();
  tauri = true;
});

describe("staging", () => {
  it("returns the parsed manifest for a valid package", async () => {
    invoke.mockResolvedValueOnce(staged());
    const out = await stageFromFile("/tmp/x.zip");
    expect(invoke).toHaveBeenCalledWith("ext_stage_file", { path: "/tmp/x.zip" });
    expect(out.stagingId).toBe("s1");
    expect(out.manifest.id).toBe("acme.timer");
  });

  it("discards and throws with the errors when the manifest is invalid", async () => {
    invoke.mockResolvedValueOnce(staged({ id: "Bad", name: "x" }));
    invoke.mockResolvedValueOnce(undefined);
    const err = await stageFromFile("/tmp/x.zip").catch((e) => e);
    expect(err).toBeInstanceOf(ExtensionError);
    expect(err.code).toBe("invalid");
    expect(err.errors.length).toBeGreaterThan(0);
    expect(invoke).toHaveBeenCalledWith("ext_discard", { stagingId: "s1" });
  });

  it("discards and throws for a manifest that is not JSON", async () => {
    invoke.mockResolvedValueOnce({ stagingId: "s1", manifestJson: "{nope", files: [] });
    invoke.mockResolvedValueOnce(undefined);
    await expect(stageFromFile("/x.zip")).rejects.toMatchObject({ code: "invalid" });
    expect(invoke).toHaveBeenCalledWith("ext_discard", { stagingId: "s1" });
  });

  it("checks that files named in the manifest exist", async () => {
    invoke.mockResolvedValueOnce(staged(good, ["extension.json"]));
    invoke.mockResolvedValueOnce(undefined);
    await expect(stageFromFile("/x.zip")).rejects.toMatchObject({ code: "invalid" });
  });

  it("wraps a Rust error string", async () => {
    invoke.mockRejectedValueOnce("Archive is too large");
    const err = await stageFromFile("/x.zip").catch((e) => e);
    expect(err).toBeInstanceOf(ExtensionError);
    expect(err.message).toBe("Archive is too large");
  });
});

describe("stageFromCatalog source policy (R6)", () => {
  it("passes https downloads whatever the catalog url", async () => {
    invoke.mockResolvedValueOnce(staged());
    await stageFromCatalog(entry("https://example.com/t.zip"), { catalogUrl: "https://example.com/catalog.json" });
    expect(invoke).toHaveBeenCalledWith("ext_stage_download", { url: "https://example.com/t.zip", sha256: "a".repeat(64) });
  });

  it("passes a file:// download when the catalog itself is a file:// url", async () => {
    invoke.mockResolvedValueOnce(staged());
    await stageFromCatalog(entry("file:///tmp/t.zip"), { catalogUrl: "file:///tmp/catalog.json" });
    expect(invoke).toHaveBeenCalledWith("ext_stage_download", { url: "file:///tmp/t.zip", sha256: "a".repeat(64) });
  });

  it("refuses a file:// download from a remote catalog without calling invoke", async () => {
    const err = await stageFromCatalog(entry("file:///etc/passwd"), { catalogUrl: "https://example.com/catalog.json" }).catch((e) => e);
    expect(err).toBeInstanceOf(ExtensionError);
    expect(err.code).toBe("source");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a file:// download when no catalog url is known", async () => {
    await expect(stageFromCatalog(entry("file:///tmp/t.zip"))).rejects.toMatchObject({ code: "source" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("other commands", () => {
  it("commit, discard and remove map to the Rust commands", async () => {
    invoke.mockResolvedValue(undefined);
    await commitStaged({ stagingId: "s1", manifest: good });
    expect(invoke).toHaveBeenCalledWith("ext_commit", { stagingId: "s1", id: "acme.timer", version: "1.0.0" });
    await discardStaged({ stagingId: "s1" });
    expect(invoke).toHaveBeenCalledWith("ext_discard", { stagingId: "s1" });
    await removeFiles("acme.timer");
    expect(invoke).toHaveBeenCalledWith("ext_remove", { id: "acme.timer", version: null });
    await removeFiles("acme.timer", "1.0.0");
    expect(invoke).toHaveBeenCalledWith("ext_remove", { id: "acme.timer", version: "1.0.0" });
  });

  it("canInstall follows isTauri, and removeFiles is a no-op outside Tauri", async () => {
    tauri = false;
    expect(canInstall()).toBe(false);
    await removeFiles("acme.timer");
    expect(invoke).not.toHaveBeenCalled();
    tauri = true;
    expect(canInstall()).toBe(true);
  });
});
