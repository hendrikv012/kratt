import { connection, isDesktop } from "../../../desktop/runtime";
// Talks to `memory-engine serve`, the Study folder service on this computer.
// One method per route; a service that can't be reached throws VaultOffline.

export class VaultOffline extends Error {
  constructor(message = "The Study folder service isn't running") {
    super(message);
    this.name = "VaultOffline";
  }
}

export const DEFAULT_VAULT_URL = "http://127.0.0.1:5057";

export function createVaultClient({
  baseUrl,
  fetchImpl = (...args) => fetch(...args),
  EventSourceImpl = globalThis.EventSource,
} = {}) {
  const url = () => baseUrl ?? connection()?.baseUrl ?? DEFAULT_VAULT_URL;
  const token = () => baseUrl ? null : connection()?.token;
  async function call(method, path, body) {
    const isBytes = body instanceof Blob || body instanceof ArrayBuffer;
    let reply;
    try {
      reply = await fetchImpl(`${url()}${path}`, {
        method,
        headers: token() ? { Authorization: `Bearer ${token()}`, ...(body !== undefined && !isBytes ? { "Content-Type": "application/json" } : {}) } : body === undefined || isBytes ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : isBytes ? body : JSON.stringify(body),
      });
    } catch {
      throw new VaultOffline();
    }
    let data = {};
    try {
      data = await reply.json();
    } catch {
      data = {};
    }
    if (!reply.ok) throw Object.assign(new Error(data.error || `The Study folder service answered ${reply.status}`), { code: data.code });
    return data;
  }

  const query = (path) => encodeURIComponent(path);

  return {
    aiSettings: () => call("GET", "/ai/settings"),
    saveAiSettings: (settings) => call("PUT", "/ai/settings", settings),
    aiModels: () => call("GET", "/ai/models"),
    chatgptLogin: (account) => call("POST", "/ai/chatgpt/login", { account }),
    chatgptSelect: (account) => call("POST", "/ai/chatgpt/select", { account }),
    chatgptLogout: () => call("POST", "/ai/chatgpt/logout", {}),
    chatgptCancel: () => call("POST", "/ai/chatgpt/cancel", {}),
    claudeStatus: () => call("GET", "/ai/claude/status"),
    claudeLogin: () => call("POST", "/ai/claude/login", {}),
    health: () => call("GET", "/health"),
    preferences: () => call("GET", "/setting/preferences"),
    setPreferences: (preferences) => call("PUT", "/setting/preferences", { preferences }),
    search: (q) => call("GET", `/search?q=${query(q)}`),
    pullModel: (model) => call("POST", "/local/pull", { model }),
    pullStatus: () => call("GET", "/local/pull"),
    snapshot: () => call("GET", "/vault"),
    read: (path) => call("GET", `/file?path=${query(path)}`),
    write: ({ path, text, version, create }) => call("PUT", "/file", { path, text, version, create }),
    mkdir: (path) => call("POST", "/folder", { path }),
    move: (from, to) => call("POST", "/move", { from, to }),
    trash: (path) => call("POST", "/trash", { path }),
    writeLayout: (layout) => call("PUT", "/layout", { layout }),
    upload: (path, blob) => call("POST", `/upload?path=${query(path)}`, blob),
    folder: () => call("GET", "/setting/folder"),
    setFolder: (path) => call("PUT", "/setting/folder", { path }),
    // Open Notebook, through the service's bridge. Failures are "ai-unavailable" or "ai-auth".
    notebookAsk: (address, prompt) => isDesktop() ? call("POST", "/ai/ask", { prompt }) : call("POST", "/notebook/ask", { base_url: address, prompt }),
    notebookStatus: (address) => call("GET", `/notebook/status?base_url=${query(address)}`),
    hasNotebookPassword: () => call("GET", "/setting/notebook-password"),
    setNotebookPassword: (password) => call("PUT", "/setting/notebook-password", { password: password || null }),
    // The model on this computer (Ollama). Failures are the codes in ai/localAi.js.
    localStatus: () => call("GET", "/local/status"),
    setLocalAi: (changes) => call("PUT", "/setting/local-ai", changes),
    localAsk: (prompt) => call("POST", "/local/ask", { prompt }),
    // Calls onEvent({ type, path }) for every change in the folder; returns a function that stops listening.
    subscribe(onEvent, onError) {
      if (!EventSourceImpl) return () => {};
      let source;
      const connect = () => {
      source?.close();
      source = new EventSourceImpl(`${url()}/events${token() ? `?token=${query(token())}` : ""}`);
      source.onmessage = (message) => {
        try {
          onEvent(JSON.parse(message.data));
        } catch {
          // a keep-alive or a malformed line: nothing to do
        }
      };
      if (onError) source.onerror = onError;
      };
      connect();
      globalThis.addEventListener?.("kratt-engine-ready", connect);
      return () => { source.close(); globalThis.removeEventListener?.("kratt-engine-ready", connect); };
    },
  };
}
