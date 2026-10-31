#!/usr/bin/env python3
"""Start Kratt on Linux, macOS or Windows: the same steps as start.fish, in plain Python.

    python3 scripts/start.py            (Windows: py scripts\\start.py)
    python3 scripts/start.py --no-browser

It finds the workspace from its own location and skips anything already running. It starts
1. Kratt's engine (Open Notebook's database and API, without its web UI) on 127.0.0.1:5055,
   logging to <temp>/kratt-logs/,
2. the Study folder service (`memory-engine serve`, 127.0.0.1:5057), which also starts Ollama
   when the AI runs on this computer,
3. the study app's dev server (`npm run dev`, http://localhost:1420),
then opens the app in the browser. When the dev server stops, or on Ctrl+C, it stops what it
started, so the Study folder service can stop an Ollama it started. If the app was already
running, whatever was started here keeps running.

Only the standard library is used, so any Python 3.9+ runs it.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUDY = ROOT / "apps" / "study"
NOTEBOOK = ROOT / "apps" / "notebook"
ENGINE_DIR = ROOT / "engine"
LOGS = Path(tempfile.gettempdir()) / "kratt-logs"
WINDOWS = os.name == "nt"

# (host, port) each part listens on
ENGINE = ("127.0.0.1", 5055)
DATABASE = ("127.0.0.1", 8000)
SERVICE = ("127.0.0.1", 5057)
APP = ("localhost", 1420)
APP_URL = "http://localhost:1420/"
STOP_TIMEOUT = 10


def is_up(address: tuple[str, int]) -> bool:
    """Whether something listens there. A connection is enough: the dev server can take seconds
    to answer its first request, and that still means it is running."""
    try:
        with socket.create_connection(address, timeout=1):
            return True
    except OSError:
        return False


def wait_until_up(address: tuple[str, int], seconds: float, process: subprocess.Popen | None = None) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if is_up(address):
            return True
        if process is not None and process.poll() is not None:
            return False
        time.sleep(0.5)
    return is_up(address)


def find(name: str) -> str | None:
    """A program on the PATH, or in ~/.local/bin where surreal and uv install themselves."""
    found = shutil.which(name)
    if found:
        return found
    local = Path.home() / ".local" / "bin" / (f"{name}.exe" if WINDOWS else name)
    return str(local) if local.is_file() else None


def read_env(path: Path, keys: tuple[str, ...]) -> dict:
    """These keys from a .env file, without quotes around the values."""
    values = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and key.strip() in keys:
            values[key.strip()] = value.strip().strip("\"'")
    return values


def start(args: list[str], cwd: Path, log: Path | None = None, env: dict | None = None) -> subprocess.Popen:
    """Start a program in its own process group, so Ctrl+C reaches only this launcher, which then
    stops each program in order. Output goes to `log`, or to this terminal."""
    output = open(log, "ab") if log else None  # noqa: SIM115 (the child keeps it open)
    options = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True})
    try:
        return subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=output,
                                stderr=subprocess.STDOUT if output else None, **options)
    finally:
        if output:
            output.close()


def stop(process: subprocess.Popen | None, name: str) -> None:
    """Ask a program (and anything it started) to stop the way Ctrl+C would, then force it."""
    if process is None or process.poll() is not None:
        return
    print(f"Stopping {name}...")
    try:
        if WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=STOP_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired):
        if WINDOWS:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                pass
        process.wait()


def start_engine() -> tuple[subprocess.Popen | None, subprocess.Popen | None]:
    """Kratt's engine: Open Notebook's database and API. Returns (database, API), each None when it
    wasn't started here."""
    if is_up(ENGINE):
        print("Kratt's engine is already running.")
        return None, None
    uv, surreal = find("uv"), find("surreal")
    if uv is None or (surreal is None and not is_up(DATABASE)):
        missing = "uv" if uv is None else "surreal"
        print(f"Skipping Kratt's engine: {missing} isn't installed. Kratt Chat works without it when "
              "the AI runs on this computer.")
        return None, None
    print("Starting Kratt's engine...")
    settings = read_env(NOTEBOOK / ".env", ("SURREAL_USER", "SURREAL_PASSWORD", "KRATT_ENGINE_PASSWORD"))
    env = {**os.environ, **settings}
    # KRATT_ENGINE_PASSWORD (in .env or the shell) is the engine's password; the API reads it as
    # OPEN_NOTEBOOK_PASSWORD
    if env.get("KRATT_ENGINE_PASSWORD"):
        env["OPEN_NOTEBOOK_PASSWORD"] = env["KRATT_ENGINE_PASSWORD"]
    database = None
    if not is_up(DATABASE):
        database = start([surreal, "start", "--log", "info", "--bind", "127.0.0.1:8000",
                          "--user", env.get("SURREAL_USER", ""), "--pass", env.get("SURREAL_PASSWORD", ""),
                          f"rocksdb:{NOTEBOOK / 'surreal_data' / 'mydatabase.db'}"],
                         NOTEBOOK, LOGS / "surrealdb.log", env)
        wait_until_up(DATABASE, 20, database)
    api = start([uv, "run", "--no-sync", "--env-file", ".env", "uvicorn", "api.main:app",
                 "--host", "127.0.0.1", "--port", "5055"], NOTEBOOK, LOGS / "notebook-api.log", env)
    if not wait_until_up(ENGINE, 60, api):
        print(f"Kratt's engine didn't come up; its log is {LOGS / 'notebook-api.log'}")
    return database, api


def start_service() -> subprocess.Popen | None:
    if is_up(SERVICE):
        print("The Study folder service is already running.")
        return None
    program = ENGINE_DIR / ".venv" / ("Scripts/memory-engine.exe" if WINDOWS else "bin/memory-engine")
    if not program.is_file():
        print(f"Skipping the Study folder service: {program} is missing. Set it up in engine/ with\n"
              "  python -m venv .venv  and then  .venv/bin/pip install -e '.[dev]'  "
              "(Windows: .venv\\Scripts\\pip install -e .[dev])")
        return None
    print("Starting the Study folder service...")
    return start([str(program), "serve"], ENGINE_DIR)


def start_app() -> subprocess.Popen | None:
    if is_up(APP):
        print("The study app is already running.")
        return None
    npm = shutil.which("npm")
    if npm is None:
        sys.exit("Can't start the study app: npm isn't installed (it comes with Node.js, nodejs.org).")
    print("Starting the study app...")
    app = start([npm, "run", "dev"], STUDY)
    wait_until_up(APP, 30, app)
    return app


def _stop_on_terminate(*_) -> None:
    raise KeyboardInterrupt  # closing the terminal or `kill` cleans up like Ctrl+C


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start Kratt: its engine, the Study folder service and the study app.")
    parser.add_argument("--no-browser", action="store_true", help="don't open the app in the browser")
    args = parser.parse_args(argv)
    LOGS.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGINT, signal.default_int_handler)  # even when started with Ctrl+C ignored
    for name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), _stop_on_terminate)

    database = api = service = app = None
    try:
        database, api = start_engine()
        service = start_service()
        app = start_app()
        if not args.no_browser:
            webbrowser.open(APP_URL)
        print(f"The study app is at {APP_URL}")
        if app is None:
            return 0  # the app was already running: leave what was started here running
        print("Press Ctrl+C to stop.")
        app.wait()
    except KeyboardInterrupt:
        print()  # Ctrl+C, also while starting: stop what was started so far
    stop(app, "the study app")
    stop(service, "the Study folder service")
    stop(api, "Kratt's engine")
    stop(database, "Kratt's engine's database")
    return 0


if __name__ == "__main__":
    sys.exit(main())
