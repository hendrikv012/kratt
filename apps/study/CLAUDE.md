# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The study app: a React web app (Vite, Tailwind, shadcn/ui) that runs in the browser at `http://localhost:1420`. It was moved out of Lokus (`apps/desktop`, branch `study-shell-redesign`, commit `81d9fed`) on 2026-10-19; its earlier history is in that repo.

Before UI work read `../../docs/PRODUCT.md`, `../../docs/DESIGN.md` and `../../.impeccable/`.

## Commands

```bash
npm run dev                                  # dev server on http://localhost:1420
npm test                                     # all tests (vitest, jsdom)
npx vitest run src/views/studyhome/path.test.jsx  # one test file
npm run build                                # production build into dist/
```

## Layout

- `src/views/studyhome/` is the app. `src/main.jsx` renders `StudyPreview` inside the same `app-root`/`app-content` structure it had in Lokus.
- Everything else under `src/` (`editor/`, `core/`, `components/`, `platform/`, `plugins/`, `services/`, `utils/`, `lib/`, `hooks/`, `styles/`, `config/`) is a copy of the Lokus files the app imports, kept at their Lokus paths so no import changed. `LICENSE-lokus` (MIT) covers them.

## Rules that are easy to break

- **Port 1420.** Files come from the Study folder service (`engine/`, `memory-engine serve`, `127.0.0.1:5057`) through `src/views/studyhome/data/vaultClient.js`. The service refuses any Origin other than `http://localhost:1420` and Tauri. Settings saved in the browser (`study-preview-settings-v3`) also live under that origin.
- **`version` in `package.json` (1.4.0)** is the app version extension manifests are checked against (`extensions/installer.js`).
- **One copy of `@radix-ui/react-dismissable-layer`.** The shadcn components (`src/views/studyhome/ui/`) need every Radix package to share it. With two copies a menu inside a dialog is not seen as the top layer, so Escape closes the dialog with it. That is why `@radix-ui/react-dropdown-menu` and `@radix-ui/react-tooltip` are pinned. Before bumping a Radix package, check that `find node_modules -path '*react-dismissable-layer/package.json'` still finds only one.
- Dependencies are pinned to the exact versions the app had in Lokus, and `package-lock.json` started from Lokus's lockfile.
- **Where the AI runs** (`settings.ai.model`): `"local"` (the default) sends Kratt Chat and extensions' `ai.ask` to Ollama through the Study folder service (`POST /local/ask`), which starts Ollama if needed and keeps the picked model; Settings > AI lists only installed models (`ai/localAi.js` has the error messages). The app tells the service which mode is on (`PUT /setting/local-ai`) so it knows to start Ollama at launch. `"cloud"` uses the desktop provider service (`POST /ai/ask`); browser development retains the Open Notebook bridge. See `../../docs/ai-providers.md`.
- **Extensions' `ai.ask`** online uses the selected desktop provider. In browser development it goes to Open Notebook through the Study folder service's bridge (`POST /notebook/ask`), via `src/views/studyhome/ai/onClient.js`: one service for the app (on the shell, `shell.ai`), with 50 KB prompts and 20 asks per extension per minute at most. The address is `settings.ai.onUrl` (default `http://localhost:5055`); the password is kept by the service, never in settings.
- The extension features call Tauri (`invoke`, `convertFileSrc`) only when `isTauri()` is true; in the browser they use their fallbacks.
- **Editor popups and plugin views.** Anything that registers a ProseMirror plugin from React (Tiptap's `BubbleMenu` with `options`/`shouldShow`) must get the same values every render: re-registering rebuilds every plugin view and closes an open "/" menu (`TableBubbleMenu.jsx` keeps `options` in a constant). Popups that should follow the person's theme go inside `.study` (`rootFor` in `editor/lib/slash-command.jsx`), since the theme's variables are set there, not on `body`.
- **/Kratt** in the "/" menu sends a `kratt:ask` window event with the editor; `PageView` answers it with `AskKratt` (`views/AskKratt.jsx`), which asks through `chatService` with the page as context. `shell.chat` carries `address` and `memory` (Settings > AI) for it.

## Artifacts

- `Artifacts/` is a special Study folder, like `Chats/`. Files hold flashcards, slides or quizzes, source IDs, origin, coverage metadata, and artifact-only scores.
- Create through `useMakeArtifact` → `createArtifactMaker` → `chatService.send`, which respects the selected local/online model. `gatherFull` reads complete stored notes and sources; `splitIntoParts` sends every piece within Chat memory, including retry overhead. Never use chat's truncated context for artifacts.
- Save only after all parts succeed. Cancel, close and unmount discard late replies. Source-text coverage is not a guarantee that an AI answer contains every fact.
- Links are `[[artifact:<id>|<Type> · <Title>]]`; preserve them through the existing wiki-link Markdown conversion. Scores never update mastery.
- Note slash commands, chat, and the Artifacts screen share the same maker. Quick Find registers artifacts in both its provider and its group order.
