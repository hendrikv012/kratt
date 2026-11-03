# Building and releasing the desktop app

These are contributor commands. End users use the installers and in-app setup described in INSTALL.md.

## Local development

Use Node 22+, Rust stable, Python 3.12 and [Tauri's native prerequisites](https://v2.tauri.app/start/prerequisites/). Install app dependencies in `apps/study` with `npm ci`. Prepare a Python build environment and install `engine/requirements-desktop.txt`, then run:

```sh
python engine/tools/build_service.py
python scripts/smoke_engine.py apps/study/src-tauri/binaries/kratt-engine-x86_64-unknown-linux-gnu
cd apps/study
npm run tauri:dev
```

The sidecar filename uses the Rust host triple; Windows adds `.exe`. Build on the target OS/architecture. PyInstaller embeds Python; users do not install it. Development override `KRATT_DATA_DIR` must be absolute and allows testing without touching real notes. Normal launches use OS-standard paths.

## Packages

From `apps/study`, run `npm run tauri:build -- --bundles deb,appimage` on Linux; use `app` on macOS or `nsis,msi` on Windows. Linux packaging tools may need `APPIMAGE_EXTRACT_AND_RUN=1` and `NO_STRIP=1`. Then, from the root:

```sh
python scripts/fix_appimage.py
python scripts/package_release.py --platform linux-x86_64
```

On macOS, run `python scripts/build_dmg.py` before collecting packages. It uses `hdiutil` directly to create a drag-to-Applications DMG without Finder automation; transient image-creation failures get two bounded retries, and the image is verified. Other platforms use `macos-arm64`, `macos-x86_64` or `windows-x64` and skip the AppImage step. Outputs go to ignored `release/<platform>/`. Do not commit binaries. The collector fails if an installer or bundled engine is missing. It extracts AppImage/deb, mounts DMG, or extracts MSI and silently installs NSIS before exercising the actual frozen engine. A tar fallback includes the full AppDir, not just the application executable.

## GitHub Actions

`build-release.yml` runs manually, for version tags, and on the initial `codex/desktop-release` integration branch. It runs frontend tests, validates version consistency, then builds on native Linux, macOS arm64, macOS Intel and Windows runners. Download test packages under each run's Artifacts. Failed jobs cannot create a release.

Update `apps/study/package.json`, its lockfile, `src-tauri/Cargo.toml` and Cargo.lock together for the next version. The initial desktop preview preserves the app's existing 1.3.3 version. A matching `v1.3.3` tag creates a **draft prerelease**, including generated GitHub notes, install instructions, platform metadata and checksum files. Existing releases are not overwritten on reruns. Review the complete draft before publishing. No signing secrets are required or read in the current workflow.

To promote an already successful branch build without rebuilding, manually run **Build desktop release** with `existing_run` set to its run ID. The promotion job requires all four native jobs and frontend verification to have succeeded in this repository, downloads their exact artifacts on GitHub, validates hashes/platforms/version/source commit and creates an unsigned draft prerelease. It fails on missing or extra files and never overwrites an existing release. Leave the input empty for a normal build. This avoids transferring large installers through a contributor's machine.

`pages-deploy.yml` deploys only `site/` from main or the integration branch, on release publication, or manually. Configure repository Pages to **GitHub Actions**. It needs `pages:write` and `id-token:write`; release creation needs `contents:write`. The website discovers published release assets at load time, so a draft correctly leaves downloads unavailable.

## Signing later

The owner explicitly deferred signing on 2026-11-03. Before a trusted public release, add Apple Developer ID certificate import, PyInstaller nested-binary signing, Tauri app signing and notarization/stapling; verify the downloaded DMG/app with `codesign`, `spctl` and `stapler`. Use [Tauri's macOS signing guidance](https://v2.tauri.app/distribute/sign/macos/).

For Windows configure the chosen certificate/hardware signing or cloud signing provider with Tauri's `signCommand`, sign the frozen engine and app plus installers, and verify Authenticode on all EXE/MSI files. See [Tauri's Windows signing guidance](https://v2.tauri.app/distribute/sign/windows/). Do not promise zero SmartScreen warnings: reputation is separate from a valid publisher signature. Add fail-closed credential and signature checks before removing the unsigned-preview label or publishing a stable release.

## Validation and promotion

Record exact OS, commit, package hashes and checks in `desktop-verification.md`. Engine smoke tests prove executable contents, health/authentication, persistence and shutdown; they do not prove that a downloaded GUI launches on every target OS. On each system install/download the actual package, open it through the OS UI, check startup, Study creation, missing-Ollama recovery, model selection, saving/reopening notes, and clean exit. Only then mark that system's GUI verified. Never infer cross-platform success from a Linux build.

For a reproducible native Linux editor check, install the distribution's `WebKitWebDriver` tool and run `python scripts/smoke_native_ui.py apps/study/src-tauri/target/release/bundle/appimage/Kratt.AppDir/AppRun` in a graphical session. It opens the extracted package, uses an isolated Study folder and browser profile, types a note, checks its Markdown file, clears browser storage, and reopens the saved note. It never requests model generation. `scripts/smoke_app.py` separately checks AppImage startup and engine shutdown.
