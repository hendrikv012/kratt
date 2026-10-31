// Runs the file operations planSync produces, one at a time, against the Study folder
// service. Nothing typed is lost: pending operations stay in browser storage until the
// service confirms them, failed ones retry with growing waits, and quick page edits collapse
// into one write.

import { VaultOffline } from "./vaultClient";
import { movedPath } from "./vaultState";

export const PENDING_KEY = "study-vault-pending-v1";
export const QUIET_MS = 800;
const MAX_REFUSALS = 3;

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

const withPaths = (op, change) => ({
  ...op,
  ...(op.path && { path: change(op.path) }),
  ...(op.from && { from: change(op.from) }),
  ...(op.to && { to: change(op.to) }),
});

function readPending(storage) {
  try {
    const saved = JSON.parse(storage.getItem(PENDING_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function createVaultSync({
  client,
  storage = globalThis.localStorage,
  onResult = () => {},
  onStatus = () => {},
  delays = [1000, 2000, 5000, 10000],
  now = () => Date.now(),
}) {
  let queue = readPending(storage);
  let timer = null;
  let running = false;
  let failures = 0;
  let refusals = 0;
  let offline = false;
  let notice = null;
  let unsavedSince = queue.length ? now() : null;

  const persist = () => {
    try {
      storage.setItem(PENDING_KEY, JSON.stringify(queue));
    } catch {
      // storage full or blocked: the queue still lives in memory
    }
  };
  const report = () => onStatus({ offline, unsavedSince, notice });

  const schedule = (delay) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };

  // Operations run in the order they were planned, so each one's paths are right when it runs.
  // A write says which version of the file it replaces (`base`), so the service keeps a file
  // changed on disk meanwhile, also when the queue is run again after a reload.
  function perform(op) {
    switch (op.op) {
      case "mkdir":
        return client.mkdir(op.path);
      case "move":
        return client.move(op.from, op.to);
      case "write":
        return op.create
          ? client.write({ path: op.path, text: op.text, create: true })
          : client.write({ path: op.path, text: op.text, version: op.base });
      case "trash":
        return client.trash(op.path);
      case "layout":
        return client.writeLayout(op.layout);
      default:
        return Promise.resolve({});
    }
  }

  async function run() {
    timer = null;
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const op = queue[0];
        let answer;
        try {
          answer = await perform(op);
        } catch (error) {
          if (error instanceof VaultOffline || refusals + 1 < MAX_REFUSALS) {
            if (!(error instanceof VaultOffline)) refusals += 1;
            failures += 1;
            offline = error instanceof VaultOffline;
            report();
            schedule(delays[Math.min(failures - 1, delays.length - 1)]);
            return;
          }
          // The service keeps refusing this one (not a connection problem): say so and go on.
          notice = `Couldn't save ${basename(op.path ?? op.to ?? "the layout")}: ${error.message}`;
          answer = null;
        }
        queue.shift();
        // The service takes another name when one is taken (" (2)"); what waits follows it.
        const planned = op.op === "move" ? op.to : op.op === "mkdir" || op.create ? op.path : null;
        const moved = answer?.path && planned && answer.path !== planned ? { from: planned, to: answer.path } : null;
        if (moved) queue = queue.map((waiting) => withPaths(waiting, (path) => movedPath(path, moved.from, moved.to)));
        // A later write of the same file replaces the version this one just made.
        if (op.op === "write" && answer?.version) {
          queue = queue.map((waiting) => (waiting.op === "write" && !waiting.create && waiting.id === op.id ? { ...waiting, base: answer.version } : waiting));
        }
        persist();
        failures = 0;
        refusals = 0;
        offline = false;
        if (answer) {
          onResult(op, answer, moved);
          if (answer.clash) notice = `Kept both versions: the one on disk is saved as ${basename(answer.clash)}`;
        }
      }
      unsavedSince = null;
      report();
    } finally {
      running = false;
    }
  }

  return {
    push(ops) {
      for (const op of ops) {
        // A newer write of the same page, or a newer layout, replaces one that hasn't started.
        const start = running ? 1 : 0;
        queue = queue.filter((queued, index) => {
          if (index < start) return true;
          if (op.op === "layout" && queued.op === "layout") return false;
          return !(op.op === "write" && !op.create && queued.op === "write" && !queued.create && queued.id === op.id);
        });
        queue.push(op);
      }
      if (queue.length && unsavedSince === null) unsavedSince = now();
      persist();
      report();
      if (!running) schedule(failures ? delays[Math.min(failures - 1, delays.length - 1)] : QUIET_MS);
    },
    flush: () => run(),
    pending: () => [...queue],
    clearNotice() {
      notice = null;
      report();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
