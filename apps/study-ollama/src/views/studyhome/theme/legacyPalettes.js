// The color roles and base palettes of the old extension theme format
// (manifest `themes` contributions). Extension themes still name one of
// these bases and roles; theme/themes.js maps them to the new bases.

export const COLOR_ROLES = [
  { key: "bg", label: "Background", css: "--st-bg", lokus: "--bg" },
  { key: "sidebar", label: "Sidebar", css: "--st-sidebar" },
  { key: "surface", label: "Panels", css: "--st-surface", lokus: "--panel" },
  { key: "hover", label: "Raised and hover", css: "--st-hover", lokus: "--panel-secondary" },
  { key: "line", label: "Lines", css: "--st-line", lokus: "--border" },
  { key: "text", label: "Text", css: "--st-text", lokus: "--text" },
  { key: "textSoft", label: "Secondary text", css: "--st-text-soft", lokus: "--text-secondary" },
  { key: "textFaint", label: "Faint text", css: "--st-text-faint", lokus: "--muted" },
];

export const BASE_PALETTES = {
  black: { bg: "#000000", sidebar: "#07090c", surface: "#07090c", hover: "#0e1116", line: "#1c222b", text: "#e6e9ee", textSoft: "#7d8796", textFaint: "#727c8c" },
  deep: { bg: "#10141a", sidebar: "#0c1015", surface: "#171c24", hover: "#1f2630", line: "#2a323d", text: "#e8ecf1", textSoft: "#9aa5b4", textFaint: "#7a8698" },
  soft: { bg: "#191919", sidebar: "#202020", surface: "#252525", hover: "#2c2c2c", line: "#2f2f2f", text: "#e9e9e7", textSoft: "#9b9b9b", textFaint: "#878787" },
  light: { bg: "#ffffff", sidebar: "#f7f7f5", surface: "#f7f7f5", hover: "#efefed", line: "#e9e9e7", text: "#37352f", textSoft: "#787774", textFaint: "#767570" },
};
