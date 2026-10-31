import { describe, it, expect } from "vitest";
import { install, setEnabled, setGranted, setToolHidden, setPendingUpdate, recordFailure, shouldSuggestDisable, remove } from "./records.js";
import { updateFor } from "./catalog.js";

const manifest = (version = "1.0.0", over = {}) => ({ id: "acme.timer", name: "Timer", version, permissions: [], contributes: {}, ...over });
const MIN = 60 * 1000;

describe("records", () => {
  it("keeps grants through disable and re-enable", () => {
    let r = install({}, { manifest: manifest(), source: "catalog", granted: ["notifications"] });
    r = setEnabled(r, "acme.timer", false);
    expect(r["acme.timer"].enabled).toBe(false);
    r = setEnabled(r, "acme.timer", true);
    expect(r["acme.timer"]).toMatchObject({ enabled: true, granted: ["notifications"] });
  });

  it("starts enabled with empty defaults", () => {
    const rec = install({}, { manifest: manifest(), source: "file", granted: [] })["acme.timer"];
    expect(rec).toMatchObject({ id: "acme.timer", version: "1.0.0", enabled: true, hiddenTools: [], pendingUpdate: null, previousVersion: null, failures: [] });
  });

  it("reinstalling a newer version sets previousVersion and keeps hiddenTools", () => {
    let r = install({}, { manifest: manifest("1.0.0"), source: "catalog", granted: [] });
    r = setToolHidden(r, "acme.timer", "t1", true);
    r = setEnabled(r, "acme.timer", false);
    r = install(r, { manifest: manifest("1.1.0"), source: "catalog", granted: ["notifications"] });
    expect(r["acme.timer"]).toMatchObject({ version: "1.1.0", previousVersion: "1.0.0", hiddenTools: ["t1"], enabled: false, granted: ["notifications"] });
  });

  it("clears the pending update and failures when replacing", () => {
    let r = install({}, { manifest: manifest(), source: "catalog", granted: [] });
    r = setPendingUpdate(r, "acme.timer", { version: "1.1.0", stagingId: "s", manifest: manifest("1.1.0"), needs: ["x"] });
    r = recordFailure(r, "acme.timer", 1000);
    r = install(r, { manifest: manifest("1.1.0"), source: "catalog", granted: [] });
    expect(r["acme.timer"].pendingUpdate).toBeNull();
    expect(r["acme.timer"].failures).toEqual([]);
  });

  it("setGranted adds and removes without duplicates", () => {
    let r = install({}, { manifest: manifest(), source: "file", granted: [] });
    r = setGranted(r, "acme.timer", "network:a.com", true);
    r = setGranted(r, "acme.timer", "network:a.com", true);
    expect(r["acme.timer"].granted).toEqual(["network:a.com"]);
    r = setGranted(r, "acme.timer", "network:a.com", false);
    expect(r["acme.timer"].granted).toEqual([]);
  });

  it("toggles hidden tools", () => {
    let r = install({}, { manifest: manifest(), source: "file", granted: [] });
    r = setToolHidden(r, "acme.timer", "t", true);
    r = setToolHidden(r, "acme.timer", "t", false);
    expect(r["acme.timer"].hiddenTools).toEqual([]);
  });

  it("ignores unknown ids and does not mutate", () => {
    const r = install({}, { manifest: manifest(), source: "file", granted: [] });
    const frozen = JSON.stringify(r);
    expect(setEnabled(r, "nope.x", false)).toBe(r);
    setEnabled(r, "acme.timer", false);
    expect(JSON.stringify(r)).toBe(frozen);
  });

  it("counts 3 failures within 5 minutes as a suggestion", () => {
    let r = install({}, { manifest: manifest(), source: "file", granted: [] });
    const t0 = 10 * MIN;
    for (const t of [t0, t0 + MIN, t0 + 2 * MIN]) r = recordFailure(r, "acme.timer", t);
    expect(shouldSuggestDisable(r["acme.timer"], t0 + 2 * MIN)).toBe(true);
  });

  it("does not suggest for 3 failures spread over 6 minutes", () => {
    let r = install({}, { manifest: manifest(), source: "file", granted: [] });
    const t0 = 10 * MIN;
    for (const t of [t0, t0 + 3 * MIN, t0 + 6 * MIN]) r = recordFailure(r, "acme.timer", t);
    expect(r["acme.timer"].failures).toEqual([t0 + 3 * MIN, t0 + 6 * MIN]);
    expect(shouldSuggestDisable(r["acme.timer"], t0 + 6 * MIN)).toBe(false);
  });

  it("removes a record", () => {
    let r = install({}, { manifest: manifest(), source: "file", granted: [] });
    r = remove(r, "acme.timer");
    expect(r).toEqual({});
  });

  it("a file install over a catalog record becomes source file, so updateFor is null", () => {
    let r = install({}, { manifest: manifest("1.0.0"), source: "catalog", granted: [] });
    const entry = { id: "acme.timer", version: "2.0.0", permissions: [] };
    expect(updateFor(r["acme.timer"], entry)).not.toBeNull();
    r = install(r, { manifest: manifest("1.0.1"), source: "file", granted: [] });
    expect(r["acme.timer"].source).toBe("file");
    expect(updateFor(r["acme.timer"], entry)).toBeNull();
  });
});
