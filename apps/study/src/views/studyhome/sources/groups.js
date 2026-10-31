// Pure helpers for the grouped Sources list: which sources sit under which
// subject, what a drop between groups does, and the remembered collapse state.
import { UNSORTED } from "../data/tree";

// One group per subject (sidebar order), then Unsorted for sources with no subject.
export function sourceGroups(state, compare) {
  const sourcesOf = (id) =>
    state.sources.filter((s) => (s.subjects ?? []).includes(id)).sort(compare);
  const groups = state.subjects.map((id) => ({
    id,
    name: state.nodes[id].name,
    color: state.nodes[id].color,
    sources: sourcesOf(id),
  }));
  const loose = state.sources.filter((s) => !(s.subjects ?? []).length).sort(compare);
  if (loose.length) groups.push({ id: UNSORTED, name: "Unsorted", color: undefined, sources: loose });
  return groups;
}

// Plain drop moves, copy (Ctrl/Alt) adds; from Unsorted always adds;
// onto Unsorted removes from the group dragged from; already there does nothing.
export function dropAction(state, sourceId, fromId, toId, copy) {
  if (fromId === toId) return { type: "none" };
  if (toId === UNSORTED) return { type: "remove", subjectId: fromId };
  const source = state.sources.find((s) => s.id === sourceId);
  if ((source?.subjects ?? []).includes(toId)) return { type: "none" };
  if (copy || fromId === UNSORTED) return { type: "add", subjectId: toId };
  return { type: "move", subjectId: toId, fromId };
}

// Toast copy for a drop; null when nothing happened.
export function dropMessage(action, state) {
  const name = (id) => state.nodes[id]?.name ?? id;
  if (action.type === "move") return `Moved to ${name(action.subjectId)}`;
  if (action.type === "add") return `Added to ${name(action.subjectId)}`;
  if (action.type === "remove") return `Removed from ${name(action.subjectId)}`;
  return null;
}

export const COLLAPSED_KEY = "kratt.sources.collapsed";

// localStorage can throw (private mode, blocked site data), so every access is guarded.
export function readCollapsed() {
  try {
    const map = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY));
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

export function writeCollapsed(map) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(map));
  } catch {
    // remembering is a convenience; ignore
  }
}

// Empty groups start collapsed unless the user chose otherwise.
export function isCollapsed(map, group) {
  return map[group.id] ?? group.sources.length === 0;
}
