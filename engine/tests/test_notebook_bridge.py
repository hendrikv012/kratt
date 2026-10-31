import http.client
import json
import socket
import stat
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from memory_engine import notebook_bridge
from memory_engine.notebook_bridge import (
    clean_base_url,
    find_prompt_transformation,
    map_error,
)
from memory_engine.serve import make_server

# ---------- the same checks as Lokus's on_bridge.rs tests


def test_finds_the_transformation_by_name():
    listing = '[{"id":"transformation:1","name":"Summary"},{"id":"transformation:2","name":"Study app prompt"}]'
    assert find_prompt_transformation(listing) == "transformation:2"


def test_none_when_absent_or_unreadable():
    assert find_prompt_transformation('[{"id":"t:1","name":"Summary"}]') is None
    assert find_prompt_transformation("[]") is None
    assert find_prompt_transformation("not json") is None
    assert find_prompt_transformation('{"name":"Study app prompt"}') is None


def test_maps_errors():
    assert map_error(None) == "ai-unavailable"
    assert map_error(401) == "ai-auth"
    assert map_error(502) == "ai-unavailable"


def test_accepts_only_http_addresses_with_a_host():
    assert clean_base_url("http://localhost:5055/") == "http://localhost:5055"
    assert clean_base_url(" https://notes.local ") == "https://notes.local"
    for bad in ["file:///etc/passwd", "ftp://host", "localhost:5055", "http://", "", "javascript:alert(1)"]:
        with pytest.raises(notebook_bridge.NotebookError):
            clean_base_url(bad)


# ---------- through the Study folder service, against a stand-in Open Notebook


class FakeNotebook(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _FakeHandler)
        self.transformations: list[dict] = []
        self.token: str | None = None  # when set, requests need "Bearer <token>"
        self.redirect = False
        self.calls: list[tuple[str, str, str | None, dict | None]] = []

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"


class _FakeHandler(BaseHTTPRequestHandler):
    server: FakeNotebook

    def log_message(self, *args):
        pass

    def _answer(self, status, payload=None, headers=None):
        body = json.dumps(payload).encode() if payload is not None else b""
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        self.server.calls.append((self.command, self.path, self.headers.get("Authorization"), body))
        if self.server.redirect:
            return self._answer(302, headers={"Location": "http://127.0.0.1:1/elsewhere"})
        if self.server.token and self.headers.get("Authorization") != f"Bearer {self.server.token}":
            return self._answer(401, {"detail": "no"})
        if (self.command, self.path) == ("GET", "/api/config"):
            return self._answer(200, {"version": "test"})
        if (self.command, self.path) == ("GET", "/api/transformations"):
            return self._answer(200, self.server.transformations)
        if (self.command, self.path) == ("POST", "/api/transformations"):
            created = {"id": f"transformation:{len(self.server.transformations) + 1}", **body}
            self.server.transformations.append(created)
            return self._answer(200, created)
        if (self.command, self.path) == ("POST", "/api/transformations/execute"):
            known = {t["id"] for t in self.server.transformations}
            if body["transformation_id"] not in known:
                return self._answer(404, {"detail": "no such transformation"})
            return self._answer(200, {"output": f"answer to: {body['input_text']}"})
        return self._answer(404, {"detail": "unknown"})

    do_GET = do_POST = _handle


@pytest.fixture
def notebook():
    server = FakeNotebook()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()
    server.server_close()


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "config" / "study.json"))
    monkeypatch.setattr(notebook_bridge, "_cache", None)
    server = make_server(tmp_path / "Study", port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()
    server.server_close()


def call(server, method, path, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
    data = json.dumps(body).encode() if body is not None else None
    conn.request(method, path, body=data, headers={"Origin": "http://localhost:1420"})
    reply = conn.getresponse()
    return reply.status, json.loads(reply.read() or b"null")


def ask(service, notebook, prompt="2+2?"):
    return call(service, "POST", "/notebook/ask", {"base_url": notebook.base + "/", "prompt": prompt})


def test_ask_creates_the_transformation_once_and_returns_the_output(service, notebook):
    assert ask(service, notebook) == (200, {"output": "answer to: 2+2?"})
    assert [t["name"] for t in notebook.transformations] == ["Study app prompt"]
    assert ask(service, notebook, "again") == (200, {"output": "answer to: again"})
    lookups = [c for c in notebook.calls if c[:2] == ("GET", "/api/transformations")]
    assert len(lookups) == 1  # the id is remembered
    created = notebook.transformations[0]
    assert created["apply_default"] is False and created["title"] == "Study app prompt"


def test_ask_reuses_an_existing_transformation(service, notebook):
    notebook.transformations.append({"id": "transformation:9", "name": "Study app prompt"})
    assert ask(service, notebook) == (200, {"output": "answer to: 2+2?"})
    assert not any(c[:2] == ("POST", "/api/transformations") for c in notebook.calls)


def test_a_deleted_transformation_is_looked_up_again(service, notebook):
    assert ask(service, notebook)[0] == 200
    notebook.transformations.clear()
    assert ask(service, notebook) == (502, {"error": "ai-unavailable"})
    assert ask(service, notebook) == (200, {"output": "answer to: 2+2?"})


def test_the_password_is_sent_kept_private_and_never_returned(service, notebook, tmp_path):
    notebook.token = "s3cret"
    assert ask(service, notebook) == (502, {"error": "ai-auth"})
    assert call(service, "GET", "/setting/notebook-password") == (200, {"set": False})

    assert call(service, "PUT", "/setting/notebook-password", {"password": "s3cret"}) == (200, {})
    assert call(service, "GET", "/setting/notebook-password") == (200, {"set": True})
    stored = tmp_path / "config" / "notebook-password"
    assert stored.read_text() == "s3cret"
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600
    assert ask(service, notebook) == (200, {"output": "answer to: 2+2?"})
    assert all(c[2] == "Bearer s3cret" for c in notebook.calls[-2:])

    assert call(service, "PUT", "/setting/notebook-password", {"password": None}) == (200, {})
    assert not stored.exists()
    assert call(service, "PUT", "/setting/notebook-password", {"password": 7})[0] == 400


def test_status_says_whether_open_notebook_answers(service, notebook):
    assert call(service, "GET", f"/notebook/status?base_url={notebook.base}") == (200, {"ok": True})
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed = probe.getsockname()[1]  # nothing listens here once the socket closes
    assert call(service, "GET", f"/notebook/status?base_url=http://127.0.0.1:{closed}") == (200, {"ok": False})
    status, reply = call(service, "POST", "/notebook/ask", {"base_url": f"http://127.0.0.1:{closed}", "prompt": "x"})
    assert (status, reply) == (502, {"error": "ai-unavailable"})


def test_redirects_are_not_followed(service, notebook):
    notebook.redirect = True
    assert ask(service, notebook) == (502, {"error": "ai-unavailable"})
    assert len(notebook.calls) == 1


def test_a_bad_address_is_a_clear_error(service):
    status, reply = call(service, "POST", "/notebook/ask", {"base_url": "file:///etc/passwd", "prompt": "x"})
    assert status == 400 and "http://" in reply["error"]
    assert call(service, "GET", "/notebook/status?base_url=localhost:5055")[0] == 400
