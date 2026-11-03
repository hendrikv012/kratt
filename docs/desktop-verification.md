# Desktop verification

Integration branch: `codex/desktop-release`. This record distinguishes checks actually run from remaining release gates.

## Local checks (2026-11-03, Linux x86_64)

- Production React build: passed.
- Rust `cargo check`: passed.
- Desktop startup/model download UI tests: 6 passed (missing Ollama/continue, retry/logs, disk preferences, preserving open work on restart).
- Python service/local-AI/desktop tests: 57 passed; download stream edge cases added to the next run.
- Frozen engine smoke: passed on the generated Linux executable (health, auth, automatic folders, Markdown save/read, search, preferences, stdin shutdown).
- Product site: Chromium checks passed for images, light/dark screenshot switching, 390px mobile layout, no-release state, versioned asset URLs/checksums and browser errors. Screenshots use example notes only.
- Full frontend suite on GitHub: 1,004 tests passed on the initial integration commit. Two additional model-download UI tests pass locally.
- Linux AppImage, Debian package and portable tar archive: generated; AppImage and Debian extracted engines pass smoke checks.
- Linux packaged GUI: launched from the AppImage, created an isolated Study folder, reached the authenticated engine through the frontend, and shut down the engine after the actual GUI process exited. The AppImage extraction wrapper is a separate parent; the test explicitly identifies the GUI.
- Product site deployed and checked over HTTPS: HTTP 200 at https://hendrikv012.github.io/kratt/.

## Native runner checks

The first Windows job exposed an eager Unix-only sandbox import; fixed with a fail-closed platform check before importing `resource`. The first macOS Intel job timed out in Python process startup; the service now avoids unnecessary reverse DNS at bind, and test subprocess startup is portable/diagnostic. These changes require another native CI run. Linux Ubuntu packaging, macOS arm64/Intel DMGs and Windows EXE/MSI builds are not yet reported as passed. Each job must verify an extracted/installed engine and publish checksum metadata. A configured workflow is not evidence of an artifact.

## Still required for trusted public distribution

Apple Developer ID signing/notarization and Windows publisher signing are deferred by explicit owner instruction. Test the downloaded GUI and installer on each target system, including first launch, missing Ollama, model selection, save/reopen, restart and quit. Native engine smoke tests do not certify Gatekeeper, SmartScreen, GPU rendering, installer UI or every OS version. Public download links can only be checked after a release is published; draft releases remain hidden from the product site.
