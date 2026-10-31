// The host side of the extension RPC. One host serves one frame: it checks
// the frame's token, the rate and size limits, the student's grants and
// every parameter, and only then calls a service. It never touches the DOM;
// ExtensionFrame does the postMessage plumbing and builds the real services.
//
//   createHost({ record, context, services }) -> { token, handle(message) }
//
//   record     the ExtRecord, or a function returning the latest one, so a
//              permission the student turns off applies without a reload
//   context    what the frame was opened as; `kind` decides whether
//              block.save is allowed
//   services   { pages: { list, read, write }, subjects: { list },
//                mastery: { get, set }, storage: { read, write }, fetch,
//                ai: { ask } | null, notify, ui: { open, toast, resize },
//                block: { save } }
//              storage.read() returns the extension's whole data object and
//              storage.write(data) replaces it; the host does get/set/remove
//              on top so the 1 MB limit is enforced in one place.
//
// handle({ token, id, method, params }) resolves to { id, result } or
// { id, error: { code, message, needs? } }, or null when the message isn't
// for this host (wrong token, no id) and must be ignored.

import { requiredPermission } from "./permissions.js";

export const MESSAGE_LIMIT = 1_048_576; // characters of JSON per message
export const RATE_LIMIT = 200; // messages per second per frame
export const STORAGE_LIMIT = 1_048_576; // characters of JSON per extension
export const BLOCK_DATA_LIMIT = 65_536; // characters of JSON per block

// What error.code can be: the spec's list (§4), plus "internal" for a bug in
// the app. Internal failures are logged here and their details stay out of
// the reply.
export const ERROR_CODES = ["permission", "unknown-method", "bad-params", "limit", "ai-unavailable", "network", "not-found", "internal"];

const RATE_WINDOW = 1000;
const FETCH_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const OPEN_VIEWS = new Set(["home", "graph", "quick-notes", "node", "tool"]);

export class HostError extends Error {
  constructor(code, message, needs) {
    super(message);
    this.name = "HostError";
    this.code = code;
    if (needs !== undefined) this.needs = needs;
  }

  toJSON() {
    return this.needs === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, needs: this.needs };
  }
}

const badParams = (message) => new HostError("bad-params", message);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Parameter checks ----------

function text(value, name, { optional = false, empty = false } = {}) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (typeof value !== "string" || (!empty && value === "")) throw badParams(`${name} must be a${empty ? "" : " non-empty"} string`);
  return value;
}

// A value as it will be stored: plain JSON, whatever postMessage let through.
function json(value, name) {
  let out;
  try {
    out = JSON.stringify(value);
  } catch {
    out = undefined;
  }
  if (out === undefined) throw badParams(`${name} must be JSON data`);
  return out;
}

function stringMap(value, name) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw badParams(`${name} must be an object of strings`);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") throw badParams(`${name} must be an object of strings`);
    out[k] = v;
  }
  return out;
}

// The fetch URL is checked before the permission, so a bad URL is reported
// as bad-params rather than as a missing "network:" permission.
function httpsUrl(value) {
  let url;
  try {
    url = new URL(text(value, "url"));
  } catch {
    throw badParams("url must be a full https:// address");
  }
  if (url.protocol !== "https:") throw badParams("url must be a full https:// address");
  return url.href;
}

// ---------- Methods ----------

