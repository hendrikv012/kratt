import { describe, it, test, expect, vi, afterEach } from "vitest";
import { createHost, HostError, ERROR_CODES, MESSAGE_LIMIT, RATE_LIMIT, STORAGE_LIMIT, BLOCK_DATA_LIMIT } from "./host.js";
import { METHOD_PERMISSIONS } from "./permissions.js";

// Storage kept in memory, the way the real service keeps it in localStorage.
function memoryStorage() {
  let data = {};
  return {
    read: vi.fn(() => data),
    write: vi.fn((next) => {
      data = next;
    }),
  };
}

function fakeServices(over = {}) {
  return {
    pages: {
      list: vi.fn(() => [{ id: "p1", name: "Krebs", subjectId: "s1", mastery: null }]),
      read: vi.fn(() => ({ id: "p1", name: "Krebs", html: "<p>x</p>", text: "x" })),
      write: vi.fn(),
    },
    subjects: { list: vi.fn(() => [{ id: "s1", name: "Biology", color: "#5bb98c" }]) },
    mastery: { get: vi.fn(() => 0.5), set: vi.fn() },
    storage: memoryStorage(),
    fetch: vi.fn(async () => ({ status: 200, headers: {}, body: "ok" })),
    ai: { ask: vi.fn(async () => "an answer") },
    notify: vi.fn(),
    ui: { open: vi.fn(), toast: vi.fn(), resize: vi.fn((h) => h) },
    block: { save: vi.fn() },
    ...over,
  };
}

const record = (granted = []) => ({ id: "acme.cards", version: "1.0.0", granted, manifest: { name: "Cards" } });

function setup({ granted = [], context = { kind: "widget" }, services = fakeServices() } = {}) {
  const host = createHost({ record: record(granted), context, services });
  let n = 0;
  const call = (method, params) => host.handle({ token: host.token, id: ++n, method, params });
  return { host, services, call };
}

// Valid params for every method that needs a permission, the permission it
// needs, and the service it should reach once granted.
const CASES = {
  "pages.list": { params: {}, service: (s) => s.pages.list },
  "pages.read": { params: { id: "p1" }, service: (s) => s.pages.read },
  "subjects.list": { params: {}, service: (s) => s.subjects.list },
  "pages.write": { params: { id: "p1", html: "<p>new</p>" }, service: (s) => s.pages.write },
  "mastery.get": { params: { id: "p1" }, service: (s) => s.mastery.get },
  "mastery.set": { params: { id: "p1", value: 0.7 }, service: (s) => s.mastery.set },
  "ai.ask": { params: { prompt: "Write a question" }, service: (s) => s.ai.ask },
  notify: { params: { title: "Session done", body: "Take a break" }, service: (s) => s.notify },
  fetch: { params: { url: "https://api.example.com/v1" }, needs: "network:api.example.com", service: (s) => s.fetch },
};
const PERMISSIONED = Object.keys(METHOD_PERMISSIONS).filter((m) => METHOD_PERMISSIONS[m] !== null);
const needsOf = (method) => CASES[method].needs ?? METHOD_PERMISSIONS[method];

afterEach(() => vi.useRealTimers());

