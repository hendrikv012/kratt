"""Create an unsigned drag-to-Applications DMG without Finder automation."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "apps/study/src-tauri/target/release/bundle"


def main():
    if sys.platform != "darwin":
        raise SystemExit("DMGs must be packaged on macOS")
    app = BUNDLE / "macos/Kratt.app"
    if not (app / "Contents/MacOS/kratt").is_file() or not (app / "Contents/MacOS/kratt-engine").is_file():
        raise SystemExit("Build the complete app bundle first with --bundles app")
    destination = BUNDLE / "dmg/Kratt.dmg"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kratt-dmg-") as temporary:
        stage = Path(temporary) / "Kratt"
        stage.mkdir()
        # ditto preserves the app bundle's resource metadata and symlinks.
        subprocess.run(["ditto", str(app), str(stage / "Kratt.app")], check=True)
        (stage / "Applications").symlink_to("/Applications")
        for attempt in range(3):
            destination.unlink(missing_ok=True)
            try:
                subprocess.run(["hdiutil", "create", "-volname", "Kratt", "-srcfolder", str(stage),
                                "-fs", "HFS+", "-format", "UDZO", "-ov", str(destination)],
                               check=True, timeout=180)
                break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                if attempt == 2:
                    raise
                print("Disk-image creation failed; retrying after the runner releases its file handles", flush=True)
                time.sleep(5)
    subprocess.run(["hdiutil", "verify", str(destination)], check=True, timeout=180)
    print(f"Created unsigned DMG: {destination}")


if __name__ == "__main__":
    main()
