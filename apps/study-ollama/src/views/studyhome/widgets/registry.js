import { useSyncExternalStore } from "react";
import { allowedIn } from "../edges/lanes";

// The widget registry. Built-in widgets register themselves from builtin.jsx;
// extensions register theirs through registerWidget. A def is
// { title, icon, source: "builtin" | { kind: "extension", id, name },
//   lanes: "any" | "side" | "edge", size: "s" | "m" | "l", Component, bare?, page?,
//   sizes?: tile sizes on the Home grid (default ["2x1", "2x2"]), homeSize?: its default,
//   home?: false keeps it off the Home grid }.
// `page` widgets read a page (context.pageId), so only pages offer them.

export { allowedIn };

export const EXTENSION_EMPTY = "Widgets from extensions you install show up here.";

// Stands in for an id nobody has registered, such as a widget from an
// extension that was removed. It keeps its place in the lane.
export const MISSING = Object.freeze({
  title: "Missing widget",
  body: "The extension that added this widget isn't installed. Remove it, or install the extension again.",
  source: "builtin",
  lanes: "any",
  size: "m",
  sizes: ["2x1"],
  missing: true,
});

// The snapshot is replaced (never mutated) on register and unregister, so
// useSyncExternalStore sees a stable value between changes.
let defs = Object.freeze({});
const listeners = new Set();

const publish = (next) => {
  defs = Object.freeze(next);
  listeners.forEach((l) => l());
};

export function registerWidget(id, def) {
  publish({ ...defs, [id]: def });
  return () => {
    // A replaced def is not removed by the unregister of the one before it.
    if (defs[id] !== def) return;
    const { [id]: _gone, ...rest } = defs;
    publish(rest);
  };
}

export const widgetDef = (id) => defs[id] ?? MISSING;

export function groupBySource(ids) {
  const builtin = [];
  const extension = [];
  for (const id of ids) {
    const def = defs[id];
    if (def && def.source !== "builtin") extension.push(id);
    else builtin.push(id);
  }
  return [
    { source: "builtin", items: builtin },
    { source: "extension", items: extension, empty: EXTENSION_EMPTY },
  ];
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useWidgetDefs = () => useSyncExternalStore(subscribe, () => defs, () => defs);
