// Test helpers: an in-memory stand-in for `memory-engine serve`, and ways to render the
// app around it.

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import yaml from "js-yaml";
import StudyPreview from "../../StudyPreview";
import { useStudy } from "../StudyProvider";
import { EMPTY_STATE } from "../operations";
import { UNSORTED } from "../tree";
import { VaultOffline } from "../vaultClient";

export const EMPTY_SNAPSHOT = { folders: [], files: [], layout: {} };

export const SAMPLE_SNAPSHOT = {
  folders: ["Biology", "Biology/Cells", "Chats", "Quick notes", "Sources", "Unsorted"],
  files: [
    { path: "Biology/Cells/Krebs cycle.md", id: "p1", meta: { id: "p1", title: "Krebs cycle", also_in: ["Biology"] }, body: "Runs in the **matrix**.\n", version: "v1" },
    { path: "Unsorted/Loose idea.md", id: "p2", meta: { id: "p2", title: "Loose idea" }, body: "Idea.\n", version: "v2" },
    { path: "Quick notes/2026-10-07 15-32.md", id: "q1", meta: { id: "q1", created: "2026-10-07T15:32:00Z" }, body: "Buy milk\n", version: "v3" },
    { path: "Sources/Lecture.md", id: "s1", meta: { id: "s1", title: "Lecture", type: "link", url: "https://e.org", use: true }, body: "Text.\n", version: "v4" },
    {
      path: "Chats/2026-10-20 09-58 Krebs cycle.md",
      id: "c1",
      meta: { id: "c1", title: "Krebs cycle, step by step", created: "2026-10-20T09:58:00Z", updated: "2026-10-20T10:12:00Z", context: ["p1"] },
      body: "### You\nWalk me through one turn of the cycle, step by step.\n\n### Kratt\nOne turn, from your notes: it runs in the matrix.\n",
      version: "v5",
    },
  ],
  layout: { subjects: ["Biology"], colors: { Biology: "#4c90f0" } },
};

const splitHeader = (text) => {
  const match = /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(text);
  return match ? [yaml.load(match[1]) ?? {}, match[2]] : [{}, text];
};
const stemOf = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

// Node's own experimental localStorage stores nothing in tests; give the window a working one.
export function installMemoryLocalStorage() {
  const store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => (store[key] = String(value)),
      removeItem: (key) => delete store[key],
      clear: () => Object.keys(store).forEach((key) => delete store[key]),
    },
  });
}

export function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => (store[key] = String(value)),
    removeItem: (key) => delete store[key],
  };
}

