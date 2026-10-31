import json
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from memory_engine.checks import MARP_CLI
from memory_engine.config import Settings
from memory_engine.db import connect, init_schema
from memory_engine.embeddings import FakeEmbedder

needs_bwrap = pytest.mark.skipif(shutil.which("bwrap") is None, reason="bubblewrap not installed")
needs_marp = pytest.mark.skipif(shutil.which("bwrap") is None or shutil.which("node") is None or not MARP_CLI.exists(),
                                reason="Marp not installed")


@pytest.fixture
def settings(tmp_path):
    return Settings(db_path=tmp_path / "memory.db")


@pytest.fixture
def conn(settings):
    connection = connect(settings)
    init_schema(connection, settings)
    yield connection
    connection.close()


@pytest.fixture
def fake():
    return FakeEmbedder(dims=768)


def _start_stub(status=200, payload=None, delay=0.0):
    """A fake Ollama. With no payload it answers one [3, 4] vector per input text."""
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            requests.append(request)
            time.sleep(delay)
            if payload is None:
                body = json.dumps({"embeddings": [[3.0, 4.0]] * len(request["input"])}).encode()
            else:
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except OSError:
                pass  # the client already gave up (timeout test)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, SimpleNamespace(url=f"http://127.0.0.1:{server.server_address[1]}", requests=requests)


@pytest.fixture
def make_stub():
    servers = []

    def make(**kwargs):
        server, stub = _start_stub(**kwargs)
        servers.append(server)
        return stub

    yield make
    for server in servers:
        server.shutdown()
        server.server_close()
