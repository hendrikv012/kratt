# Ember Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the study app the Ember look (Pixelify Sans, orange on neutral black), a sidebar that lists what matters, a snap-grid Home that is arranged only in Settings, and a real Kratt Chat backed by Open Notebook with chats saved in the Study folder.

**Architecture:** Four parts, built in order, each working before the next:
1. Theme tokens in `theme/themes.js`.
2. Sidebar sections, which read `useStudy()`.
3. A pure grid model (`home/grid.js`) with a renderer and a Settings editor. The grid replaces the Edges lanes for Home only.
4. Chats, stored as Markdown in `Chats/` through the existing `stateFromSnapshot` / `fileText` / `planSync` pipeline. A chat service resends each conversation through the one-shot `/notebook/ask` bridge.

**Tech Stack:** React 18, Vite, Tailwind with shadcn (`studyhome/ui/`), Vitest with jsdom and Testing Library, `@fontsource` font packages, js-yaml.

**Spec:** `docs/superpowers/specs/2026-10-20-ember-redesign-design.md`. Read it before any task. The chosen preview is row v3 of https://claude.ai/artifact/FgWjbWX7p32MhQLwMn4rsq (sources in `~/Base N/.ember-preview/project/Home3.dc.html` and `Chat3.dc.html`).

All paths below are relative to `src/views/studyhome/` unless they start with `package.json`, `docs/` or `src/`. Work in the worktree `~/Downloads/KRATT/apps/study-ember` (branch `ember-redesign`).

**Run order:** 0, 1, 2, **14, 15, 16**, 3, 4, … 13. Tasks 14–16 (Kratt styles, the Kratt component, the opening screen) were added on 2026-10-20 from spec §1b, and they come after Task 2.

## Global Constraints

- **Colors:**
  - Ground `#0e0e0e`, raised `#161616`, hover `#1c1c1c`, line `#232323`.
  - Text `#ece8e3` (≥ 15:1), soft `#a19c96` (≥ 7:1).
  - Accent `#ff8a3d`. Accent wash = accent at 14% over the ground.
- **Type:**
  - Pixelify Sans 400/500: 15 px body, 14 px minimum for any pixel text, letter-spacing 0.01em.
  - VT323 for the clock: 60 / 92 / 140 px at 1×1 / 2×1 / 2×2.
  - Geist 16 px with line-height 1.7 for note text.
- **Fonts and dependencies:**
  - No font loads from the network. New dependencies are pinned exactly: `@fontsource/pixelify-sans@5.3.0` and `@fontsource/vt323@5.3.0`.
  - Do not bump any Radix package (see `CLAUDE.md`: one copy of `@radix-ui/react-dismissable-layer`).
- **Copy:**
  - Sentence case everywhere.
  - Labels: **Notes** (the folder stays `Quick notes/`), **Kratt Chat**, **New chat**, **Chats**, **Due for review**, **Pinned**, **Subjects**, **Find**.
  - No "Edit home" button anywhere on Home.
- **Kratt:** Kratt shows up only where spec §1b lists. His animation always uses `steps()`, and it stops under `data-kratt-still` and under reduced motion. The app names itself **KRATT**; "Study folder" stays as it is.
- **Settings:** everything you customize lives in Settings. Home shows only the right-click item "Edit home screen…".
- **Chat memory budgets (UTF-8 bytes):** `short` 8192, `normal` 24576 (default), `long` 49152.
- **Engine:** no changes under `engine/`.
- **Tests:** run one file at a time with `npx vitest run <file>`. The full suite (`npm test`) is load-sensitive: on `main` (db455e9) it already shows 1–6 random 10 s timeouts per run. Use it only in Task 13, and re-run any file that timed out on its own.

## Review Focus

These are inputs the spec implies but no feature test would naturally hit. Each line has its pinning test in the task that owns the code.

1. A chat file someone edited by hand: missing front matter, a heading that is neither `### You` nor `### Kratt`, or text before the first heading. The text must survive a load and a save. (Task 9: `keeps hand-edited text`.)
2. A Study folder that already has a `Chats` subject folder made by the user. It must not show up as a subject. Its `.md` files directly inside become chats, and deeper files are ignored. (Task 9: `Chats folder is never a subject`.)
3. A saved Home layout from before this change (`layout.kinds.home` lanes). The first load after the update must keep the widget order and not lose widgets. (Task 7: `upgrades lanes to the grid once`.)
4. A pinned page that was deleted or renamed outside the app. It must drop out of Pinned on the next load, and a rename keeps the pin because the id is the same. (Task 3: `drops pins whose page is gone`.)
5. A question sent while Open Notebook is down, then sent again. Your turn must be saved once and not duplicated, and Try again must re-ask without appending a second "You" turn. (Task 11: `try again does not duplicate the question`.)

---

### Task 0: Worktree ready

**Files:** none changed.

