"""Exercise the actual frozen executable, not the Python source. Uses only test data."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def smoke(binary: Path):
    with tempfile.TemporaryDirectory(prefix="kratt-engine-smoke-") as temporary:
        root = Path(temporary)
        ready = root / "ready.json"
        token = uuid.uuid4().hex
        env = {**os.environ, "KRATT_ENGINE_TOKEN": token, "PYTHONHOME": "", "PYTHONPATH": ""}
        with (root / "process.log").open("wb") as log:
            process = subprocess.Popen([str(binary.resolve()), "--exit-with-stdin", "--port", "0",
                "--data-dir", str(root), "--ready-file", str(ready)], stdin=subprocess.PIPE,
                stdout=log, stderr=log, env=env)
            try:
                deadline = time.monotonic() + 45
                while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(.1)
                if not ready.exists():
                    raise AssertionError((root / "process.log").read_text(errors="replace"))
                port = json.loads(ready.read_text())["port"]
                def request(path, body=None, auth=token):
                    headers = {"Authorization": f"Bearer {auth}", "Content-Type": "application/json", "Origin": "tauri://localhost"}
                    method = "PUT" if body is not None else "GET"
                    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, headers=headers,
                        data=json.dumps(body).encode() if body is not None else None)
                    with urllib.request.urlopen(req, timeout=5) as response:
                        return json.load(response)
                assert request("/health")["service"] == "kratt-engine"
                try:
                    request("/vault", auth="wrong")
                    raise AssertionError("Engine accepted the wrong token")
                except urllib.error.HTTPError as error:
                    assert error.code == 401
                for name in ["Study", "logs", "temp"]:
                    assert (root / name).is_dir()
                request("/file", {"path": "Biology/Cells.md", "text": "# Cells\nMitochondria supply ATP.\n", "create": True})
                assert (root / "Study/Biology/Cells.md").read_text().endswith("Mitochondria supply ATP.\n")
                assert request("/search?q=ATP")["hits"][0]["path"] == "Biology/Cells.md"
                request("/setting/preferences", {"preferences": {"test": True}})
                assert json.loads((root / "config.json").read_text())["preferences"]["test"]
                assert request("/vault")["files"]
                process.stdin.close()
                assert process.wait(timeout=15) == 0
                assert not ready.exists()
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)
    print(f"PASS: {binary.name}: health, authentication, disk persistence, search, preferences and shutdown")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    smoke(parser.parse_args().binary)
