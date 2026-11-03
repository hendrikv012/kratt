"""Launch the packaged GUI with an isolated vault; verify frontend-started engine and crash cleanup.

Requires a graphical session (or xvfb-run on Linux). Does not replace visual/manual OS testing.
"""
import argparse
import http.client
import os
from pathlib import Path
import re
import signal
import sys
import socket
import subprocess
import tempfile
import time


def smoke(command):
    with tempfile.TemporaryDirectory(prefix="kratt-app-smoke-") as folder:
        root = Path(folder)
        with (root / "app.log").open("wb") as log:
            app = subprocess.Popen(command, env={**os.environ, "KRATT_DATA_DIR": str(root), "APPIMAGE_EXTRACT_AND_RUN": "1"}, stdout=log, stderr=log)
            port = None
            gui_pid = None
            try:
                deadline = time.monotonic() + 60
                while app.poll() is None and time.monotonic() < deadline:
                    engine_log = root / "logs/engine.log"
                    if engine_log.exists():
                        match = re.search(r"Listening on http://127\.0\.0\.1:(\d+)", engine_log.read_text(errors="replace"))
                        if match:
                            port = int(match[1])
                            break
                    time.sleep(.25)
                assert port, "GUI did not start its engine: " + (root / "app.log").read_text(errors="replace")
                assert (root / "Study").is_dir() and (root / "config.json").is_file()
                client = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                client.request("GET", "/health")
                assert client.getresponse().status == 401, "Packaged engine must require the session token"
                client.close()
                # Unexpected parent exit must close the pipe too, without relying on a Quit callback.
                gui_pid = app.pid
                if sys.platform == "linux":
                    # AppImage extract-and-run has a runtime parent; terminate the actual GUI.
                    rows = [line.split(maxsplit=2) for line in subprocess.check_output(["ps", "-eo", "pid,ppid,comm"], text=True).splitlines()[1:]]
                    descendants = {app.pid}
                    for _ in range(10):
                        descendants.update(int(pid) for pid, parent, name in rows if int(parent) in descendants)
                    candidates = [int(pid) for pid, parent, name in rows if int(pid) in descendants and name == "kratt"]
                    assert len(candidates) == 1, "Could not identify the spawned Kratt GUI"
                    gui_pid = candidates[0]
                os.kill(gui_pid, signal.SIGTERM)
                app.wait(timeout=15)
                deadline = time.monotonic() + 40
                while time.monotonic() < deadline:
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=.5):
                            pass
                    except OSError:
                        break
                    time.sleep(.25)
                else:
                    raise AssertionError("Engine outlived its parent")
            finally:
                if gui_pid and gui_pid != app.pid:
                    try:
                        os.kill(gui_pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if app.poll() is None:
                    app.kill()
                    app.wait(timeout=10)
    print("PASS: packaged GUI invoked startup, created its vault, required authentication, and stopped its engine on parent exit")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="+")
    smoke(parser.parse_args().command)
