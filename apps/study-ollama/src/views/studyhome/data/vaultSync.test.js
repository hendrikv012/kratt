import { expect, it, vi } from "vitest";
import { memoryStorage } from "./testing/fakeVault";
import { VaultOffline } from "./vaultClient";
import { createVaultSync } from "./vaultSync";

it("collapses quick page writes and retries with growing waits", async () => {
  vi.useFakeTimers();
  const calls = [];
  const client = { write: vi.fn(async (args) => { calls.push(Date.now()); if (calls.length < 3) throw new VaultOffline(); return { path: args.path, version: "v", clash: null }; }) };
  const sync = createVaultSync({ client, storage: memoryStorage(), onResult() {}, onStatus() {} });
  sync.push([{ op: "write", id: "p1", path: "a.md", text: "1" }]);
  sync.push([{ op: "write", id: "p1", path: "a.md", text: "2" }]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.write).toHaveBeenCalledTimes(3);
  expect(client.write.mock.calls.at(-1)[0].text).toBe("2");
  expect(calls[1] - calls[0]).toBe(1000);
  expect(calls[2] - calls[1]).toBe(2000);
});

it("runs each operation with the paths it was planned with, and follows a name the service chose", async () => {
  vi.useFakeTimers();
  const client = {
    mkdir: vi.fn(async () => ({ path: "Biology (2)" })), // a "Biology" appeared on disk meanwhile
    write: vi.fn(async ({ path }) => ({ path, version: "v1", clash: null })),
    move: vi.fn(async (from, to) => ({ path: to })),
  };
  const results = [];
  const sync = createVaultSync({ client, storage: memoryStorage(), onResult: (op, answer, moved) => results.push(moved), onStatus() {} });
  sync.push([
    { op: "mkdir", id: "s1", path: "Biology" },
    { op: "write", id: "p1", path: "Biology/Cells.md", text: "x", create: true },
    { op: "move", id: "p1", from: "Biology/Cells.md", to: "Biology/Cell parts.md" },
  ]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(client.write.mock.calls[0][0].path).toBe("Biology (2)/Cells.md");
  expect(client.move).toHaveBeenCalledWith("Biology (2)/Cells.md", "Biology (2)/Cell parts.md");
  expect(results[0]).toEqual({ from: "Biology", to: "Biology (2)" });
  vi.useRealTimers();
});
