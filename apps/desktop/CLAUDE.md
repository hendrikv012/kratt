# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Never Mention Claude in anything no pr no issue no commits no comments never mention claude

## Commands

```bash
npm run tauri dev          # full desktop app (runs `npm run dev`, Vite on :1420, then the Rust backend)
npm run dev                # frontend only in a browser; Tauri APIs are unavailable, so code guards for that
npm run tauri build        # production build
npm run build:linux        # platform build; also runs bundle:mcp first

npm test                   # Vitest, single run
npm run test:watch
npx vitest run src/editor/extensions/WikiLink.test.js     # single file
npx vitest run -t "name of test"                          # single test by name
cd src-tauri && cargo test                                # Rust tests
```

- Unit tests sit **next to the source** as `src/**/*.test.{js,jsx}` (and `packages/**`), and run in jsdom with `src/test-setup.js`. There is no `tests/unit/` directory.
- `tests/mcp-server/*.test.js` is outside Vitest's `include`, so `npm test` doesn't run it.
- E2E is currently disabled: `playwright.config.js` points `testDir` at `./tests-disabled/e2e`, so `npm run test:e2e` finds no tests.

## Architecture

### One frontend bundle, several windows
Every Tauri window loads the same `index.html`. `App.jsx` picks the view from query params:
- `?view=prefs` opens Preferences.
- `?workspacePath=…` opens Workspace. Workspace windows use `ws-*` labels, and the path can also arrive later through the `workspace:activate` event (see `hooks/useWorkspaceActivation.js`).
- `?view=design-preview` opens a dev-only page. It is listed in `src/hooks/devView.js` and read once before the first render. The study app that used to open with `?view=study-preview` now lives in `../study`.
- No params opens the Launcher.

Windows are created in `src-tauri/src/windows.rs`. To add a new window type, add a query param, an activation hook in `src/hooks/`, and a branch in `App.jsx`.

### Rust backend (`src-tauri/src/`)
- `main.rs` is the real entry point. Every Tauri command must be registered in its `generate_handler![...]` list. `lib.rs` is an unused stub.
- `api_server.rs` runs a local Axum HTTP API on `127.0.0.1:3333`, which the MCP server uses to reach app/workspace state.

### MCP server
- The source is in `src/mcp-server/`, a separate Node package with its own `package.json`. `mcp.rs` starts it as an HTTP server on port **3456** (`.mcp.json` points there).
- In production it is embedded in the binary: `mcp_embedded.rs` uses `include_str!` on `src-tauri/resources/mcp-bundle/mcp-server.js` and on `src/mcp-server/http-server.js`, then extracts them to `~/.lokus/mcp-server/`.
- **After changing `src/mcp-server/`, run `npm run bundle:mcp`.** Otherwise the embedded bundle is stale, and the Rust build fails if the bundle file is missing.

### Editor (TipTap)
- `src/editor/components/Editor.jsx` builds the extension list. Custom extensions are in `src/editor/extensions/`.
- To add an editor feature: create the extension, add it to the extensions array in `Editor.jsx`, add a slash command in `src/editor/lib/slash-command.jsx`, and add styles to `src/editor/styles/editor.css`.
- Markdown in and out goes through `src/core/markdown/` (syntax config) and the paste extensions (`MarkdownPaste.js`, `MarkdownTablePaste.js`).

### Theming
- `src/core/theme/manager.js` sets every theme token as an inline style on `documentElement`, which overrides plain CSS or `data-theme` toggles.
- Token defaults live in `src/styles/globals.css` and are space-separated RGB triplets (`--bg: 30 30 30`) consumed by `tailwind.config.cjs`.
- The tokens are kept consistent with open-notebook's frontend (see `../../CLAUDE.md`).

### Study app Radix versions

### Plugins
- The runtime is in `src/plugins/` (`PluginManager.js`, loader, manifest validation, security sandbox, registry). The plugin-facing API is `src/plugins/api/LokusPluginAPI.js`.
- `packages/plugin-sdk` and `packages/lokus-plugin-cli` are the external SDK and the scaffolding CLI.
- Plugin authoring docs are in `PLUGIN_DEVELOPMENT.md`.
