// Theme model for the study app. Pure JS, no React and no browser globals.
// A theme is a handful of choices; every color variable is worked out from
// them, so a few choices give a whole, consistent palette.
import { BASE_PALETTES } from "./legacyPalettes.js";

// backgrounds: hue, saturation, lightness of the ground
export const BASES = {
  // `tones` replace derived colors with fixed values, each a hex or [h, s, l]
  ember: { name: "Ember", dark: true, h: 0, s: 0, l: 5.5, accent: "#ff8a3d", tones: { card: "#161616", accent: "#1c1c1c", border: "#232323", foreground: "#ece8e3", "muted-foreground": "#a19c96", body: "#d6d1cb", "primary-foreground": "#0e0e0e" } },
  black: { name: "Black", dark: true, h: 0, s: 0, l: 0 },
  night: { name: "Night", dark: true, h: 220, s: 14, l: 5 },
  graphite: { name: "Graphite", dark: true, h: 30, s: 4, l: 7.5 },
  steel: { name: "Steel", dark: true, h: 213, s: 17, l: 9.5 },
  dusk: { name: "Dusk", dark: true, h: 238, s: 15, l: 9 },
  chalk: { name: "Chalk", dark: false, h: 216, s: 14, l: 96 },
  paper: { name: "Paper", dark: false, h: 40, s: 28, l: 96.5 },
};
export const ACCENTS = [
  { name: "Blue", hex: "#5b8fd9" },
  { name: "Steel", hex: "#7f97b2" },
  { name: "Teal", hex: "#3e9488" },
  { name: "Olive", hex: "#8a9a5b" },
  { name: "Amber", hex: "#c99442" },
  { name: "Red", hex: "#c4574f" },
  { name: "Ink", hex: "#2f55a4" },
];
export const GRAPH_COLORS = [
  { name: "White", hex: "#f0f0f0" },
  { name: "Green", hex: "#10b981" },
  { name: "Blue", hex: "#6fa0e6" },
  { name: "Amber", hex: "#d9a557" },
  { name: "Ink", hex: "#2d4f9a" },
  { name: "Same as accent", hex: "accent" },
];
export const RADII = {
  sharp: { name: "Sharp", v: "0.125rem" },
  slight: { name: "Slight", v: "0.25rem" },
  soft: { name: "Soft", v: "0.375rem" },
};
export const DENSITIES = {
  compact: { name: "Compact", v: "14px" },
  comfortable: { name: "Comfortable", v: "15.5px" },
};
// `font` is the id the fonts loader uses to bundle the family.
export const UI_FONTS = {
  pixelify: { name: "Pixelify Sans", font: "pixelify", family: '"Pixelify Sans", system-ui, sans-serif', display: '"Pixelify Sans", system-ui, sans-serif', stretch: "100%", weight: 500, tracking: "0.01em", mono: '"JetBrains Mono", ui-monospace, monospace', numeric: '"VT323", ui-monospace, monospace', pixel: true },
  archivo: { name: "Archivo", font: "archivo", family: '"Archivo Variable", "Archivo", system-ui, sans-serif', display: '"Archivo Variable", "Archivo", system-ui, sans-serif', stretch: "84%", weight: 650, tracking: "-0.015em", mono: '"JetBrains Mono", ui-monospace, monospace' },
  intertight: { name: "Inter Tight", font: "intertight", family: '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif', display: '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif', stretch: "100%", weight: 650, tracking: "-0.03em", mono: '"JetBrains Mono", ui-monospace, monospace' },
  plex: { name: "IBM Plex Sans", font: "plexsans", family: '"IBM Plex Sans", system-ui, sans-serif', display: '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif', stretch: "100%", weight: 600, tracking: "-0.01em", mono: '"IBM Plex Mono", ui-monospace, monospace' },
  geist: { name: "Geist", font: "geist", family: '"Geist Variable", "Geist", system-ui, sans-serif', display: '"Geist Variable", "Geist", system-ui, sans-serif', stretch: "100%", weight: 600, tracking: "-0.035em", mono: '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace' },
  barlow: { name: "Barlow", font: "barlow", family: '"Barlow", system-ui, sans-serif', display: '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif', stretch: "100%", weight: 600, tracking: "-0.005em", mono: '"JetBrains Mono", ui-monospace, monospace' },
  instrument: { name: "Instrument Sans", font: "instrumentsans", family: '"Instrument Sans Variable", "Instrument Sans", system-ui, sans-serif', display: '"Instrument Sans Variable", "Instrument Sans", system-ui, sans-serif', stretch: "85%", weight: 600, tracking: "-0.015em", mono: '"IBM Plex Mono", ui-monospace, monospace' },
};
export const READ_FONTS = {
  geist: { name: "Geist", font: "geist", family: '"Geist Variable", "Geist", system-ui, sans-serif' },
  sourceserif: { name: "Source Serif 4", font: "sourceserif", family: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif' },
  literata: { name: "Literata", font: "literata", family: '"Literata Variable", "Literata", Georgia, serif' },
  newsreader: { name: "Newsreader", font: "newsreader", family: '"Newsreader Variable", "Newsreader", Georgia, serif' },
  plexserif: { name: "IBM Plex Serif", font: "plexserif", family: '"IBM Plex Serif", Georgia, serif' },
  sans: { name: "Same as interface", family: "var(--st-font-sans)" },
};
// Ember and the older presets; PRESETS below slots the Kratt styles in after Ember.
const BASE_PRESETS = [
  { id: "ember", name: "Ember", base: "ember", accent: "#ff8a3d", kratt: "#ff8a3d", graph: "accent", radius: "soft", density: "comfortable", uiFont: "pixelify", readingFont: "geist" },
  { id: "black", name: "Black", base: "black", accent: "#5b8fd9", graph: "#f0f0f0", radius: "sharp", density: "compact", uiFont: "archivo", readingFont: "sourceserif" },
  { id: "graphite", name: "Graphite", base: "graphite", accent: "#c99442", graph: "#ece6dc", radius: "slight", density: "compact", uiFont: "geist", readingFont: "literata" },
  { id: "steel", name: "Steel", base: "steel", accent: "#7fa6cf", graph: "#a9c6e6", radius: "sharp", density: "compact", uiFont: "plex", readingFont: "plexserif" },
  { id: "dusk", name: "Dusk", base: "dusk", accent: "#9890d0", graph: "#b9b2ec", radius: "slight", density: "compact", uiFont: "intertight", readingFont: "newsreader" },
  { id: "chalk", name: "Chalk", base: "chalk", accent: "#2f6f8f", graph: "#2b5c86", radius: "sharp", density: "compact", uiFont: "barlow", readingFont: "literata" },
  { id: "paper", name: "Paper", base: "paper", accent: "#2f55a4", graph: "#2d4f9a", radius: "slight", density: "comfortable", uiFont: "instrument", readingFont: "sourceserif" },
];
export const DEFAULT_THEME_ID = "ember";
// Missing choices in extension and saved custom themes fall back to Black.
const BLACK = BASE_PRESETS.find((p) => p.id === "black");
export const THEME_KEYS = ["base", "accent", "graph", "radius", "density", "uiFont", "readingFont"];

const HEX6 = /^#?([0-9a-f]{6})$/i;

function hexToHsl(hex) {
  const m = HEX6.exec(hex || "");
  if (!m) return [0, 0, 50];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 1000) / 10];
}