- [ ] **Step 1:** In `~/Downloads/KRATT/apps/study-ember` run `npm ci`. Expected: it exits 0.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/theme/themes.test.js src/views/studyhome/edges/lanes.test.js`. Expected: all pass. This is the baseline.

---

## Part 1: Look

### Task 1: Ember theme tokens

**Files:**
- Modify: `theme/themes.js` (`BASES`, `UI_FONTS`, `READ_FONTS`, `PRESETS`, `DEFAULT_THEME_ID`, `palette`, `themeVars`, `bridgeVars`)
- Test: `theme/themes.test.js`

**Interfaces:**
- **Produces:**
  - `BASES.ember = { name: "Ember", dark: true, h: 0, s: 0, l: 5.5, tones }`. `tones` overrides colors that `palette()` would otherwise derive, as `[h, s, l]` values: `card: [0, 0, 8.6]`, `accent: [0, 0, 11]`, `border: [0, 0, 13.7]`, `foreground: [33, 21, 91]` and `"muted-foreground": [33, 5, 61]`. Tones are applied after the derived values and before the `*-foreground` copies.
  - `UI_FONTS.pixelify = { name: "Pixelify Sans", font: "pixelify", family: '"Pixelify Sans", system-ui, sans-serif', display` (the same), `stretch: "100%", weight: 500, tracking: "0.01em", mono: '"JetBrains Mono", ui-monospace, monospace', numeric: '"VT323", ui-monospace, monospace', pixel: true }`.
  - `READ_FONTS.geist = { name: "Geist", font: "geist", family: '"Geist Variable", "Geist", system-ui, sans-serif' }`.
  - `PRESETS[0] = { id: "ember", name: "Ember", base: "ember", accent: "#ff8a3d", graph: "accent", radius: "soft", density: "comfortable", uiFont: "pixelify", readingFont: "geist" }` and `DEFAULT_THEME_ID = "ember"`.
  - `themeVars(t)` adds `--st-font-numeric` (`f.numeric ?? f.mono`), and sets `--st-ui-size` to `"15px"` when `f.pixel`.
  - `bridgeVars(t)` adds `--st-accent-wash`: the hex of the accent mixed 14% over the background.
  - `export const isPixelFont = (t) => Boolean(UI_FONTS[t.uiFont]?.pixel)`.
  - `export function contrastRatio(a, b)` takes two hex colors and returns the WCAG ratio, using the existing `luminance`.

- [ ] **Step 1: Write the failing tests** in `theme/themes.test.js`:

```js
describe("Ember", () => {
  const ember = PRESETS.find((p) => p.id === "ember");
  it("is the default and the first preset", () => {
    expect(DEFAULT_THEME_ID).toBe("ember");
    expect(PRESETS[0].id).toBe("ember");
  });
  it("paints the v3 greys", () => {
    const v = bridgeVars(ember);
    expect(v["--st-bg"]).toBe("#0e0e0e");
    expect(v["--st-surface"]).toBe("#161616");
    expect(v["--st-hover"]).toBe("#1c1c1c");
    expect(v["--st-accent"]).toBe("#ff8a3d");
    expect(v["--st-accent-wash"]).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("keeps text readable", () => {
    const v = bridgeVars(ember);
    expect(contrastRatio(v["--st-text"], v["--st-bg"])).toBeGreaterThanOrEqual(15);
    expect(contrastRatio(v["--st-text-soft"], v["--st-bg"])).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(v["--st-text-soft"], v["--st-surface"])).toBeGreaterThanOrEqual(4.5);
  });
  it("uses Pixelify for the interface, VT323 for numbers, Geist for notes", () => {
    const v = themeVars(ember);
    expect(v["--st-font-sans"]).toContain("Pixelify Sans");
    expect(v["--st-font-numeric"]).toContain("VT323");
    expect(v["--st-font-reading"]).toContain("Geist");
    expect(v["--st-ui-size"]).toBe("15px");
    expect(isPixelFont(ember)).toBe(true);
    expect(isPixelFont(PRESETS.find((p) => p.id === "black"))).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/theme/themes.test.js`. Expected: FAIL, because `contrastRatio` is undefined.
- [ ] **Step 3: Implement** the Interfaces above. Existing tests that assert `DEFAULT_THEME_ID === "black"` or `PRESETS[0]` change to Ember. Keep every other preset as it is.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then run `npx vitest run src/views/studyhome/theme/useTheme.test.jsx src/views/studyhome/settings/upgrade.test.js`. Expected: PASS. Fix any test that pinned the old default.
- [ ] **Step 5: Commit** with `feat(theme): Ember preset, Pixelify and Geist choices`.

### Task 2: Fonts bundled, the pixel size floor, and the clock font

**Files:**
- Modify: `package.json`, `package-lock.json`, `theme/fonts.js`, `theme/useTheme.js`, `StudyPreview.jsx` (the `.study` root), `styles/base.css`, every `studyhome/**/*.css` with a `font-size` under 14px, `ClockWidget.jsx`, and `widgets/widgets.css` (`.st-clock-time`)
- Test: `theme/fonts.test.js`, `theme/useTheme.test.jsx`

**Interfaces:**
- **Consumes:** `isPixelFont` and `UI_FONTS.pixelify.font === "pixelify"` from Task 1.
- **Produces:**
  - `loadFont("pixelify")` imports `@fontsource/pixelify-sans/400.css`, `@fontsource/pixelify-sans/500.css` and `@fontsource/vt323/400.css`.
  - `useTheme()` also returns `pixel: boolean`.
  - The `.study` root gets `data-pixel` when `pixel` is true.
  - The CSS variable `--st-min-text` is `14px` under `.study[data-pixel]` and `0px` otherwise.

- [ ] **Step 1:** Run `npm i -E @fontsource/pixelify-sans@5.3.0 @fontsource/vt323@5.3.0`. Then confirm `find node_modules -path '*react-dismissable-layer/package.json' | wc -l` prints `1`.
- [ ] **Step 2: Write the failing tests.**
  - In `fonts.test.js`: `it("bundles Pixelify Sans with VT323")` asserts `await loadFont("pixelify")` resolves `true`.
  - In `useTheme.test.jsx`: `it("marks pixel themes")`. It renders a probe with `appearance.themeId = "ember"` and expects `pixel === true`; with `"black"` it expects `false`.
- [ ] **Step 3:** Run `npx vitest run src/views/studyhome/theme/fonts.test.js src/views/studyhome/theme/useTheme.test.jsx`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Add the `pixelify` loader in `fonts.js`.
  - Return `pixel` from `useTheme`, and set `data-pixel={pixel || undefined}` on the `.study` root in `StudyPreview.jsx`.
  - In `styles/base.css`, add `.study{--st-min-text:0px} .study[data-pixel]{--st-min-text:14px}` and the rule `.study[data-pixel] :is(.text-xs,.text-\[11px\],.text-\[12px\],.text-\[12\.5px\],.text-\[13px\]){font-size:14px}`.
  - Rewrite every `font-size: Npx` with N < 14 in `studyhome` CSS as `font-size: max(Npx, var(--st-min-text))`. To find them, run `grep -rnE "font-size: ?1[0-3](\.[0-9])?px" src/views/studyhome --include=*.css`.
  - The clock's digital time uses `font-family: var(--st-font-numeric)`. Its size comes from the tile (Task 7). Until then keep the current size.
- [ ] **Step 5:** Run the Step 3 command. Expected: PASS. Then `npm run build`. Expected: exit 0.
- [ ] **Step 6: Manual check.** With `npm run dev`, Home renders in Pixelify on black, and no visible text is smaller than 14 px. Spot-check it in devtools.
- [ ] **Step 7: Commit** with `feat(theme): bundle Pixelify and VT323, 14px floor for pixel text`.


### Task 14: Kratt styles, dark and light

**Files:**
- Modify: `theme/themes.js` (`BASES`, `PRESETS`, `palette`, `themeVars`, `bridgeVars`), `settings/appearance/ThemeCards.jsx`, `settings/AppearanceSection.jsx`
- Create: `theme/styles.js`, `theme/styles.test.js`

**Interfaces:**
- **Consumes:** the Ember preset and `tones` mechanism from Task 1.
- **Produces:**
  - `tones` values may be a hex string or `[h, s, l]`; `palette()` converts hex with `hexToHsl`.
  - Each Kratt style gets one base per mode: `ember` (already there), `ember-light`, `deepred`, `deepred-light`, `chrome`, `chrome-light`, `green`, `green-light`, `steel`, `steel-light`. Each has `dark` set to match and exact `tones` taken from the spec §1b table, mapped like this:

    | Table token | Palette key |
    |---|---|
    | ground | `background` |
    | raise | `card` |
    | hover | `accent` |
    | line | `border` |
    | text | `foreground` |
    | soft | `muted-foreground` |
    | body | `body` (new) |
    | ink | `primary-foreground` |

  - Each style has a matching preset: `{ id, name, base, accent, kratt, graph: "accent", radius: "soft", density: "comfortable", uiFont: "pixelify", readingFont: "geist" }`. Light presets are named `"<Name> light"`, and `ember-light` uses the `ember-light` base.
  - `themeVars` emits `--st-kratt` (`t.kratt ?? t.accent`). `bridgeVars` emits `--st-kratt` and `--st-text-body` (the `body` tone, else `foreground`).
  - In `theme/styles.js`:
    - `export const KRATT_STYLES = ["ember", "deepred", "chrome", "green", "steel"]`
    - `export function styleOf(themeId)` returns `{ style, mode } | null`: `"green-light"` gives `{ style: "green", mode: "light" }`, and a theme that isn't one of the five styles (for example `"paper"`) gives `null`.
    - `export function themeIdFor(style, mode)` returns `style` for dark and `style + "-light"` for light.
- **The Appearance section,** top to bottom:
  1. "Style": five cards in `KRATT_STYLES` order. Each card shows a 46 px `Kratt` once Task 15 lands; until then, a swatch of the kratt color. It also shows the accent, text and raised swatches and the style name. A card is a `button` with `aria-pressed`.
  2. "Mode": a `Segmented` control with Dark and Light.
  3. A disclosure "More themes" that holds the existing `ThemeCards` for the other presets, custom themes and extension themes.
  4. The `ThemeEditor` and the "Text and motion" group, unchanged.
  - When the current theme isn't a Kratt style, no Style card is pressed and Mode reads the theme's darkness.

- [ ] **Step 1: Write the failing tests** in `theme/styles.test.js`:
  - `every style matches the spec table`: for each of the 10 presets, `bridgeVars(preset)` gives `--st-bg`, `--st-surface`, `--st-hover`, `--st-line`, `--st-text`, `--st-text-soft`, `--st-text-body`, `--st-accent`, `--st-accent-ink` and `--st-kratt` equal to the §1b table values. Copy the ten rows into the test as a literal table.
  - `every style is readable`: using `contrastRatio`, text/bg and body/bg are ≥ 7; soft/bg, soft/surface, accent/bg, accent/surface and ink/accent are ≥ 4.5; kratt/surface is ≥ 3.
  - `mode round-trips`: `themeIdFor("green", "light") === "green-light"`, `styleOf("green-light")` equals `{ style: "green", mode: "light" }`, `styleOf("ember")` equals `{ style: "ember", mode: "dark" }`, and `styleOf("paper") === null`.
  - In `settings/SettingsDialog.test.jsx`, `it("picks a Kratt style and mode")`: open `/?settings=appearance`, click "Racing green", then "Light". The saved `appearance.themeId` is `"green-light"`, and `document.documentElement.style.getPropertyValue("--st-c-background")` changes.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/theme/styles.test.js src/views/studyhome/settings/SettingsDialog.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/theme/themes.test.js src/views/studyhome/theme/useTheme.test.jsx`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(theme): Kratt styles in dark and light`.

### Task 15: Kratt himself

**Files:**
- Create: `kratt/Kratt.jsx`, `kratt/kratt.css`, `kratt/Kratt.test.jsx`, `public/kratt.svg` (copy `~/Base N/kratt_animated.svg` as it is)
- Modify: `index.html` (`<title>KRATT</title>`, favicon `/kratt.svg`), `useSettings.js` (`DEFAULTS.appearance.krattMoves = true`), `settings/AppearanceSection.jsx` (the "Kratt moves" row in "Text and motion"), `StudyPreview.jsx` (`data-kratt-still` on `.study` when `!krattMoves`), and `settings/appearance/*` (the Style cards show `<Kratt size={46} />` on each style's own `--st-kratt`)

**Interfaces:**
- **Consumes:** `--st-kratt` from Task 14.
- **Produces:**
  - `export default function Kratt({ size = 20, mode = "idle", label })`, where `mode` is one of `"idle" | "think" | "hop" | "sleep"`.
  - It renders `<svg class="st-kratt" data-mode={mode} width={size} height={round(size * 58 / 72)} viewBox="-3 -6 72 58" shape-rendering="crispEdges">`. With a `label` it has `role="img"` and `aria-label={label}`; otherwise it is `aria-hidden="true"`.
  - Inside are the parts `k-hop > k-tl, k-tr, k-body, k-fork, k-lids, k-z` with the paths from `public/kratt.svg`.
  - `kratt.css` holds the keyframes from `public/kratt.svg`, scoped to `.st-kratt`, with `[data-mode]` selectors. `.st-hopper:hover .st-kratt .k-hop` plays the hop.
  - The rules `.study[data-kratt-still] .st-kratt *` and `@media (prefers-reduced-motion: reduce) .st-kratt *` both set `animation: none !important`.
  - "Kratt moves" row: the label is "Kratt moves", and the description is "He blinks, hops and thinks. Off keeps him still."

- [ ] **Step 1: Write the failing tests** in `kratt/Kratt.test.jsx`:
  - `is decorative without a label`: `aria-hidden="true"` and no role.
  - `is an image with a label`: `getByRole("img", { name: "Kratt is thinking" })` has `data-mode="think"`.
  - `keeps the logo's proportions`: `size={30}` gives `height="24"`.
  - `Kratt moves off marks the app still`: render the app with saved `appearance.krattMoves: false`, and `.study` has `data-kratt-still`.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/kratt/Kratt.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/settings/SettingsDialog.test.jsx`. Expected: PASS. Then `npm run build`. Expected: exit 0.
- [ ] **Step 5: Commit** with `feat(kratt): the Kratt sprite, Kratt moves setting, KRATT title and favicon`.

### Task 16: Opening screen

**Files:**
- Create: `kratt/Splash.jsx`, `kratt/splash.css`, `kratt/Splash.test.jsx`
- Modify: `data/StudyProvider.jsx` (props `onPhase`, `renderGate`), `StudyPreview.jsx` (render `Splash` above everything; start the intro only after the splash is done)

**Interfaces:**
- **Consumes:** `Kratt` from Task 15; `resolveTheme` and `bridgeVars` from `theme/themes.js`.
- **Produces:**
  - `StudyProvider` gets two optional props:
    - `onPhase(phase)`, called whenever the phase changes, with `phase` one of `"loading" | "offline" | "ready"`.
    - `renderGate(phase)`, used in place of the built-in gate text when given.
  - `export default function Splash({ phase, animate, onDone })`:
    - It is a fixed, full-screen `role="status"` element. Its inline style is `bridgeVars(resolveTheme(settings.appearance).choices)` (the background is `--st-bg`).
    - **The sequence** runs only when `animate` is true:
      - Kratt (96 px) drops in with `steps(3)` over 0–500 ms and lands with one hop.
      - "KRATT" types in from 500 to 1000 ms, one letter per 100 ms, using `steps(5)` on a width clip.
      - He blinks and waves his fork over 1000–1400 ms.
    - **After the sequence:**
      - `ready` fades out over 250 ms, then calls `onDone()`.
      - `loading` puts Kratt in `"think"` mode and shows "Opening your Study folder…".
      - `offline` puts Kratt in `"sleep"` mode and shows `OFFLINE_MESSAGE`.
      - When the phase later becomes `ready`, the screen fades and calls `onDone()`.
    - **Accessible names:** "Opening KRATT" during the sequence, then the text it shows.
    - A `pointerdown` or `keydown` anywhere skips to the end state.
  - `animate` is `appearance.openingAnimation && !appearance.reduceMotion && !prefersReducedMotion`. When it is false, there is no sequence and no fade: the screen shows a still Kratt and the wordmark while not ready, and calls `onDone()` as soon as the phase is `ready`.
  - In `StudyPreview`: `const [splashDone, setSplashDone] = useState(false)`. It passes `renderGate={() => null}` and `onPhase={setPhase}` to `StudyProvider`, and renders `{!splashDone && <Splash … />}`. `Shell` gets `splashDone`, and `useIntro` starts its timer only once `splashDone` is true.
  - The constants `SPLASH_SEQUENCE_MS = 1400` and `SPLASH_FADE_MS = 250` are exported for tests.

- [ ] **Step 1: Write the failing tests** in `kratt/Splash.test.jsx`, using fake timers (`vi.useFakeTimers()`):
  - `plays then opens Home`: the app renders with `fakeClient(SAMPLE_SNAPSHOT)` and saved `openingAnimation: true`. `getByRole("status", { name: "Opening KRATT" })` is present. After advancing 1400 + 250 ms, the status is gone and the tab "Home" is shown.
  - `waits thinking while loading`: with a client whose `snapshot()` never resolves, after 1400 ms the status reads "Opening your Study folder…" and its Kratt has `data-mode="think"`.
  - `sleeps when offline`: with a client whose `snapshot()` rejects with `VaultOffline`, after 1400 ms the status contains `OFFLINE_MESSAGE` and Kratt has `data-mode="sleep"`.
  - `a key skips it`: press a key at 200 ms, and with the phase ready, Home shows after `SPLASH_FADE_MS`.
  - `no sequence when the opening animation is off`: with saved `openingAnimation: false`, there is no "Opening KRATT" status; Home shows as soon as the data is ready.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/kratt/Splash.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Some existing tests wait for Home right after render. They get `openingAnimation: false` in their saved settings, or they advance the timers. Change only what is needed, and list each changed test file in the report.
- [ ] **Step 4:** Run the Step 2 command, then `npx vitest run src/views/studyhome/StudyPreview.test.jsx src/views/studyhome/data/StudyProvider.test.jsx src/views/studyhome/vaultSettings.test.jsx`. Expected: PASS.
- [ ] **Step 5: Manual check.** In `npm run dev` with the service running, the splash plays and opens Home. With the service stopped, Kratt sleeps with the offline message. With "Opening animation" off, the app opens without the sequence.
- [ ] **Step 6: Commit** with `feat(kratt): opening screen`.

---

## Part 2: Sidebar

### Task 3: Pinned pages in the Study folder layout

**Files:**
- Modify: `data/operations.js` (`EMPTY_STATE.pinned = []`, `pinPage`, `unpinPage`, `mutations`), `data/vaultState.js` (`stateFromSnapshot`, `layoutOf`)
- Test: `data/vaultState.test.js`, `data/operations.test.js`

**Interfaces:**
- **Produces:**
  - `state.pinned: string[]`, a list of page ids.
  - `pinPage(state, id)` appends the id if it isn't already pinned.
  - `unpinPage(state, id)` removes it.
  - Both return the same `state` object when nothing changes, and both are exposed as `actions.pinPage(id)` and `actions.unpinPage(id)`.
  - `layoutOf` writes `layout.pinned` only when the list is not empty.
  - `stateFromSnapshot` reads `layout.pinned` and keeps only ids of existing pages.

- [ ] **Step 1: Write the failing tests:**
  - `it("drops pins whose page is gone")`: a snapshot with `layout.pinned: ["p1", "gone", "Biology"]` gives `state.pinned` equal to `["p1"]` (`Biology` is a subject, not a page).
  - `it("writes pins to the layout")`: `planSync` from a state without pins to `pinPage(state, "p1")` produces exactly one op, `{ op: "layout" }`, whose `layout.pinned` is `["p1"]`.
  - `it("pinPage is idempotent")` asserts `pinPage(pinPage(s, "p1"), "p1").pinned` equals `["p1"]`, and that `unpinPage(s, "x")` returns `s` itself.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/data/vaultState.test.js src/views/studyhome/data/operations.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the Interfaces.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(data): pinned pages kept in the Study folder layout`.

### Task 4: Sidebar sections and their Settings switches

> **Amended (§1b):** the header is `<div class="st-hopper"><Kratt size={30} /><span>KRATT</span></div>`, not "K"/"Kratt". Test `lists sections in order` also asserts the text "KRATT".

**Files:**
- Create: `sidebar/ChatsSection.jsx`, `sidebar/ReviewSection.jsx`, `sidebar/PinnedSection.jsx`
- Modify: `sidebar/Sidebar.jsx`, `sidebar/sidebar.css`, `mastery.js`, `useSettings.js` (`DEFAULTS.layout.sidebar`), `settings/LayoutSection.jsx`, and `StudyPreview.jsx` (the props passed to `Sidebar`; `recentIds` seeded from `state.recent`)
- Test: create `sidebar/Sidebar.test.jsx`

**Interfaces:**
- **Consumes:** `state.pinned` and `actions.unpinPage` from Task 3.
- **Produces:**
  - `DEFAULTS.layout.sidebar = { chats: true, review: true, pinned: true }`.
  - `export function dueForReview(state)` in `mastery.js` returns `[]` for now. The comment says scheduling doesn't exist yet.
  - The section components take no props and read `useStudy()`, `useShell()` and `settings.layout.sidebar`, passed down through a `sections` prop on `Sidebar`.
  - `ChatsSection` reads `state.chats ?? []` (filled in Task 9). It shows the 3 most recent chats with a relative time from `relativeTime(ms, now)`, which you create in `sidebar/ChatsSection.jsx`. The formats are "now" (under a minute), "12m", "2h", a weekday short name within 7 days, and "20 Oct" after that.
  - When there are no chats, it shows the empty text "No chats yet".
  - A row calls `shell.chat.open(id)`. Task 11 provides `shell.chat`; until then, guard with `shell.chat?.open`.
- **The sidebar's order and copy,** exactly:
  1. The header: the mark "K", then "Kratt".
  2. "Find" with "Ctrl K".
  3. Home, Graph, Notes (the count of quick notes).
  4. "New chat" with "Ctrl J".
  5. The sections Chats ("See all"), Due for review (count badge), Pinned, and Subjects (the existing `SubjectTree`).
  6. Then Sources, Extensions, Settings.
  - The "Library" heading and the "AI chats" row are removed.
- **Settings:** under Settings > Layout and home screen, a group "Sidebar" with three `Toggle`s labelled "Chats", "Due for review" and "Pinned".

- [ ] **Step 1: Write the failing tests** in `sidebar/Sidebar.test.jsx`. Render the app with `fakeClient(SAMPLE_SNAPSHOT)` the way `StudyPreview.test.jsx` does.
  - `it("lists sections in order")`: the sidebar's text contains, in order, "Find", "Home", "Graph", "Notes", "New chat", "Chats", "Subjects". It has no "Library" and no "AI chats".
  - `it("hides empty sections")`: there is no "Due for review" heading and no "Pinned" heading, and "No chats yet" is shown.
  - `it("shows pinned pages")`: with `layout.pinned: ["p1"]`, the Pinned heading and a "Krebs cycle" link are shown, and clicking the link opens the tab "Krebs cycle".
  - `it("section switches hide sections")`: with `layout.pinned: ["p1"]`, open Settings (`/?settings=layout`) and switch "Pinned" off. The Pinned heading is gone.
  - `it("relativeTime")` is a pure test: `relativeTime(now - 30e3, now)` is "now", 12 minutes is "12m", 2 hours is "2h", and 10 days is the "20 Oct" format.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/sidebar/Sidebar.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Styles in `sidebar.css` follow the v3 preview (`Home3.dc.html`, the `.side`, `.row`, `.sec`, `.count` and `.newchat` rules).
  - Use theme variables, never hex values: raised is `--st-surface`, hover is `--st-hover`, the accent wash is `--st-accent-wash`.
  - The active row gets `box-shadow: inset 2px 0 0 var(--st-accent)`.
  - "New chat" calls `shell.chat?.newChat()`.
  - Seed `recentIds` in `StudyPreview` with `state.recent` page ids on mount, so Find lists recent pages when its box is empty.
- [ ] **Step 4:** Run the Step 2 command, then `npx vitest run src/views/studyhome/StudyPreview.test.jsx src/views/studyhome/settings/SettingsDialog.test.jsx`. Expected: PASS. Update tests that clicked "AI chats" or "Quick notes" in the sidebar to the new labels.
- [ ] **Step 5: Commit** with `feat(sidebar): chats, review, pinned sections with Settings switches`.

### Task 5: Pin from page and tab menus

**Files:**
- Modify: `views/PageView.jsx` (or wherever a page's context menu is built; find it with `grep -rn "Rename" views shell sidebar --include=*.jsx`), `shell/TabBar.jsx`
- Test: `views/PageView.test.jsx`, `shell/TabBar.test.jsx`

**Interfaces:**
- **Consumes:** `actions.pinPage` and `actions.unpinPage` from Task 3.
- **Produces:** a menu item "Pin to sidebar" when the page isn't pinned, and "Unpin" when it is, in both the page's context menu and the page tab's context menu.

- [ ] **Step 1: Write the failing tests:**
  - `it("pins and unpins a page from its tab menu")`: right-click the "Krebs cycle" tab, choose "Pin to sidebar", and the sidebar's Pinned section lists it. Open the menu again and choose "Unpin", and it's gone.
  - Write the same test for the page's own menu.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/shell/TabBar.test.jsx src/views/studyhome/views/PageView.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Add the items.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(sidebar): pin pages from page and tab menus`.

---

## Part 3: Home grid

### Task 6: Grid model

**Files:**
- Create: `home/grid.js`, `home/grid.test.js`
- Modify: `widgets/builtin.jsx` (add `sizes`/`homeSize` to each def, add the `graph` def), `widgets/registry.js` (update the def comment and `MISSING`)

**Interfaces:**
- **Produces** (all pure functions; inputs are never mutated, and an unchanged result returns the same object):
  - `export const GRID_COLUMNS = 6`
  - `export const TILE_SIZES = ["1x1", "2x1", "2x2", "4x2", "6x2"]`
  - `export const spanOf = (size) => ({ w, h })`
  - `export function sizesOf(def)` returns `def?.sizes ?? ["2x1", "2x2"]`. `export function homeSizeOf(def)` returns `def?.homeSize ?? sizesOf(def)[0]`.
  - `export const HOME_ORDER = ["graph", "clock", "continue", "review", "chats", "deadlines", "notes"]`
  - `export function homeLayout(saved, defs)` returns `{ order: string[], size: Record<string, TileSize> }`. With no `saved` it returns `HOME_ORDER` and default sizes. It removes duplicates and anything that isn't a string. Unknown ids stay. A size not in `sizesOf(defs[id])` becomes `homeSizeOf(defs[id])`.
  - The edit functions:
    - `moveTile(hl, id, index)`
    - `setTileSize(hl, id, size, defs)`, which returns `hl` if the size isn't allowed.
    - `addTile(hl, id, defs)`, which appends with the default size.
    - `removeTile(hl, id)`
  - `export function fromLanes(lanes)` turns `{ left, right, top, bottom }` into `{ order, size: {} }`, reading the lanes in the order top, left, right, bottom.
  - `export function homeTileList(hl, defs)` returns `[{ id, on }]`: the placed tiles first, then every other non-`page` def, off.
- **The built-in defs** get these fields:
  - `graph`: `sizes ["2x2", "4x2", "6x2"]`, `homeSize "4x2"`. It is a new def, "Graph", using the `Waypoints` icon; its Component is Task 7's `GraphTile`. For now use a placeholder that renders `null`.
  - `clock`: sizes `["1x1", "2x1", "2x2"]`, default `"2x1"`.
  - `continue`: `["2x1", "2x2"]`, default `"2x1"`.
  - `review`: `["2x1", "2x2"]`, default `"2x2"`.
  - `chats`: `["2x1", "2x2"]`, default `"2x2"`.
  - `deadlines`: `["1x1", "2x1"]`, default `"2x1"`.
  - `notes`: `["2x1", "2x2"]`, default `"2x1"`.
  - `recent` and `week`: `["2x1", "2x2"]`, default `"2x1"`.
  - `legend`: add `home: false`. `homeTileList` skips defs with `home: false`.
  - `MISSING`: `sizes ["2x1"]`.

- [ ] **Step 1: Write the failing tests** in `home/grid.test.js`:
  - `defaults`: `homeLayout(undefined, defs)` gives `order` equal to `HOME_ORDER` and `size.graph === "4x2"`.
  - `cleans saved data`: duplicates and non-strings are removed, `"ext.gone"` is kept, and `size.clock: "6x2"` becomes `"2x1"`.
  - `edits`: `moveTile(hl, "clock", 0).order[0] === "clock"`, `setTileSize(hl, "clock", "6x2", defs) === hl`, `addTile(hl, "week", defs).size.week === "2x1"`, and `removeTile(hl, "nope") === hl`.
  - `upgrades lanes order`: `fromLanes({ left: ["continue"], right: ["chats"], top: ["clock"], bottom: ["legend"] }).order` equals `["clock", "continue", "chats", "legend"]`.
  - `extension defaults`: a def without `sizes` allows `["2x1", "2x2"]` and defaults to `"2x1"`.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/home/grid.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement `grid.js` and the def fields.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/widgets/registry.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(home): snap grid model`.

### Task 7: Home renders the grid; the lanes upgrade once

> **Amended (§1b):** the Latest chats tile uses `<Kratt size={16} />` as its icon. The empty states use exact copy: Due for review shows `<Kratt size={56} mode="hop" />` and "All caught up. Kratt is keeping watch until something starts to fade." (shown while `dueForReview(state)` is empty); Latest chats shows `<Kratt size={40} />` and "No chats yet. Kratt is ready when you are.". Add `it("Home empty states show Kratt")`.

**Files:**
- Create: `home/HomeGrid.jsx`, `home/home.css`, `home/GraphTile.jsx`
- Modify: `StudyPreview.jsx` (`Screen` uses `HomeGrid` when `kind === "home"`; `layoutApi`; Ctrl+E on Home opens Settings), `edges/lanes.js` (remove `home` from `KIND_DEFAULTS`), `settings/upgrade.js`, `useSettings.js` (`DEFAULTS.layout.home = null`), `ClockWidget.jsx`, and `widgets/builtin.jsx` (`graph` uses `GraphTile`)
- Test: `StudyPreview.test.jsx`, `settings/upgrade.test.js`, `edges/EdgesLayout.test.jsx` (remove its Home cases)

**Interfaces:**
- **Consumes:** `homeLayout`, `spanOf`, `fromLanes` and `homeTileList` from Task 6.
- **Produces:**
  - `<HomeGrid layout={settings.layout} context={{ home }} onEditHome={() => shell.openSettings("layout")} />`. It renders `<section data-tile={id} style={{ "--w": w, "--h": h }}>` per tile, in `homeLayout(layout.home, defs).order`, using `WidgetFrame` with no drag handle.
  - It has a right-click menu (shadcn `ContextMenu`) with one item, "Edit home screen…".
  - `GraphTile` wraps `HomeGraphCanvas` and `EmptyGraph` to fit inside its tile. The legend hint "Brighter is better known" is a `title` on the tile.
  - `ClockWidget` reads its tile size through `context.size` and sets the digital font-size to 60 / 92 / 140 px for 1x1 / 2x1 / 2x2.
  - `layoutApi` gets `homeLayout()`, `saveHome(next)` (which shows the "Layout saved" toast with Undo, like `saveKind`), `resetHome()` (which sets `layout.home` to `null`), and `homeWidgets()`, which now returns `homeTileList`. `setHomeWidget(id, on)` uses `addTile` and `removeTile`.
  - `upgradeSettings(saved)`: when `saved.layout?.kinds?.home` exists and `saved.layout.home` doesn't, it sets `layout.home = fromLanes(kinds.home.lanes)` and deletes `kinds.home`. It does this only once.
- **CSS** in `home.css`:
  - `.st-home-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:150px;gap:14px;grid-auto-flow:row dense;padding:28px 32px 36px}`
  - Each tile spans `var(--w)` columns and `var(--h)` rows, with background `var(--st-surface)`, a 10px radius and no border.
  - `@media (max-width:760px)`: 2 columns, and every tile spans 2.

- [ ] **Step 1: Write the failing tests:**
  - In `StudyPreview.test.jsx`, `it("Home is a grid of tiles with no edit button")`: tiles `[data-tile]` appear in the order of `HOME_ORDER`, and `queryByRole("button", { name: /edit home/i })` is null.
  - `it("right-click offers Edit home screen")`: a contextmenu event on a tile, then choosing "Edit home screen…", opens the dialog "Settings" on "Layout and home screen".
  - In `upgrade.test.js`, `it("upgrades lanes to the grid once")`: saved settings with `kinds.home.lanes = { top: ["clock"], left: ["continue"], right: ["chats"], bottom: [] }` upgrade to `layout.home.order` equal to `["clock", "continue", "chats"]` and drop `kinds.home`. Upgrading the result again returns it unchanged.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/StudyPreview.test.jsx src/views/studyhome/settings/upgrade.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement. Delete the Home cases from `EdgesLayout.test.jsx`; Home is no longer a lanes kind.
- [ ] **Step 4:** Run the Step 2 command, then `npx vitest run src/views/studyhome/edges/EdgesLayout.test.jsx src/views/studyhome/edges/lanes.test.js src/views/studyhome/widgets/WidgetFrame.test.jsx`. Expected: PASS.
- [ ] **Step 5: Manual check.** Home looks like the v3 preview's `Home3` board. At a width under 760px it shows 2 columns.
- [ ] **Step 6: Commit** with `feat(home): render Home as a snap grid; upgrade saved lanes`.

### Task 8: Home screen editor in Settings

**Files:**
- Create: `settings/HomeGridEditor.jsx`, `settings/HomeGridEditor.test.jsx`
- Modify: `settings/LayoutSection.jsx` (its "Home screen" group holds the editor and the existing widget switches and clock options; the "Edit layout" row's description becomes "Move and resize widgets on page and graph screens.")

**Interfaces:**
- **Consumes:** `shell.layoutApi.homeLayout()`, `saveHome(next)` and `resetHome()` from Task 7, and `moveTile`, `setTileSize`, `spanOf` and `sizesOf` from Task 6.
- **Produces:** `<HomeGridEditor />`, which takes no props and uses `useShell()` and `useWidgetDefs()`.
  - It renders a scaled 6-column grid. Each tile is a `<button>` with an accessible name: `"<title>, <w>×<h>"`.
  - **Selecting:** clicking a tile selects it and shows a `role="radiogroup"` labelled `"Size of <title>"`. It holds one radio per allowed size, labelled `"1×1"`, `"2×1"` and so on.
  - **Keyboard:**
    - Space on a focused tile picks it up and announces "<title> picked up, place <n> of <total>".
    - ArrowLeft and ArrowUp move it one place earlier; ArrowRight and ArrowDown move it one place later. Each move announces "<title>, place <n> of <total>".
    - Space drops it and saves with `saveHome`.
    - Escape restores the order and announces "<title> put back".
    - Announcements go to a `role="status"` live region.
  - **Pointer:** dragging a tile with the pointer reorders live, and drop saves. Reuse the FLIP approach of `edges/EdgesLayout.jsx` (`useFlip`); copy the hook into `home/useFlip.js` instead of importing it from Edges.
  - **Reset:** a button "Reset home screen" calls `resetHome()`.

- [ ] **Step 1: Write the failing tests:**
  - `moves a tile with the keyboard`: focus "Clock, 2×1", press Space, ArrowLeft, Space. The status reads "Clock, place 1 of 7", and the saved `layout.home.order[0]` is "clock".
  - `escape puts it back`: Space, ArrowRight, Escape. The order is unchanged and the status reads "Clock put back".
  - `resizes from the size buttons`: click "Clock, 2×1", choose the radio "1×1", and the tile is now "Clock, 1×1".
  - `reset with undo`: click "Reset home screen". The toast "Layout saved" has Undo, and Undo brings back the previous order.
  - `switches widgets on and off`: switching off "Deadlines and exams" removes "Deadlines and exams, 2×1" from the editor.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/settings/HomeGridEditor.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/settings/SettingsDialog.test.jsx`. Expected: PASS.
- [ ] **Step 5: Manual check.** Drag with the mouse and with the keyboard, and turn on reduced motion. Nothing animates.
- [ ] **Step 6: Commit** with `feat(settings): Home screen editor`.

---

## Part 4: Kratt Chat

### Task 9: Chats saved in `Chats/`

**Files:**
- Create: `chats/format.js`, `chats/format.test.js`
- Modify: `data/vaultState.js` (`CHATS_DIR`, `SPECIAL_DIRS`, `stateFromSnapshot`, `fileText`, `planSync`), `data/operations.js` (`EMPTY_STATE.chats = []`, chat mutations), `data/testing/fakeVault.js` (`SAMPLE_SNAPSHOT` gets one chat file at `Chats/2026-10-20 09-58 Krebs cycle.md` with id `c1`)
- Test: `data/vaultState.test.js`, `data/operations.test.js`

**Interfaces:**
- **Produces:**
  - `Chat = { id, title, created: number, updated: number, context: string[], turns: Turn[] }`, where `Turn = { who: "you" | "kratt", text: string }`.
  - In `chats/format.js`:
    - `parseTurns(body)` returns `Turn[]`. Text before the first `### You` or `### Kratt` heading becomes a "you" turn. Any other heading stays inside the turn above it.
    - `formatTurns(turns)` returns a string in the form `### You\n<text>\n\n### Kratt\n<text>\n`.
    - `chatTitle(question)` cuts the question at a word boundary to 48 characters or fewer; an empty question gives `"New chat"`.
  - In `vaultState.js`:
    - `export const CHATS_DIR = "Chats"` joins `SPECIAL_DIRS`.
    - Files directly in `Chats/` become `state.chats`, sorted by `updated` with the newest first. Deeper files are ignored.
    - `fileText` writes a chat as front matter `{ id, title, created, updated, context }` followed by `formatTurns(turns)`.
    - `planSync` lists chats like quick notes, with the new path `${CHATS_DIR}/${stampName(chat.created)} ${sanitizeName(chat.title)}.md`.
    - `export function pageMarkdown(node)` is exported (it already exists, privately).
  - In `operations.js`, the chat mutations:
    - `addChat(state, { id, title, context, now })`
    - `appendTurn(state, id, turn, now)`, which also sets `updated` to `now`.
    - `renameChat(state, id, title)`
    - `deleteChat(state, id)`
    - All of them are added to `mutations`.

- [ ] **Step 1: Write the failing tests:**
  - `format.test.js`:
    - `round-trips`: `formatTurns(parseTurns(formatTurns(t)))` equals `formatTurns(t)` for two turns, one with Unicode ("ATP ⇒ ADP, café").
    - `keeps hand-edited text`: parsing `"intro\n### You\nq\n## Notes\nmore\n### Kratt\na\n"` gives `[{who: "you", text: "intro"}, {who: "you", text: "q\n## Notes\nmore"}, {who: "kratt", text: "a"}]`.
    - `titles`: `chatTitle("Walk me through one turn of the cycle, step by step please")` is 48 characters or fewer, ends on a whole word, and has no trailing comma.
  - `vaultState.test.js`:
    - `Chats folder is never a subject`: a snapshot with folders `["Chats", "Chats/old"]` and files `Chats/a.md` and `Chats/old/b.md` gives `state.subjects` without "Chats", `state.chats` with exactly one entry, and the files' turns parsed.
    - `writes a new chat and its turns`: `planSync` after `addChat` and then `appendTurn` creates one write at a path that starts with `Chats/`, whose text contains `### You`.
    - `deletes a chat to the trash`: a `deleteChat` plans a `trash` op for its path.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/chats/format.test.js src/views/studyhome/data/vaultState.test.js src/views/studyhome/data/operations.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/data/StudyProvider.test.jsx src/views/studyhome/data/vaultSync.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(chats): chats saved as Markdown in Chats/`.

### Task 10: Chat service and the Chat memory setting

**Files:**
- Create: `chats/chatService.js`, `chats/chatService.test.js`
- Modify: `useSettings.js` (`DEFAULTS.ai.chatMemory = "normal"`), `settings/LearningSections.jsx` (`AiSection`), `settings/AiSection.test.jsx`

**Interfaces:**
- **Consumes:** `pageMarkdown` from Task 9, `parentIndex` and `pagesInside` from `data/tree.js`, and `VaultOffline` from `data/vaultClient.js`.
- **Produces:**
  - `export const MEMORY = { short: 8192, normal: 24576, long: 49152 }`.
  - `export const INSTRUCTIONS`, the spec's exact text: "You are Kratt, a study helper. Answer from the notes given when you can. When you use a note, cite it as [[Title]]. Say so when the notes don't cover the question."
  - `export class ChatError extends Error`, with `code` set to `"too-long" | "ai-unavailable" | "ai-auth" | "offline"`.
  - `export const CHAT_MESSAGES`:
    - `"ai-unavailable"`: `(address) => \`Open Notebook isn't answering at ${address}. Start Open Notebook, or change the address in Settings > AI.\``
    - `"ai-auth"`: "Open Notebook didn't accept the password. Check it in Settings > AI."
    - `"offline"`: "Chats need the Study folder service. Start it with `memory-engine serve`."
    - `"too-long"`: `(memory) => \`That question is too long for Chat memory: ${Label}. Shorten it, or pick a longer Chat memory in Settings > AI.\``, where `Label` is "Short", "Normal" or "Long".
  - `export function gatherContext(state, ids)` returns `[{ title, markdown }]`. A page gives its whole `pageMarkdown`; a subject gives each of its pages cut to its first 2048 bytes.
  - `export function buildPrompt({ question, context, turns, memory })` returns `{ prompt, sentFrom }`. `sentFrom` is the index in `turns` of the oldest turn sent; it equals `turns.length` when no earlier turn is sent, and `0` when all are. It throws `ChatError("too-long")` if the instructions and the question alone exceed `MEMORY[memory]`. Build it like this:

```
budget = MEMORY[memory] - bytes(INSTRUCTIONS) - bytes(question block)
contextBudget = floor(budget / 2); take context items in order, each "## [[Title]]\n<markdown>\n";
  an item that doesn't fit whole is cut at the last "\n\n" that fits (skipped if none fits)
turnBudget = budget - bytes(context used); walk turns from newest to oldest, keep while they fit
prompt = INSTRUCTIONS + "\n\n# Notes\n" + context + "\n# Conversation\n" + kept turns oldest→newest
         ("You: …" / "Kratt: …") + "\nYou: " + question + "\nKratt:"
```

  - `export function citationsIn(answer, state)` returns `[{ id, title }]` for each distinct `[[Title]]` that matches a page's name, ignoring case. Titles with no matching page are left out.
  - `export function createChatService({ client, address })` returns `{ ask({ question, context, turns, memory }) }`, which resolves to `{ answer, sentFrom }`. It calls `client.notebookAsk(address(), prompt)`. `VaultOffline` becomes `ChatError("offline")`; an error with message `"ai-auth"` becomes `ChatError("ai-auth")`; any other failure becomes `"ai-unavailable"`.
- **Settings > AI**, Model group: a row "Chat memory" with a `Segmented` control: Short / Normal / Long. The description is exactly: "How much of the page, your notes and this chat is sent with each question. Pick Short if answers ignore what you said earlier."

- [ ] **Step 1: Write the failing tests** in `chatService.test.js`:
  - `fits each memory budget`: for each of short, normal and long, with 40 turns of 900 bytes, `bytes(prompt) <= MEMORY[m]`, and `sentFrom` is greater for short than for long.
  - `drops oldest turns first`: the prompt contains the last turn's text and not the first turn's.
  - `context takes at most half and the page goes first`: with a 30 KB page under `normal`, the context part is ≤ 12288 bytes, it is cut at a `\n\n`, and the page's title appears before a subject page's title.
  - `refuses a question too long for the budget`: a 9000-byte question under `short` throws a ChatError with `code === "too-long"`.
  - `finds citations`: the answer `"See [[krebs cycle]] and [[Nope]]"` with `SAMPLE_SNAPSHOT` state gives `[{ id: "p1", title: "Krebs cycle" }]`.
  - `maps errors`: `notebookAsk` rejecting with `VaultOffline` gives `"offline"`, with `new Error("ai-auth")` gives `"ai-auth"`, and with `new Error("boom")` gives `"ai-unavailable"`.
- [ ] **Step 2:** In `AiSection.test.jsx`, add `it("chooses Chat memory")`. The default selection is "Normal"; choosing "Short" saves `ai.chatMemory = "short"` to `study-preview-settings-v3`.
- [ ] **Step 3:** Run `npx vitest run src/views/studyhome/chats/chatService.test.js src/views/studyhome/settings/AiSection.test.jsx`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6: Commit** with `feat(chats): chat service with Chat memory budgets`.

### Task 11: Kratt Chat panel

> **Amended (§1b):**
> - The tab bar button shows `<Kratt size={18} />` before "Kratt Chat".
> - Each answer's header is `<Kratt size={20} />` and "Kratt".
> - While pending, it shows `<Kratt size={20} mode="think" label="Kratt is thinking" />` and the text "Kratt is thinking" in place of the block cursor.
> - The empty state shows `<Kratt size={72} label="Kratt" />`, "Hi, I'm Kratt." and "Ask me about this page or anything in your notes. I'll show which notes each answer came from.". The suggestions follow it.
> - The ai-unavailable card starts with `<Kratt size={44} mode="sleep" label="Kratt is asleep" />` and "Kratt can't reach Open Notebook at <address>.".
>
> Tests use these names.

**Files:**
- Create: `chats/ChatPanel.jsx`, `chats/chat.css`, `chats/ChatPanel.test.jsx`
- Delete: `AiPanel.jsx`
- Modify: `StudyPreview.jsx` (render `ChatPanel`; `shell.chat`; Ctrl+J; the tab bar button label "Kratt Chat"), `StudyPreview.test.jsx` (`"the AI chat opens from the tab bar"` becomes "Kratt Chat")

**Interfaces:**
- **Consumes:**
  - From Task 9: `actions.addChat`, `appendTurn` and `renameChat`, `state.chats`, `chatTitle`, `newId` (from `data/operations.js`).
  - From Task 10: `createChatService`, `gatherContext`, `citationsIn`, `CHAT_MESSAGES` and `settings.ai.chatMemory`.
- **Produces:**
  - `shell.chat = { open(id), newChat(), activeId }`. Both functions open the panel. `newChat()` sets `activeId` to null, so the empty state shows and the file is created only on the first send.
  - Ctrl+J calls `newChat()`, except while typing (use the same `typing()` guard as Ctrl+E).
  - `<ChatPanel open onClose width onWidth />` keeps the resize behavior of the old `AiPanel`.
- **What the panel shows:**
  - **Header:** the chat title, or "New chat"; buttons "Chat history" (a menu of the 10 most recent chats), "New chat" and "Close Kratt Chat".
  - **Context pills:**
    - A new chat's context starts as `[route.id]` when the current tab is a page, and `[]` otherwise.
    - Pills are labelled "This page" (the current page) or the page or subject name, each with a remove button "Remove <name>".
    - A "+" button "Add context" opens a picker of pages and subjects.
  - **Empty state:** the text "Ask about this page or anything in your notes. Answers link to the notes they came from." and the suggestions "Explain this page in 5 steps" and "Quiz me on <page name>". The suggestions show only when the context has a page.
  - **Turns:** "You" turns are bubbles. A Kratt turn shows its text, then its citations as buttons that open the page, then "Quiz me" and "Save as note".
    - "Quiz me" sends "Quiz me on this, 5 questions".
    - "Save as note" calls `actions.addQuickNote(text + "\n\nFrom Kratt Chat: " + title)`.
  - **Earlier messages line:** after an ask whose `sentFrom > 0`, a line "Earlier messages aren't sent with new questions." appears above turn `sentFrom`. It links to Settings > AI (`shell.openSettings("ai")`). It is kept in component state only and resets when you switch chats.
  - **Pending:** a block cursor with the label "Kratt is answering", and the composer is disabled.
  - **Errors:** a `role="alert"` card with the `CHAT_MESSAGES` text and the buttons "Try again" and "Open settings".
    - "Try again" re-asks the last "you" turn, which has no Kratt turn after it, without appending it again.
    - On `"too-long"`, nothing is appended and the question stays in the composer.
  - **Composer:** the textarea "Message" sends on Enter and adds a new line on Shift+Enter. The send button is labelled "Send".
  - **Status line:** "Open Notebook connected. Chats save to your Study folder." after a successful ask, or the error's short form.
- **Sending a question:**
  1. If there's no active chat, call `addChat` with `id = newId()`, `title = chatTitle(question)` and the context.
  2. Call `appendTurn(you)`.
  3. Call `service.ask`.
  4. Call `appendTurn(kratt)`.

- [ ] **Step 1: Write the failing tests** in `ChatPanel.test.jsx`. Render the app with `fakeClient(SAMPLE_SNAPSHOT)` and `client.notebookOk = true`; the fake answers `answer to <prompt>`.
  - `creates a chat on first send`: press Ctrl+J, type "What is ATP?", press Enter. A file is written under `Chats/` containing `### You\nWhat is ATP?` and `### Kratt`. The sidebar's Chats section lists "What is ATP?".
  - `shows the earlier-messages line only when turns were left out`: open `c1` after replacing its turns with 30 turns of 1 KB, set `ai.chatMemory = "short"`, and send. The line is present and sits before the first rendered turn that was sent. Under `"long"`, with 3 short turns, it is absent.
  - `offline card and try again does not duplicate the question`: with `notebookOk = false`, send "q". The alert contains "isn't answering at http://localhost:5055". Set `notebookOk = true` and click "Try again". The saved file has exactly one `### You\nq`, followed by one `### Kratt`.
  - `too-long keeps the question in the composer`: under `short`, a 9000-character question shows "That question is too long for Chat memory: Short", nothing is written, and the textarea still holds the text.
  - `citations open pages`: the fake returns "See [[Krebs cycle]]". A button "Krebs cycle" appears under the answer, and clicking it opens the tab "Krebs cycle".
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/chats/ChatPanel.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement. Styles follow the v3 preview (`Chat3.dc.html`, the `.ai*`, `.me`, `.bot`, `.pill`, `.warn`, `.compose` and `.box` rules), using theme variables. The cursor stops blinking under `prefers-reduced-motion` and under `.study[data-reduce-motion]`.
- [ ] **Step 4:** Run the Step 2 command and `npx vitest run src/views/studyhome/StudyPreview.test.jsx`. Expected: PASS.
- [ ] **Step 5: Manual check.** With `memory-engine serve` and Open Notebook running, ask about the Krebs cycle page. The answer cites it, and the chat file appears in the Study folder's `Chats/`.
- [ ] **Step 6: Commit** with `feat(chats): Kratt Chat panel`.

### Task 12: Chats screen and Latest chats widget

**Files:**
- Create: `chats/ChatsView.jsx`, `chats/ChatsView.test.jsx`
- Modify: `StudyPreview.jsx` (`centerOf`: `route.view === "chats"` renders `ChatsView`; `PlaceholderView` no longer handles chats), `widgets/builtin.jsx` (`ChatsWidget` lists `state.chats`)

**Interfaces:**
- **Consumes:** `state.chats`, `actions.renameChat` and `actions.deleteChat` from Task 9; `shell.chat.open` and `newChat` from Task 11; `relativeTime` from Task 4.
- **Produces:**
  - **The Chats screen.** It has the title "Chats" and a search box "Search chats" that filters by title and turn text, ignoring case.
  - Each row shows the title, the first 80 characters of the last Kratt turn, and `relativeTime`, plus the actions Open, Rename (inline input) and Delete (confirms with the existing `Dialog`, then calls `deleteChat`).
  - Empty state: "No chats yet. Start one with New chat or Ctrl J."
  - **The Latest chats widget** shows the same rows without actions: 3 at 2×2, 1 at 2×1. Clicking a row opens the chat.

- [ ] **Step 1: Write the failing tests:**
  - `lists, searches, renames and deletes`: `SAMPLE_SNAPSHOT` has `c1`. Searching "krebs" shows it and "zzz" shows the empty search result "No chats match". Renaming it to "Cycle" writes the title. Deleting it plans a trash of its path.
  - `empty state`: with `EMPTY_SNAPSHOT`, the text is "No chats yet. Start one with New chat or Ctrl J."
  - `widget opens a chat`: clicking the c1 row in the Home tile opens the panel with c1's title.
- [ ] **Step 2:** Run `npx vitest run src/views/studyhome/chats/ChatsView.test.jsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(chats): Chats screen and Latest chats widget`.

### Task 13: Whole-branch check

**Files:** `README.md` in `apps/study`, only if it names "AI chat" or "Quick notes" in the sidebar.

- [ ] **Step 1:** Run `npm test`. Expected: every file passes. If a file fails with a 10 s timeout, run it alone with `npx vitest run <file>`; it must pass alone. Note any such file in the hand-off.
- [ ] **Step 2:** Run `npm run build`. Expected: exit 0.
- [ ] **Step 3: Manual check** against preview v3, across Home, the sidebar, the chat panel, the Chats screen, Settings > Appearance / Layout and home screen / AI, a width under 760px, keyboard only, and reduced motion.
- [ ] **Step 4: Commit** any doc touch-ups with `docs: Ember redesign notes`.
