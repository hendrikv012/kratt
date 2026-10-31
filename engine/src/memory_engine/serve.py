"""`memory-engine serve`: the Study folder service for the study app.

A small HTTP service on 127.0.0.1 that only the study app may use (Origin and Host are
checked, so another web page in the same browser can't read or write the folder). It wraps
a Vault and streams file changes, found by polling, as server-sent events. It also bridges the
app's extension AI prompts to a local Open Notebook (`notebook_bridge`), and, when the AI runs
on this computer, the app's questions to Ollama (`local_ai`), which it starts if it has to.
"""

import json
import os
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from memory_engine import local_ai, notebook_bridge
from memory_engine.frontmatter import atomic_write
from memory_engine.vault import Vault, VaultError

ALLOWED_ORIGINS = {"http://localhost:1420", "tauri://localhost", "http://tauri.localhost"}
DEFAULT_PORT = 5057
KEEPALIVE_SECONDS = 15


def config_path() -> Path:
    override = os.environ.get("MEMORY_ENGINE_CONFIG")
    return Path(override) if override else Path.home() / ".config" / "memory-engine" / "study.json"


def _load_config() -> dict:
    try:
        config = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return config if isinstance(config, dict) else {}


def _save_config(**changes) -> None:
    target = config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(target, json.dumps({**_load_config(), **changes}, indent=2) + "\n")


def load_study_folder() -> Path:
    folder = _load_config().get("folder")
    return Path(folder) if folder else Path.home() / "Study"


def save_study_folder(path: Path) -> None:
    _save_config(folder=str(path))


def load_local_ai() -> dict:
    """{"local": whether the AI runs on this computer, "model": the Ollama model picked, or None}."""
    config = _load_config()
    model = config.get("model")
    return {"local": config.get("local", True) is not False, "model": model if isinstance(model, str) and model else None}


def local_model_configured() -> bool:
    setting = load_local_ai()
    return setting["local"] and setting["model"] is not None


class Watcher:
    """Finds files added, changed or removed in the folder by comparing modification time and size."""

    def __init__(self, vault: Vault, interval: float = 1.0):
        self.vault = vault
        self.interval = interval
        self._seen: dict[str, tuple[int, int]] | None = None

    def _scan(self) -> dict[str, tuple[int, int]]:
        found: dict[str, tuple[int, int]] = {}
        for folder, _, filenames in self.vault.walk():
            for name in filenames:
                path = folder / name
                try:
                    info = path.stat()
                except OSError:
                    continue
                found[path.relative_to(self.vault.root).as_posix()] = (info.st_mtime_ns, info.st_size)
        return found

    def poll(self) -> list[dict]:
        current = self._scan()
        if self._seen is None:
            self._seen = current
            return []
        events = [{"type": "added", "path": p} for p in current if p not in self._seen]
        events += [{"type": "removed", "path": p} for p in self._seen if p not in current]
        events += [{"type": "changed", "path": p} for p in current if p in self._seen and current[p] != self._seen[p]]
        self._seen = current
        return sorted(events, key=lambda e: e["path"])


def _write_file(request: "_Handler", query: dict) -> dict:
    data = request.json()
    return request.vault.write(str(data.get("path", "")), str(data.get("text", "")),
                               data.get("version"), bool(data.get("create")))


def _write_layout(request: "_Handler", query: dict) -> dict:
    layout = request.json().get("layout")
    if not isinstance(layout, dict):
        raise VaultError("layout must be an object")
    request.vault.write_layout(layout)
    return {}


def _switch_folder(request: "_Handler", query: dict) -> dict:
    path = Path(*request.fields("path")).expanduser()
    if not str(path).strip() or not path.is_absolute():
        raise VaultError("the Study folder must be a full path, like /home/you/Study")
    request.server.switch(path)
    save_study_folder(path)
    return {"path": str(path)}


def _notebook_ask(request: "_Handler", query: dict) -> dict:
    data = request.json()
    password = notebook_bridge.load_password(config_path().parent)
    return {"output": notebook_bridge.ask(str(data.get("base_url", "")), str(data.get("prompt", "")), password)}


