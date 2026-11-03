# Installing Kratt

Kratt is a desktop application. The [product website](https://hendrikv012.github.io/kratt/) introduces it; [GitHub Releases](https://github.com/hendrikv012/kratt/releases) hosts versioned downloads. Do not download installers from a Pages asset directory.

## Current preview status

The owner requested unsigned builds first. macOS builds are **not Developer ID signed or notarized**; Windows builds are **not publisher signed**. Gatekeeper, SmartScreen or an organisation's policy may block these previews. They are test builds, not a claim of verified public distribution. Do not disable system security protections to install them. Branch builds are available as GitHub Actions artifacts; tagged builds create a draft prerelease until reviewed.

## Linux (x86_64)

For Ubuntu/Debian, download the `.deb`, open it with the software installer, and launch Kratt from the applications menu. Builds made on Ubuntu 22.04 target that system and newer compatible distributions.

For other distributions, download the `.AppImage`. In your file manager, open Properties and allow it to run as a program, then double-click it. Some distributions need AppImage/FUSE support. The `.tar.gz` fallback contains an extracted AppDir: extract it and open `Kratt/AppRun`. Compatibility must be tested on your distribution; a local Arch build is not an Ubuntu compatibility test.

## macOS (Apple silicon or Intel)

Choose the DMG for your processor. Open it and drag Kratt into Applications. The current unsigned preview may be blocked by Gatekeeper. Public distribution verification will be added with Developer ID signing and notarization.

## Windows (x64)

Open the `.exe` installer and follow the prompts, or use the `.msi` package. Kratt includes the engine and the WebView2 offline installer. Python and Node are not required. Unsigned previews may show an unknown publisher warning or be blocked by policy.

## First launch

Kratt creates its folders, starts its bundled engine, and waits for it to become healthy. A failure screen has **Retry** and **Open logs**. No engine commands are needed.

Your files are in:

| System | Default data folder |
|---|---|
| Windows | `%APPDATA%\Kratt` |
| macOS | `~/Library/Application Support/Kratt` |
| Linux | `$XDG_DATA_HOME/kratt`, normally `~/.local/share/kratt` |

Inside are `Study/`, `logs/`, `temp/`, and `config.json`. Notes, chats, sources and artifacts are files in Study. Use **Settings → Data → Study folder** to select an existing vault; Kratt does not silently move or overwrite it. Back up the entire Study folder. Removing or upgrading the app should not remove this folder.

## Local AI

The welcome screen detects Ollama. **Install Ollama** opens its official download page. Once installed, use **Check again**, then select an installed model or **Download model**. Model downloads use the internet and may occupy several gigabytes. **Continue to notes** skips AI setup; it remains available in **Settings → AI**. There is no automatic model download or cloud fallback. To use an online provider instead, choose **Settings → AI → Online service** and follow the [provider setup guide](ai-providers.md).

## Checksums and support

Each release includes `SHA256SUMS.txt`, platform checksum files, metadata and release notes. A checksum verifies file integrity, not the publisher's identity. Compare downloaded files with the published checksum using your preferred checksum utility. Report problems at [GitHub Issues](https://github.com/hendrikv012/kratt/issues); include OS, app version and relevant log lines, never personal notes or credentials.
