// Open tabs. A tab is a string id: "home", "graph", "sources", "quick-notes",
// "extensions", "chats", "node:<id>" or "source:<id>". The set is
// { list: string[], active: string } and every function returns a new set.

const FIXED = ["home", "graph", "sources", "quick-notes", "extensions", "chats"];
const HOME = "home";

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
  return { list: tabs.list.includes(id) ? tabs.list : [...tabs.list, id], active: id };
}

export function closeTab(tabs, id) {
  const at = tabs.list.indexOf(id);
  if (id === HOME || at < 0) return tabs;
  const list = tabs.list.filter((t) => t !== id);
  const active = tabs.active === id ? list[Math.max(0, at - 1)] : tabs.active;
  return { list, active };
}

export function reorderTabs(tabs, id, toIndex) {
  const from = tabs.list.indexOf(id);
  if (from < 0) return tabs;
  const list = tabs.list.filter((t) => t !== id);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, id);
  return { ...tabs, list };
}

function exists(id, state) {
  if (FIXED.includes(id)) return true;
  const { view, id: target } = routeOf(id);
  if (view === "node") return Boolean(state.nodes[target]);
  if (view === "source") return state.sources.some((s) => s.id === target);
  return false;
}

// Drops unknown tabs and ones for deleted pages or sources. Home always stays.
// Returns the same object when nothing changed.
export function sanitizeTabs(tabs, state) {
  if (!tabs || typeof tabs !== "object" || !Array.isArray(tabs.list)) return { list: [HOME], active: HOME };
  if (typeof tabs.active !== "string") tabs = { ...tabs, active: HOME };
  const kept = [...new Set(tabs.list)].filter((id) => exists(id, state));
  const list = kept.includes(HOME) ? kept : [HOME, ...kept];
  const active = list.includes(tabs.active) ? tabs.active : HOME;
  const same = list.length === tabs.list.length && list.every((id, i) => id === tabs.list[i]) && active === tabs.active;
  return same ? tabs : { list, active };
}