def _notebook_status(request: "_Handler", query: dict) -> dict:
    password = notebook_bridge.load_password(config_path().parent)
    return {"ok": notebook_bridge.status(query.get("base_url", ""), password)}


def _set_notebook_password(request: "_Handler", query: dict) -> dict:
    password = request.json().get("password")
    if password is not None and not isinstance(password, str):
        raise VaultError("password must be text, or null to remove it")
    notebook_bridge.save_password(config_path().parent, password)
    return {}


def _local_status(request: "_Handler", query: dict) -> dict:
    """What Settings > AI shows: Ollama's state and its installed models. Asking starts Ollama when
    the AI runs on this computer, so the model list can be shown."""
    setting = load_local_ai()
    if not setting["local"]:
        return {**setting, "state": "off", "detail": "", "models": []}
    return {**setting, **request.server.ollama.ensure()}


def _set_local_ai(request: "_Handler", query: dict) -> dict:
    data = request.json()
    changes = {}
    if "local" in data:
        if not isinstance(data["local"], bool):
            raise VaultError("local must be true or false")
        changes["local"] = data["local"]
    if "model" in data:
        model = data["model"]
        if model is not None and (not isinstance(model, str) or not model.strip()):
            raise VaultError("model must be a model name, or null")
        changes["model"] = model.strip() if model else None
    _save_config(**changes)
    return load_local_ai()


def _local_ask(request: "_Handler", query: dict) -> dict:
    prompt = request.json().get("prompt")
    if not isinstance(prompt, str):
        raise VaultError("prompt must be text")
    return {"output": local_ai.ask(request.server.ollama, load_local_ai()["model"], prompt)}


# (method, path) -> route(request, query): the answer as JSON, or None when the route answered itself.
ROUTES = {
    ("GET", "/vault"): lambda request, query: request.vault.snapshot(),
    ("GET", "/file"): lambda request, query: dict(zip(("text", "version"), request.vault.read(query.get("path", "")))),
    ("GET", "/setting/folder"): lambda request, query: {"path": str(request.vault.root)},
    ("GET", "/events"): lambda request, query: request.stream_events(),
    ("PUT", "/file"): _write_file,
    ("PUT", "/layout"): _write_layout,
    ("PUT", "/setting/folder"): _switch_folder,
    ("POST", "/folder"): lambda request, query: {"path": request.vault.mkdir(*request.fields("path"))},
    ("POST", "/move"): lambda request, query: {"path": request.vault.move(*request.fields("from", "to"))},
    ("POST", "/trash"): lambda request, query: {"path": request.vault.trash(*request.fields("path"))},
    ("POST", "/upload"): lambda request, query: {"path": request.vault.upload(query.get("path", ""), request.body())},
    ("POST", "/notebook/ask"): _notebook_ask,
    ("GET", "/notebook/status"): _notebook_status,
    # The password is never sent back; the app can only ask whether one is set.
    ("GET", "/setting/notebook-password"): lambda request, query: {
        "set": notebook_bridge.load_password(config_path().parent) is not None},
    ("PUT", "/setting/notebook-password"): _set_notebook_password,
    ("GET", "/local/status"): _local_status,
    ("PUT", "/setting/local-ai"): _set_local_ai,
    ("POST", "/local/ask"): _local_ask,
}


