// One-time upgrade of saved settings to the current shape. Works on the
// stored "changes" object, which may be partial, and is safe to run again.
import { BASES, PRESETS, DEFAULT_THEME_ID } from "../theme/themes.js";
import { fromLanes } from "../home/grid.js";

const BLACK = PRESETS.find((p) => p.id === "black");
const { id: _id, name: _name, ...BLACK_CHOICES } = BLACK;

const OLD_DEFAULT_ACCENT = "#4c90f0";
const THEME_MAP = { black: "black", deep: "black", soft: "graphite", light: "paper" };
const BASE_MAP = { black: "black", deep: "night", soft: "graphite", light: "paper" };
const SIZES = { small: "s", medium: "m", large: "l" };
const DROPPED = ["glass", "glow", "glowColor", "graphDecor", "styles", "theme", "accent", "pageFont"];

const KNOWN_WIDGETS = new Set(["continue", "review", "deadlines", "chats", "recent", "note", "notes", "week", "clock"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// The old "system" theme followed the computer; it becomes whichever side
// the computer is on at upgrade time.
function prefersLight() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && Boolean(window.matchMedia("(prefers-color-scheme: light)")?.matches);
  } catch {
    return false;
  }
}

function convertStyle(style) {
  if (!isObject(style) || style.id == null) return null;
  const base = BASE_MAP[style.base] ?? "black";
  // Graph dots follow the ground, as for extension themes (mapExtensionTheme).
  const graph = BASES[base].dark ? "#f0f0f0" : "#2d4f9a";
  const theme = { id: "mine-" + style.id, name: String(style.name || "My theme"), ...BLACK_CHOICES, base, graph };
  if (isHex(style.accent)) theme.accent = style.accent;
  return theme;
}

function convertHome(widgets) {
  const lanes = {};
  const size = {};
  const seen = new Set();
  for (const side of ["left", "right"]) {
    const list = Array.isArray(widgets[side]) ? widgets[side] : [];
    lanes[side] = [];
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== "string") continue;
      if (!KNOWN_WIDGETS.has(item.id)) continue;
      const id = item.id === "note" ? "notes" : item.id;
      if (seen.has(id)) continue;
      seen.add(id);
      lanes[side].push(id);
      size[id] = SIZES[item.size] ?? "s";
    }
  }
  return { lanes, size };
}

// Home's lanes before the grid. A lane missing from the saved lanes showed
// these, so the upgrade fills them in the same way.
const OLD_HOME_LANES = { left: ["continue", "review"], right: ["deadlines", "chats", "notes"], top: ["clock"], bottom: ["legend"] };

// Home's lanes become the snap grid, once: after it `kinds.home` is gone.
// The legend leaves Home; the graph tile shows its hint instead. A grid
// already saved wins, and stale lanes beside it are dropped.
function lanesToGrid(settings) {
  const layout = settings.layout;
  if (!isObject(layout) || !isObject(layout.kinds) || !("home" in layout.kinds)) return settings;
  const { home, ...kinds } = layout.kinds;
  if ("home" in layout) return { ...settings, layout: { ...layout, kinds } };
  const grid = fromLanes({ ...OLD_HOME_LANES, ...(isObject(home) && isObject(home.lanes) ? home.lanes : {}) });
  return { ...settings, layout: { ...layout, kinds, home: { ...grid, order: grid.order.filter((id) => id !== "legend") } } };
}

export function upgradeSettings(saved) {
  const input = isObject(saved) ? saved : {};
  const appearance = isObject(input.appearance) ? input.appearance : {};
  if (appearance.upgraded === 2) return lanesToGrid(input);

  const next = { ...input };
  const a = { ...appearance };

  // No saved appearance at all is a new user, who gets the default (Ember).
  const newUser = !isObject(input.appearance);
  const oldTheme = typeof a.theme === "string" ? a.theme : "black";
  const customs = Array.isArray(a.customThemes) ? [...a.customThemes] : [];
  const converted = (Array.isArray(a.styles) ? a.styles : []).map(convertStyle).filter(Boolean);
  for (const t of converted) if (!customs.some((c) => c?.id === t.id)) customs.push(t);

  if (newUser) a.themeId = DEFAULT_THEME_ID;
  else if (typeof a.themeId !== "string") {
    a.themeId = oldTheme.startsWith("custom:") ? "mine-" + oldTheme.slice(7) : oldTheme === "system" ? (prefersLight() ? "paper" : "black") : THEME_MAP[oldTheme] ?? "black";
    if (a.themeId.startsWith("mine-") && !customs.some((c) => c?.id === a.themeId)) a.themeId = "black";
  }
  const draft = isObject(a.themeDraft) ? { ...a.themeDraft } : {};
  const preset = PRESETS.find((p) => p.id === a.themeId);
  if (preset && isHex(a.accent) && a.accent.toLowerCase() !== OLD_DEFAULT_ACCENT && a.accent.toLowerCase() !== preset.accent.toLowerCase() && !("accent" in draft)) {
    draft.accent = a.accent;
  }
  a.themeDraft = draft;
  a.customThemes = customs;
  DROPPED.forEach((k) => delete a[k]);
  a.upgraded = 2;
  next.appearance = a;

  if (isObject(input.home)) {
    const { widgets, columns: _columns, ...home } = input.home;
    next.home = home;
    if (isObject(widgets)) {
      const layout = isObject(input.layout) ? input.layout : {};
      const kinds = isObject(layout.kinds) ? layout.kinds : {};
      if (!kinds.home) next.layout = { ...layout, kinds: { ...kinds, home: convertHome(widgets) } };
    }
  }
  return lanesToGrid(next);
}
