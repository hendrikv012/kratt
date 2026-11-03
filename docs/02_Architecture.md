# 02 — Architecture

Verified against the monorepo source on 2026-11-03. This replaces the unverified FastAPI/Express and relational-note prototype proposal. See `desktop-product-spec.md` for the product flow and `desktop-release.md` for packaging.

## Repository

- `apps/study/src/`: React/Vite study workspace, Tiptap editor, file synchronization, chats and study artifacts.
- `apps/study/src/desktop/`: native startup/recovery gate and model setup. Browser development bypasses this gate.
- `apps/study/src-tauri/`: Rust Tauri shell, owned engine lifecycle, extension package handling, capabilities and bundle configuration. There is one Tauri project, not a second root-level shell.
- `engine/src/memory_engine/`: Python file service, local Ollama and optional online-provider integration, and the existing advanced memory-engine CLI.
- `scripts/`: frozen-engine smoke testing, package verification/collection and AppImage compatibility repair.
- `site/`: marketing website only; `.github/workflows/` builds native packages and deploys that site.
- `docs/`, `design/`: product specification, decisions, validation records and mascot artwork. `kratt/` remains the unrelated unused starter.

## Runtime

Tauri embeds production React assets and an OS-native PyInstaller engine executable. Rust allocates platform app-data folders, locks ownership, spawns the engine, verifies health, and shuts it down. The Python stdlib HTTP server binds to a dynamically assigned loopback port. Requests require the app's session token and allowed Host/Origin. Standalone developer `memory-engine serve` remains on 5057 without the desktop session token.

Ollama is external and local. Kratt discovers or starts it, supports installed-model selection and explicit model downloads, and stops only an Ollama process it started. Missing AI does not prevent note use. Settings also offers opt-in OpenAI/Claude and OpenAI-compatible APIs, ChatGPT public-client OAuth, and the official Claude Code subscription client. The engine owns provider transport, protected credential files, callback listeners and CLI process cleanup. Selected prompts leave the computer only when online AI is chosen. Desktop legacy online notebook routes remain disabled; extension networking remains opt-in under existing permissions.

## Persistence

The Study folder is authoritative. Pages, quick notes, sources, chats and artifacts are Markdown with YAML metadata. Layout lives in `.study/layout.json`; deletion moves files to `.study/trash`; conflicting writes retain both versions. A polling watcher streams changes to the UI. Desktop preferences and selected model/folder live in `config.json` in the standard per-user Kratt data directory.

The local desktop full-text index mirrors Markdown/text files in `.study/search.sqlite3`, updates from disk on search, and can be rebuilt. The advanced CLI retains its existing SQLite/vector/code indexing modules; it is not the desktop runtime's dependency chain. Browser state holds caches and pending writes, not the authoritative saved notes.

## Distribution

App version uses MAJOR.MINOR.PATCH, currently 1.4.0. Native runners build Linux x86_64 AppImage/deb/tar, macOS arm64/x86_64 DMG, and Windows x64 EXE/MSI. Package verification checks actual contents and executes the extracted engine. Checksums, metadata, install guidance and generated notes accompany draft releases. Per the owner's latest instruction, signing/notarization is deferred and all builds are labelled unsigned previews.

GitHub Pages receives only `site/`. Download links resolve real versioned assets in GitHub Releases, with explicit empty/error states. No app or installer is deployed to Pages.

## Deferred product work

The old roadmap's proposed mastery schema and time-decay scoring are not implemented by the desktop shell. Existing study features remain as implemented. Do not infer backend endpoints or production platform validation from draft roadmap tickets.
