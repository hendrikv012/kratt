// Pure operations on the installed-extension records, a map of id -> record.
// Every function returns a new map and never mutates its input.

export const FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const FAILURE_LIMIT = 3;

const change = (records, id, fn) => (records[id] ? { ...records, [id]: fn(records[id]) } : records);

export function install(records, { manifest, source, granted }) {
  const old = records[manifest.id];
  return {
    ...records,
    [manifest.id]: {
      id: manifest.id,
      version: manifest.version,
      source,
      manifest,
      granted: [...granted],
      enabled: old ? old.enabled : true,
      hiddenTools: old ? old.hiddenTools : [],
      pendingUpdate: null,
      previousVersion: old ? old.version : null,
      failures: [],
    },
  };
}

export const setEnabled = (records, id, enabled) => change(records, id, (r) => ({ ...r, enabled: !!enabled }));

export const setGranted = (records, id, perm, on) =>
  change(records, id, (r) => {
    const rest = r.granted.filter((p) => p !== perm);
    return { ...r, granted: on ? [...rest, perm] : rest };
  });

export const setToolHidden = (records, id, toolId, hidden) =>
  change(records, id, (r) => {
    const rest = r.hiddenTools.filter((t) => t !== toolId);
    return { ...r, hiddenTools: hidden ? [...rest, toolId] : rest };
  });

export const setPendingUpdate = (records, id, pending) => change(records, id, (r) => ({ ...r, pendingUpdate: pending ?? null }));

export const recordFailure = (records, id, now) =>
  change(records, id, (r) => ({ ...r, failures: [...r.failures.filter((t) => now - t < FAILURE_WINDOW_MS), now] }));

export const shouldSuggestDisable = (record, now) =>
  (record?.failures ?? []).filter((t) => now - t < FAILURE_WINDOW_MS).length >= FAILURE_LIMIT;

export function remove(records, id) {
  const { [id]: _gone, ...rest } = records;
  return rest;
}
