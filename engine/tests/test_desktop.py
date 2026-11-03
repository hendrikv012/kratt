import http.client
import os
import re
import subprocess
import sys
import threading

import pytest

# Runs the service with SIGINT ignored, the way a shell's `&`, nohup or some launchers start the app.
SIGINT_IGNORED = (
    "import runpy, signal, sys; signal.signal(signal.SIGINT, signal.SIG_IGN); "
    "sys.argv[0] = 'kratt-service'; runpy.run_module('memory_engine.desktop', run_name='__main__')"
)


@pytest.fixture(params=["normal", "sigint-ignored"])
def desktop_service(request, tmp_path):
    env = {**os.environ, "MEMORY_ENGINE_CONFIG": str(tmp_path / "study.json"), "PYTHONUNBUFFERED": "1"}
    start = ["-m", "memory_engine.desktop"] if request.param == "normal" else ["-c", SIGINT_IGNORED]
    proc = subprocess.Popen(
        [sys.executable, *start, "--exit-with-stdin", "--port", "0", "--folder", str(tmp_path / "Study")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True,
    )
    port = None
    output = []
    found = threading.Event()

    def read_port():
        nonlocal port
        for line in proc.stdout:
            output.append(line)
            match = re.search(r"Listening on http://127\.0\.0\.1:(\d+)", line)
            if match:
                port = int(match.group(1))
                found.set()
        found.set()

    threading.Thread(target=read_port, daemon=True).start()
    try:
        assert found.wait(45) and port, "the service never said it was listening: " + "".join(output)
        yield proc, port
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def status_for(port, origin):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", "/vault", headers={"Origin": origin})
    return conn.getresponse().status


def test_the_desktop_window_is_let_in_and_others_are_refused(desktop_service):
    _, port = desktop_service
    assert status_for(port, "tauri://localhost") != 403
    assert status_for(port, "http://tauri.localhost") != 403
    assert status_for(port, "https://evil.example") == 403


def test_the_service_stops_when_its_stdin_closes(desktop_service):
    proc, _ = desktop_service
    proc.stdin.close()
    assert proc.wait(timeout=10) == 0
