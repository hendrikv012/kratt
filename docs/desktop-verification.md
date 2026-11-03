# Desktop verification

Integration branch: `codex/desktop-release`. This record distinguishes checks actually run from remaining release gates.

## Local checks (2026-11-03, Linux x86_64)

- Production React build: passed.
- Rust `cargo check`: passed.
- Desktop startup UI tests: 4 passed (missing Ollama/continue, retry/logs, disk preferences, preserving open work on restart).
- Python service/local-AI/desktop tests: 55 passed.
- Frozen engine smoke: passed on the generated Linux executable (health, auth, automatic folders, Markdown save/read, search, preferences, stdin shutdown).
- Product site: Chromium checks passed for images, light/dark screenshot switching, 390px mobile layout, no-release state, versioned asset URLs/checksums and browser errors. Screenshots use example notes only.
- Full frontend regression suite and native Linux release packaging: running; update this record when complete.

## Native runner checks

Linux Ubuntu packaging, macOS arm64/Intel DMGs and Windows EXE/MSI builds are configured but not yet reported as passed. Each job must verify an extracted/installed engine and publish checksum metadata. A configured workflow is not evidence of an artifact.

## Still required for trusted public distribution

Apple Developer ID signing/notarization and Windows publisher signing are deferred by explicit owner instruction. Test the downloaded GUI and installer on each target system, including first launch, missing Ollama, model selection, save/reopen, restart and quit. Native engine smoke tests do not certify Gatekeeper, SmartScreen, GPU rendering, installer UI or every OS version. Public download links can only be checked after a release is published; draft releases remain hidden from the product site.
