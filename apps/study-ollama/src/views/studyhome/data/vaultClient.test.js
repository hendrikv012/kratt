import { expect, it } from "vitest";
import { createVaultClient, VaultOffline } from "./vaultClient";

it("reports a missing service as offline", async () => {
  const client = createVaultClient({ fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
  await expect(client.snapshot()).rejects.toBeInstanceOf(VaultOffline);
});

it("passes the service's error message on", async () => {
  const client = createVaultClient({ fetchImpl: async () => new Response(JSON.stringify({ error: "x.md is not a path in the Study folder" }), { status: 400 }) });
  await expect(client.read("../x.md")).rejects.toThrow("is not a path in the Study folder");
});

it("reaches Open Notebook through the service's bridge", async () => {
  const seen = [];
  const client = createVaultClient({
    fetchImpl: async (url, init) => {
      seen.push([init.method, url.replace("http://127.0.0.1:5057", ""), init.body && JSON.parse(init.body)]);
      return new Response(JSON.stringify({ output: "4" }), { status: 200 });
    },
  });
  await expect(client.notebookAsk("http://localhost:5055", "2+2?")).resolves.toEqual({ output: "4" });
  await client.notebookStatus("http://localhost:5055/x y");
  await client.hasNotebookPassword();
  await client.setNotebookPassword("s3cret");
  await client.setNotebookPassword("");
  expect(seen).toEqual([
    ["POST", "/notebook/ask", { base_url: "http://localhost:5055", prompt: "2+2?" }],
    ["GET", "/notebook/status?base_url=http%3A%2F%2Flocalhost%3A5055%2Fx%20y", undefined],
    ["GET", "/setting/notebook-password", undefined],
    ["PUT", "/setting/notebook-password", { password: "s3cret" }],
    ["PUT", "/setting/notebook-password", { password: null }],
  ]);
});
