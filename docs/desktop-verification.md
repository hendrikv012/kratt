# Desktop verification

Integration branch: `codex/desktop-release`. Initial binary source commit: `b2cec11b7157819a168bcaa18d57625a0cd0a125`. [Native build run](https://github.com/hendrikv012/kratt/actions/runs/41702385628). Later commits add release promotion and verification documentation; they do not change the app binaries.

## Verified checks (2026-11-03)

- Full frontend suite: 1,006 tests passed locally after the runtime dependency patches and again on GitHub.
- Production React build and Rust `cargo check`: passed; all 33 Rust library tests passed locally.
- Engine tests: 62 passed on Linux and Apple Silicon; Windows passed 61, with its inapplicable POSIX SIGTERM test skipped. Windows stdin-closure shutdown is tested separately.
- Desktop startup/model download UI: 6 tests cover missing Ollama, continuing to notes, retry/logs, disk preferences, keeping open work during restart, and model downloads.
- Chromium production checks: flashcards, slides, quizzes, full mode, and note-to-quiz generation/link/scoring/persistence passed in Ember and Chalk.
- Linux packaged GUI: the rebuilt AppImage created an isolated Study folder, started the authenticated engine through the frontend, and stopped the engine after the actual GUI exited. No personal files were used.
- Product site: HTTPS 200 at https://hendrikv012.github.io/kratt/. Chromium checked images, light/dark screenshot switching, 390px layout, no-release state, versioned release/checksum links and browser errors. Screenshots contain example notes only.
- Release validation: 6 tests cover complete artifacts, altered binaries, wrong commits, missing checksums, extra files and unsafe checksum paths. The promotion workflow validates actual CI artifacts before drafting a release.

## Native packages

| Target | Packages | Package verification | GUI verification |
|---|---|---|---|
| Linux x86_64 / Ubuntu 22.04 | AppImage, deb, portable tar.gz | Passed: extracted AppImage and deb engines | Local Arch build passed startup/exit; Ubuntu GUI not manually tested |
| macOS Apple Silicon | DMG | Passed: mounted DMG engine | Not manually tested |
| macOS Intel | DMG | App compiled; Tauri DMG helper failed; replacement packaging awaiting CI | Not manually tested |
| Windows x64 | EXE, MSI | Passed: installed NSIS and extracted MSI engines | Not manually tested |

Every engine smoke covers automatic folders, localhost health, authentication, Markdown save/read, file search, preferences and shutdown. Packages include the Python runtime. The downloadable artifacts carry their source commit, version, platform, verification flags and SHA-256 hashes. The initial Windows portability failures were corrected before this run.

## Remaining limits

Apple Developer ID signing/notarization and Windows publisher signing are deferred by explicit owner instruction. These are unsigned previews. Native engine smoke tests do not certify Gatekeeper, SmartScreen, GPU rendering, installer UI or every OS version. Test the downloaded GUI on each target system, including first launch, missing Ollama, model selection, save/reopen, restart and quit.

Draft releases remain hidden from the product site's public download list until published. Real-model generation quality was not evaluated; browser generation tests used deterministic fixtures. Input splitting preserves stored source text but cannot guarantee semantic completeness of generated study material.

Runtime audit fixes removed all high/critical production findings. One moderate Tiptap finding and one low KaTeX finding remain; development toolchain findings are tracked in T-04 and the daily log.
