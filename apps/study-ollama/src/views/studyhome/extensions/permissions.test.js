import { describe, it, expect } from "vitest";
import {
  PERMISSIONS, permissionLabel, isKnownPermission, METHOD_PERMISSIONS, requiredPermission, addedPermissions,
} from "./permissions.js";
import { compareVersions } from "./semver.js";

describe("permissions", () => {
  it("labels permissions", () => {
    expect(permissionLabel("pages.read")).toBe(PERMISSIONS["pages.read"]);
    expect(permissionLabel("network:api.example.com")).toBe("Connect to api.example.com");
  });
  it("knows permissions", () => {
    expect(isKnownPermission("ai")).toBe(true);
    expect(isKnownPermission("network:a.com")).toBe(true);
    expect(isKnownPermission("files.write")).toBe(false);
  });
  it("maps methods to permissions", () => {
    expect(METHOD_PERMISSIONS["ai.ask"]).toBe("ai");
    expect(requiredPermission("fetch", { url: "https://api.example.com/x" })).toBe("network:api.example.com");
    expect(requiredPermission("storage.get")).toBe(null);
    expect(requiredPermission("fs.read")).toBeUndefined();
    expect(requiredPermission("pages.list")).toBe("pages.read");
  });
  it("finds added permissions", () => {
    expect(addedPermissions(["a"], ["a", "b"])).toEqual(["b"]);
  });
  it("compares versions", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
  });
});