// Each handler gets (params, ctx) with params already known to be an object.
// Handlers run synchronously up to their service call, so storage changes
// read and write in one step.
const HANDLERS = {
  "pages.list": (_, { services }) => services.pages.list(),
  "pages.read": (p, { services }) => services.pages.read(text(p.id, "id")),
  "subjects.list": (_, { services }) => services.subjects.list(),
  "pages.write": (p, { services }) => {
    services.pages.write(text(p.id, "id"), text(p.html, "html", { empty: true }));
    return null;
  },
  "mastery.get": (p, { services }) => services.mastery.get(text(p.id, "id")),
  "mastery.set": (p, { services }) => {
    const id = text(p.id, "id");
    const ok = p.value === null || (typeof p.value === "number" && p.value >= 0 && p.value <= 1);
    if (!ok) throw badParams("value must be null or a number from 0 to 1");
    services.mastery.set(id, p.value);
    return null;
  },
  "storage.get": (p, { services }) => {
    const key = text(p.key, "key");
    const data = services.storage.read();
    return own(data, key) ? data[key] : null;
  },
  "storage.set": (p, { services }) => {
    const key = text(p.key, "key");
    if (p.value === undefined) throw badParams("value is missing; use storage.remove to delete a key");
    const value = JSON.parse(json(p.value, "value"));
    const next = { ...services.storage.read(), [key]: value };
    if (JSON.stringify(next).length > STORAGE_LIMIT) throw new HostError("limit", "Extension storage is limited to 1 MB");
    writeStorage(services, next);
    return null;
  },
  "storage.remove": (p, { services }) => {
    const key = text(p.key, "key");
    const data = services.storage.read();
    if (own(data, key)) {
      const { [key]: _gone, ...rest } = data;
      writeStorage(services, rest);
    }
    return null;
  },
  fetch: (p, { services }) =>
    services.fetch({
      url: httpsUrl(p.url),
      method: fetchMethod(p.method),
      headers: stringMap(p.headers, "headers"),
      body: text(p.body, "body", { optional: true, empty: true }) ?? null,
    }),
  "ai.ask": (p, { services }) => {
    const prompt = text(p.prompt, "prompt");
    if (!services.ai) throw new HostError("ai-unavailable", "The AI isn't available");
    return services.ai.ask(prompt);
  },
  notify: (p, { services }) => {
    services.notify(text(p.title, "title"), text(p.body, "body", { optional: true, empty: true }) ?? "");
    return null;
  },
  "ui.open": (p, { services }) => {
    const view = text(p.view, "view");
    if (!OPEN_VIEWS.has(view)) throw badParams(`view must be one of ${[...OPEN_VIEWS].join(", ")}`);
    const needsId = view === "node" || view === "tool";
    services.ui.open(needsId ? { view, id: text(p.id, "id") } : { view });
    return null;
  },
  "ui.toast": (p, { services }) => {
    services.ui.toast(text(p.text, "text"));
    return null;
  },
  "ui.resize": (p, { services }) => {
    if (typeof p.height !== "number" || !Number.isFinite(p.height) || p.height < 0) {
      throw badParams("height must be a number of pixels");
    }
    return services.ui.resize(p.height) ?? null;
  },
  "block.save": (p, { services, context }) => {
    if (context?.kind !== "block") throw badParams("block.save only works in a page block");
    const data = json(p.data === undefined ? null : p.data, "data");
    if (data.length > BLOCK_DATA_LIMIT) throw new HostError("limit", "Block data is limited to 64 KB");
    services.block.save(JSON.parse(data), text(p.text ?? "", "text", { empty: true }));
    return null;
  },
};

function fetchMethod(value) {
  if (value === undefined || value === null) return "GET";
  const method = typeof value === "string" ? value.toUpperCase() : "";
  if (!FETCH_METHODS.has(method)) throw badParams(`method must be one of ${[...FETCH_METHODS].join(", ")}`);
  return method;
}

// A full browser store is the extension's limit; anything else is a bug.
function writeStorage(services, data) {
  try {
    services.storage.write(data);
  } catch (e) {
    if (e?.name === "QuotaExceededError") throw new HostError("limit", "There's no room left to save this");
    throw e;
  }
}

// Rust reports the expected failures of these as plain-language strings.
const STRING_FAILURES = { fetch: "network", "ai.ask": "ai-unavailable" };

function failure(method, e) {
  if (e instanceof HostError) return e.toJSON();
  if (typeof e === "string" && STRING_FAILURES[method]) return { code: STRING_FAILURES[method], message: e };
  console.error(`Extension call ${String(method)} failed`, e);
  return { code: "internal", message: "Something went wrong in the app" };
}

export function createHost({ record, context, services }) {
  const token = randomToken();
  const currentRecord = typeof record === "function" ? record : () => record;
  let recent = []; // times of accepted messages in the last second

  function overRate() {
    const now = Date.now();
    recent = recent.filter((t) => now - t < RATE_WINDOW);
    if (recent.length >= RATE_LIMIT) return true;
    recent.push(now);
    return false;
  }

  function checkSize(message) {
    if (json(message, "The message").length > MESSAGE_LIMIT) throw new HostError("limit", "Messages are limited to 1 MB");
  }

  function permissionFor(method, params) {
    if (method === "fetch") httpsUrl(params.url);
    const need = requiredPermission(method, params);
    if (need && !(currentRecord()?.granted ?? []).includes(need)) {
      throw new HostError("permission", `This needs the "${need}" permission`, need);
    }
  }

  // Everything up to the service call runs synchronously, so the rate limit
  // counts messages in the order they arrive.
  function handle(message) {
    if (!message || typeof message !== "object" || message.token !== token) return Promise.resolve(null);
    const { id, method } = message;
    if (typeof id !== "string" && !(typeof id === "number" && Number.isFinite(id))) return Promise.resolve(null);
    // Results cross as plain JSON data, whatever a service returned; one that
    // can't be (a cycle) throws here and is reported as internal.
    const reply = (result) => {
      const text = result === undefined ? undefined : JSON.stringify(result);
      return { id, result: text === undefined ? null : JSON.parse(text) };
    };
    const refuse = (e) => ({ id, error: failure(method, e) });

    try {
      if (overRate()) throw new HostError("limit", "Too many messages; at most 200 a second");
      checkSize(message);
      if (typeof method !== "string" || requiredPermission(method, message.params) === undefined || !own(HANDLERS, method)) {
        throw new HostError("unknown-method", `Unknown method: ${String(method)}`);
      }
      const params = message.params ?? {};
      if (typeof params !== "object" || Array.isArray(params)) throw badParams("params must be an object");
      permissionFor(method, params);
      return Promise.resolve(HANDLERS[method](params, { services, context })).then(reply).catch(refuse);
    } catch (e) {
      return Promise.resolve(refuse(e));
    }
  }

  return { token, handle };
}
