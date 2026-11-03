"""Build kratt-engine (the Study folder service for the desktop app) with PyInstaller, and copy it
to apps/study/src-tauri/binaries/ under the name Tauri's externalBin expects.

    .venv/bin/python tools/build_service.py          (Windows: .venv\\Scripts\\python tools\\build_service.py)

Run it on each system you build the desktop app for: PyInstaller can't build for another system.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
BUILD = ENGINE / "build" / "kratt-engine"
TARGET_DIR = ENGINE.parent / "apps" / "study" / "src-tauri" / "binaries"
# The service never imports these; excluding them keeps the program small.
EXCLUDE = ["sqlite_vec", "tree_sitter", "tree_sitter_python", "mypy", "ruff", "pytest", "tkinter"]


def host_triple() -> str:
    """Rust's name for this system (e.g. x86_64-unknown-linux-gnu), which Tauri adds to sidecar names."""
    info = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    return next(line.split(":", 1)[1].strip() for line in info.splitlines() if line.startswith("host:"))


def main() -> int:
    command = [sys.executable, "-m", "PyInstaller", "--onefile", "--console", "--noconfirm", "--clean",
               "--name", "kratt-engine", "--paths", str(ENGINE / "src"),
               "--distpath", str(BUILD / "dist"), "--workpath", str(BUILD / "work"), "--specpath", str(BUILD)]
    for name in EXCLUDE:
        command += ["--exclude-module", name]
    command.append(str(ENGINE / "tools" / "kratt_service_entry.py"))
    subprocess.run(command, check=True)

    suffix = ".exe" if sys.platform == "win32" else ""
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    target = TARGET_DIR / f"kratt-engine-{host_triple()}{suffix}"
    shutil.copy2(BUILD / "dist" / f"kratt-engine{suffix}", target)
    print(f"Built {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
