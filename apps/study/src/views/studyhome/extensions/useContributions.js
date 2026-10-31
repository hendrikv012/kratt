import { createElement, useEffect, useMemo, useRef } from "react";
import { Blocks } from "lucide-react";
import ExtensionFrame from "./ExtensionFrame.jsx";
import { useExtensions } from "./ExtensionsProvider.jsx";
import { mapExtensionTheme } from "../theme/themes.js";
import { registerWidget } from "../widgets/registry.js";

// Extension themes in the shape resolveTheme takes: { id, name, choices }.
// Ids are namespaced so two extensions can both ship a theme called "dusk".
export function themesOf(contributions) {
  return contributions.themes.map((t) => ({
    id: `ext:${t.extId}/${t.id}`,
    name: t.name || t.id,
    choices: mapExtensionTheme(t),
  }));
}

// One component per widget id, kept for the life of the hook. It reads the
// live record when it renders, so a changed record never gives React a new
// component type (which would remount, and reload, the sandboxed frame).
function makeComponent(extId, widgetId) {
  return function ExtensionWidget({ compact: _compact, ...context }) {
    const { records } = useExtensions();
    const record = records[extId];
    const entry = record?.manifest?.contributes?.widgets?.find((w) => w.id === widgetId)?.entry;
    if (!record || !entry) return null;
    return createElement(ExtensionFrame, { record, entry, kind: "widget", contributionId: widgetId, context });
  };
}

// Registers each enabled extension's widgets (and unregisters them when the
// extension is disabled or removed) and returns the themes they add. Call it
// once, in the shell; other places read themes with `useExtensionThemes`.
export function useContributions() {
  const { contributions } = useExtensions();
  const components = useRef(new Map());

  // Only what a def is made from. Other record changes (grants, failures,
  // another extension toggled) leave it unchanged, so nothing re-registers.
  const signature = JSON.stringify(contributions.widgets.map((w) => [w.extId, w.extName, w.id, w.title ?? w.id]));

  useEffect(() => {
    const offs = JSON.parse(signature).map(([extId, extName, id, title]) => {
      const key = `ext:${extId}/${id}`;
      if (!components.current.has(key)) components.current.set(key, makeComponent(extId, id));
      return registerWidget(key, {
        title,
        icon: Blocks,
        source: { kind: "extension", id: extId, name: extName },
        lanes: "any",
        size: "m",
        Component: components.current.get(key),
      });
    });
    return () => offs.forEach((off) => off());
  }, [signature]);

  return { themes: useMemo(() => themesOf(contributions), [contributions]) };
}

export function useExtensionThemes() {
  const { contributions } = useExtensions();
  return useMemo(() => themesOf(contributions), [contributions]);
}
