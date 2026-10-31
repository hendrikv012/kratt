import http.client
import json
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from memory_engine import local_ai
from memory_engine.local_ai import LocalAiError, OllamaKeeper
from memory_engine.serve import (
    load_local_ai,
    load_study_folder,
    make_server,
    save_study_folder,
)

LLAMA = {"name": "llama3.2:1b", "capabilities": ["completion", "tools"]}
THINKER = {"name": "qwen3:4b", "capabilities": ["completion", "thinking"]}
EMBEDDER = {"name": "nomic-embed-text:latest", "capabilities": ["embedding"]}


class FakeOllama:
    """An Ollama that answers /api/tags with `models` and /api/chat with `reply`."""

    def __init__(self, models=(LLAMA, EMBEDDER), reply="An answer.", port=0):
        self.models = list(models)
        self.reply = reply
        self.chats = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self._send(200, {"models": fake.models})

            def do_POST(self):
                fake.chats.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self._send(200, {"message": {"role": "assistant", "content": fake.reply}, "done": True})

            def _send(self, status, payload):
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def ollama():
    fake = FakeOllama()
    yield fake
    fake.close()


def free_url():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{s.getsockname()[1]}"


class FakeProcess:
    def __init__(self, exit_code=None):
        self.exit_code = exit_code
        self.terminated = False

    def poll(self):
        return self.exit_code

    def terminate(self):
        self.terminated = True
        self.exit_code = 0

    def wait(self, timeout=None):
        return self.exit_code

    def kill(self):
        self.exit_code = -9


# ---------- finding Ollama


def test_ollama_on_the_path_is_found_first():
    assert local_ai.find_ollama(which=lambda name: "/opt/bin/ollama", exists=lambda p: False) == "/opt/bin/ollama"


@pytest.mark.parametrize("system, env, expected", [
    ("Darwin", {"HOME": "/Users/me"}, "/Applications/Ollama.app/Contents/Resources/ollama"),
    ("Windows", {"LOCALAPPDATA": "C:\\Users\\me\\AppData\\Local"}, "C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe"),
    ("Linux", {"HOME": "/home/me"}, "/usr/local/bin/ollama"),
])
def test_ollama_is_found_where_its_installer_puts_it(system, env, expected):
    assert local_ai.find_ollama(system, env, exists=lambda p: p == expected, which=lambda name: None) == expected


def test_no_ollama_anywhere():
    assert local_ai.find_ollama("Linux", {"HOME": "/h"}, exists=lambda p: False, which=lambda name: None) is None


@pytest.mark.parametrize("host, url", [
    (None, "http://127.0.0.1:11434"),
    ("127.0.0.1:11555", "http://127.0.0.1:11555"),
    ("0.0.0.0", "http://127.0.0.1:11434"),
    ("http://0.0.0.0:8080", "http://127.0.0.1:8080"),
    ("https://ollama.lan", "https://ollama.lan:11434"),
])
def test_ollama_is_asked_where_ollama_host_says(host, url):
    assert local_ai.ollama_url({} if host is None else {"OLLAMA_HOST": host}) == url


def test_only_models_that_can_chat_are_listed():
    old_style = [{"name": "mistral:7b", "details": {"family": "llama"}},
                 {"name": "mxbai-embed-large:latest", "details": {"family": "bert"}}]
    assert local_ai.chat_model_names([EMBEDDER, THINKER, LLAMA, *old_style]) == ["llama3.2:1b", "mistral:7b", "qwen3:4b"]


# ---------- starting and stopping


def test_a_running_ollama_is_used_and_never_stopped(ollama):
    starts = []
    keeper = OllamaKeeper(ollama.url, find=lambda: "/usr/bin/ollama", start=lambda *a, **k: starts.append(a))
    assert keeper.ensure() == {"state": "running", "detail": "", "models": ["llama3.2:1b"]}
    keeper.stop()
    assert starts == [] and not keeper.started_here


def test_ollama_not_installed(tmp_path):
    keeper = OllamaKeeper(free_url(), find=lambda: None, log_path=tmp_path / "ollama.log")
    assert keeper.ensure()["state"] == "not-installed"