// An in-memory client with the vaultClient methods. `fail` makes every call throw VaultOffline.
// Like the service, a write whose version isn't the one on disk keeps the disk text as a page
// of its own ("<name> (from disk …).md").
export function fakeClient(snapshot = EMPTY_SNAPSHOT, { folder = "/home/me/Study" } = {}) {
  let folders = [...snapshot.folders];
  let files = snapshot.files.map((f) => ({ ...f, meta: { ...f.meta } }));
  let layout = structuredClone(snapshot.layout ?? {});
  let counter = 0;
  const listeners = new Set();
  const otherFolders = {}; // folders switched away from, by path, as the service keeps them on disk
  const client = {
    calls: [],
    fail: false,
    folderPath: folder,
    notebookOk: false, // whether the stand-in Open Notebook answers
    notebookPassword: null,
    // The stand-in Ollama, as /local/status answers: state "running", "started", "not-installed" or "failed".
    local: { local: true, model: null, state: "not-installed", detail: "", models: [] },
  };
  const guard = (method, args) => {
    client.calls.push({ method, ...args });
    if (client.fail) throw new VaultOffline();
  };
  const free = (path, taken) => {
    if (!taken(path)) return path;
    const dot = path.endsWith(".md") ? path.length - 3 : path.length;
    for (let n = 2; ; n++) {
      const candidate = `${path.slice(0, dot)} (${n})${path.slice(dot)}`;
      if (!taken(candidate)) return candidate;
    }
  };
  // Like the service, move and trash refuse a path that isn't there.
  const exists = (path) => folders.includes(path) || files.some((f) => f.path === path);
  Object.assign(client, {
    async snapshot() {
      guard("snapshot", {});
      return client.snapshotNow();
    },
    snapshotNow: () => ({ folders: [...folders].sort(), files: files.map((f) => ({ ...f })), layout: structuredClone(layout) }),
    async read(path) {
      guard("read", { path });
      const file = files.find((f) => f.path === path);
      return { text: file.body, version: file.version };
    },
    async write({ path, text, version, create }) {
      guard("write", { path, text, version, create });
      const target = create ? free(path, (p) => files.some((f) => f.path === p)) : path;
      const onDisk = files.find((f) => f.path === target);
      let clash = null;
      if (!create && version !== undefined && onDisk && onDisk.version !== version) {
        clash = `${target.slice(0, target.lastIndexOf("/") + 1)}${stemOf(target)} (from disk 2026-10-07 15-32).md`;
        files = [...files, { ...onDisk, path: clash, id: `${onDisk.id}-disk`, meta: { ...onDisk.meta, id: `${onDisk.id}-disk` } }];
      }
      const [meta, body] = splitHeader(text);
      const entry = { path: target, id: String(meta.id ?? `f${files.length}`), meta, body, version: `w${++counter}` };
      files = [...files.filter((f) => f.path !== target), entry];
      return { path: target, version: entry.version, clash };
    },
    async mkdir(path) {
      guard("mkdir", { path });
      const target = free(path, (p) => folders.includes(p));
      folders.push(target);
      return { path: target };
    },
    async move(from, to) {
      guard("move", { from, to });
      if (!exists(from)) throw new Error(`'${from}' does not exist`);
      const rename = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
      folders = folders.map(rename);
      files = files.map((f) => ({ ...f, path: rename(f.path) }));
      return { path: to };
    },
    async trash(path) {
      guard("trash", { path });
      if (!exists(path)) throw new Error(`'${path}' does not exist`);
      folders = folders.filter((p) => p !== path && !p.startsWith(`${path}/`));
      files = files.filter((f) => f.path !== path && !f.path.startsWith(`${path}/`));
      return { path: `.study/trash/x/${path}` };
    },
    async writeLayout(next) {
      guard("writeLayout", { layout: next });
      layout = structuredClone(next);
      return {};
    },
    async upload(path, blob) {
      guard("upload", { path, size: blob?.size });
      return { path };
    },
    async folder() {
      guard("folder", {});
      return { path: client.folderPath };
    },
    async setFolder(path) {
      guard("setFolder", { path });
      otherFolders[client.folderPath] = { folders, files, layout };
      ({ folders, files, layout } = otherFolders[path] ?? { folders: [], files: [], layout: {} });
      client.folderPath = path;
      return { path };
    },
    // The service's Open Notebook bridge.
    async notebookAsk(address, prompt) {
      guard("notebookAsk", { address, prompt });
      if (!client.notebookOk) throw new Error("ai-unavailable");
      return { output: `answer to ${prompt}` };
    },
    async notebookStatus(address) {
      guard("notebookStatus", { address });
      return { ok: client.notebookOk };
    },
    async hasNotebookPassword() {
      guard("hasNotebookPassword", {});
      return { set: client.notebookPassword !== null };
    },
    async setNotebookPassword(password) {
      guard("setNotebookPassword", {});
      client.notebookPassword = password || null;
      return {};
    },
    // The service's local model (Ollama).
    async localStatus() {
      guard("localStatus", {});
      return client.local.local ? { ...client.local } : { ...client.local, state: "off", models: [] };
    },
    async setLocalAi(changes) {
      guard("setLocalAi", changes);
      Object.assign(client.local, changes);
      return { local: client.local.local, model: client.local.model };
    },
    async localAsk(prompt) {
      guard("localAsk", { prompt });
      const { state, model, models } = client.local;
      if (state === "not-installed") throw new Error("ollama-missing");
      if (state === "failed") throw new Error("ollama-failed");
      if (!model) throw new Error("no-model");
      if (!models.includes(model)) throw new Error("model-missing");
      return { output: `answer to ${prompt}` };
    },
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    emit(event) {
      listeners.forEach((listener) => listener(event));
    },
    setBody(path, body) {
      files = files.map((f) => (f.path === path ? { ...f, body, version: `disk${++counter}` } : f));
    },
  });
  return client;
}

// A state in the old browser-storage format, with one subject holding one page.
export function legacyStateWithOnePage(name, html) {
  return {
    ...EMPTY_STATE,
    nodes: {
      ...EMPTY_STATE.nodes,
      [UNSORTED]: { ...EMPTY_STATE.nodes[UNSORTED], children: [] },
      s1: { id: "s1", type: "subject", name: "Legacy", color: "#5bb98c", children: ["pg1"] },
      pg1: { id: "pg1", type: "page", name, content: html, mastery: null, home: "s1" },
    },
    subjects: ["s1"],
  };
}

export function renderWithProvider(client) {
  return render(createElement(StudyPreview, { client }));
}

// Renders the app around `client`, waits until it has loaded, and gives the store.
export async function renderAndGetStudy(client) {
  const store = {};
  function Probe() {
    Object.assign(store, useStudy());
    return null;
  }
  render(createElement(StudyPreview, { client }, createElement(Probe)));
  await screen.findByRole("navigation", { name: "Sidebar" });
  return { actions: store.actions, getState: () => store.state, store };
}

// Opens the "Krebs cycle" page from the sidebar tree, expanding its folders.
export async function openKrebs(side) {
  const { fireEvent } = await import("@testing-library/react");
  for (const name of ["Biology", "Cells"]) {
    if (side.queryByText("Krebs cycle")) break;
    const row = (await side.findByText(name)).closest(".st-tree-row");
    fireEvent.click(row.querySelector('button[aria-label="Expand"]'));
  }
  fireEvent.click(await side.findByText("Krebs cycle"));
}
