"""Validate packaged engines and collect versioned release assets. Never signs or publishes."""
import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from smoke_engine import smoke

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "apps/study/src-tauri/target/release/bundle"


def exactly_one(pattern):
    paths = list(BUNDLE.glob(pattern))
    if len(paths) != 1:
        raise ValueError(f"Expected one {pattern}, found {len(paths)}")
    return paths[0]


def engine_in(folder):
    engines = [p for p in folder.rglob("kratt-engine*") if p.is_file() and p.name in {"kratt-engine", "kratt-engine.exe"}]
    if not engines:
        raise ValueError(f"No bundled engine in {folder}")
    smoke(engines[0])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=["linux-x86_64", "macos-arm64", "macos-x86_64", "windows-x64"], required=True)
    args = parser.parse_args()
    version = json.loads((ROOT / "apps/study/package.json").read_text())["version"]
    destination = ROOT / "release" / args.platform
    destination.mkdir(parents=True, exist_ok=True)
    prefix = f"Kratt-{version}-{args.platform}"
    copies = []
    with tempfile.TemporaryDirectory(prefix="kratt-package-") as temporary:
        temporary = Path(temporary)
        if args.platform.startswith("linux"):
            appimage = exactly_one("appimage/*.AppImage")
            subprocess.run([str(appimage), "--appimage-extract"], cwd=temporary, stdout=subprocess.DEVNULL, check=True)
            engine_in(temporary / "squashfs-root")
            copies.append((appimage, prefix + ".AppImage"))
            deb = exactly_one("deb/*.deb")
            subprocess.run(["dpkg-deb", "-x", str(deb), str(temporary / "deb")], check=True)
            engine_in(temporary / "deb")
            copies.append((deb, prefix + ".deb"))
            # A portable fallback includes the full AppDir and its AppRun launcher.
            with tarfile.open(destination / (prefix + ".tar.gz"), "w:gz") as archive:
                archive.add(temporary / "squashfs-root", arcname="Kratt")
        elif args.platform.startswith("macos"):
            dmg = exactly_one("dmg/*.dmg")
            mount = temporary / "mounted"
            subprocess.run(["hdiutil", "attach", str(dmg), "-readonly", "-nobrowse", "-mountpoint", str(mount)], check=True)
            try:
                engine_in(mount / "Kratt.app")
            finally:
                subprocess.run(["hdiutil", "detach", str(mount)], check=True)
            copies.append((dmg, prefix + ".dmg"))
        else:
            msi, exe = exactly_one("msi/*.msi"), exactly_one("nsis/*.exe")
            # Inspect a real administrative extraction and a silent per-user NSIS installation.
            subprocess.run(["msiexec", "/a", str(msi), "/qn", f"TARGETDIR={temporary / 'msi'}"], check=True)
            engine_in(temporary / "msi")
            install = temporary / "nsis"
            subprocess.run([str(exe), "/S", f"/D={install}"], check=True)
            engine_in(install)
            uninstall = install / "uninstall.exe"
            if uninstall.exists():
                subprocess.run([str(uninstall), "/S", f"_?={install}"], check=True)
            copies.extend([(msi, prefix + ".msi"), (exe, prefix + ".exe")])
        for source, name in copies:
            shutil.copy2(source, destination / name)
    assets = sorted(p for p in destination.iterdir() if p.suffix in {".AppImage", ".deb", ".gz", ".dmg", ".exe", ".msi"})
    metadata = {"version": version, "platform": args.platform, "signing": "unsigned-preview",
                "host": platform.platform(), "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "verification": ["engine-present-in-package", "frozen-engine-smoke"],
                "assets": [{"name": path.name, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in assets]}
    (destination / f"metadata-{args.platform}.json").write_text(json.dumps(metadata, indent=2) + "\n")
    shutil.copy2(ROOT / "docs/INSTALL.md", destination / f"INSTALL-{args.platform}.md")
    files = sorted(p for p in destination.iterdir() if p.is_file() and not p.name.startswith("SHA256SUMS"))
    (destination / f"SHA256SUMS-{args.platform}.txt").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files))
    print(f"Validated and collected {len(assets)} packages in {destination}")


if __name__ == "__main__":
    main()