def test_ollama_is_started_once_and_stopped_by_who_started_it(tmp_path):
    url = free_url()
    port = int(url.rsplit(":", 1)[1])
    started, servers = [], []

    def start(args, **options):
        started.append(args)
        servers.append(FakeOllama(port=port))
        return FakeProcess()

    keeper = OllamaKeeper(url, find=lambda: "/usr/bin/ollama", start=start, log_path=tmp_path / "ollama.log")
    try:
        threads = [threading.Thread(target=keeper.ensure) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert started == [["/usr/bin/ollama", "serve"]]  # three requests at once, one Ollama
        assert keeper.ensure()["state"] == "started"
        process = keeper._process
        keeper.stop()
        assert process.terminated and not keeper.started_here
    finally:
        for server in servers:
            server.close()


def test_a_start_that_fails_says_why(tmp_path):
    log = tmp_path / "ollama.log"

    def start(args, stdout, **options):
        stdout.write(b"time=... level=INFO msg=starting\n")
        stdout.write(b"Error: listen tcp 127.0.0.1:11434: bind: address already in use\n")
        return FakeProcess(exit_code=1)

    keeper = OllamaKeeper(free_url(), find=lambda: "/usr/bin/ollama", start=start, log_path=log)
    status = keeper.ensure()
    assert status == {"state": "failed", "models": [],
                      "detail": "Error: listen tcp 127.0.0.1:11434: bind: address already in use"}
    assert not keeper.started_here


def test_a_program_that_cannot_run_is_a_failed_start(tmp_path):
    def start(args, **options):
        raise PermissionError(13, "Permission denied")

    status = OllamaKeeper(free_url(), find=lambda: "/x/ollama", start=start, log_path=tmp_path / "o.log").ensure()
    assert status == {"state": "failed", "detail": "Permission denied", "models": []}


def test_a_real_process_is_started_and_stopped(tmp_path, monkeypatch):
    """With a stand-in `ollama` program, as close to the real thing as a test gets."""
    url = free_url()
    program = tmp_path / "ollama"
    program.write_text(f"""#!{sys.executable}
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
assert sys.argv[1:] == ["serve"]
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({{"models": [{json.dumps(LLAMA)}]}}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
print("listening", flush=True)
HTTPServer(("127.0.0.1", {url.rsplit(":", 1)[1]}), H).serve_forever()
""")
    program.chmod(0o755)
    keeper = OllamaKeeper(url, find=lambda: str(program), log_path=tmp_path / "ollama.log")
    assert keeper.ensure() == {"state": "started", "detail": "", "models": ["llama3.2:1b"]}
    process = keeper._process
    keeper.stop()
    assert process.poll() is not None
    assert local_ai.installed_models(url) is None


# ---------- asking


def test_ask_sends_the_prompt_to_the_picked_model(ollama):
    keeper = OllamaKeeper(ollama.url, find=lambda: None)
    assert local_ai.ask(keeper, "llama3.2:1b", "Why?") == "An answer."
    sent = ollama.chats[0]
    assert sent["model"] == "llama3.2:1b" and sent["messages"] == [{"role": "user", "content": "Why?"}]
    assert sent["stream"] is False and sent["options"]["num_ctx"] == 4096 and "think" not in sent


def test_a_thinking_model_answers_without_its_reasoning(ollama):
    ollama.models = [THINKER]
    ollama.reply = "<think>hmm</think>\n\nThe answer."
    assert local_ai.ask(OllamaKeeper(ollama.url, find=lambda: None), "qwen3:4b", "Q") == "The answer."
    assert ollama.chats[0]["think"] is False


def test_a_long_prompt_gets_a_larger_context():
    assert local_ai.context_size("x" * 100) == 4096
    assert local_ai.context_size("x" * 15000) == 8192
    assert local_ai.context_size("x" * 49152) == 32768  # Long chat memory


@pytest.mark.parametrize("model, find, code", [
    (None, lambda: None, "no-model"),
    ("llama3.2:8b", lambda: None, "model-missing"),
])
def test_ask_errors_with_ollama_running(ollama, model, find, code):
    with pytest.raises(LocalAiError, match=code):
        local_ai.ask(OllamaKeeper(ollama.url, find=find), model, "Q")


def test_ask_without_ollama_installed(tmp_path):
    with pytest.raises(LocalAiError, match="ollama-missing"):
        local_ai.ask(OllamaKeeper(free_url(), find=lambda: None, log_path=tmp_path / "o.log"), "llama3.2:1b", "Q")


def test_latest_is_implied(ollama):
    ollama.models = [{"name": "llama3.2:latest", "capabilities": ["completion"]}]
    assert local_ai.ask(OllamaKeeper(ollama.url, find=lambda: None), "llama3.2", "Q") == "An answer."


# ---------- the service's routes


@pytest.fixture
def service(tmp_path, monkeypatch, ollama):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "study.json"))
    server = make_server(tmp_path / "Study", port=0, ollama=OllamaKeeper(ollama.url, find=lambda: None))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()
    server.server_close()


