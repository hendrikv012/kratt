# Study Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the study app's shell as the approved Edges design: themes with an editor, a shadcn Settings dialog, tabs with an optional auto-hide bar, four widget lanes on every screen, an extension-ready widget registry, and an Extensions tab.

**Architecture:** Pure modules carry every decision (`theme/themes.js`, `edges/lanes.js`, `shell/tabs.js`, `widgets/registry.js`, `settings/upgrade.js`) and are unit-tested first; thin React components render them. shadcn components live only in `studyhome/ui/` and use `st-*` Tailwind colors that read `--st-c-*` variables, so nothing else in Lokus changes. The existing study CSS keeps working through bridge variables (`--st-bg`, `--st-text`, Lokus's RGB editor tokens) fed from the same theme.

**Tech Stack:** React 19, Tailwind 3.4, Radix (shadcn pattern), lucide-react, @fontsource, Vitest + Testing Library, headless Firefox over WebDriver BiDi for the real-browser checks.

**Spec:** `docs/superpowers/specs/2026-10-08-study-shell-redesign-design.md` (read it with this plan). Mockups with the reference theme model and interactions: `/home/caesarsta/Downloads/BaseN/.impeccable/mockups/2026-10-07-freeform-shell/` (`_build/src/themes.js`, `_build/src/settings.js`, `_build/src/c.js`, `c-edges.html`).

All paths below are relative to the worktree root `lokus/.claude/worktrees/study-shell-redesign/` unless absolute. `SH` = `src/views/studyhome`.

## Global Constraints

- Branch `study-shell-redesign`; never merge without the user's OK. Run `npm test -- <path>` for one file, `npm test` for all.
- No change to Lokus outside `SH` except: `tailwind.config.cjs` (add `st-*` names only), `package.json`/`package-lock.json` (new deps), `SH`-scoped CSS. No existing Tailwind name changes; `src/components/ui/*` untouched.
- Theme variables on `document.documentElement` use the `--st-c-` prefix (colors as HSL triplets `H S% L%`) plus `--st-radius`, `--st-ui-size`, `--st-font-sans`, `--st-font-display`, `--st-display-stretch`, `--st-display-weight`, `--st-display-tracking`, `--st-font-mono`, `--st-font-reading`. They are removed when the study app unmounts. `--st-accent`, `--st-bg` etc. already exist in the study CSS with other meanings; never reuse those names for shadcn colors.
- Built-in themes, bases, swatches, fonts, radii (sharp `0.125rem`, slight `0.25rem`, soft `0.375rem`) and densities (compact `14px`, comfortable `15.5px`) are copied verbatim from the mockup's `_build/src/themes.js`. Default theme id `black`.
- Copy (exact): "Layout saved", "Undo", "Unsaved changes", "Save as my theme", "Discard changes", "Widgets from extensions you install show up here.", "Themes from extensions you install show up here.", "Missing widget", "This widget stopped working", "No extensions installed. Installing extensions isn't available yet.", "Always shown", "Show near the edge", "Drop widgets here". Sentence case, plain words, American spelling.
- Banned looks: glass, glow, gradients, color fog, bracket/corner marks, status bar, docked console. Shadows only on lifted or dragged items. Pills only for switches and dots.
- Every animation is instant under reduced motion (OS setting or Settings > Appearance > Reduce motion).
- Subject dots keep each subject's stored color; new subjects still take colors from `SUBJECT_COLORS`. (The mockup's per-theme subject colors are not carried over because nothing in the app reads them; this replaces the spec's "four subject colors" line.)
- Fonts are bundled with `@fontsource` packages, never loaded from the network.

## Review Focus

1. A saved layout naming a widget that no longer exists, listed twice, or in a lane it may not use: the layout loads with that entry dropped or shown as "Missing widget", never crashes (Task 9 test `sanitizes damaged lanes`).
2. Settings saved by today's app (`study-preview-settings-v3` with `theme: "deep"`, an accent, color styles, glass and glow, old `home.widgets` columns): the first run maps them and nothing the student made is lost (Task 4 tests).
3. A tab whose page or source was deleted, on load or while open: the tab disappears and the active tab falls back to Home (Task 7 test `drops tabs for deleted items`).
4. The auto-hide tab bar while one of its menus is open (Radix renders menus in a portal outside the bar) or while it has keyboard focus: it stays shown (Task 8 test `stays while a menu from the bar is open`).
5. A widget dragged and released outside any lane, or with Escape: it returns to where it was and nothing is saved (Task 11 test `cancels a drag`).

---

### Task 0: Merge the extension branch

**Files:**
- Modify (conflicts): `SH/StudyPreview.jsx`, `SH/useSettings.js`, `SH/data/operations.js`, `SH/data/operations.test.js`

**Interfaces:**
- Produces: on this branch, `ExtensionsProvider`/`contributionsOf` (`SH/extensions/ExtensionsProvider.jsx`), `QuickFind`, `Toasts`/`useToasts` (`SH/Toasts.jsx`), shell members `openSettings`, `toggleSidebar`, `toggleFocus`, `addFindProvider`, `toast`, and `setMastery` in operations, alongside everything from `study-vault`.

- [ ] **Step 1: Merge**

Run: `git merge --no-ff feat/study-extensions`
Expected: conflicts in the four files above only.

- [ ] **Step 2: Resolve, keeping both sides**

`useSettings.js`: keep `study-vault`'s `graphView` group, `GRAPH_DEFAULTS` from `getDefaultConfig()` and `COLUMN_WIDTHS`; add `extensions: { autoUpdate: true, catalogUrl: "" }` to `DEFAULTS`. `StudyPreview.jsx`: keep `study-vault`'s `StudyProvider client` wiring, `VaultBanner`, `graph: settings.graphView`/`setGraph`; add the extension branch's `settingsState` prop, `ExtensionsProvider` wrapper, QuickFind, Toasts, recent ids and the new shell members. `operations.js`/`.test.js`: keep both sides' additions.

- [ ] **Step 3: Run all tests**

Run: `npm test -- src/views/studyhome src-tauri 2>&1 | tail -5` then `npm test 2>&1 | tail -5`
Expected: all pass. Also `cargo check` in `src-tauri` succeeds.

- [ ] **Step 4: Commit**

```bash
git commit -m "merge: the extension system into the study shell redesign"
```

### Task 1: Study-only shadcn components

**Files:**
- Modify: `tailwind.config.cjs`, `package.json`
- Create: `SH/ui/dialog.jsx`, `SH/ui/dropdown-menu.jsx`, `SH/ui/context-menu.jsx`, `SH/ui/switch.jsx`, `SH/ui/toggle-group.jsx`, `SH/ui/tooltip.jsx`, `SH/ui/button.jsx`, `SH/ui/input.jsx`, `SH/ui/badge.jsx`
- Test: `SH/ui/ui.test.jsx`

**Interfaces:**
- Produces: shadcn's standard exports per file (e.g. `Dialog, DialogContent, DialogTitle`; `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem`; `ContextMenu…`; `Switch`; `ToggleGroup, ToggleGroupItem`; `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider`; `Button` with `variant: "default" | "ghost"` and `size: "default" | "sm" | "icon" | "iconSm"`; `Input`; `Badge`). Tailwind colors `st-background, st-foreground, st-card, st-card-foreground, st-popover, st-popover-foreground, st-primary, st-primary-foreground, st-secondary, st-secondary-foreground, st-muted, st-muted-foreground, st-accent, st-accent-foreground, st-destructive, st-destructive-foreground, st-border, st-input, st-ring, st-sidebar, st-sidebar-foreground, st-sidebar-accent, st-sidebar-border`, each `hsl(var(--st-c-<name>) / <alpha-value>)`; `borderRadius` keys `st` (`var(--st-radius)`), `st-sm` (`calc(var(--st-radius) - 1px)`); `fontFamily` keys `st-sans`, `st-display`, `st-mono`, `st-reading`.

- [ ] **Step 1: Add dependencies**

Run: `npm install @radix-ui/react-dropdown-menu @radix-ui/react-switch @radix-ui/react-toggle-group @radix-ui/react-tooltip`
Expected: added to `dependencies`.

- [ ] **Step 2: Write the failing test** `SH/ui/ui.test.jsx`

```jsx
it("dialog uses study colors and stays flat", async () => {
  render(<Dialog open><DialogContent><DialogTitle>Settings</DialogTitle></DialogContent></Dialog>);
  const d = await screen.findByRole("dialog", { name: "Settings" });
  expect(d.className).toMatch(/bg-st-popover/);
  expect(d.className).not.toMatch(/shadow/);
});
it("button has only the default and ghost variants", () => {
  render(<><Button>Save</Button><Button variant="ghost">Cancel</Button></>);
  expect(screen.getByText("Save").className).toMatch(/bg-st-primary/);
  expect(screen.getByText("Cancel").className).toMatch(/hover:bg-st-accent/);
});
it("switch toggles", () => { /* render <Switch aria-label="x" />, click, expect aria-checked "true" */ });
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test -- src/views/studyhome/ui`
Expected: FAIL (modules missing).

- [ ] **Step 4: Add the `st-*` Tailwind names and the components**

Copy each component from shadcn's new-york JavaScript source; replace every color class with its `st-` form (`bg-background` → `bg-st-background`, `ring-ring` → `ring-st-ring`, …), `rounded-*` with `rounded-st`/`rounded-st-sm`, and drop `shadow*` classes except on `DropdownMenuContent`/`ContextMenuContent`/`TooltipContent`/`DialogContent` which use none either. Import `cn` from `src/lib/utils`. Dialog overlay `bg-black/60`, no blur.

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/views/studyhome/ui`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(study): study-only shadcn components with st-* colors`

### Task 2: Theme model

**Files:**
- Create: `SH/theme/themes.js`
- Test: `SH/theme/themes.test.js`

**Interfaces:**
- Produces:
  - constants `BASES, ACCENTS, GRAPH_COLORS, RADII, DENSITIES, UI_FONTS, READ_FONTS, PRESETS, DEFAULT_THEME_ID` (verbatim from the mockup; `UI_FONTS[id].family` is the CSS family string, `.display`, `.stretch`, `.weight`, `.tracking`, `.mono`, `.font` = the fonts.js id).
  - `THEME_KEYS = ["base","accent","graph","radius","density","uiFont","readingFont"]`
  - `themeVars(choices) -> Record<string,string>` (the `--st-c-*` and other names in Global Constraints)
  - `bridgeVars(choices) -> Record<string,string>`: `--st-bg, --st-sidebar, --st-surface, --st-hover, --st-line, --st-text, --st-text-soft, --st-text-faint, --st-accent, --st-accent-ink, --st-sans, --st-mono, --st-page-font` as CSS colors/families, and Lokus's `--bg, --panel, --panel-secondary, --border, --text, --text-secondary, --muted, --editor-placeholder, --accent` as `"R G B"`.
  - `isDark(choices) -> boolean`
  - `resolveTheme(appearance, extensionThemes = []) -> { id, name, source: "builtin"|"mine"|"extension", choices }` (draft applied on top; unknown id → Black)
  - `mapExtensionTheme(extTheme) -> choices` (old base → nearest new base by lightness and dark/light, accent kept, graph = "#f0f0f0" on dark bases and "#2d4f9a" on light ones, other keys from Black)
  - `contrastInk(hex) -> "dark" | "light"` (dark text when relative luminance > 0.18)

- [ ] **Step 1: Write the failing tests**

```js
it.each(PRESETS)("$id yields every variable", (t) => {
  const v = themeVars(t);
  ["--st-c-background","--st-c-foreground","--st-c-card","--st-c-popover","--st-c-primary","--st-c-primary-foreground","--st-c-secondary","--st-c-muted","--st-c-muted-foreground","--st-c-accent","--st-c-border","--st-c-input","--st-c-ring","--st-c-destructive","--st-c-sidebar","--st-c-sidebar-foreground","--st-c-sidebar-accent","--st-c-sidebar-border","--st-c-graph-node","--st-c-graph-link","--st-c-graph-label","--st-c-graph-note","--st-radius","--st-ui-size","--st-font-sans","--st-font-reading"]
    .forEach((k) => expect(v[k], k).toBeTruthy());
});
it("black is true black", () => expect(themeVars(PRESETS[0])["--st-c-background"]).toBe("0 0% 0%"));
it("primary text is readable on light and dark accents", () => {
  expect(contrastInk("#5b8fd9")).toBe("dark");
  expect(contrastInk("#2f55a4")).toBe("light");
});
it("bridge feeds Lokus's editor RGB tokens", () => {
  expect(bridgeVars(PRESETS[0])["--bg"]).toBe("0 0 0");
  expect(bridgeVars(PRESETS.find((p) => p.id === "paper"))["--text"]).toMatch(/^\d+ \d+ \d+$/);
});
it("resolves drafts over the chosen theme and falls back to black", () => {
  expect(resolveTheme({ themeId: "steel", themeDraft: { accent: "#c4574f" }, customThemes: [] }).choices.accent).toBe("#c4574f");
  expect(resolveTheme({ themeId: "nope", themeDraft: {}, customThemes: [] }).id).toBe("black");
});
it("maps an extension theme in the old shape", () => {
  const c = mapExtensionTheme({ base: "light", accent: "#aa3355", subjects: Array(8).fill("#000000") });
  expect(isDark(c)).toBe(false);
  expect(c.accent).toBe("#aa3355");
});
```

- [ ] **Step 2: Run to fail** — `npm test -- src/views/studyhome/theme` → FAIL.
- [ ] **Step 3: Implement** by porting the mockup's `hexToHsl`, `triplet`, `luminance`, `themeVars` (renaming keys to `--st-c-*` and the font/radius names above) and adding `bridgeVars` (map: bg=background, sidebar=sidebar, surface=card, hover=accent, line=border, text=foreground, text-soft=muted-foreground, text-faint=muted-foreground at 85% lightness toward background, accent=primary, accent-ink=primary-foreground; RGB triplets converted from the same HSL values).
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(study): theme model for built-in, custom and extension themes`

### Task 3: Fonts and applying the theme

**Files:**
- Create: `SH/theme/fonts.js`, `SH/theme/useTheme.js`
- Modify: `SH/styles/base.css` (delete the per-theme `.study[data-theme=…]` color blocks and the hard-coded titlebar colors; titlebar becomes `background-color: hsl(var(--st-c-background)) !important`), `SH/StudyPreview.jsx` (replace `useAppearance` with `useTheme`; drop the `data-theme`, `data-glass`, `data-glow-off`, `data-graph-decor` attributes and the fx/glass/blackout imports; `shell.palette` becomes `SUBJECT_COLORS`), `package.json`
- Delete: `SH/useAppearance.js`, `SH/styles/fx.css`, `SH/styles/glass.css`, `SH/styles/blackout.css` (before the new settings exist, `resolveTheme` falls back to Black, so the app keeps working)
- Test: `SH/theme/useTheme.test.jsx`

**Interfaces:**
- Consumes: `resolveTheme`, `themeVars`, `bridgeVars`, `UI_FONTS`, `READ_FONTS` (Task 2).
- Produces: `loadFont(fontId) -> Promise<boolean>` (dynamic `import()` of the @fontsource CSS; resolves `false` for an unknown id or a failed import, never rejects); `useTheme(appearance, extensionThemes) -> { theme, bridgeStyle }` — sets `themeVars` on `document.documentElement` in an effect and removes exactly those properties on unmount or change; `bridgeStyle` goes on the `.study` root's `style`.

- [ ] **Step 1: Add fonts** — `npm install` the @fontsource packages for Inter Tight, IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Serif, IBM Plex Mono, Geist, Geist Mono, Barlow, Barlow Semi Condensed, Instrument Sans, Literata, Newsreader (prefer `@fontsource-variable/*` where it exists; check with `npm view <name> version`). If a family has no fontsource package, remove it from `UI_FONTS`/`READ_FONTS` and note it in the commit message.
- [ ] **Step 2: Write the failing tests**

```jsx
it("puts the theme on the page root and takes it away on unmount", () => {
  const { unmount } = renderHook(() => useTheme({ themeId: "black", themeDraft: {}, customThemes: [] }, []));
  expect(document.documentElement.style.getPropertyValue("--st-c-background")).toBe("0 0% 0%");
  unmount();
  expect(document.documentElement.style.getPropertyValue("--st-c-background")).toBe("");
});
it("never touches Lokus's own variables on the page root", () => {
  renderHook(() => useTheme({ themeId: "paper", themeDraft: {}, customThemes: [] }, []));
  expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
});
it("loadFont resolves false for an unknown font", async () => expect(await loadFont("comic")).toBe(false));
```

- [ ] **Step 3: Run to fail.**
- [ ] **Step 4: Implement** `fonts.js` as a map `{ archivo: () => import("@fontsource-variable/archivo/wdth.css"), … }`; `useTheme` calls `loadFont` for the theme's UI and page fonts on change.
- [ ] **Step 5: Run to pass**, then `npm test -- src/views/studyhome`; the old glass/glow test in `StudyPreview.test.jsx` is deleted here (its replacement comes in Task 6).
- [ ] **Step 6: Commit** `feat(study): apply themes and bundle their fonts`

### Task 4: Settings upgrade and new settings shape

**Files:**
- Create: `SH/settings/upgrade.js`
- Modify: `SH/useSettings.js`
- Test: `SH/settings/upgrade.test.js`

**Interfaces:**
- Consumes: `PRESETS`, `BASES` (Task 2).
- Produces: `DEFAULTS.appearance = { themeId: "black", themeDraft: {}, customThemes: [], tabBar: "always", sidebar: "pinned", sidebarSide: "left", reduceMotion: false, openingAnimation: true, textSize: "normal" }`; new group `DEFAULTS.layout = { version: 1, kinds: {}, sideWidth: 256, tabsAt: "top", tabs: { list: ["home"], active: "home" } }`; `upgradeSettings(saved) -> saved` (pure, idempotent; marks `appearance.upgraded = 2`); `useSettings()` runs it once on load. `home.widgets`/`home.columns` are dropped after conversion; `home.clock` stays.

- [ ] **Step 1: Write the failing tests**

```js
it("maps old themes to the nearest new one", () => {
  expect(upgradeSettings({ appearance: { theme: "deep" } }).appearance.themeId).toBe("black");
  expect(upgradeSettings({ appearance: { theme: "light" } }).appearance.themeId).toBe("paper");
  expect(upgradeSettings({ appearance: { theme: "soft" } }).appearance.themeId).toBe("graphite");
});
it("keeps a changed accent as a draft", () => {
  expect(upgradeSettings({ appearance: { theme: "black", accent: "#e0a03a" } }).appearance.themeDraft).toEqual({ accent: "#e0a03a" });
});
it("turns color styles into my themes", () => {
  const s = upgradeSettings({ appearance: { styles: [{ id: "s1", name: "Forest", base: "black", accent: "#4caf6e" }] } });
  expect(s.appearance.customThemes[0]).toMatchObject({ name: "Forest", accent: "#4caf6e" });
});
it("drops glass and glow", () => {
  const a = upgradeSettings({ appearance: { glass: "liquid", glow: 60, glowColor: "#fff", graphDecor: true } }).appearance;
  ["glass","glow","glowColor","graphDecor","styles","theme","accent","pageFont"].forEach((k) => expect(a).not.toHaveProperty(k));
});
it("converts home columns into Home lanes", () => {
  const s = upgradeSettings({ home: { widgets: { left: [{ id: "note", size: "small" }], right: [{ id: "chats", size: "large" }] } } });
  expect(s.layout.kinds.home.lanes.left).toEqual(["notes"]);
  expect(s.layout.kinds.home.size).toMatchObject({ notes: "s", chats: "l" });
});
it("survives damaged values", () => {
  expect(upgradeSettings({ appearance: { customThemes: "x", styles: 5 } }).appearance.customThemes).toEqual([]);
  expect(upgradeSettings(null)).toBeTruthy();
});
it("is idempotent", () => { const once = upgradeSettings({ appearance: { theme: "deep" } }); expect(upgradeSettings(once)).toEqual(once); });
```

- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.** Theme map: `black`/`deep`/`system`/unknown → `black`, `soft` → `graphite`, `light` → `paper`. Color style → `{ id: "mine-" + style.id, name, ...Black choices, base: nearest(style.base), accent: style.accent }`. Old widget ids: `note` → `notes`; sizes `small/medium/large` → `s/m/l`. Clock in old columns stays where it was.
- [ ] **Step 4: Run to pass**, then `npm test -- src/views/studyhome`. The old Appearance and Colors sections still render until Task 6; they may read keys the upgrade dropped, so give them the old defaults locally (`appearance.styles ?? []`) rather than restoring the keys.
- [ ] **Step 5: Commit** `feat(study): new appearance and layout settings with a one-time upgrade`

### Task 5: Toasts with an action

**Files:**
- Modify: `SH/Toasts.jsx`, `SH/ShellContext.js` (doc comment)
- Test: `SH/Toasts.test.jsx`

**Interfaces:**
- Produces: `toast(text, action?)` where `action = { label: string, run: () => void }`; the action is a ghost Button; running it dismisses the toast. Existing `toast(text)` calls unchanged.

- [ ] **Step 1: Failing test** `it("runs and dismisses an action")`: `toast("Layout saved", { label: "Undo", run })`, click "Undo", expect `run` called once and the text gone.
- [ ] **Step 2: Run to fail. Step 3: Implement. Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(study): toasts can carry an Undo`

### Task 6: Settings dialog and Appearance

**Files:**
- Create: `SH/settings/SettingsDialog.jsx` (replaces `SettingsModal.jsx`), `SH/settings/appearance/ThemeCards.jsx`, `SH/settings/appearance/ThemeEditor.jsx`, `SH/settings/LayoutSection.jsx`, `SH/settings/ExtensionsSection.jsx`
- Modify: `SH/settings/AppearanceSection.jsx` (rewrite), `SH/settings/controls.jsx` (same exports and props, rendered with `SH/ui` parts: `Toggle` → `Switch`, `Segmented` → `ToggleGroup`), `SH/settings/settings.css` (only what Tailwind can't express), `SH/StudyPreview.jsx` (use `SettingsDialog`, `useTheme`)
- Delete: `SH/settings/SettingsModal.jsx`, `SH/settings/ColorsSection.jsx`, `SH/settings/WidgetsSection.jsx`, `SH/colorStyles.js`, `SH/colorStyles.test.js`
- Test: `SH/settings/SettingsDialog.test.jsx`; update `SH/StudyPreview.test.jsx` (the clock, color-style, glass/glow and quick-style tests are replaced by the tests below)

**Interfaces:**
- Consumes: `resolveTheme`, `PRESETS`, `THEME_KEYS` (Task 2); `useTheme` (Task 3); settings shape (Task 4); `toast` (Task 5); `ui/*` (Task 1).
- Produces: `SECTIONS` = `[{id:"appearance"},{id:"layout"},{id:"studying"},{id:"ai"},{id:"notifications"},{id:"shortcuts"},{id:"data"},{id:"extensions"},{id:"about"}]` (labels "Appearance", "Layout and home screen", "Studying", "AI", "Notifications", "Shortcuts", "Data", "Extensions", "About"); `SettingsDialog({ section, onSection, onClose, settings, set, reset })`; `openSettings(section = "appearance")`. `LayoutSection` reads `shell.layoutApi = { editLayout(), resetAll(), homeWidgets(): {id,on}[], setHomeWidget(id,on) }` (filled in Task 11; until then the section renders its controls disabled).

- [ ] **Step 1: Failing tests**

```jsx
it("opens on Appearance with Ctrl+,", ...);              // dialog "Settings", heading "Appearance"
it("picking a theme applies it live", ...);               // click card "Theme: Paper" → documentElement --st-c-background lightness > 90
it("editing shows Unsaved changes, saving keeps it as my theme", ...); // click "Accent: Red" → badge; type "Exam" + "Save as my theme" → card "Theme: Exam" in "Your themes", badge gone
it("deleting my theme can be undone", ...);               // delete "Exam" → toast "Undo" → card back
it("lists no extension themes yet", ...);                 // text "Themes from extensions you install show up here."
it("keeps the studying, AI, notifications, shortcuts, data and about sections", ...);
it("has no glass, glow or colors settings", ...);         // queryByText("Glass"), ("Glow"), ("Colors") are null
```

- [ ] **Step 2: Run to fail. Step 3: Implement** following the mockup's `settings.js` (cards with a mini preview, three groups, Customize rows, name field `maxLength={40}`, Save always creates a new theme `{ id: "mine-<time36>", name: name || "My theme <n>", ...choices }`). Background swatch flipping dark↔light also resets `graph` to the readable default unless it is `"accent"`. Custom color uses `<input type="color">` overlaid on a "Custom" chip. Appearance also keeps the "Opening animation" and "Reduce motion" switches and the text size choice.
- [ ] **Step 4: Run to pass**, and `npm test -- src/views/studyhome`.
- [ ] **Step 5: Commit** `feat(study): Settings dialog with themes and a theme editor`

### Task 7: Tabs

**Files:**
- Create: `SH/shell/tabs.js`, `SH/shell/TabBar.jsx`, `SH/shell/Breadcrumb.jsx` (moved out of `StudyPreview.jsx`)
- Modify: `SH/StudyPreview.jsx` (tabs replace the single `route`; `shell.open(route)` keeps its signature and opens or activates a tab), `SH/views/PageView.jsx` and `SH/views/ContainerView.jsx` (render `Breadcrumb` above the title)
- Test: `SH/shell/tabs.test.js`, `SH/shell/TabBar.test.jsx`

**Interfaces:**
- Produces: tab ids `"home" | "graph" | "sources" | "quick-notes" | "extensions" | "chats" | "node:<id>" | "source:<id>"`; `tabIdOf(route) -> string`, `routeOf(tabId) -> route`; `openTab(tabs, id) -> tabs`, `closeTab(tabs, id) -> tabs` (Home can't close; active moves to the left neighbour), `reorderTabs(tabs, id, toIndex) -> tabs`, `sanitizeTabs(tabs, state) -> tabs` (drops unknown ids and deleted nodes/sources; always keeps `"home"`; active falls back to `"home"`). `TabBar({ tabs, onSelect, onClose, onReorder, tools, at: "top"|"bottom" })`. Tabs live in `settings.layout.tabs`.

- [ ] **Step 1: Failing tests**

```js
it("opens, activates and closes tabs", () => { let t = openTab({ list: ["home"], active: "home" }, "node:a"); expect(t).toEqual({ list: ["home","node:a"], active: "node:a" }); t = closeTab(t, "node:a"); expect(t.active).toBe("home"); });
it("never closes Home", () => expect(closeTab({ list: ["home"], active: "home" }, "home").list).toEqual(["home"]));
it("drops tabs for deleted items", () => expect(sanitizeTabs({ list: ["home","node:gone","source:s1"], active: "node:gone" }, { nodes: {}, sources: [{ id: "s1" }] })).toEqual({ list: ["home","source:s1"], active: "home" }));
it("round-trips routes", () => expect(routeOf(tabIdOf({ view: "node", id: "x" }))).toEqual({ view: "node", id: "x" }));
```

TabBar test: tabs render as `role="tab"` with the active one `aria-selected="true"`; dragging a tab 100px right calls `onReorder`; the page tab's close button calls `onClose`; Arrow keys move focus between tabs.

- [ ] **Step 2: Run to fail. Step 3: Implement.** The tab bar shows only the tabs, Search (opens QuickFind), `TopBarClock`, and the AI chat toggle. A deleted item's tab is removed by running `sanitizeTabs` whenever study state changes.
- [ ] **Step 4: Run to pass**, then update the `StudyPreview.test.jsx` breadcrumb assertion to look inside the page (`screen.getByRole("navigation", { name: "Breadcrumb" })`).
- [ ] **Step 5: Commit** `feat(study): tabs for every screen and page`

### Task 8: Auto-hide tab bar and sidebar side

**Files:**
- Create: `SH/shell/useAutoHide.js`
- Modify: `SH/shell/TabBar.jsx`, `SH/StudyPreview.jsx`, `SH/sidebar/Sidebar.jsx` (header is the drag handle to switch sides; its grip button visually hidden, kept for keyboard), `SH/styles/shell.css`, `SH/settings/LayoutSection.jsx` (Tab bar row)
- Test: `SH/shell/useAutoHide.test.jsx`

**Interfaces:**
- Produces: `useAutoHide({ enabled, edge: "top"|"bottom", containerRef, barRef, keepOpen: () => boolean }) -> boolean shown`. Shown when the pointer is within 10px of the container's edge (or leaves the window through it), while the bar has focus, or while `keepOpen()`; hides 450ms after the pointer leaves the bar's box plus 12px. In auto mode the bar is `position: absolute` over the content.

- [ ] **Step 1: Failing tests** (fake timers):

```jsx
it("appears near the top edge and hides 450ms after leaving", ...);
it("stays while a menu from the bar is open", ...);   // keepOpen returns true → still shown after 1000ms
it("shows when the bar gets keyboard focus", ...);
it("does nothing when disabled", ...);
```

And in `StudyPreview.test.jsx`: choosing "Show near the edge" in Settings > Layout and home screen keeps the content area's height the same when the bar appears (`getBoundingClientRect` of `.st-content` is unchanged; jsdom: assert the bar has `data-auto="true"` and is outside the content's flex flow via class).

- [ ] **Step 2: Run to fail. Step 3: Implement.** `keepOpen` in the shell: a Radix menu opened from the bar is open (track `onOpenChange` from TabBar menus), or edit mode is on. Sidebar side is `appearance.sidebarSide`; dragging the sidebar header past the middle of the window flips it; the peek edge follows the side.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(study): optional auto-hide tab bar and a sidebar on either side`

### Task 9: Lanes model

**Files:**
- Create: `SH/edges/lanes.js`
- Test: `SH/edges/lanes.test.js`

**Interfaces:**
- Consumes: `widgetDef(id)` and `allowedIn(def, lane)` (Task 10; tests pass a stub `defs` map).
- Produces: `LANES = ["left","right","top","bottom"]`, `SIZES = ["s","m","l"]`, `LANE_WIDTH = { min: 220, max: 440, left: 272, right: 288 }`, `KIND_DEFAULTS` (Home: left `["continue","review"]`, right `["deadlines","chats","notes"]`, top `["clock"]`, bottom `["legend"]`, size `{ clock: "s", legend: "l" }`; page: right `["local","pagesrc"]`, size `{ local: "m", pagesrc: "s" }`; graph: bottom `["legend"]`, size `{ legend: "l" }`; others empty), `kindOfTab(tabId) -> "home"|"graph"|"sources"|"source"|"quick-notes"|"extensions"|"chats"|"page"|"container"`, `kindLayout(layout, kind, defs) -> { lanes, size, widths }` (defaults when missing; sanitized), `moveWidget(kl, id, lane, index, defs) -> kl` (refuses a lane the widget may not use: returns `kl` unchanged), `setSize(kl, id, size)`, `setLaneWidth(kl, lane, px)` (clamped), `addWidget(kl, id, lane, defs)` (first allowed lane when `lane` is omitted or not allowed), `removeWidget(kl, id)`, `homeWidgetList(kl, defs) -> { id, on }[]`.

- [ ] **Step 1: Failing tests**

```js
it("starts Home with the default lanes", () => expect(kindLayout({ kinds: {} }, "home", defs).lanes.top).toEqual(["clock"]));
it("moves between lanes at an index", () => { const kl = moveWidget(kindLayout({ kinds: {} }, "home", defs), "continue", "right", 1, defs); expect(kl.lanes.right).toEqual(["deadlines","continue","chats","notes"]); expect(kl.lanes.left).toEqual(["review"]); });
it("refuses a lane the widget may not use", () => { const kl = kindLayout({ kinds: {} }, "home", defs); expect(moveWidget(kl, "local", "top", 0, defs)).toBe(kl); });
it("clamps lane widths", () => expect(setLaneWidth(kindLayout({ kinds: {} }, "home", defs), "left", 9999).widths.left).toBe(440));
it("sanitizes damaged lanes", () => {
  const kl = kindLayout({ kinds: { home: { lanes: { left: ["continue","continue", 5], right: "x", top: ["ext:gone/w"] }, size: { continue: "huge" } } } }, "home", defs);
  expect(kl.lanes.left).toEqual(["continue"]);
  expect(kl.lanes.right).toEqual([]);
  expect(kl.lanes.top).toEqual(["ext:gone/w"]);   // unknown ids stay, shown as Missing widget
  expect(kl.size.continue).toBe("m");
});
```

- [ ] **Step 2: Run to fail. Step 3: Implement. Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(study): lanes model for the Edges layout`

### Task 10: Widget registry and widget frame

**Files:**
- Create: `SH/widgets/registry.js`, `SH/widgets/WidgetFrame.jsx`, `SH/widgets/builtin.jsx` (moves today's widgets from `SH/widgets.jsx` and adds Legend, Connected to this page, Sources for this page, On this page), `SH/widgets/widgets.css`
- Modify: `SH/views/PageView.jsx` (its inline local graph moves into the "local" widget), `SH/graph/HomeGraph.jsx` (legend moves into the "legend" widget)
- Delete: `SH/widgets.jsx` (re-export nothing; update imports)
- Test: `SH/widgets/registry.test.js`, `SH/widgets/WidgetFrame.test.jsx`

**Interfaces:**
- Produces: `registerWidget(id, def) -> () => void` (returns unregister), `widgetDef(id) -> def` (a `MISSING` def for unknown ids: title "Missing widget", body "The extension that added this widget isn't installed. Remove it, or install the extension again."), `allowedIn(def, lane) -> boolean`, `groupBySource(ids) -> [{ source: "builtin", items }, { source: "extension", items, empty: "Widgets from extensions you install show up here." }]`, `useWidgetDefs() -> Record<id, def>` (re-renders on register/unregister; `useSyncExternalStore`). A def is `{ title, icon, source: "builtin" | { kind: "extension", id, name }, lanes: "any" | "side" | "edge", size: "s"|"m"|"l", Component, bare?: boolean }`. Built-in ids: `continue, review, deadlines, chats, notes, recent, week, clock, legend, local, pagesrc, outline`. `local` and `pagesrc` and `outline` are `lanes: "side"`; `clock` and `legend` are `bare`. `WidgetFrame({ id, lane, size, onMenu(action), handleProps })`: header (or the whole card if `bare`) is the drag handle with `tabIndex=0`; a chevron `DropdownMenu` after the title with Move to (other lanes), Size (Small/Medium/Large), Remove; right-click opens the same menu (`ContextMenu`); Enter on the header opens it; the body sits in an error boundary showing "This widget stopped working". Widgets with nothing to show render a one-line empty message (today's `Empty` copy) and keep their place. `pagesrc` shows "No sources linked to this page yet." (sources have no page links yet). `outline` lists the page's h1–h3 headings parsed from its HTML.

- [ ] **Step 1: Failing tests**

```js
it("unknown ids come back as Missing widget", () => expect(widgetDef("ext:x/y").title).toBe("Missing widget"));
it("registering adds to the extension group", () => { const off = registerWidget("ext:a/w", { title: "W", source: { kind: "extension", id: "a", name: "A" }, lanes: "any", size: "m", Component: () => null }); expect(groupBySource(["ext:a/w"])[1].items).toEqual(["ext:a/w"]); off(); });
it("side-only widgets may not go on top", () => expect(allowedIn(widgetDef("local"), "top")).toBe(false));
```

```jsx
it("a crashing widget shows a message and the rest keeps working", ...);
it("the chevron and Enter open the menu", ...);
it("an empty widget keeps its place with a short message", ...);
```

- [ ] **Step 2: Run to fail. Step 3: Implement. Step 4: Run to pass**, then `npm test -- src/views/studyhome` (update the old "empty widgets stay hidden" test: they now show their empty message).
- [ ] **Step 5: Commit** `feat(study): widget registry with sources, a quiet frame and contained errors`

### Task 11: Edges layout on every screen

**Files:**
- Create: `SH/edges/EdgesLayout.jsx`, `SH/edges/useLaneDrag.js`, `SH/edges/edges.css`
- Modify: `SH/StudyPreview.jsx` (every screen renders inside `EdgesLayout` with its view as `center`; fills `shell.layoutApi`), `SH/settings/LayoutSection.jsx` (enable its controls)
- Delete: `SH/HomeScreen.jsx`, `SH/styles/home.css` (graph sizing moves to `edges.css`)
- Test: `SH/edges/EdgesLayout.test.jsx`, `SH/edges/useLaneDrag.test.js`

**Interfaces:**
- Consumes: `kindLayout`, `moveWidget`, `setSize`, `setLaneWidth`, `addWidget`, `removeWidget`, `homeWidgetList` (Task 9); `useWidgetDefs`, `WidgetFrame`, `groupBySource` (Task 10); `toast(text, action)` (Task 5).
- Produces: `EdgesLayout({ kind, center, layout, onLayout(next), editing, onEditing(bool), context })`; `useLaneDrag({ onDrop(id, lane, index), onCancel })`; `shell.layoutApi` as in Task 6; Ctrl+E toggles edit mode; Arrow keys on a focused widget header move it one place along its lane (Up/Left earlier, Down/Right later). Grid: `auto minmax(0,1fr) auto` columns, `auto minmax(0,1fr) auto` rows, 16px gaps; side lanes scroll inside; empty side lanes take no width; the graph's fit padding comes from the measured lane boxes.

- [ ] **Step 1: Failing tests**

```jsx
it("renders Home's default lanes around the graph", ...);   // regions Continue studying (in left lane), Clock (top), Legend (bottom); list "Graph" in the middle
it("moving a widget saves and offers Undo", ...);          // menu Move to > Right edge → widget now in right lane; toast "Layout saved" with "Undo" restores
it("sizes snap between small, medium and large", ...);
it("edit mode shows drop areas on empty lanes and Done ends it", ...); // "Drop widgets here"
it("Add widget lists built-in and an empty From extensions group", ...);
it("each kind of screen keeps its own arrangement", ...);  // change Home, open a page tab, page lanes are the page defaults
```

`useLaneDrag.test.js`: `it("cancels a drag")` — pointer up outside every lane calls `onCancel`, not `onDrop`; Escape during a drag calls `onCancel`.

- [ ] **Step 2: Run to fail. Step 3: Implement** following `c.js` in the mockup: drag starts after 5px; a placeholder holds the slot; siblings slide with a 200ms FLIP; the dragged card follows the pointer (`position: fixed`, shadow while lifted) and glides 180ms into its slot; the size handle snaps every 56px of pointer travel; lane width handles are keyboard-operable (Arrow ±16px). Reduced motion: no FLIP or glide.
- [ ] **Step 4: Run to pass**, then all study tests.
- [ ] **Step 5: Commit** `feat(study): the Edges layout on every screen`

### Task 12: Extensions tab and extension contributions

**Files:**
- Create: `SH/extensions/ExtensionsView.jsx`, `SH/extensions/useContributions.js`
- Modify: `SH/sidebar/Sidebar.jsx` (Extensions row under Library), `SH/StudyPreview.jsx` (tab `"extensions"`; `shell.openExtensions`; call `useContributions`), `SH/settings/ExtensionsSection.jsx` ("Open Extensions" button), `SH/settings/appearance/ThemeCards.jsx` (extension themes group)
- Test: `SH/extensions/ExtensionsView.test.jsx`, `SH/extensions/useContributions.test.jsx`

**Interfaces:**
- Consumes: `useExtensions()`/`contributionsOf` (`ExtensionsProvider`), `ExtensionFrame`, `registerWidget` (Task 10), `mapExtensionTheme` (Task 2).
- Produces: `useContributions() -> { themes: [{ id: "ext:<extId>/<themeId>", name, choices }] }`; registers each enabled extension widget as `ext:<extId>/<widgetId>` (def `source: { kind: "extension", id: extId, name: extName }`, `lanes: "any"`, `size: "m"`, `Component` rendering `ExtensionFrame` for that contribution) and unregisters it when the extension is disabled or removed. `ExtensionsView()`: title "Extensions", one line "Extensions add widgets, page blocks, tools and themes to Study.", a disabled search Input, then installed extensions (name, version) or "No extensions installed. Installing extensions isn't available yet."

- [ ] **Step 1: Failing tests**

```jsx
it("shows the empty state with no extensions", ...);
it("lists an installed extension's name and version", ...);   // seed records in localStorage "study-extensions-v1"
it("registers an enabled extension's widget and removes it when disabled", ...);
it("offers an extension theme under From extensions", ...);
```

- [ ] **Step 2: Run to fail. Step 3: Implement. Step 4: Run to pass**, then `npm test`.
- [ ] **Step 5: Commit** `feat(study): Extensions tab and extension widgets and themes`

### Task 13: Real-browser check and cleanup

**Files:**
- Modify: anything the check finds broken; `CLAUDE.md` of `lokus` only if a study-app gotcha is worth recording.
- Create (not committed): a BiDi script in a scratch directory, adapted from `/home/caesarsta/Downloads/BaseN/.impeccable/mockups/2026-10-07-freeform-shell/_build/bidi.mjs`.

- [ ] **Step 1: Search for leftovers**

Run: `grep -rn "glass\|glow\|colorStyles\|data-theme=\"deep\"\|st-bracket" src/views/studyhome | grep -v test`
Expected: no hits outside comments explaining the upgrade.

- [ ] **Step 2: Run everything** — `npm test` → all pass; `npm run build` → succeeds.

- [ ] **Step 3: Headless Firefox** against `npm run dev` at `/?view=study-preview` with `memory-engine serve` running on a scratch Study folder: no console errors; each of the six themes (screenshot Home); Settings opens with Ctrl+,; a theme edit saves; drag a widget from left to right lane and undo; resize a widget; Edit layout shows drop areas; Tab bar "Show near the edge" hides and shows the bar without moving the content (compare the content's `getBoundingClientRect().top` before and after); open a page tab and check the local graph widget draws (canvas non-empty); Extensions tab shows its empty state; reduced motion on, repeat one drag.

- [ ] **Step 4: Fix what it finds, re-run once.**

- [ ] **Step 5: Commit** `fix(study): what the real-browser check found` (if anything changed).
