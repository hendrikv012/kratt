import { useEffect, useLayoutEffect, useMemo } from "react";
import { bridgeVars, isDark, isPixelFont, resolveTheme, themeVars, READ_FONTS, UI_FONTS } from "./themes";
import { loadFont } from "./fonts";

// Puts the chosen theme on the page root (removed again on change or
// unmount) and returns the variables for the `.study` root's style.
const NO_THEMES = [];

export function useTheme(appearance, extensionThemes = NO_THEMES) {
  const { themeId, themeDraft, customThemes } = appearance || {};
  const theme = useMemo(
    () => resolveTheme({ themeId, themeDraft, customThemes }, extensionThemes),
    [themeId, themeDraft, customThemes, extensionThemes]
  );
  const vars = useMemo(() => themeVars(theme.choices), [theme]);
  const bridgeStyle = useMemo(() => bridgeVars(theme.choices), [theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
    return () => Object.keys(vars).forEach((k) => root.style.removeProperty(k));
  }, [vars]);

  const uiFont = UI_FONTS[theme.choices.uiFont]?.font;
  const readFont = READ_FONTS[theme.choices.readingFont]?.font;
  useEffect(() => {
    if (uiFont) loadFont(uiFont);
    if (readFont) loadFont(readFont);
  }, [uiFont, readFont]);

  return { theme, bridgeStyle, pixel: isPixelFont(theme.choices), scheme: isDark(theme.choices) ? "dark" : "light" };
}
