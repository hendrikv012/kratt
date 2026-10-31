// Open tabs. A tab is a string id: "home", "graph", "sources", "quick-notes",
// "extensions", "chats", "node:<id>" or "source:<id>". The set is
// { list: string[], active: string, pinned?: string[] } and every function
// returns a new set. Pinned tabs come right after Home, can't be closed and
// stay open; `pinned` is left out until something is pinned.

const FIXED = ["home", "graph", "sources", "quick-notes", "extensions", "chats"];
const HOME = "home";

const pinnedOf = (tabs) => tabs.pinned ?? [];
export const isPinned = (tabs, id) => pinnedOf(tabs).includes(id);

// Home, then the pinned tabs in their list order, then the rest.
function arrange(list, pinned) {
  const rest = list.filter((id) => id !== HOME);
  return [HOME, ...rest.filter((id) => pinned.includes(id)), ...rest.filter((id) => !pinned.includes(id))];
}

export function tabIdOf(route) {
  if (route.view === "node" || route.view === "source") return `${route.view}:${route.id}`;
  return route.view;
}

export function routeOf(tabId) {
  const at = tabId.indexOf(":");
  if (at > 0) return { view: tabId.slice(0, at), id: tabId.slice(at + 1) };
  return { view: tabId };
}

export function openTab(tabs, id) {
  return { ...tabs, list: tabs.list.includes(id) ? tabs.list : [...tabs.list, id], active: id };
}

export function closeTab(tabs, id) {
  const at = tabs.list.indexOf(id);
  if (id === HOME || at < 0 || isPinned(tabs, id)) return tabs;
  const list = tabs.list.filter((t) => t !== id);
  const active = tabs.active === id ? list[Math.max(0, at - 1)] : tabs.active;
  return { ...tabs, list, active };
}

// Pins `id` at the end of the pinned tabs, opening it if it isn't open.
export function pinTab(tabs, id) {
  if (id === HOME || isPinned(tabs, id)) return tabs;
  const pinned = [...pinnedOf(tabs), id];
  const list = tabs.list.filter((t) => t !== id);
  list.splice(pinnedOf(tabs).length + 1, 0, id);
  return { ...tabs, list: arrange(list, pinned), pinned };
}

// Unpins `id`; it becomes the first unpinned tab.
export function unpinTab(tabs, id) {
  if (!isPinned(tabs, id)) return tabs;
  const pinned = pinnedOf(tabs).filter((t) => t !== id);
  const list = tabs.list.filter((t) => t !== id);
  list.splice(pinned.length + 1, 0, id);
  return { ...tabs, list, pinned };
}

export function reorderTabs(tabs, id, toIndex) {
  const from = tabs.list.indexOf(id);
  if (from < 0) return tabs;
  const list = tabs.list.filter((t) => t !== id);
  // A tab moves only among its own kind: Home, then pinned, then the rest.
  const pins = pinnedOf(tabs).filter((t) => t !== id).length;
  const [min, max] = id === HOME ? [0, 0] : isPinned(tabs, id) ? [1, 1 + pins] : [1 + pins, list.length];
  list.splice(Math.max(min, Math.min(toIndex, max)), 0, id);
  return { ...tabs, list };
}

function exists(id, state) {
  if (FIXED.includes(id)) return true;
  const { view, id: target } = routeOf(id);
  if (view === "node") return Boolean(state.nodes[target]);
  if (view === "source") return state.sources.some((s) => s.id === target);
  return false;
}

// Drops unknown tabs and ones for deleted pages or sources. Home always stays,
// first, and pinned tabs follow it. Returns the same object when nothing changed.
export function sanitizeTabs(tabs, state) {
  if (!tabs || typeof tabs !== "object" || !Array.isArray(tabs.list)) return { list: [HOME], active: HOME };
  if (typeof tabs.active !== "string") tabs = { ...tabs, active: HOME };
  const kept = [...new Set(tabs.list)].filter((id) => exists(id, state));
  const saved = Array.isArray(tabs.pinned) ? tabs.pinned : [];
  const pinned = saved.filter((id) => id !== HOME && kept.includes(id));
  const list = arrange(kept, pinned);
  const active = list.includes(tabs.active) ? tabs.active : HOME;
  const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
  const same = sameList(list, tabs.list) && active === tabs.active && sameList(pinned, saved) && (tabs.pinned === undefined || Array.isArray(tabs.pinned));
  if (same) return tabs;
  return tabs.pinned === undefined ? { list, active } : { list, active, pinned };
}