// The Kratt styles (spec 1b): ground, raise, hover, line, text, soft, body, accent, ink, kratt.
// Ember dark is the hand-written `ember` base and preset above.
const STYLE_ROWS = [
  ["ember-light", "Ember light", false, "#f6f3ee #ffffff #ece8e1 #dcd6cc #1b1917 #5f5a54 #2b2825 #b04d0c #ffffff #d9661b"],
  ["deepred", "Deep red", true, "#100d0d #191414 #201919 #2a2121 #efe6e4 #a89a98 #dccfcc #e5605a #100d0d #c8423e"],
  ["deepred-light", "Deep red light", false, "#f5f1ef #ffffff #ece5e2 #dcd2ce #1d1716 #645856 #2e2624 #a3302e #ffffff #a3302e"],
  ["chrome", "Chrome", true, "#0e0f10 #16181a #1d1f22 #25282b #e9ecef #9ca3ab #d3d8dd #c3c7cc #0e0f10 #c3c7cc"],
  ["chrome-light", "Chrome light", false, "#f2f3f4 #ffffff #e7e9eb #d6d9dc #16181a #565d65 #26292c #454b53 #ffffff #7c8289"],
  ["green", "Racing green", true, "#0c0f0d #141815 #1a1f1b #222924 #e6ece7 #97a49b #cdd8d0 #4cbb7f #0c0f0d #34935c"],
  ["green-light", "Racing green light", false, "#f1f4f1 #ffffff #e5ebe6 #d2dbd4 #141a16 #56605a #242b26 #24613f #ffffff #24613f"],
  ["calmsteel", "Calm steel", true, "#0d0f11 #15181b #1b1f23 #23282d #e6eaee #9aa3ad #ced5dc #a3adb9 #0d0f11 #8a939e"],
  ["calmsteel-light", "Calm steel light", false, "#f1f3f5 #ffffff #e6e9ec #d3d8dd #15181b #575f68 #262a2e #4f5862 #ffffff #6b737d"],
];
const STYLE_PRESETS = STYLE_ROWS.map(([id, name, dark, row]) => {
  const [ground, raise, hover, line, text, soft, body, accent, ink, kratt] = row.split(" ");
  const [h, s, l] = hexToHsl(ground);
  BASES[id] = {
    name, dark, h, s, l, accent, hidden: true, // not offered as a Background
    tones: { background: ground, card: raise, accent: hover, border: line, foreground: text, "muted-foreground": soft, body, "primary-foreground": ink },
  };
  return { id, name, base: id, accent, kratt, graph: "accent", radius: "soft", density: "comfortable", uiFont: "pixelify", readingFont: "geist" };
});
export const PRESETS = [BASE_PRESETS[0], ...STYLE_PRESETS, ...BASE_PRESETS.slice(1)];
const fmt = ([h, s, l]) => `${h} ${s}% ${l}%`;

