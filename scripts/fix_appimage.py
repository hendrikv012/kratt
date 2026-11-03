"""Remove Ubuntu's Wayland libraries that conflict with newer Mesa, then repack the AppImage."""
import hashlib
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "apps/study/src-tauri/target/release/bundle/appimage"
TOOL_SHA256 = "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"


def main():
    images = list(BUNDLE.glob("*.AppImage"))
    assert len(images) == 1, "Expected exactly one AppImage"
    appdir = BUNDLE / "Kratt.AppDir"
    assert (appdir / "usr/bin/kratt-engine").is_file(), "AppImage is missing its engine"
    for path in (appdir / "usr/lib").glob("libwayland-*.so*"):
        path.unlink()
    tool = ROOT / "release/tools/appimagetool-1.9.1.AppImage"
    tool.parent.mkdir(parents=True, exist_ok=True)
    if not tool.exists():
        urllib.request.urlretrieve("https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage", tool)
    assert hashlib.sha256(tool.read_bytes()).hexdigest() == TOOL_SHA256, "appimagetool checksum mismatch"
    runtime = tool.parent / "runtime-x86_64"
    if not runtime.exists():
        urllib.request.urlretrieve("https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64", runtime)
    assert hashlib.sha256(runtime.read_bytes()).hexdigest() == "617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46", "AppImage runtime checksum changed; review before updating the pin"
    tool.chmod(0o755)
    subprocess.run([str(tool), "--appimage-extract-and-run", "--no-appstream", "--runtime-file", str(runtime), str(appdir), str(images[0])],
                   env={**os.environ, "ARCH": "x86_64"}, check=True)


if __name__ == "__main__":
    main()
