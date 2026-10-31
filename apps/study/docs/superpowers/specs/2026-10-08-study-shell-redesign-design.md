# Study shell redesign: Edges layout, themes, Settings

Date: 2026-10-08. Status: design approved section by section; this written spec awaits review.
Branch: `study-shell-redesign`, from `study-vault`, with `feat/study-extensions` merged in as step 0 (user's choice). `feat/study-extensions` split off before all 13 `study-vault` commits (Study folder, Lokus graph, Sources), so building on it alone would lose them; only four files changed on both.
Reference mockups: `BaseN/.impeccable/mockups/2026-10-07-freeform-shell/` (`c-edges.html` is the chosen layout; `_build/src/` holds the theme model and the Settings code they were built from).

## Why

The user asked for a cooler, simpler UI that students can arrange freely, with a visibly new style. Through four rounds of mockups they settled on:

- a layout students arrange themselves, where nothing can overlap or get lost (**Edges**);
- a serious, professional look: small corners, firm type, muted accents, nothing that reads as a kids' app;
- colors and the rest of the look configurable by the student, with a true-black theme among the presets;
- a clean screen: theme and layout controls live in Settings, not in the top bar;
- an option for the tab bar to hide and slide in when the pointer comes near, without moving anything;
- quiet drag handles (no grip dots, no "⋯" buttons);
- room for extensions to add things to the home screen later, and an Extensions tab.

Still banned (earlier rejections): Herbarium metaphors, the Gotham/Palantir docked console and status bar, glare, glass shine, glows, color fog, vivid gradients, corner or bracket marks.

## Scope

In: the frame (sidebar, tabs, tab bar, AI chat panel), the Edges layout on every screen, the theme model and editor, the Settings dialog, the widget registry, the Extensions tab, the drag handles. Out: new data, the memory engine, FSRS, the AI, the extension install flow and its screens (the extension plumbing from `feat/study-extensions` is merged, not changed). Data stays in the Study folder through `memory-engine serve`, untouched.

## 1. Foundation: study-only shadcn

Lokus's Tailwind config has no shadcn color names, and Lokus already uses `text-secondary` (85 places) and `text-muted` as inert classes. Adding shadcn's names globally would restyle Lokus. So:

- shadcn components the study app needs are added under `src/views/studyhome/ui/` (Dialog, DropdownMenu, ContextMenu, Tabs, Switch, Slider, Select, Tooltip, Input, Checkbox, Badge, Separator, Progress, Toggle, ToggleGroup, ScrollArea as needed; Radix underneath). Their color classes use a study-only prefix: `bg-st-background`, `text-st-muted-foreground`, `border-st-border`, `ring-st-ring`, and so on.
- `tailwind.config.cjs` gains these `st-*` colors only, each `hsl(var(--st-<name>) / <alpha-value>)`, plus `st` radius steps from `--st-radius`. No existing Tailwind name changes.
- Shadow classes are dropped from the copied components (surfaces stay flat); only lifted or dragged items get a shadow.
- Lokus's existing `src/components/ui/*` are not used by the study app and are not changed.

Removed with the new look: `styles/fx.css`, `styles/glass.css`, `styles/blackout.css`, `colorStyles.js` and `settings/ColorsSection.jsx`, and the Appearance options for glass, glow, glow color and graph decorations. Animations stay. The opening animation stays as a switch in Appearance.

## 2. Themes and Settings

### Theme model (`studyhome/theme/themes.js`, pure functions)

Ported from the mockup's `themes.js`. A theme is a set of choices:

| Choice | Values |
|---|---|
| `base` | black, night, graphite, steel, dusk, chalk, paper (hue, saturation, lightness, dark or light) |
| `accent` | any `#rrggbb`; 7 quick swatches |
| `graph` | any `#rrggbb` or `accent`; 6 quick swatches incl. Lokus green |
| `radius` | sharp 2px, slight 4px, soft 6px |
| `density` | compact 14px, comfortable 15.5px root size |
| `uiFont` | Archivo, Inter Tight, IBM Plex Sans, Geist, Barlow, Instrument Sans |
| `readingFont` | Source Serif 4, Literata, Newsreader, IBM Plex Serif, same as interface |

`themeVars(choices)` returns every variable: background, card, popover, secondary, muted, accent, border, input, foreground, muted foreground, sidebar set, primary and its readable foreground (dark text on light accents, white on dark ones), ring, destructive, graph node, link, label, note and hollow fill, radius, root size, font families and display settings, four subject colors (separate dark and light sets), and `color-scheme`. All names carry the `--st-` prefix.

Built-in themes: **Black** (default; `#000`, muted blue `#5b8fd9`, Archivo with condensed titles, sharp), **Graphite** (warm charcoal, amber, Geist, slight), **Steel** (blue-gray slate, steel blue, IBM Plex, sharp), **Dusk** (blue-violet, muted lavender, Inter Tight, slight), **Chalk** (light cool gray, dark teal, Barlow, sharp), **Paper** (light warm paper, ink blue, Instrument Sans, slight, comfortable).

### Applying

While the study app is mounted, the resolved variables are set on `document.documentElement` (so Radix portals get them too) and removed on unmount. No Lokus variable is touched. A change applies live; an unsaved edit is a draft on top of the chosen theme.

### Fonts

The app runs offline, so fonts are bundled through `@fontsource` (as Archivo and Source Serif 4 already are), not loaded from Google. Only the current theme's fonts are imported at start; others are imported dynamically the first time they're chosen. A font that fails to load falls back to the system font.

### Extension themes

`feat/study-extensions` validates extension themes in the old color-style shape (`base` palette, `colors`, `accent`, `glow`, 8 `subjects`). They are mapped onto the new model: the old base maps to the nearest new base, `accent` is kept, `glow` is ignored, and the first four subject colors are used. The extension manifest format is not changed. They appear under "From extensions" in Appearance.

### Settings dialog (shadcn Dialog, section list on the left, Ctrl+,)

- **Appearance:** theme cards with a small preview, in three groups: Built in, Your themes (each deletable with undo), From extensions (empty message when none). Below them, Customize: Accent, Background, Graph dots, Corners, Density, Interface font, Page font; an "Unsaved changes" badge; a name field with "Save as my theme" (always creates a new theme) and "Discard changes". Plus the opening animation switch.
- **Layout and home screen:** Edit layout (closes Settings, enters edit mode; Ctrl+E), Reset to default (with undo), Tab bar (Always shown / Show near the edge), On Home (widget switches grouped Built in / From extensions).
- **Studying, AI, Notifications, Shortcuts, Data, About:** kept as they are, restyled with the new components.
- **Extensions:** one line on what extensions add and an "Open Extensions" button. `feat/study-extensions` stores `extensions: { autoUpdate, catalogUrl }` in settings but has no UI for them; adding those controls is part of the install flow, not this work.

### Saving and the one-time upgrade

Settings stay in `useSettings` under its storage key. `appearance` gains `themeId`, `themeDraft`, `customThemes`, `tabBar` (`always` | `auto`). One-time upgrade: the old `appearance.theme` maps to the closest new theme, the old `accent` becomes the draft accent if it differs, and each old color style in `appearance.styles` becomes an entry in Your themes (nearest base, its accent). Glass, glow and related keys are dropped.

## 3. Frame and the Edges layout

### Frame

Left to right: sidebar (page tree; left or right side; hide and peek as now; dragged by its header, its grip button kept only for keyboard users), main area (tab bar over the screen), AI chat panel on the right edge (hidden until opened, as now).

### Tabs (new)

Home, Graph, Sources, Quick notes, Extensions and each opened page get a tab. Tabs reorder by dragging; pages can be closed; the open tabs and the active one are remembered. The breadcrumb moves inside the page, above its title. The tab bar holds only the tabs, Search (Ctrl+K, the existing QuickFind from `feat/study-extensions`), a small clock and the AI chat toggle.

### Tab bar option

**Always shown** (default) or **Show near the edge**. In the second mode the bar is positioned over the screen, so the content gets the full height and nothing moves when it appears. It slides in when the pointer comes within 10px of its edge (or leaves the window through it) and stays while it is hovered, focused, has a menu open, or the layout is being edited; it slides out 450ms after the pointer leaves. Reduced motion makes this instant.

### Edges

Every screen has four lanes (left, right, top, bottom) around a middle that always stays free: the graph on Home and Graph; the screen's content on pages, Sources, Quick notes and Extensions.

Defaults: Home has Continue studying and Due for review on the left; Deadlines and exams, Latest chats and Quick notes on the right; the clock on top; the legend at the bottom. Pages have Connected to this page and Sources for this page on the right. Other screens start empty.

Arranging: drag a widget by its header to any lane; the others slide apart (FLIP animation) and a placeholder shows where it lands. Pull its edge to snap between Small, Medium and Large. Lanes resize by their inner line (220 to 440px). The chevron menu offers Move to, Size and Remove. Each kind of screen keeps its own arrangement. Every change shows "Layout saved · Undo". Edit layout shows all handles, "Drop widgets here" on empty lanes, and a bar with Add widget, Reset (this screen or everything) and Done.

A widget with nothing to show keeps its place and shows a one-line empty message (today such widgets disappear, which would make lanes jump).

The graph re-fits into the free middle when lanes change size.

### Code shape

`HomeScreen` becomes `EdgesLayout` (lanes, drag and size logic, edit mode), used by every screen. `StudyPreview.jsx` gains a tabs state in place of the single route. Layout state is a settings group `layout`: `{ kinds: { [kind]: { lanes, size, widths } }, side, sideWidth, sideHidden, tabsAt, chat, chatWidth, tabs }`. The old `home.widgets` left and right columns are converted once into the Home lanes.

## 4. Widgets, extensions, Extensions tab

### Registry (`studyhome/widgets/registry.js`)

One list. Each entry: id, title, icon, source (`builtin` or `{ kind: "extension", id, name }`), default size, allowed lanes (side, top/bottom, or both), component. Lanes, Add widget and On Home all read from it.

Built in: Continue studying, Due for review, Deadlines and exams, Latest chats, Quick notes, Recent pages, This week, Clock, Legend, Connected to this page, Sources for this page, On this page.

### Extensions

- `registerWidget(id, def)` adds an entry. Widget contributions from enabled extensions (`contributionsOf` in `ExtensionsProvider`) are registered through it as `ext:<extId>/<widgetId>`, drawn inside the existing sandboxed `ExtensionFrame`.
- Every grouped list has a "From extensions" group with an empty message: "Widgets from extensions you install show up here."
- A widget whose entry is missing (extension removed or disabled) renders as a "Missing widget" card that can be removed, so its slot survives.
- Each widget renders inside an error boundary: a crash shows "This widget stopped working" in that card only.

### Extensions tab

A sidebar entry under Library and a tab. `feat/study-extensions` has no Extensions screen, so this tab shows the title, one line on what extensions add, a disabled search box, and the installed list from `ExtensionsProvider`: each installed extension's name and version, or, with none, "No extensions installed. Installing extensions isn't available yet." No fake catalog; the list-and-detail view and installing come with the install flow.

### Handles

The card header is the drag handle (grab cursor on hover). A faint chevron after the title, shown on hover or focus, opens the card's menu; right-click opens it too. Keyboard: Tab focuses a header; arrow keys move the widget along its lane; Enter opens the menu. Bare widgets (clock, legend) are dragged by the card itself. Moves glide briefly (about 70ms to 200ms), instant under reduced motion. Resize marks are thin square lines; placeholders and outlines use the theme radius.

## 5. Errors, testing, build order

### When things go wrong

- A damaged or outdated saved layout or theme: that part falls back to its default; the rest keeps working; the app always opens.
- A missing font: system font.
- A crashing widget: contained (section 4).
- Study folder saving and its banner: unchanged.

### Tests (Vitest, written first)

- Theme model: every built-in theme yields every variable; primary foreground is readable on each accent; custom themes save, delete and undo; extension themes map; the one-time upgrade maps old themes, accents and color styles.
- Edges: moving between lanes, sizes, lane widths, reset and undo, missing widgets, converting the old home columns.
- Settings: the sections render; the tab bar option; On Home switches.
- Tabs: open, close, reorder, remembered across reloads.
- The study app's existing tests (including those from `feat/study-extensions`) keep passing.
- After each part, a headless Firefox check over WebDriver BiDi: no console errors, every theme, drag and resize, the auto-hide bar, the Settings dialog. (Tests mock the graph, so a real browser is needed for anything that draws on it.)

### Build order (each part works before the next)

0. Merge `feat/study-extensions` into the branch. Conflicts are in `StudyPreview.jsx`, `useSettings.js`, `data/operations.js` and `data/operations.test.js`; keep everything from both sides (`study-vault`'s `graphView` settings and Study folder wiring, the extension branch's `extensions` settings, QuickFind, Toasts and providers). All tests pass before step 1.
1. shadcn base: `studyhome/ui/` components with `st-*` classes; Tailwind `st-*` colors; bundled fonts.
2. Theme model and the Settings dialog (Appearance, Layout and home screen, the kept sections restyled); remove glass, glow and Colors; the one-time upgrade.
3. The frame: tabs, the tab bar option, sidebar on either side.
4. Edges with the widget registry and the quiet handles.
5. The Extensions tab, extension widgets and themes through the registry, the "From extensions" groups.

Nothing is merged without the user's OK.