def call(server, method, path, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    conn.request(method, path, body=None if body is None else json.dumps(body),
                 headers={"Origin": "http://localhost:1420"})
    reply = conn.getresponse()
    return reply.status, json.loads(reply.read())


def test_status_lists_installed_chat_models(service):
    assert call(service, "GET", "/local/status") == (200, {
        "local": True, "model": None, "state": "running", "detail": "", "models": ["llama3.2:1b"]})


def test_picking_a_model_is_remembered_beside_the_folder(service, tmp_path):
    save_study_folder(tmp_path / "Elsewhere")
    assert call(service, "PUT", "/setting/local-ai", {"model": "llama3.2:1b"}) == (200, {"local": True, "model": "llama3.2:1b"})
    assert load_local_ai() == {"local": True, "model": "llama3.2:1b"}
    assert load_study_folder() == tmp_path / "Elsewhere"
    assert call(service, "POST", "/local/ask", {"prompt": "Why?"}) == (200, {"output": "An answer."})


def test_online_service_leaves_ollama_alone(service):
    call(service, "PUT", "/setting/local-ai", {"local": False})
    _, answer = call(service, "GET", "/local/status")
    assert answer["state"] == "off" and answer["models"] == []


@pytest.mark.parametrize("body", [{"model": 3}, {"model": "  "}, {"local": "yes"}])
def test_bad_settings_are_refused(service, body):
    assert call(service, "PUT", "/setting/local-ai", body)[0] == 400


def test_ask_errors_reach_the_app_as_codes(service):
    assert call(service, "POST", "/local/ask", {"prompt": "Q"}) == (400, {"error": "no-model"})


def test_launch_starts_ollama_only_with_a_local_model_picked(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "study.json"))
    calls = []

    class Keeper:
        def ensure(self):
            calls.append("ensure")

        def stop(self):
            calls.append("stop")

    server = make_server(tmp_path / "Study", port=0, ollama=Keeper())
    server.start_ollama()
    (tmp_path / "study.json").write_text(json.dumps({"model": "llama3.2:1b", "local": False}))
    server.start_ollama()
    assert calls == []
    (tmp_path / "study.json").write_text(json.dumps({"model": "llama3.2:1b"}))
    server.start_ollama()
    server.server_close()
    for _ in range(50):
        if calls == ["ensure", "stop"]:
            break
        threading.Event().wait(0.02)
    assert calls == ["ensure", "stop"]


def test_terminating_the_service_stops_what_it_started(tmp_path):
    """`kill` (SIGTERM), as start.fish sends, runs the cleanup that stops a started Ollama."""
    script = tmp_path / "run.py"
    script.write_text("""
import sys
from memory_engine import __main__ as m
class Server:
    def serve_forever(self):
        print("up", flush=True)
        import time; time.sleep(30)
    def shutdown(self): pass
    def server_close(self): print("closed", flush=True)
m.serve_forever(Server())
""")
    process = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, text=True,
                               env={"PYTHONPATH": str(local_ai.Path(local_ai.__file__).parents[1])})
    assert process.stdout.readline().strip() == "up"
    process.terminate()
    assert process.communicate(timeout=10)[0].strip() == "closed"