class _Handler(BaseHTTPRequestHandler):
    server: "StudyServer"

    def log_message(self, *args) -> None:
        pass

    @property
    def vault(self) -> Vault:
        return self.server.vault

    # ---------- checks and answers

    def _origin(self) -> str | None:
        """The allowed Origin (or "" when the request has none); None means refuse."""
        port = self.server.server_port
        if self.headers.get("Host", "") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return None
        origin = self.headers.get("Origin")
        if origin is None:
            return ""
        return origin if origin in ALLOWED_ORIGINS else None

    def _send(self, status: int, payload: dict | None, origin: str | None = "") -> None:
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        self.send_response(status)
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    # ---------- the request, for routes

    def body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def json(self) -> dict:
        try:
            data = json.loads(self.body() or b"{}")
        except ValueError as err:
            raise VaultError(f"the request is not valid JSON: {err}") from err
        if not isinstance(data, dict):
            raise VaultError("the request must be a JSON object")
        return data

    def fields(self, *keys: str) -> list[str]:
        """These keys of the JSON body, as text (the body is read once)."""
        data = self.json()
        return [str(data.get(key, "")) for key in keys]

    # ---------- routing

    def _route(self) -> None:
        origin = self._origin()
        if origin is None:
            self._send(403, {"error": "only the study app may use this service"})
            return
        url = urlparse(self.path)
        query = {key: values[0] for key, values in parse_qs(url.query).items()}
        route = ROUTES.get((self.command, url.path))
        if route is None:
            self._send(404, {"error": f"no such route: {url.path}"}, origin)
            return
        try:
            result = route(self, query)
        except (notebook_bridge.NotebookError, local_ai.LocalAiError) as err:
            self._send(err.status, {"error": str(err)}, origin)
        except VaultError as err:
            self._send(400, {"error": str(err)}, origin)
        except FileNotFoundError as err:
            self._send(404, {"error": f"not found: {err.filename}"}, origin)
        except (OSError, ValueError) as err:
            # Anything else the file system refuses (a name too long, a folder moved into itself)
            # is answered, so the app doesn't take a dropped connection for a stopped service.
            self._send(400, {"error": getattr(err, "strerror", None) or str(err)}, origin)
        else:
            if result is not None:
                self._send(200, result, origin)

    do_GET = do_PUT = do_POST = _route

    def do_OPTIONS(self) -> None:
        origin = self._origin()
        if not origin:
            self._send(403, {"error": "only the study app may use this service"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def stream_events(self) -> None:
        """Stream change events until the app disconnects or the service stops."""
        origin = self._origin()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.end_headers()
        inbox = self.server.subscribe()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while not self.server.stopping.is_set():
                try:
                    event = inbox.get(timeout=KEEPALIVE_SECONDS)
                    self.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except OSError:
            pass  # the app went away
        finally:
            self.server.unsubscribe(inbox)


class StudyServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, folder: Path, port: int, ollama: local_ai.OllamaKeeper | None = None):
        super().__init__(("127.0.0.1", port), _Handler)
        self.ollama = ollama or local_ai.OllamaKeeper()
        self.stopping = threading.Event()
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue] = []
        self.vault: Vault
        self.watcher: Watcher
        self.switch(folder)
        threading.Thread(target=self._watch, daemon=True).start()

    def switch(self, folder: Path) -> None:
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self.vault = Vault(folder)
            self.watcher = Watcher(self.vault)
            self.watcher.poll()  # remember the folder as it is now

    def subscribe(self) -> queue.Queue:
        inbox: queue.Queue = queue.Queue()
        with self._lock:
            self._subscribers.append(inbox)
        return inbox

    def unsubscribe(self, inbox: queue.Queue) -> None:
        with self._lock:
            if inbox in self._subscribers:
                self._subscribers.remove(inbox)

    def _watch(self) -> None:
        while not self.stopping.wait(1.0):
            with self._lock:
                watcher, inboxes = self.watcher, list(self._subscribers)
            for event in watcher.poll():
                for inbox in inboxes:
                    inbox.put(event)

    def start_ollama(self) -> None:
        """At launch, with a local model picked, start Ollama in the background if it isn't running."""
        if local_model_configured():
            threading.Thread(target=self.ollama.ensure, daemon=True).start()

    def shutdown(self) -> None:
        self.stopping.set()
        super().shutdown()

    def server_close(self) -> None:
        super().server_close()
        self.ollama.stop()  # only an Ollama this service started


def make_server(folder: Path, port: int = DEFAULT_PORT, ollama: local_ai.OllamaKeeper | None = None) -> StudyServer:
    return StudyServer(folder, port, ollama)
