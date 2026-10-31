# Ember redesign: look, sidebar, home grid, Kratt Chat

Date: 2026-10-20. Status: direction approved through three rounds of previews; this written spec awaits review.
Branch: `ember-redesign`, from `main` at `db455e9` (extensions' `ai.ask` through the Open Notebook bridge).
Reference preview: https://claude.ai/artifact/FgWjbWX7p32MhQLwMn4rsq. Row "v3" is the chosen layout (`Home3`, `Chat3`, `Tokens3`). Rows v4 (Kratt) and v5 (styles in Settings) add to it (§1b). Older rows are kept for history. The boards' sources are in `~/Base N/.ember-preview/project/`.

## Why

The user asked for a frontend that is cleaner and theirs, and named four problems:

- The look isn't theirs. They want a pixel font, orange, and a calm black ground. After three rounds they settled on **v3**: neutral black, off-white text, orange only as an accent, and Pixelify Sans for the interface text, at sizes that stay easy to read.
- The sidebar doesn't show what matters. It should list the important things, AI chats first.
- Moving widgets on Home feels bad. With four lanes and S/M/L sizes the tiles don't fit together; the clock alone in the top lane is the clearest case. They chose a **snap grid**.
- The AI chat is a disabled stub. They chose to make it **real now**: talk to Open Notebook, save each chat, list chats in the sidebar.

Two rules came out of the review:

- **Everything you customize lives in Settings.** That covers fonts, colors, the Home layout and the sidebar sections. Screens show content, not edit controls: Home gets no "Edit home" button.
- **Small text stays readable.** Pixel text is never below 14 px.

Names the user changed in the preview: the sidebar says **Notes** (was "Quick notes"), and the AI is **Kratt Chat** (was "AI chat"). Only the labels change; the `Quick notes/` folder keeps its name.

## Scope

In scope: the Ember theme and fonts, the sidebar sections, the Home snap grid and its editor in Settings, and Kratt Chat (panel, saved chats, Chats screen, sidebar list).

Out of scope:

- Page and graph screens keep the Edges lanes. Their lane editing is still started from Settings > Layout ("Edit layout"), as it is today.
- No streaming answers: the bridge returns a whole answer.
- No engine changes.
- No Deadlines data model. Deadlines stay an empty widget.
- "Due for review" shows only once mastery scheduling exists. Until then its sidebar section is hidden and its widget keeps its empty text.

## 1. Look: the Ember theme

### Tokens

Ember is a new preset in `theme/themes.js` and becomes `DEFAULT_THEME_ID`. Saved settings keep the theme they have; only new users and "Reset" get Ember.

| Token | Value | Use |
|---|---|---|
| base `ember` | `#0e0e0e` (h 0, s 0, l 5.5) | ground |
| raised | `#161616` | tiles, panels, active row, active tab |
| hover | `#1c1c1c` | hover fill, quiet buttons |
| line | `#232323` | the few hairlines left (sidebar edge, tab bar, panel edge) |
| text | `#ece8e3` | 15.6:1 on ground |
| soft | `#a19c96` | labels, meta, timestamps, 7.1:1 |
| accent | `#ff8a3d` | actions, counts, active marker, links, graph, 8.2:1 |
| accent wash | accent at 14% over ground | New chat button, count badges, warnings |

Radius is "soft": 6 px for rows and buttons, 10 px for tiles and panels. Density is "comfortable".

The theme model gets the two values it lacks today: a base whose raised and hover steps are neutral grey, and the accent wash. Both are derived the way the current palette is. The other presets don't change.

### Type

| Role | Font | Sizes |
|---|---|---|
| Interface text (sidebar, tabs, buttons, tiles, lists, chat) | Pixelify Sans 400/500 | 15 px body, 14 px for labels and meta (never smaller), letter-spacing 0.01em, line-height 1.5 |
| Titles (page title, Kratt wordmark, the main line of a tile) | Pixelify Sans 500 | 19 px and up |
| Clock and big numbers | VT323 | 60 / 92 / 140 px for the clock at 1×1 / 2×1 / 2×2 |
| Note text in the editor | Geist | 16 px, line-height 1.7 |

- **Theme model:** `UI_FONTS` gets `pixelify` (family and display Pixelify Sans, `numeric` VT323, `pixel: true`; `mono` stays JetBrains Mono for code), and `READ_FONTS` gets `geist`. Ember uses both.
- **Numeric font:** a new CSS variable `--st-font-numeric` comes from the UI font's `numeric` (else its `mono`) and is used by the clock.
- **Bundling:** `theme/fonts.js` gets the ids `pixelify` (`@fontsource/pixelify-sans` 400 and 500, `@fontsource/vt323`) and `geist` (already bundled). These are new exact-pinned dependencies, so no font comes from the network.
- **Readable sizes:** when the UI font is a pixel font (`UI_FONTS[id].pixel: true`), the app sets the size scale up a step, and a single CSS rule keeps every `text-xs` or `12px` use at a 14 px minimum. Pixel fonts are blurry below that.

### Settings > Appearance

- **Ember card:** it is the first theme card.
- **Interface font:** the theme editor's list adds Pixelify Sans.
- **Reading font:** the list adds Geist.

Nothing else changes in this section: the font and color choices stay where they already live.

## 1b. Kratt, styles and the opening screen

Added 2026-10-20 after preview rows v4 and v5 (`Home4`, `Chat4`, `Kratt4`, `Settings5`, `Home5`, `Chat5`). The user approved them and chose to keep Ember as the default.

### Kratt

Kratt is the app's mascot, and he is the AI the user talks to. His sprite comes from `~/Base N/kratt_four_colors_dark_and_light.svg`: a flat pixel figure on a 66×50 grid. The parts are a body with two eye holes, two tufts, a twine band, two legs, a left arm with a hand, and a right arm holding a fork.

- **Component.** `kratt/Kratt.jsx` renders the sprite inline: `<Kratt size={px} mode="idle|think|hop|sleep" label? />`.
  - The viewBox is `-3 -6 72 58`, with `shape-rendering="crispEdges"`.
  - The fill is `var(--st-kratt)`.
  - Without `label` the sprite is decorative (`aria-hidden`). With a label it is `role="img"`.
  - The paths and the animation are the ones in `~/Base N/kratt_animated.svg` (the standalone animated logo). That file is copied to `public/kratt.svg` and used as the favicon.
- **Animation** comes in hard pixel steps only (`steps()`), with no easing:
  - **Idle:** a blink every 4.6 s, the tufts twitch every 3.2 s, and the fork bobs every 5.4 s.
  - **Think:** the fork pokes and the tufts bounce every 0.5 s.
  - **Hop:** a 4-unit hop. It also plays when you hover anything marked `.st-hopper`.
  - **Sleep:** the eyes are shut, the fork is lowered, and a pixel "z" rises.
- **Kratt moves.** Settings > Appearance gets a switch "Kratt moves" (`appearance.krattMoves`, default `true`), described as "He blinks, hops and thinks. Off keeps him still."
  - When it is off, or when reduced motion is on, every Kratt animation stops.
  - "Off" puts `data-kratt-still` on `.study`.
- **Wordmark.** "Study" becomes **KRATT** everywhere the app names itself: the sidebar header, the window title and the favicon. The wordmark is Pixelify Sans 600 with letter-spacing 0.12em, after a 30 px Kratt.
  - "Study folder" stays: it is the user's folder on disk.
- **Where he appears, and nowhere else:**
  - The sidebar wordmark: idle, and he hops on hover.
  - The tab bar's Kratt Chat button: an 18 px Kratt.
  - Beside each Kratt answer: a 20 px Kratt and "Kratt".
  - While an answer is pending: a 20 px Kratt in think mode and the text "Kratt is thinking". This replaces the block cursor.
  - The empty chat: a 72 px Kratt, "Hi, I'm Kratt." in the title font, and "Ask me about this page or anything in your notes. I'll show which notes each answer came from."
  - The offline card: a 44 px sleeping Kratt and "Kratt can't reach Open Notebook at <address>."
  - The Latest chats tile icon (16 px).
  - Home's empty states. Due for review shows a 56 px hopping Kratt and "All caught up. Kratt is keeping watch until something starts to fade." Latest chats shows a 40 px idle Kratt and "No chats yet. Kratt is ready when you are."
  - The opening screen.

### Styles

Settings > Appearance leads with **Style**. These are five cards, each showing Kratt in that style's color with three swatches (accent, text, raised). Below them is **Mode**, a choice of Dark or Light.

- **Ember** is the default style in dark mode.
- **The four Kratt styles.** Deep red, Chrome, Racing green and Calm steel are his logo colors.
  - In light mode the accent is the logo color itself, except Chrome, whose light accent is a darker chrome so it can be read.
  - In dark mode, the darker logo colors use brighter shades of the same color.
- **What a style sets:** the accent, Kratt's color (`--st-kratt`) and a faint tint in the ground.
- **Contrast.** All ten variants pass:
  - text and body against the ground: at least 7:1
  - soft text and the accent against both the ground and raised surfaces: at least 4.5:1
  - the ink on the accent: at least 4.5:1
  - Kratt against raised surfaces: at least 3:1
- **Older presets.** Black, Graphite, Steel, Dusk, Chalk and Paper move under a "More themes" disclosure. Users on one of them keep it.
- **Theme model.**
  - Each style is a preset `<style>` (dark) plus `<style>-light`. Ember dark is the existing `ember` preset.
  - Each preset's base carries `tones` for every token, so the hex values below are exact.
  - A preset may carry `kratt`, and `themeVars` emits `--st-kratt` (falling back to the accent).
  - The Style cards and Mode set `appearance.themeId` to the matching preset id.

| Style | Mode | ground | raise | hover | line | text | soft | body | accent | ink | kratt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ember (`ember`) | dark | `#0e0e0e` | `#161616` | `#1c1c1c` | `#232323` | `#ece8e3` | `#a19c96` | `#d6d1cb` | `#ff8a3d` | `#0e0e0e` | `#ff8a3d` |
| Ember (`ember`) | light | `#f6f3ee` | `#ffffff` | `#ece8e1` | `#dcd6cc` | `#1b1917` | `#5f5a54` | `#2b2825` | `#b04d0c` | `#ffffff` | `#d9661b` |
| Deep red (`deepred`) | dark | `#100d0d` | `#191414` | `#201919` | `#2a2121` | `#efe6e4` | `#a89a98` | `#dccfcc` | `#e5605a` | `#100d0d` | `#c8423e` |
| Deep red (`deepred`) | light | `#f5f1ef` | `#ffffff` | `#ece5e2` | `#dcd2ce` | `#1d1716` | `#645856` | `#2e2624` | `#a3302e` | `#ffffff` | `#a3302e` |
| Chrome (`chrome`) | dark | `#0e0f10` | `#16181a` | `#1d1f22` | `#25282b` | `#e9ecef` | `#9ca3ab` | `#d3d8dd` | `#c3c7cc` | `#0e0f10` | `#c3c7cc` |
| Chrome (`chrome`) | light | `#f2f3f4` | `#ffffff` | `#e7e9eb` | `#d6d9dc` | `#16181a` | `#565d65` | `#26292c` | `#454b53` | `#ffffff` | `#7c8289` |
| Racing green (`green`) | dark | `#0c0f0d` | `#141815` | `#1a1f1b` | `#222924` | `#e6ece7` | `#97a49b` | `#cdd8d0` | `#4cbb7f` | `#0c0f0d` | `#34935c` |
| Racing green (`green`) | light | `#f1f4f1` | `#ffffff` | `#e5ebe6` | `#d2dbd4` | `#141a16` | `#56605a` | `#242b26` | `#24613f` | `#ffffff` | `#24613f` |
| Calm steel (`steel`) | dark | `#0d0f11` | `#15181b` | `#1b1f23` | `#23282d` | `#e6eaee` | `#9aa3ad` | `#ced5dc` | `#a3adb9` | `#0d0f11` | `#8a939e` |
| Calm steel (`steel`) | light | `#f1f3f5` | `#ffffff` | `#e6e9ec` | `#d3d8dd` | `#15181b` | `#575f68` | `#262a2e` | `#4f5862` | `#ffffff` | `#6b737d` |

### Opening screen (`kratt/Splash.jsx`)

It replaces the plain gate text "Opening your Study folder…" while the Study folder loads, and it plays when the app starts.

1. **0.0–0.5 s:** Kratt (96 px) drops in from above in 3 pixel steps and lands with one hop. His tufts pop up as he lands.
2. **0.5–1.0 s:** "KRATT" types in one letter per 100 ms, under him.
3. **1.0–1.4 s:** he blinks and waves his fork once.
4. **Then:**
   - If the folder is ready, the screen fades out (250 ms) into Home, and the existing opening animation (graph fade, sidebar glide) plays.
   - If it is still loading, Kratt switches to think mode, and "Opening your Study folder…" appears under the wordmark until it is ready. The fade-out follows.
   - If the service can't be reached, Kratt sleeps, and the existing offline message shows under him: "Study folder not connected. Start it with: memory-engine serve".

- **Skipping.** A click or any key skips straight to the end state (Home, or the waiting or offline state).
- **When it doesn't play.** With "Opening animation" off (it already exists in Settings > Appearance), or with reduced motion on, nothing animates. A still Kratt and the wordmark show only while loading, with no minimum time.
- **Colors.** The background is the style's ground, and Kratt is the style's Kratt color. The style is read from settings before the Study folder loads, so the splash is never the wrong color.
- **Accessibility.** The screen is `role="status"`, and its accessible name is the current state's text ("Opening KRATT", "Opening your Study folder…" or the offline message).

## 2. Sidebar

The layout from top to bottom, matching preview `Home3`:

1. **Header.** A 30 px idle `<Kratt />` and the **KRATT** wordmark (see 1b). Hovering it makes him hop.
2. **Find (Ctrl K).** It opens QuickFind. Recent pages move here: QuickFind with an empty query lists them first.
3. **Main links.** Home, Graph, Notes (with its count).
4. **New chat (Ctrl J).** An accent-wash button. It opens a new chat in the Kratt Chat panel.
5. **Chats.** The 3 most recent chats by last message, each with a relative time ("12m", "2h", "Sun"). "See all" opens the Chats screen.
6. **Due for review.** A count badge and the top 3 topics. It is hidden while there is nothing due, so for now it is always hidden.
7. **Pinned.** Pages you pinned, in the order you pinned them. You pin from a page's context menu or the tab's context menu ("Pin to sidebar" / "Unpin"). The list is stored as `layout.pinned` (an array of page ids) next to `layout.recent`, and pages that no longer exist are dropped when it loads.
8. **Subjects.** The existing `SubjectTree`.
9. **Footer.** Sources, Extensions, Settings.

The Library heading and the "AI chats" row go away, because Chats replaces them.

**Settings > Layout and home screen > Sidebar** gets a switch for each section that can be turned off (Chats, Due for review, Pinned). Subjects and the main links are always shown. This is stored as `layout.sidebar = { chats: true, review: true, pinned: true }`.

**Code shape:**
- `Sidebar.jsx` becomes a list of section components: `sidebar/ChatsSection.jsx`, `ReviewSection.jsx` and `PinnedSection.jsx`.
- Each section reads its data from `useStudy()` and renders nothing when it is empty, except Chats, which shows "No chats yet".
- Each section is a list of rows like `NavRow`.

## 3. Home: the snap grid

### Model (`home/grid.js`, pure functions, no React)

- **The grid.** Home is a 6-column grid with 150 px rows and a 14 px gap, using `grid-auto-flow: row dense`. Below 760 px it switches to 2 columns, and every tile spans 2.
- **Tile sizes.** A tile's size is one of `1x1`, `2x1`, `2x2`, `4x2` or `6x2`. Each widget def gets `sizes` (allowed sizes) and `homeSize` (its default):

  | Widget | Allowed sizes | Default |
  |---|---|---|
  | graph | 2×2, 4×2, 6×2 | 4×2 |
  | clock | 1×1, 2×1, 2×2 | 2×1 |
  | continue | 2×1, 2×2 | 2×1 |
  | review | 2×1, 2×2 | 2×2 |
  | chats | 2×1, 2×2 | 2×2 |
  | deadlines | 1×1, 2×1 | 2×1 |
  | notes | 2×1, 2×2 | 2×1 |
  | recent | 2×1, 2×2 | 2×1 |
  | week | 2×1, 2×2 | 2×1 |

  - **Extension widgets** default to sizes `["2x1", "2x2"]` with default `2x1`, and can declare their own.
  - **The legend widget** leaves Home: the graph tile shows the "brighter is better known" hint on hover.

- **Saved state.** Stored as `layout.home = { order: [ids], size: { id: "2x1" } }`. The order is the reading order, and dense flow places the tiles. Nothing stores x/y, so no layout can have gaps or overlaps.
- **Functions:**
  - `homeLayout(saved, defs)` cleans saved data the way `kindLayout` does: it drops duplicates and anything that isn't a string, keeps ids nobody has registered (they render as "Missing widget"), and replaces sizes the widget doesn't allow with its default.
  - The edit functions are `moveTile(hl, id, index)`, `setTileSize(hl, id, size)`, `addTile` and `removeTile`. Unchanged results return the same object.
  - `fromLanes(kinds.home, defs)` is the one-time upgrade. It reads the old lanes in the order top, left, right, bottom, keeps the order, and gives every tile its widget's default size.
- **Default layout:** graph 4×2, clock 2×1, continue 2×1, review 2×2, chats 2×2, deadlines 2×1, notes 2×1. This is the v3 preview.

### The Home screen (`home/HomeGrid.jsx`)

- **Rendering.** Tiles render in `layout.home.order`, each through `WidgetFrame` without its drag handle. A tile is the raised colour with a 10 px radius and no border.
- **No edit controls on Home.** The graph moves from a backdrop under the lanes into the `graph` widget, a normal tile.
- **The one way in.** A right-click on Home's empty space or on a tile shows "Edit home screen…". It opens Settings at that section.
- **Lanes.** The `home` entry leaves `KIND_DEFAULTS` in `edges/lanes.js`. Page and graph keep their lanes.

### Settings > Layout and home screen > Home screen (`settings/HomeGridEditor.jsx`)

- **The editor.** A scaled copy of the 6-column grid (tiles show their title and icon, not their content). Beside it is the list of all widgets, each with an on/off switch, which the current `LayoutSection` already has.
- **Moving tiles with the pointer.** Drag a tile, and the others move aside live as the order changes, using the existing FLIP animation helper. Drop it to save.
- **Moving tiles with the keyboard.** Focus a tile, press Space to pick it up, use the arrows to move it one place in the order, then Space to drop it or Escape to cancel. A live region announces each step, such as "Clock, place 2 of 7".
- **Resizing.** The selected tile shows its allowed sizes as buttons (1×1, 2×1, …), and choosing one resizes it at once.
- **Reset.** "Reset home screen" puts the defaults back, and a toast offers Undo.
- **Clock options.** The clock options already in this section stay here.

## 4. Kratt Chat

### Storage: one Markdown file per chat in `Chats/`

`Chats` joins `SPECIAL_DIRS` in `data/vaultState.js`, so it never shows up as a subject. `parseVault` reads it into `state.chats`, which is sorted by `updated`, newest first. A chat file looks like this:

```markdown
---
id: 01JB...            # written by the service like every file's id
title: Krebs cycle, step by step
created: 2026-10-20T09:58:00Z
updated: 2026-10-20T10:12:00Z
context: [page-id]     # what the chat reads; see Context
---

### You
Walk me through one turn of the cycle, step by step.

### Kratt
One turn, from your notes: ...
```

- **Format:** `chats/format.js` has `parseChat(text)` and `formatChat(chat)`, and they round-trip exactly. A heading that isn't `### You` or `### Kratt` stays part of the turn above it, so hand edits never lose text.
- **File name:** `Chats/<stamp>-<slug>.md`. The file is created on the first message, not when "New chat" is pressed.
- **Saving:** writes go through the existing `planSync` queue like Quick notes: you add a turn, and the file is written.
- **Title:** the first question, cut to 48 characters at a word boundary. "Rename" in the panel or on the Chats screen changes it.
- **Deleting:** it moves the file to the trash through `POST /trash`, as deleting a page does.

### Asking (`chats/chatService.js`)

The bridge is one-shot (a transformation with no memory), so the app sends the conversation every time:

```
prompt = instructions
       + context notes (each as "## [[Title]]\n<markdown>")
       + earlier turns, newest first while they fit
       + the new question
```

- **Budget: Chat memory.** The budget is the "Chat memory" setting in Settings > AI, stored as `settings.ai.chatMemory`:
  - **Short:** 8 KB of UTF-8, for small local models.
  - **Normal:** 24 KB, the default.
  - **Long:** 48 KB, for models with a large context. That stays under the 50 KB that extensions' `ai.ask` allows.

  The setting's description says: "How much of the page, your notes and this chat is sent with each question. Pick Short if answers ignore what you said earlier."

  The service itself sets no limit; the model's context window is the real one, and this setting is how you fit it.
- **Filling the budget:**
  1. The instructions and the new question go in first.
  2. Context gets up to half of what's left, with the current page first. A page that doesn't fit whole is cut at a paragraph boundary.
  3. Earlier turns fill the rest, newest first. Turns that don't fit are left out, oldest first.
- **Showing what was left out.** When earlier turns were left out, the panel shows a quiet line above the oldest turn that was sent: "Earlier messages aren't sent with new questions." The line links to Settings > AI > Chat memory. The chat file always keeps every turn; only what is sent is cut.
  - The line is worked out on each ask from what was actually sent, and it is not saved in the file.
- **Instructions:** "You are Kratt, a study helper. Answer from the notes given when you can. When you use a note, cite it as [[Title]]. Say so when the notes don't cover the question."
- **The call:** it reuses `client.notebookAsk(address, prompt)` through a chat service of its own, so extensions' rate limit doesn't apply. The address comes from Settings > AI.
- **Citations:** the answer is scanned for `[[Title]]` links that match existing pages. Each match shows under the answer as a link that opens the page, and links with no matching page stay as plain text.
- **Turn order:**
  1. Your turn is saved first.
  2. While the answer is pending, the panel shows a blinking block cursor. It is still when reduced motion is on.
  3. The answer is appended and saved.
  4. While one ask is pending, the composer is disabled so a second can't overlap.

### Context

- **Default:** a new chat reads the page in the current tab, if there is one ("This page").
- **Pills:** context shows as pills under the header. "+" adds a page or a whole subject (titles and the first 2 KB of each page, until the budget is full), and a pill's × removes it.
- **Saving:** the chosen context is saved in the chat's `context` as page and subject ids.

### Kratt Chat panel (replaces `AiPanel.jsx`'s stub)

- **Placement:** the panel stays on the right with the same resize and remembered width.
- **Header:** the chat title and three buttons: History (a menu of recent chats), New chat and Close.
- **Body:** the context pills, the messages, and the composer. The composer sends on Enter and adds a line on Shift+Enter.
- **States:**
  - Empty: three suggestions built from the context, such as "Explain this page in 5 steps", "Quiz me on <page>" and "What should I review before <next deadline>?". The last one is left out while there are no deadlines.
  - Conversation.
  - Offline.
- **Answer actions:** "Quiz me" asks a follow-up in the same chat, and "Save as note" writes the answer to `Quick notes/` with a link back to the chat.
- **Status line:** "Open Notebook connected. Chats save to your Study folder." or the error (see When things go wrong).
- **Opening the panel:** the tab bar button "Kratt Chat", Ctrl J, the sidebar's New chat, or a sidebar chat row. `settings.ai.chatHidden` stays the remembered open or closed state.

### Chats screen (route `chats`, replaces the placeholder)

- **List:** every chat, newest first, with its title, the start of its last answer, and its time.
- **Search:** a box that filters by title and text.
- **Row actions:** Open (in the panel), Rename and Delete.
- **Empty state:** "No chats yet. Start one with New chat or Ctrl J."

The **Latest chats** widget shows the same list, cut to fit its tile.

## 5. When things go wrong

| What happens | What you see |
|---|---|
| Open Notebook not answering (`ai-unavailable`) | Card in the panel: "Open Notebook isn't answering at <address>. Start Open Notebook, or change the address in Settings > AI." Buttons: Try again, Open settings. Your question stays saved with a "Try again" link under it. |
| Wrong password (`ai-auth`) | "Open Notebook didn't accept the password. Check it in Settings > AI." Same buttons. |
| Study folder service not running (`VaultOffline`) | The existing vault banner. The composer is disabled, with "Chats need the Study folder service. Start it with `memory-engine serve`." |
| Instructions plus the question alone are over the Chat memory budget | "That question is too long for Chat memory: <Short/Normal/Long>. Shorten it, or pick a longer Chat memory in Settings > AI." The question is not sent and stays in the composer. |
| Chat file edited by hand into something unreadable | The chat opens with its text as one turn. Nothing is rewritten until you send. |
| Pinned page deleted | It drops out of Pinned when the layout next loads. |
| Saved Home layout names a widget that's gone | A "Missing widget" tile keeps its place, as lanes do today, and removing it works from the Home screen editor. |

## 6. Testing

Tests use Vitest and are written first.

- `home/grid.test.js`:
  - Defaults.
  - Cleaning bad saved data: unknown ids, duplicates, sizes the widget doesn't allow.
  - The `moveTile`, `setTileSize`, `addTile` and `removeTile` edits, including that an unchanged result is the same object.
  - The `fromLanes` upgrade.
  - Extension defaults.
- `settings/LearningSections.test.jsx`: the Chat memory choice in Settings > AI saves `ai.chatMemory`, and the default is `normal`.
- `settings/HomeGridEditor.test.jsx`:
  - The keyboard move (Space, arrows, Space or Escape) and its announcements.
  - Resizing through the size buttons.
  - Reset with Undo.
  - Switching widgets on and off.
- `chats/format.test.js`:
  - Round-trip.
  - Hand-edited headings.
  - Missing front matter.
  - Unicode titles.
- `chats/chatService.test.js`:
  - Prompt order for each Chat memory budget (Short, Normal, Long).
  - Context takes at most half of what's left after the instructions and question, with the page first and cut at a paragraph boundary.
  - Oldest turns are dropped first, and the result reports how many turns were left out (this drives the "Earlier messages" line).
  - A question too long for the budget is refused.
  - Citation parsing.
  - Error codes mapped to the messages above.
- `data/vaultState.test.js`:
  - `Chats/` parsed into `state.chats` and kept out of subjects.
  - Writes planned for new turns.
  - `layout.pinned` cleaned on load.
- `chats/ChatPanel.test.jsx`: the "Earlier messages aren't sent" line shows only when turns were left out, sits above the oldest turn that was sent, and links to Chat memory.
- `sidebar/Sidebar.test.jsx`:
  - The sections hide when empty or switched off.
  - The Chats rows open the panel.
  - Pin and unpin from a page's menu.
- `theme/styles.test.js`: all ten Kratt-style variants match the §1b table and pass its contrast floors. Mode maps `<style>` to `<style>-light` and back.
- `kratt/Kratt.test.jsx`: it is decorative without a label and `role="img"` with one; each mode sets its class; `data-kratt-still` stops the animations (checked through the CSS rule's presence).
- `kratt/Splash.test.jsx`: it shows while loading, fades to Home when ready, switches to think mode after the sequence while still loading, sleeps with the offline message when offline, and a key press skips it. With "Opening animation" off it shows no sequence.
- `theme/themes.test.js`:
  - The Ember palette values and their contrast (text ≥ 4.5:1).
  - `pixelify` is in `UI_FONTS`.
  - The default theme is Ember.

Existing tests keep passing. The Edges tests lose their Home cases, and those move to the grid tests.

**Manual check after each part:**
1. Run `npm run dev` with `memory-engine serve` and Open Notebook running.
2. Check the part against preview v3.
3. Check the narrow window (under 760 px).
4. Check keyboard-only use.
5. Check reduced motion.

## 7. Build order

Each part works and is checked before the next:

1. **Look.** The Ember preset, the fonts and the readable-size rule. Then the Kratt styles, Kratt himself with "Kratt moves", and the opening screen (§1b).
2. **Sidebar.** The sections, Pinned, the section switches in Settings, and recent pages in Find. Chats shows "No chats yet" until part 4.
3. **Home grid.** `grid.js`, `HomeGrid`, the graph as a tile, the Home screen editor in Settings, and the upgrade from lanes.
4. **Kratt Chat.** Storage, the chat service, the panel, the Chats screen, the sidebar list and the Latest chats widget.
