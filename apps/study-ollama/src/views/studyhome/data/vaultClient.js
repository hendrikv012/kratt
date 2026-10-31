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
  baseUrl = DEFAULT_VAULT_URL,
  fetchImpl = (...args) => fetch(...args),
  EventSourceImpl = globalThis.EventSource,
} = {}) {
  async function call(method, path, body) {
    const isBytes = body instanceof Blob || body instanceof ArrayBuffer;
    let reply;
    try {
      reply = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined || isBytes ? undefined : { "Content-Type": "application/json" },
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
    if (!reply.ok) throw new Error(data.error || `The Study folder service answered ${reply.status}`);
    return data;
  }

  const query = (path) => encodeURIComponent(path);

  return {
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
    notebookAsk: (address, prompt) => call("POST", "/notebook/ask", { base_url: address, prompt }),
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
      const source = new EventSourceImpl(`${baseUrl}/events`);
      source.onmessage = (message) => {
        try {
          onEvent(JSON.parse(message.data));
        } catch {
          // a keep-alive or a malformed line: nothing to do
        }
      };
      if (onError) source.onerror = onError;
      return () => source.close();
    },
  };
}
