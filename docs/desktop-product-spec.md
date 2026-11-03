# Kratt desktop product

Status: implementation and unsigned preview validation in progress, 2026-11-03. This replaces the earlier desktop prototype's fixed-port attachment and manual launch assumptions. The owner explicitly requested unsigned builds before configuring certificates; no signed release is claimed.

## Product boundary

- `site/` is a static product website deployed to GitHub Pages. It never runs the study app or hosts installers.
- The React study app in `apps/study/` runs inside Tauri 2. Rust owns the bundled `kratt-engine` process.
- Versioned Linux, macOS and Windows packages live in GitHub Releases after publication. CI artifacts are for testing; tag builds create draft prereleases.
- Notes work without AI. Local AI uses Ollama; Settings → AI can explicitly select a remote API or supported subscription connection. Kratt has no hosted backend and requires no Python installation. Online providers receive the prompt and selected context.

## Startup and recovery

1. Determine the platform's standard per-user data directory (see INSTALL.md).
2. Create Study, logs and temp directories. Acquire an OS file lock for this data folder. A second instance shows a message instead of starting a conflicting engine.
3. Spawn the adjacent bundled engine with an open stdin pipe, private session token and port 0. Windows suppresses a console window.
4. Read the engine's temporary readiness descriptor and verify its authenticated `/health` response within 45 seconds. Never reuse an unrelated service on port 5057.
5. Hydrate preferences from `config.json`. Preserve the local/online choice: online users enter the workspace; local users check Ollama or see setup/Continue to notes.
6. While open, check health periodically. On failure keep the mounted workspace and pending changes, show Retry, restart only the owned process, and reconnect file events.
7. On exit close stdin; the engine stops when that pipe closes, including parent crashes. After a bounded timeout the shell terminates its process. An Ollama instance already running before Kratt is never stopped by Kratt.

## Files and memory

Study Markdown files are authoritative. Atomic writes, conflict copies and trash behaviour are retained. Layout is `.study/layout.json`; the rebuildable full-text search index is `.study/search.sqlite3`. The bundled engine supports authenticated `/search` results without requiring a model. Existing app Quick Find searches the loaded note content; selected full notes feed artifact generation. The separate advanced engine CLI's semantic/code search remains separate from this desktop index.

Desktop study preferences persist through the engine to `config.json`. Browser localStorage remains a migration/cache and pending-write recovery layer, not the saved-note source. A remembered Study folder is respected; the default does not silently adopt `~/Study` or an Obsidian vault. Legacy editor themes/extension packages use Tauri's standard app-identifier data directory.

## AI choice and privacy

The desktop engine binds only to `127.0.0.1`, verifies Host and Origin, and requires the per-session token (Authorization header; query token for SSE). The session token is never written to logs. Desktop Ollama uses loopback without environment proxies or redirects, rejects remote model aliases, and online notebook bridge routes are disabled. Downloads and explicitly installed extensions can use the network; the core desktop UI has no remotely loaded fonts, scripts or analytics.

The GUI can request a model download and report progress, failure or completion. Notes stay usable while AI is missing. Model choice and settings are saved on disk. Generated artifacts split selected note input rather than truncating it; this guarantees input delivery, not perfect semantic coverage by the model.

## Distribution gates

`build-release.yml` tests the app, freezes the engine on each target OS/architecture, builds packages, extracts or installs them to check for the engine, runs a frozen-engine smoke test, and attaches SHA-256 sums plus platform metadata. Linux builds use Ubuntu 22.04; Apple silicon and Intel builds have separate native runners; Windows includes NSIS and MSI.

Current artifacts are unsigned previews. Full public-release acceptance still needs signed/notarized macOS builds, Windows publisher signing, downloaded-app GUI checks on each target OS, and public release link validation. Signing does not guarantee immediate SmartScreen reputation. These gaps must never be relabelled as completed platform validation.

## Online providers

The owner requested provider choice after the initial local-only preview. `ai-providers.json` lives outside Study, uses owner-only file creation, and contains per-provider keys and separate ChatGPT account registrations. The UI receives only model/address metadata, key-present flags and account labels. It never persists new keys in browser preferences. ChatGPT uses PKCE and verified OIDC identity, serialized token refresh, revocation on sign-out and completed Responses streaming; Claude subscription use delegates to the installed official client with tools/MCP/hooks disabled. There is no automatic fallback to paid API credentials. See `ai-providers.md` for setup, provider contracts and validation limits.

## Sources (Part A)

Sources opens the reference Kratt Find panel, subject boxes in sidebar order, and an Unsorted list below. Unsorted has no box or separate tab. A subject opens its own sources tab, with the same Find panel, source cards, Add link / Upload files / Paste text and six sort orders. Settings → Layout and home screen → Sources contains Rich, Simple and Preview box styles. Styles and per-collection sorts persist with desktop preferences; subject pages use the normal persisted tab model. The old grouped List presentation is replaced.

Files of every type up to 50 GB (50,000,000,000 bytes), recursive folders and URLs share the app-wide queue. Drops on a subject assign it; other overview drops and URL pastes go to Unsorted. Editing controls own their paste events. Folders never create subjects. Hidden/system files are skipped; unreadable/oversize items are reported. Duplicate URLs or filename/size matches reuse the existing source; source identity is persisted for reloads. More than 50 new items asks before adding anything. Membership remains a many-to-many `subjects:` header on one source Markdown file.

Originals preserve nested paths under `Sources/files/`. This directory is excluded from note scanning and search: uploaded Markdown is never rewritten as a note, and large text originals are not read into memory. Text extraction is bounded to text files ≤1 MiB and PDFs ≤200 MiB. PDFs that cannot be read still keep their originals. Preflight checks path, size and free disk space; authenticated uploads stream in 1 MiB chunks to temporary files. Completion publishes without replacing another original; failed/cancelled transfers remove partial files. Recognizable crash leftovers are cleaned at next engine start.

The upload panel shows Kratt working, the current file/count, byte progress, Cancel and the final summary. Completed originals remain; Cancel discards files not started and marks the interrupted source Original not saved. Failures continue with the next file and retain named error details until dismissed. Closing a subject tab keeps uploads running; switching Study folders is blocked until uploads finish or are cancelled. An upload interrupted by closing the app is shown as Original not saved on restart.

Find sources with Kratt is shown on both pages with disabled Regular/Deep/Search controls and an explicit coming-soon message. Web search and fetching link content are Part B, not implemented by this change.
