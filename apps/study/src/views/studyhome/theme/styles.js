// The five Kratt styles. Each is a dark preset `<style>` plus `<style>-light`.
export const KRATT_STYLES = ["ember", "deepred", "chrome", "green", "calmsteel"];

export const themeIdFor = (style, mode) => (mode === "light" ? `${style}-light` : style);

// { style, mode } for a Kratt style's preset id, null for any other theme.
export function styleOf(themeId) {
  if (KRATT_STYLES.includes(themeId)) return { style: themeId, mode: "dark" };
  const m = /^(.+)-light$/.exec(themeId || "");
  return m && KRATT_STYLES.includes(m[1]) ? { style: m[1], mode: "light" } : null;
}
