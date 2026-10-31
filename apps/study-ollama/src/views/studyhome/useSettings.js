import { useEffect, useMemo, useState } from "react";
import { getDefaultConfig } from "../../core/graph/config-manager.js";
import { upgradeSettings } from "./settings/upgrade.js";

// Settings for the design probe, kept in localStorage so choices survive a
// reload. The real app would use Lokus's config store instead.
//
// Settings are grouped, and each group belongs to one settings section.
// Only what the user changed is stored, merged over DEFAULTS on load, so
// changing a default here still reaches everyone who never touched it.

const STORAGE_KEY = "study-preview-settings-v3";
// v2 started with Liquid glass and glow on. v3 starts them off, so a glass
// or glow choice saved under v2 is dropped once; everything else carries over.
const OLD_STORAGE_KEY = "study-preview-settings-v2";

// The graph's forces and filters, like Obsidian's graph settings.
// Lokus's own graph settings (Graph Settings panel), starting on the
// "How well you know it" colors.
export const GRAPH_DEFAULTS = { ...getDefaultConfig(), colorScheme: "mastery" };

export const DEFAULTS = {
  appearance: {
    themeId: "ember",
    themeDraft: {},
    customThemes: [],
    tabBar: "always", // always | auto
    sidebar: "pinned",
    sidebarSide: "left",
    reduceMotion: false,
    openingAnimation: true,
    krattMoves: true,
    textSize: "normal",
  },
  layout: { version: 1, sidebar: { chats: true, review: true, pinned: true }, kinds: {}, home: null, sideWidth: 256, tabsAt: "top", tabs: { list: ["home"], active: "home" } },
  home: {
    clock: { style: "digital", hours: "24", seconds: false, date: true },
  },
  graphView: GRAPH_DEFAULTS, // a new name: "graph" held the old graph's forces, on another scale
  studying: { session: "10", fade: "normal", quiz: "mixed", warmup: true },
  ai: { model: "local", apiKey: "", autoFile: true, markAi: true, chatHidden: true, panelWidth: 360, onUrl: "http://localhost:5055", chatMemory: "normal" },
  notifications: { deadlines: true, deadlineLead: "3", review: true, reviewTime: "18:00", quiet: true, quietFrom: "22:00", quietTo: "07:00" },
  data: { folder: "~/Study" },
  extensions: { autoUpdate: true, catalogUrl: "" },
};

function readChanges() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) ?? {};
    const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY)) ?? {};
    if (!old.appearance) return old;
    const { glass, glow, ...appearance } = old.appearance;
    return { ...old, appearance };
  } catch {
    return {};
  }
}

const loadChanges = () => upgradeSettings(readChanges());

// Returns the current settings, `set(group, patch)` to change part of one
// group (`patch` may be a function of the group's current values that
// returns the patch), and `reset()` to drop every change.
export function useSettings() {
  const [changes, setChanges] = useState(loadChanges);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
    } catch {}
  }, [changes]);

  const settings = useMemo(
    () => Object.fromEntries(Object.entries(DEFAULTS).map(([group, values]) => [group, { ...values, ...changes[group] }])),
    [changes]
  );
  const set = (group, patch) =>
    setChanges((c) => {
      const next = typeof patch === "function" ? patch({ ...DEFAULTS[group], ...c[group] }) : patch;
      return { ...c, [group]: { ...c[group], ...next } };
    });
  const reset = () => setChanges({});
  return [settings, set, reset];
}
