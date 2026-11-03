import http.client
import json
import threading
from pathlib import Path

from memory_engine.serve import make_server
from memory_engine.vault import Vault
from memory_engine.vault_search import VaultSearch


def test_session_token_health_cors_and_explicit_online_selection(tmp_path, monkeypatch):
    monkeypatch.setenv("KRATT_ENGINE_TOKEN", "secret-session")
    monkeypatch.setenv("KRATT_DESKTOP", "1")
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "config.json"))
    server = make_server(tmp_path / "Study", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def request(path, token="secret-session", origin="tauri://localhost", method="GET", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        conn.request(method, path, body=json.dumps(body) if body else None,
                     headers={"Origin": origin, "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result
    try:
        assert request("/health")[1] == {"ok": True, "service": "kratt-engine", "protocol": 1}
        assert request("/vault", token="wrong")[0] == 401
        assert request("/vault", origin="https://evil.example")[0] == 403
        assert request("/notebook/status")[0] == 403
        calls = []
        monkeypatch.setattr(server.online_ai, "ask", lambda prompt: calls.append(prompt) or "Provider answer")
        assert request("/ai/settings", token="wrong")[0] == 401
        assert request("/ai/settings", origin="https://evil.example")[0] == 403
        assert request("/ai/ask", method="POST", body={"prompt": "private note"})[0] == 400
        assert not calls
        saved = request("/ai/settings", method="PUT", body={"provider": "openai", "key": "test-private-key", "model": "test-model"})
        assert saved[0] == 200 and saved[1]["profiles"]["openai"]["keySet"]
        assert "test-private-key" not in json.dumps(request("/ai/settings")[1])
        assert request("/setting/local-ai", method="PUT", body={"local": False})[0] == 200
        assert request("/ai/ask", method="POST", body={"prompt": "selected test text"}) == (200, {"output": "Provider answer"})
        assert calls == ["selected test text"]
        assert request("/ai/chatgpt/cancel", method="POST")[1]["pending"] is False
        assert request("/setting/preferences", method="PUT", body={"preferences": {"appearance": {"themeId": "chalk"}}})[0] == 200
        assert json.loads((tmp_path / "config.json").read_text())["preferences"]["appearance"]["themeId"] == "chalk"
    finally:
        server.shutdown()
        server.server_close()


def test_index_tracks_disk_edits_moves_and_deletes_without_ollama(tmp_path):
    note = tmp_path / "Cell.md"
    note.write_text("# Cell\nMitochondria make ATP.")
    search = VaultSearch(Vault(tmp_path))
    assert search.search("ATP")[0]["path"] == "Cell.md"
    note.write_text("# Cell\nChloroplasts make glucose.")
    assert not search.search("ATP")
    assert "glucose" in search.search("glucose")[0]["text"]
    note.rename(tmp_path / "Plant.md")
    assert search.search("glucose")[0]["path"] == "Plant.md"
    (tmp_path / "Plant.md").unlink()
    assert not search.search("glucose")
    assert not search.search('" OR *')


def test_index_does_not_follow_external_file_symlink(tmp_path):
    root = tmp_path / "Study"
    root.mkdir()
    outside = tmp_path / "private.md"
    outside.write_text("privatepassphrase")
    try:
        (root / "link.md").symlink_to(outside)
    except OSError:
        return  # Windows runner may not grant symlink creation.
    assert not VaultSearch(Vault(root)).search("privatepassphrase")


def test_local_model_list_excludes_remote_ollama_aliases():
    from memory_engine.local_ai import chat_model_names
    assert chat_model_names([
        {"name": "local:3b"}, {"name": "remote:cloud"},
        {"name": "harmless-alias", "remote_host": "https://ollama.com", "remote_model": "remote"},
    ]) == ["local:3b"]


def test_corrupt_desktop_config_is_preserved(tmp_path, monkeypatch):
    from memory_engine.desktop import main
    import pytest
    for key in ("MEMORY_ENGINE_CONFIG", "KRATT_LOG_DIR", "KRATT_DESKTOP"):
        monkeypatch.setenv(key, "test")
    config = tmp_path / "config.json"
    config.write_text("{corrupt")
    with pytest.raises(ValueError, match="Cannot read"):
        main(["--data-dir", str(tmp_path)])
    assert config.read_text() == "{corrupt"


def test_atomic_replacement_on_platforms_without_fchmod(tmp_path, monkeypatch):
    import os
    from memory_engine.frontmatter import atomic_write
    note = tmp_path / "note.md"
    atomic_write(note, "First version")
    monkeypatch.delattr(os, "fchmod", raising=False)
    atomic_write(note, "Second version")
    assert note.read_text() == "Second version"
    assert not list(tmp_path.glob(".*.tmp"))
