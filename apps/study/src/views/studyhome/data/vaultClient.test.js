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

// A stand-in XMLHttpRequest: the test drives it by hand after send().
class FakeXhr {
  static last = null;
  constructor() {
    this.upload = {};
    this.aborted = false;
    FakeXhr.last = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name, value) { this.headers = { ...this.headers, [name]: value }; }
  send(body) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  reply(status, body) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}
const xhrClient = () => createVaultClient({ XMLHttpRequestImpl: FakeXhr });

it("uploads the file and reports progress", async () => {
  const progress = [];
  const blob = new Blob(["abc"]);
  const sent = xhrClient().upload("Sources/files/a b.pdf", blob, { onProgress: (loaded, total) => progress.push([loaded, total]) });
  const xhr = FakeXhr.last;
  expect(xhr.method).toBe("POST");
  expect(xhr.url).toBe("http://127.0.0.1:5057/upload?path=Sources%2Ffiles%2Fa%20b.pdf");
  expect(xhr.body).toBe(blob);
  xhr.upload.onprogress({ loaded: 1, total: 3 });
  xhr.reply(200, { path: "Sources/files/a b.pdf" });
  await expect(sent).resolves.toEqual({ path: "Sources/files/a b.pdf" });
  expect(progress).toEqual([[1, 3]]);
});

it("passes an upload refusal's message on", async () => {
  const sent = xhrClient().upload("Sources/files/a.pdf", new Blob(["x"]));
  FakeXhr.last.reply(507, { error: "Not enough space on disk (needs 12.4 GB, 3.1 GB free)" });
  await expect(sent).rejects.toThrow("Not enough space on disk");
});

it("falls back to a generic message when the refusal has no body", async () => {
  const sent = xhrClient().upload("Sources/files/a.pdf", new Blob(["x"]));
  FakeXhr.last.status = 500;
  FakeXhr.last.responseText = "";
  FakeXhr.last.onload();
  await expect(sent).rejects.toThrow("answered 500");
});

it("treats an upload network error as offline", async () => {
  const sent = xhrClient().upload("Sources/files/a.pdf", new Blob(["x"]));
  FakeXhr.last.onerror();
  await expect(sent).rejects.toBeInstanceOf(VaultOffline);
});

it("cancels an upload with an AbortError", async () => {
  const controller = new AbortController();
  const sent = xhrClient().upload("Sources/files/a.pdf", new Blob(["x"]), { signal: controller.signal });
  controller.abort();
  expect(FakeXhr.last.aborted).toBe(true);
  await expect(sent).rejects.toMatchObject({ name: "AbortError" });
});

it("does not start an upload whose signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(xhrClient().upload("Sources/files/a.pdf", new Blob(["x"]), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
});

it("checks an upload before sending it", async () => {
  const seen = [];
  const client = createVaultClient({
    fetchImpl: async (url, init) => {
      seen.push([init.method, url.replace("http://127.0.0.1:5057", "")]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await expect(client.uploadCheck("Sources/files/a b.pdf", 12)).resolves.toEqual({ ok: true });
  expect(seen).toEqual([["GET", "/upload/check?path=Sources%2Ffiles%2Fa%20b.pdf&size=12"]]);
  const refusing = createVaultClient({ fetchImpl: async () => new Response(JSON.stringify({ error: "Not enough space on disk (needs 12.4 GB, 3.1 GB free)" }), { status: 507 }) });
  await expect(refusing.uploadCheck("Sources/files/a.pdf", 1)).rejects.toThrow("Not enough space");
  const offline = createVaultClient({ fetchImpl: () => Promise.reject(new TypeError("x")) });
  await expect(offline.uploadCheck("Sources/files/a.pdf", 1)).rejects.toBeInstanceOf(VaultOffline);
});


it("authenticates XHR uploads with the current desktop session", async () => {
  globalThis.__KRATT_DESKTOP__ = { baseUrl: "http://127.0.0.1:12345", token: "fixture-token" };
  try {
    const sent = xhrClient().upload("Sources/files/x.bin", new Blob(["x"]));
    expect(FakeXhr.last.url).toBe("http://127.0.0.1:12345/upload?path=Sources%2Ffiles%2Fx.bin");
    expect(FakeXhr.last.headers.Authorization).toBe("Bearer fixture-token");
    FakeXhr.last.reply(200, { path: "Sources/files/x.bin" }); await sent;
  } finally { delete globalThis.__KRATT_DESKTOP__; }
});
it("does not mark a malformed successful upload reply as saved", async () => {
  const sent = xhrClient().upload("Sources/files/x.bin", new Blob(["x"]));
  FakeXhr.last.reply(200, {}); await expect(sent).rejects.toThrow("saved original");
});