describe("permissions", () => {
  it("has a case for every method that needs a permission", () => {
    expect(Object.keys(CASES).sort()).toEqual([...PERMISSIONED].sort());
  });

  test.each(PERMISSIONED)("%s is denied without its permission", async (method) => {
    const { call, services } = setup({ granted: ["notifications", "pages.read"].filter((p) => p !== needsOf(method)) });
    const res = await call(method, CASES[method].params);
    expect(res.error).toMatchObject({ code: "permission", needs: needsOf(method) });
    expect(CASES[method].service(services)).not.toHaveBeenCalled();
  });

  test.each(PERMISSIONED)("%s calls its service when granted", async (method) => {
    const { call, services } = setup({ granted: [needsOf(method)] });
    const res = await call(method, CASES[method].params);
    expect(res).not.toHaveProperty("error");
    expect(res).toHaveProperty("result");
    expect(CASES[method].service(services)).toHaveBeenCalledTimes(1);
  });

  it("asks for the host of a fetch that isn't granted", async () => {
    const { call, services } = setup({ granted: ["network:api.example.com"] });
    const res = await call("fetch", { url: "https://other.com/x" });
    expect(res.error).toMatchObject({ code: "permission", needs: "network:other.com" });
    expect(services.fetch).not.toHaveBeenCalled();
  });

  it("follows the latest grants when the record is given as a function", async () => {
    let granted = ["pages.read"];
    const services = fakeServices();
    const host = createHost({ record: () => record(granted), context: { kind: "tool" }, services });
    expect((await host.handle({ token: host.token, id: 1, method: "pages.list" })).result).toHaveLength(1);
    granted = [];
    expect((await host.handle({ token: host.token, id: 2, method: "pages.list" })).error.code).toBe("permission");
  });

  test.each([
    ["no url", {}],
    ["a url that isn't a string", { url: 42 }],
    ["an unparseable url", { url: "not a url" }],
    ["plain http", { url: "http://api.example.com/v1" }],
    ["a file url", { url: "file:///etc/passwd" }],
  ])("fetch with %s is bad-params, never permission", async (_, params) => {
    const { call, services } = setup();
    const res = await call("fetch", params);
    expect(res.error.code).toBe("bad-params");
    expect(services.fetch).not.toHaveBeenCalled();
  });

  it("passes only the checked request fields to the proxy", async () => {
    const { call, services } = setup({ granted: ["network:api.example.com"] });
    const res = await call("fetch", {
      url: "https://api.example.com/v1",
      method: "post",
      headers: { "content-type": "application/json" },
      body: "{}",
      extra: "ignored",
    });
    expect(res.result).toEqual({ status: 200, headers: {}, body: "ok" });
    expect(services.fetch).toHaveBeenCalledWith({
      url: "https://api.example.com/v1",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  test.each([
    ["an unknown method", { method: "CONNECT" }],
    ["headers that aren't strings", { headers: { a: 1 } }],
    ["headers that are a list", { headers: ["a"] }],
    ["a body that isn't a string", { body: { a: 1 } }],
  ])("fetch with %s is bad-params", async (_, extra) => {
    const { call, services } = setup({ granted: ["network:api.example.com"] });
    const res = await call("fetch", { url: "https://api.example.com/v1", ...extra });
    expect(res.error.code).toBe("bad-params");
    expect(services.fetch).not.toHaveBeenCalled();
  });
});

describe("messages", () => {
  it("ignores a wrong or missing token", async () => {
    const { host, services } = setup();
    expect(await host.handle({ token: "nope", id: 1, method: "ui.toast", params: { text: "hi" } })).toBeNull();
    expect(await host.handle({ id: 2, method: "ui.toast", params: { text: "hi" } })).toBeNull();
    expect(await host.handle(null)).toBeNull();
    expect(await host.handle("ui.toast")).toBeNull();
    expect(services.ui.toast).not.toHaveBeenCalled();
  });

  it("makes a long random token, different for every host", () => {
    const a = setup().host.token;
    const b = setup().host.token;
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  test.each(["files.delete", "constructor", "__proto__", "toString", 42])("%s is an unknown method", async (method) => {
    const { call } = setup();
    const res = await call(method, {});
    expect(res.error.code).toBe("unknown-method");
  });

  it("answers with the request id and the result", async () => {
    const { host, services } = setup();
    const res = await host.handle({ token: host.token, id: "a7", method: "ui.toast", params: { text: "hi" } });
    expect(res).toEqual({ id: "a7", result: null });
    expect(services.ui.toast).toHaveBeenCalledWith("hi");
  });

  it("refuses a message over 1 MB", async () => {
    const { call, services } = setup();
    const res = await call("ui.toast", { text: "x".repeat(1.1 * 1024 * 1024) });
    expect(MESSAGE_LIMIT).toBe(1_048_576);
    expect(res.error.code).toBe("limit");
    expect(services.ui.toast).not.toHaveBeenCalled();
  });

  it("refuses the 201st message in one second, then recovers", async () => {
    vi.useFakeTimers();
    const { call, services } = setup();
    const replies = await Promise.all(Array.from({ length: RATE_LIMIT + 1 }, () => call("ui.toast", { text: "hi" })));
    expect(RATE_LIMIT).toBe(200);
    expect(replies.slice(0, RATE_LIMIT).every((r) => !r.error)).toBe(true);
    expect(replies[RATE_LIMIT].error.code).toBe("limit");
    expect(services.ui.toast).toHaveBeenCalledTimes(RATE_LIMIT);
    vi.advanceTimersByTime(1000);
    expect((await call("ui.toast", { text: "hi" })).error).toBeUndefined();
  });

  test.each([
    ["ui.toast", { text: 5 }],
    ["ui.toast", undefined],
    ["ui.resize", { height: "100px" }],
    ["ui.resize", { height: Number.NaN }],
    ["ui.resize", { height: -1 }],
    ["ui.open", { view: "settings" }],
    ["ui.open", { view: "node" }],
    ["storage.get", { key: "" }],
    ["storage.set", { key: "k" }],
    ["storage.remove", { key: 3 }],
    ["ui.toast", ["hi"]],
  ])("%s with %j is bad-params", async (method, params) => {
    const { call } = setup();
    expect((await call(method, params)).error.code).toBe("bad-params");
  });

  test.each([
    ["pages.read", { id: 5 }],
    ["pages.write", { id: "p1", html: null }],
    ["mastery.get", {}],
    ["mastery.set", { id: "p1", value: 1.5 }],
    ["mastery.set", { id: "p1", value: "0.5" }],
    ["notify", { body: "no title" }],
    ["ai.ask", { prompt: "" }],
  ])("%s with %j is bad-params and never reaches the service", async (method, params) => {
    const { call, services } = setup({ granted: [METHOD_PERMISSIONS[method]] });
    expect((await call(method, params)).error.code).toBe("bad-params");
    expect(CASES[method].service(services)).not.toHaveBeenCalled();
  });

  it("lets mastery be cleared with null", async () => {
    const { call, services } = setup({ granted: ["mastery.write"] });
    expect((await call("mastery.set", { id: "p1", value: null })).error).toBeUndefined();
    expect(services.mastery.set).toHaveBeenCalledWith("p1", null);
  });

  it("passes a service's own error code through", async () => {
    const services = fakeServices();
    services.pages.read.mockImplementation(() => {
      throw new HostError("not-found", "No page with that id");
    });
    const { call } = setup({ granted: ["pages.read"], services });
    expect((await call("pages.read", { id: "gone" })).error).toEqual({ code: "not-found", message: "No page with that id" });
  });

  it("reports a failed fetch as network", async () => {
    const services = fakeServices({ fetch: vi.fn(async () => Promise.reject("The response was too large")) });
    const { call } = setup({ granted: ["network:api.example.com"], services });
    const res = await call("fetch", { url: "https://api.example.com/big" });
    expect(res.error).toEqual({ code: "network", message: "The response was too large" });
  });

  it("sends results as plain data only", async () => {
    const services = fakeServices();
    services.pages.list.mockReturnValue([{ id: "p1", when: new Date(0), run: () => 1, node: undefined }]);
    const { call } = setup({ granted: ["pages.read"], services });
    expect((await call("pages.list", {})).result).toEqual([{ id: "p1", when: "1970-01-01T00:00:00.000Z" }]);
  });

  it("logs an unexpected failure and reports it as internal, without the details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const bug = new TypeError("Cannot read properties of undefined (reading 'children')");
    const services = fakeServices();
    services.subjects.list.mockImplementation(() => {
      throw bug;
    });
    const { call } = setup({ granted: ["pages.read"], services });
    expect((await call("subjects.list", {})).error).toEqual({ code: "internal", message: "Something went wrong in the app" });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("subjects.list"), bug);
    expect(ERROR_CODES).toEqual(["permission", "unknown-method", "bad-params", "limit", "ai-unavailable", "network", "not-found", "internal"]);
  });

  it("treats a result that isn't JSON data as internal", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const services = fakeServices();
    const loop = {};
    loop.self = loop;
    services.subjects.list.mockReturnValue(loop);
    const { call } = setup({ granted: ["pages.read"], services });
    expect((await call("subjects.list", {})).error.code).toBe("internal");
    expect(logged).toHaveBeenCalled();
  });

  it("answers ai-unavailable until the AI service is wired", async () => {
    const { call } = setup({ granted: ["ai"], services: fakeServices({ ai: null }) });
    expect((await call("ai.ask", { prompt: "hi" })).error.code).toBe("ai-unavailable");
  });
});

describe("storage", () => {
  it("keeps values per key and removes them", async () => {
    const { call } = setup();
    await call("storage.set", { key: "count", value: { today: 3 } });
    expect((await call("storage.get", { key: "count" })).result).toEqual({ today: 3 });
    expect((await call("storage.get", { key: "missing" })).result).toBeNull();
    expect((await call("storage.get", { key: "__proto__" })).result).toBeNull();
    await call("storage.remove", { key: "count" });
    expect((await call("storage.get", { key: "count" })).result).toBeNull();
  });

  it("refuses a value that would take the extension over 1 MB", async () => {
    const { call, services } = setup();
    expect(STORAGE_LIMIT).toBe(1_048_576);
    await call("storage.set", { key: "a", value: "x".repeat(600 * 1024) });
    const res = await call("storage.set", { key: "b", value: "x".repeat(600 * 1024) });
    expect(res.error.code).toBe("limit");
    expect(services.storage.write).toHaveBeenCalledTimes(1);
    expect((await call("storage.get", { key: "b" })).result).toBeNull();
  });

  it("allows replacing a large value with a smaller one", async () => {
    const { call } = setup();
    await call("storage.set", { key: "a", value: "x".repeat(900 * 1024) });
    expect((await call("storage.set", { key: "a", value: "y".repeat(800 * 1024) })).error).toBeUndefined();
  });

  it("reports a full browser store as limit", async () => {
    const storage = memoryStorage();
    storage.write.mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { call } = setup({ services: fakeServices({ storage }) });
    expect((await call("storage.set", { key: "a", value: 1 })).error.code).toBe("limit");
  });

  it("logs any other storage failure as internal", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new DOMException("denied", "SecurityError");
    const storage = memoryStorage();
    storage.write.mockImplementation(() => {
      throw broken;
    });
    const { call } = setup({ services: fakeServices({ storage }) });
    expect((await call("storage.set", { key: "a", value: 1 })).error.code).toBe("internal");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("storage.set"), broken);
  });
});

describe("block.save", () => {
  it("is bad-params outside a block", async () => {
    const { call, services } = setup({ context: { kind: "widget" } });
    expect((await call("block.save", { data: { cards: [] }, text: "" })).error.code).toBe("bad-params");
    expect(services.block.save).not.toHaveBeenCalled();
  });

  it("saves data and text inside a block", async () => {
    const { call, services } = setup({ context: { kind: "block" } });
    expect((await call("block.save", { data: { cards: [{ q: "a", a: "b" }] }, text: "Q: a A: b" })).error).toBeUndefined();
    expect(services.block.save).toHaveBeenCalledWith({ cards: [{ q: "a", a: "b" }] }, "Q: a A: b");
  });

  it("refuses data over 64 KB", async () => {
    const { call, services } = setup({ context: { kind: "block" } });
    expect(BLOCK_DATA_LIMIT).toBe(65_536);
    expect((await call("block.save", { data: "x".repeat(65 * 1024), text: "" })).error.code).toBe("limit");
    expect(services.block.save).not.toHaveBeenCalled();
  });

  it("needs text to be a string", async () => {
    const { call } = setup({ context: { kind: "block" } });
    expect((await call("block.save", { data: null, text: 4 })).error.code).toBe("bad-params");
  });
});