function luminance(hex) {
  const m = HEX6.exec(hex || "");
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const contrastInk = (hex) => (luminance(hex) > 0.18 ? "dark" : "light");

function hslToRgb([h, s, l]) {
  const sat = s / 100, lig = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}
const rgbTriplet = (hsl) => hslToRgb(hsl).join(" ");
const rgbHex = (hsl) => "#" + hslToRgb(hsl).map((x) => x.toString(16).padStart(2, "0")).join("");

// A theme variable's value ("H S% L%") as #rrggbb, or null when it isn't one.
export function tripletHex(value) {
  const m = /^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(String(value ?? ""));
  return m ? rgbHex([+m[1], +m[2], +m[3]]) : null;
}

// Every color of a theme as [h, s, l], keyed by shadcn name.
function palette(t) {
  const b = BASES[t.base] || BASES.black;
  const r1 = (x) => Math.round(x * 10) / 10;
  const n = (dl) => [b.h, b.s, r1(Math.max(0, Math.min(100, b.l + dl)))];
  const ns = (sat, l) => [b.h, Math.min(b.s, sat), l];
  const v = {};
  if (b.dark) {
    Object.assign(v, {
      background: n(0), card: n(2.5), popover: n(4), secondary: n(7), muted: n(5), accent: n(8),
      border: n(12), input: n(17),
      foreground: ns(10, b.l === 0 ? 97 : 94), "muted-foreground": ns(12, 64),
      sidebar: n(1.8), "sidebar-foreground": ns(10, 74), "sidebar-accent": n(7),
      "sidebar-border": n(10), destructive: [4, 62, 58],
      "graph-link": ns(10, 86), "graph-label": ns(10, 90), "graph-note": ns(8, 46),
    });
  } else {
    Object.assign(v, {
      background: n(0), card: [b.h, b.s, r1(Math.min(100, b.l + 3.5))], popover: [b.h, b.s, 100],
      secondary: n(-5), muted: n(-3.5), accent: n(-6.5), border: n(-12), input: n(-18),
      foreground: ns(14, 10), "muted-foreground": ns(9, 36),
      sidebar: n(-2.2), "sidebar-foreground": ns(10, 26), "sidebar-accent": n(-8),
      "sidebar-border": n(-10), destructive: [4, 66, 44],
      "graph-link": ns(14, 18), "graph-label": ns(14, 14), "graph-note": ns(8, 58),
    });
  }
  // a tone is [h, s, l] or a hex; hex tones also keep their exact value
  const hex = {};
  Object.entries(b.tones || {}).forEach(([k, tone]) => {
    if (typeof tone === "string") { v[k] = hexToHsl(tone); hex[k] = tone.toLowerCase(); }
    else v[k] = tone;
  });
  v["card-foreground"] = v["popover-foreground"] = v["secondary-foreground"] = v["accent-foreground"] = v.foreground;
  v["destructive-foreground"] = [0, 0, 100];
  const acc = hexToHsl(t.accent);
  v.primary = v.ring = acc;
  // a style's own ink only suits its own accent; any other accent gets a readable ink
  if (b.tones?.["primary-foreground"] && t.accent?.toLowerCase() === b.accent) { /* keep the tone */ }
  else {
    delete hex["primary-foreground"];
    v["primary-foreground"] = contrastInk(t.accent) === "dark" ? [b.h, 20, 7] : [0, 0, 100];
  }
  v["graph-node"] = t.graph === "accent" ? acc : hexToHsl(t.graph);
  return { v, hex, dark: b.dark };
}

export const isPixelFont = (t) => Boolean(UI_FONTS[t.uiFont]?.pixel);

export const isDark = (t) => (BASES[t.base] || BASES.black).dark;

// Variables set on documentElement while the study app is mounted.
export function themeVars(t) {
  const { v: p, dark } = palette(t);
  const out = {};
  Object.entries(p).forEach(([k, hsl]) => { out[`--st-c-${k}`] = fmt(hsl); });
  out["--st-c-graph-link-alpha"] = dark ? "0.16" : "0.22";
  out["--st-c-graph-hollow-fill"] = out["--st-c-background"];
  out["--st-kratt"] = t.kratt ?? t.accent;
  out["--st-radius"] = (RADII[t.radius] || RADII.sharp).v;
  out["--st-ui-size"] = (DENSITIES[t.density] || DENSITIES.compact).v;
  const f = UI_FONTS[t.uiFont] || UI_FONTS.archivo;
  Object.assign(out, {
    "--st-font-sans": f.family,
    "--st-font-display": f.display,
    "--st-display-stretch": f.stretch,
    "--st-display-weight": String(f.weight),
    "--st-display-tracking": f.tracking,
    "--st-font-mono": f.mono,
    "--st-font-numeric": f.numeric ?? f.mono,
  });
  if (f.pixel) out["--st-ui-size"] = "15px";
  out["--st-font-reading"] = (READ_FONTS[t.readingFont] || READ_FONTS.sourceserif).family;
  out["color-scheme"] = dark ? "dark" : "light";
  return out;
}

// Variables for the study CSS (`--st-*`, CSS colors) and for Lokus's editor
// tokens (`--bg` etc., "R G B").
export function bridgeVars(t) {
  const { v: p, hex } = palette(t);
  // exact hex when the theme gives one, else worked out from the [h, s, l]
  const hx = (k) => hex[k] ?? rgbHex(p[k]);
  const bg = p.background, mf = p["muted-foreground"];
  // faint text: 85% of the way from the background to the soft text, in lightness
  const faint = [mf[0], mf[1], Math.round((bg[2] + (mf[2] - bg[2]) * 0.85) * 10) / 10];
  const f = UI_FONTS[t.uiFont] || UI_FONTS.archivo;
  const page = READ_FONTS[t.readingFont] || READ_FONTS.sourceserif;
  const validAccent = /^#[0-9a-f]{6}$/i.test(t.accent || "");
  const accentHex = validAccent ? t.accent.toLowerCase() : rgbHex(p.primary);
  const accentRgb = validAccent
    ? [1, 3, 5].map((i) => parseInt(accentHex.slice(i, i + 2), 16)).join(" ")
    : rgbTriplet(p.primary);
  // the accent at 14% over the background
  const wash = [1, 3, 5].map((i, k) => Math.round(parseInt(accentHex.slice(i, i + 2), 16) * 0.14 + hslToRgb(bg)[k] * 0.86));
  return {
    "--st-bg": hx("background"),
    "--st-sidebar": rgbHex(p.sidebar),
    "--st-surface": hx("card"),
    "--st-hover": hx("accent"),
    "--st-line": hx("border"),
    "--st-text": hx("foreground"),
    "--st-text-soft": hx("muted-foreground"),
    "--st-text-faint": rgbHex(faint),
    "--st-accent": accentHex,
    "--st-accent-wash": "#" + wash.map((x) => x.toString(16).padStart(2, "0")).join(""),
    "--st-accent-ink": hx("primary-foreground"),
    "--st-kratt": t.kratt ?? accentHex,
    "--st-text-body": p.body ? hx("body") : hx("foreground"),
    "--st-sans": f.family,
    "--st-mono": f.mono,
    "--st-page-font": page.family,
    "--bg": rgbTriplet(bg),
    "--panel": rgbTriplet(p.card),
    "--panel-secondary": rgbTriplet(p.secondary),
    "--border": rgbTriplet(p.border),
    "--text": rgbTriplet(p.foreground),
    "--text-secondary": rgbTriplet(mf),
    "--muted": rgbTriplet(faint),
    "--editor-placeholder": rgbTriplet(faint),
    "--accent": accentRgb,
  };
}

const lightnessOf = (hex) => hexToHsl(hex)[2];

// Old extension themes name one of four bases. Pick the nearest new base by
// lightness among bases on the same side (dark or light).
function nearestBase(oldBase) {
  const pal = BASE_PALETTES[oldBase] || BASE_PALETTES.black;
  const l = lightnessOf(pal.bg);
  const dark = l < 50;
  let best = "black", bestD = Infinity;
  Object.entries(BASES).forEach(([id, b]) => {
    if (b.dark !== dark || STYLE_ROWS.some((r) => r[0] === id)) return; // the Kratt styles are not for old themes
    const d = Math.abs(b.l - l);
    if (d < bestD) { best = id; bestD = d; }
  });
  return best;
}

export function mapExtensionTheme(ext) {
  const base = nearestBase(ext?.base);
  const dark = BASES[base].dark;
  return {
    ...BLACK,
    base,
    accent: /^#[0-9a-f]{6}$/i.test(ext?.accent || "") ? ext.accent : BLACK.accent,
    graph: dark ? "#f0f0f0" : "#2d4f9a",
  };
}

// appearance: { themeId, themeDraft, customThemes }. The draft sits on top of
// the chosen theme. An unknown id falls back to the default theme; missing choices fall back to Black.
export function resolveTheme(appearance, extensionThemes = []) {
  const { themeId, themeDraft } = appearance || {};
  const customThemes = Array.isArray(appearance?.customThemes) ? appearance.customThemes : [];
  const exts = Array.isArray(extensionThemes) ? extensionThemes : [];
  const fallback = PRESETS.find((p) => p.id === DEFAULT_THEME_ID);
  let id = fallback.id, name = fallback.name, source = "builtin", raw = fallback;
  const preset = PRESETS.find((p) => p.id === themeId);
  const mine = !preset && customThemes.find((c) => c?.id === themeId);
  const ext = !preset && !mine && exts.find((e) => e?.id === themeId);
  if (preset) ({ id, name, raw } = { id: preset.id, name: preset.name, raw: preset });
  else if (mine) { id = mine.id; name = mine.name || mine.id; source = "mine"; raw = mine.choices || mine; }
  else if (ext) { id = ext.id; name = ext.name || ext.id; source = "extension"; raw = ext.choices || mapExtensionTheme(ext); }
  const choices = {};
  THEME_KEYS.forEach((k) => { choices[k] = raw?.[k] ?? BLACK[k]; });
  // `kratt` is a preset field, not an editable choice; BLACK has none
  if (raw?.kratt) choices.kratt = raw.kratt;
  Object.entries(themeDraft || {}).forEach(([k, val]) => {
    if (THEME_KEYS.includes(k) && val != null) choices[k] = val;
  });
  return { id, name, source, choices };
}
