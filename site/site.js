const repository = "hendrikv012/kratt";
const status = document.querySelector("#release-status");
for (const button of document.querySelectorAll("[data-theme]")) {
  button.addEventListener("click", () => {
    const theme = button.dataset.theme;
    for (const other of document.querySelectorAll("[data-theme]")) other.setAttribute("aria-pressed", String(other === button));
    document.querySelector("#workspace-image").src = `assets/${theme}-notes.png`;
    document.querySelector("#practice-image").src = `assets/${theme}-cards.png`;
  });
}
const formats = [
  ["linux-x86_64", "AppImage", "Download AppImage"],
  ["linux-x86_64", "deb", "Download Ubuntu / Debian installer"],
  ["linux-x86_64", "tar.gz", "Portable archive"],
  ["macos-arm64", "dmg", "Download for Apple silicon"],
  ["macos-x86_64", "dmg", "Download for Intel"],
  ["windows-x64", "exe", "Download Windows installer"],
  ["windows-x64", "msi", "Download MSI"],
];
async function loadReleases() {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=20`, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error("Release listing unavailable");
    const releases = await response.json();
    const release = releases.find((r) => !r.draft && !r.prerelease) ?? releases.find((r) => !r.draft);
    if (!release) { status.textContent = "The first desktop builds are being tested. No public release is available yet."; return; }
    const version = release.tag_name.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Unknown version format");
    const prefix = `https://github.com/${repository}/releases/download/${release.tag_name}/`;
    const assets = release.assets.filter((a) => a.state === "uploaded" && a.size > 0 && a.browser_download_url.startsWith(prefix));
    const checksum = assets.find((a) => a.name === "SHA256SUMS.txt");
    if (!checksum) throw new Error("Checksums not published yet");
    let count = 0;
    for (const [platform, extension, label] of formats) {
      const asset = assets.find((a) => a.name === `Kratt-${version}-${platform}.${extension}`);
      if (!asset) continue;
      const container = document.querySelector(`[data-downloads="${platform}"]`);
      container.querySelector(".pending")?.remove();
      const link = document.createElement("a");
      link.href = asset.browser_download_url;
      link.textContent = `${label} (${Math.round(asset.size / 1024 / 1024)} MB)`;
      container.append(link); count++;
    }
    status.textContent = count ? `Version ${version}${release.prerelease ? " · Testing preview — read the release notes before installing" : ""}.` : "Release packages are still being uploaded.";
    document.querySelector("#release-notes").href = `https://github.com/${repository}/releases/tag/${release.tag_name}`;
    const checksums = document.querySelector("#checksums"); checksums.href = checksum.browser_download_url; checksums.hidden = false;
  } catch {
    status.textContent = "Downloads could not be listed. Open Releases and notes below to check available builds.";
  }
}
loadReleases();
