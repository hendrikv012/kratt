import http.client
import json
import shutil
import socket
import threading

import pytest

from memory_engine.__main__ import main
from memory_engine.serve import Watcher, load_study_folder, make_server
from memory_engine import vault as vault_module
from memory_engine.vault import Vault


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "study.json"))
    server = make_server(tmp_path / "Study", port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()



def call(server, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    conn.request(method, path, body=data, headers={"Origin": "http://localhost:1420", **(headers or {})})
    reply = conn.getresponse()
    return reply.status, reply.getheader("Access-Control-Allow-Origin"), reply.read()


def test_snapshot_is_served_to_the_app(service):
    status, allow, body = call(service, "GET", "/vault")
    assert status == 200 and allow == "http://localhost:1420" and json.loads(body)["files"] == []


@pytest.mark.parametrize("headers", [{"Origin": "https://evil.example"}, {"Host": "evil.example:5057"}])
def test_other_pages_are_refused(service, headers):
    status, _, _ = call(service, "PUT", "/file", {"path": "x.md", "text": "x", "create": True}, headers)
    assert status == 403 and not (service.vault.root / "x.md").exists()


def test_preflight_allows_the_app(service):
    status, allow, _ = call(service, "OPTIONS", "/file", headers={"Access-Control-Request-Method": "PUT"})
    assert status == 204 and allow == "http://localhost:1420"


def test_write_read_move_and_trash(service):
    status, _, body = call(service, "PUT", "/file", {"path": "Notes.md", "text": "One.\n", "create": True})
    written = json.loads(body)
    assert status == 200 and written["path"] == "Notes.md"
    assert json.loads(call(service, "GET", "/file?path=Notes.md")[2]) == {"text": "One.\n", "version": written["version"]}
    assert json.loads(call(service, "POST", "/move", {"from": "Notes.md", "to": "Kept.md"})[2]) == {"path": "Kept.md"}
    assert json.loads(call(service, "POST", "/trash", {"path": "Kept.md"})[2])["path"].startswith(".study/trash/")


def test_a_stale_save_reports_the_clash(service):
    v1 = json.loads(call(service, "PUT", "/file", {"path": "K.md", "text": "a", "create": True})[2])["version"]
    (service.vault.root / "K.md").write_text("by hand")
    clash = json.loads(call(service, "PUT", "/file", {"path": "K.md", "text": "mine", "version": v1})[2])["clash"]
    assert clash.startswith("K (from disk ")


def test_bad_paths_are_a_clear_error(service):
    status, _, body = call(service, "GET", "/file?path=../../etc/passwd")
    assert status == 400 and "is not a path in the Study folder" in json.loads(body)["error"]


def test_layout_and_upload(service):
    assert call(service, "PUT", "/layout", {"layout": {"subjects": ["s1"]}})[0] == 200
    assert service.vault.read_layout() == {"subjects": ["s1"]}
    assert json.loads(call(service, "POST", "/upload?path=Sources/files/a.pdf", b"%PDF")[2]) == {"path": "Sources/files/a.pdf"}
    big = bytes(range(256)) * 9000  # over 2 MiB, so it arrives in several chunks
    assert json.loads(call(service, "POST", "/upload?path=Sources/files/a.pdf", big)[2]) == {"path": "Sources/files/a (2).pdf"}
    assert (service.vault.root / "Sources/files/a (2).pdf").read_bytes() == big


def test_upload_disk_full_is_507(service, monkeypatch):
    monkeypatch.setattr(vault_module.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(0, 0, 5))
    status, _, body = call(service, "POST", "/upload?path=Sources/files/a.bin", b"x" * 10)
    assert status == 507
    assert json.loads(body) == {"error": "Not enough space on disk (needs 0.0 GB, 0.0 GB free)"}
    assert not (service.vault.root / "Sources").exists()


def test_upload_over_limit_is_413(service):
    status, _, body = call(service, "POST", "/upload?path=Sources/files/a.bin", b"x", {"Content-Length": "53687091201"})
    assert status == 413 and "error" in json.loads(body)


def test_the_folder_setting_switches_and_is_remembered(service, tmp_path):
    other = tmp_path / "Other study"
    assert json.loads(call(service, "PUT", "/setting/folder", {"path": str(other)})[2]) == {"path": str(other)}
    assert other.is_dir() and service.vault.root == other and load_study_folder() == other


def test_watcher_sees_changes_made_by_hand(tmp_path):
    vault = Vault(tmp_path)
    watcher = Watcher(vault)
    assert watcher.poll() == []
    (tmp_path / "a.md").write_text("x")
    assert watcher.poll() == [{"type": "added", "path": "a.md"}]
    (tmp_path / "a.md").write_text("longer")
    assert watcher.poll() == [{"type": "changed", "path": "a.md"}]
    (tmp_path / "a.md").unlink()
    assert watcher.poll() == [{"type": "removed", "path": "a.md"}]


def test_events_stream_a_change(service):
    conn = http.client.HTTPConnection("127.0.0.1", service.server_port, timeout=5)
    conn.request("GET", "/events", headers={"Origin": "http://localhost:1420"})
    reply = conn.getresponse()
    (service.vault.root / "new.md").write_text("x")
    line = reply.fp.readline()
    while not line.startswith(b"data:"):
        line = reply.fp.readline()
    assert json.loads(line[5:]) == {"type": "added", "path": "new.md"}


def test_cli_serve_prints_where_it_listens(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "study.json"))
    started = []
    monkeypatch.setattr("memory_engine.__main__.serve_forever", lambda server: started.append(server))
    assert main(["serve", "--folder", str(tmp_path / "Study"), "--port", "0"]) == 0
    assert started and started[0].vault.root == tmp_path / "Study"


def test_other_file_errors_are_answered_not_dropped(service):
    too_long = "x" * 300 + ".md"
    status, _, body = call(service, "PUT", "/file", {"path": too_long, "text": "x", "create": True})
    assert status == 400 and json.loads(body)["error"]
    call(service, "POST", "/folder", {"path": "A"})
    status, _, body = call(service, "POST", "/move", {"from": "A", "to": "A/B"})  # into itself
    assert status == 400 and json.loads(body)["error"]


def disk_with(free):
    return lambda _: shutil._ntuple_diskusage(0, 0, free)


def test_upload_check_answers_before_any_bytes_are_sent(service, monkeypatch):
    assert call(service, "GET", "/upload/check?path=Sources/files/a.bin&size=10")[::2] == (200, b'{"ok": true}')
    status, _, body = call(service, "GET", "/upload/check?path=Sources/files/a.bin&size=53687091201")
    assert status == 413 and "error" in json.loads(body)
    status, _, body = call(service, "GET", "/upload/check?path=Biology/a.bin&size=10")
    assert status == 400 and "Sources/files" in json.loads(body)["error"]
    status, _, body = call(service, "GET", "/upload/check?path=Sources/files/a.bin&size=-1")
    assert status == 400
    monkeypatch.setattr(vault_module.shutil, "disk_usage", disk_with(3_100_000_000))
    status, _, body = call(service, "GET", "/upload/check?path=Sources/files/a.bin&size=12400000000")
    assert status == 507
    assert json.loads(body) == {"error": "Not enough space on disk (needs 12.4 GB, 3.1 GB free)"}
    assert not (service.vault.root / "Sources").exists()


def test_a_507_reaches_an_app_still_sending_the_body(service, monkeypatch):
    monkeypatch.setattr(vault_module.shutil, "disk_usage", disk_with(1000))
    size = 16 * 1024 * 1024
    head = (f"POST /upload?path=Sources/files/big.bin HTTP/1.1\r\nHost: 127.0.0.1:{service.server_port}\r\n"
            f"Origin: http://localhost:1420\r\nContent-Length: {size}\r\n\r\n").encode()
    with socket.create_connection(("127.0.0.1", service.server_port), timeout=10) as sock:
        sock.sendall(head)
        sock.sendall(b"x" * size)
        reply = b""
        while chunk := sock.recv(65536):
            reply += chunk
    status_line, _, rest = reply.partition(b"\r\n")
    assert b" 507 " in status_line
    assert json.loads(rest.split(b"\r\n\r\n", 1)[1]) == {"error": "Not enough space on disk (needs 0.0 GB, 0.0 GB free)"}


def test_upload_requires_explicit_size_and_rejects_transfer_encoding(service):
    conn = http.client.HTTPConnection('127.0.0.1', service.server_port, timeout=5)
    conn.putrequest('POST', '/upload?path=Sources/files/missing.bin')
    conn.putheader('Origin', 'http://localhost:1420')
    conn.endheaders()
    reply = conn.getresponse()
    assert reply.status == 400
    assert 'Content-Length' in reply.read().decode()
    assert not (service.vault.root / 'Sources/files/missing.bin').exists()


def test_upload_preflight_and_body_require_desktop_auth(service):
    service.token = 'fixture-token'
    assert call(service, 'GET', '/upload/check?path=Sources/files/a.bin&size=1')[0] == 401
    assert call(service, 'POST', '/upload?path=Sources/files/a.bin', b'x')[0] == 401
    headers = {'Authorization': 'Bearer fixture-token'}
    assert call(service, 'GET', '/upload/check?path=Sources/files/a.bin&size=1', headers=headers)[0] == 200
    assert call(service, 'POST', '/upload?path=Sources/files/a.bin', b'x', headers=headers)[0] == 200
