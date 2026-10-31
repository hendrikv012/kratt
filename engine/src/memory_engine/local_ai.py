"""The local model behind the study app's chat when the AI runs on this computer: Ollama.

`OllamaKeeper` makes sure Ollama is running. If something already answers on Ollama's address
(the Ollama app, a systemd service, a terminal), it is used and never stopped. Otherwise the
keeper starts `ollama serve` itself, and stops only that one when `memory-engine serve` ends.
The app only ever lists models that are already installed; nothing here downloads one.

Errors reach the app as short codes it turns into friendly messages:
  ollama-missing      Ollama isn't installed
  ollama-failed       Ollama was started but didn't come up
  no-model            no model has been picked in Settings > AI
  model-missing       the picked model isn't installed any more
  ollama-unavailable  Ollama stopped answering, or answered with something unexpected
"""

import http.client
import json
import os
import platform
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlparse

OLLAMA_PORT = 11434
CHECK_TIMEOUT = 2.0  # seconds for "is Ollama there?"
START_TIMEOUT = 20.0  # seconds a freshly started Ollama gets to answer
ASK_TIMEOUT = 600.0  # seconds for one reply; a model on a CPU is slow
STOP_TIMEOUT = 5.0
LOG_LINES = 5  # lines of Ollama's own log shown when it fails to start


def ollama_url(env: dict | None = None) -> str:
    """Where Ollama listens: OLLAMA_HOST when it is set (as Ollama itself reads it), else 127.0.0.1:11434.
    Reading it keeps Kratt from starting a second Ollama beside one that listens elsewhere."""
    host = ((os.environ if env is None else env).get("OLLAMA_HOST") or "").strip()
    if not host:
        return f"http://127.0.0.1:{OLLAMA_PORT}"
    url = urlparse(host if "://" in host else f"http://{host}")
    name = url.hostname or "127.0.0.1"
    if name in ("0.0.0.0", "::"):  # listening everywhere; ask it on this computer
        name = "127.0.0.1"
    try:
        port = url.port or OLLAMA_PORT
    except ValueError:
        port = OLLAMA_PORT
    return f"{url.scheme or 'http'}://{f'[{name}]' if ':' in name else name}:{port}"


class LocalAiError(Exception):
    """A local-model call that failed; the message is the code the app sees."""

    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.status = status


def find_ollama(system: str | None = None, env: dict | None = None, exists: Callable[[str], bool] = os.path.isfile,
                which: Callable[[str], str | None] = shutil.which) -> str | None:
    """The `ollama` program: on the PATH, or where the installers put it on each system."""
    system = system or platform.system()
    env = os.environ if env is None else env
    found = which("ollama")
    if found:
        return found
    home = env.get("HOME") or env.get("USERPROFILE") or ""
    if system == "Darwin":
        places = ["/Applications/Ollama.app/Contents/Resources/ollama", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama",
                  f"{home}/Applications/Ollama.app/Contents/Resources/ollama"]
    elif system == "Windows":
        local = env.get("LOCALAPPDATA") or f"{home}\\AppData\\Local"
        programs = env.get("ProgramFiles") or "C:\\Program Files"
        places = [f"{local}\\Programs\\Ollama\\ollama.exe", f"{programs}\\Ollama\\ollama.exe"]
    else:
        places = ["/usr/local/bin/ollama", "/usr/bin/ollama", f"{home}/.local/bin/ollama"]
    return next((place for place in places if exists(place)), None)


def installed_models(url: str, timeout: float = CHECK_TIMEOUT) -> list[dict] | None:
    """What `GET /api/tags` lists, or None when nothing answers there like Ollama does."""
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/tags", timeout=timeout) as reply:
            models = json.loads(reply.read())["models"]
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError):
        return None
    return models if isinstance(models, list) else None


def can_chat(model: dict) -> bool:
    """Whether a model from /api/tags can answer questions. Ollama 0.6+ lists capabilities; for
    older versions an embedding model is recognised by its name or family."""
    capabilities = model.get("capabilities")
    if isinstance(capabilities, list):
        return "completion" in capabilities
    details = model.get("details") or {}
    families = [details.get("family") or "", *(details.get("families") or [])]
    return "embed" not in str(model.get("name", "")) and not any("bert" in str(f) for f in families)


def chat_model_names(models: list[dict]) -> list[str]:
    return sorted(str(m["name"]) for m in models if isinstance(m, dict) and m.get("name") and can_chat(m))


def _same_model(wanted: str, name: str) -> bool:
    return wanted == name or (":" not in wanted and name == f"{wanted}:latest")


def _log_path() -> Path:
    return Path(tempfile.gettempdir()) / "kratt-logs" / "ollama.log"


def _start_options() -> dict:
    """Ollama runs apart from this process: Ctrl+C in the terminal reaches only the service, which
    then stops it itself; on Windows no console window opens."""
    if platform.system() == "Windows":
        return {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


class OllamaKeeper:
    """Starts Ollama when it isn't running, and stops it again only if it started it."""

    def __init__(self, url: str | None = None, find: Callable[[], str | None] = find_ollama,
                 start: Callable[..., subprocess.Popen] = subprocess.Popen, log_path: Path | None = None,
                 start_timeout: float = START_TIMEOUT):
        self.url = url or ollama_url()
        self._find = find
        self._start = start
        self._log_path = log_path or _log_path()
        self._start_timeout = start_timeout
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None  # the Ollama this keeper started
        self._failure = ""

    @property
    def started_here(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def ensure(self) -> dict:
        """Make sure Ollama answers. Returns {"state": ..., "detail": ..., "models": [...]}, where state is
        "running" (it was already there), "started" (this keeper started it), "not-installed" or "failed"."""
        with self._lock:  # two requests at once must not start two copies
            models = installed_models(self.url)
            if models is not None:
                return self._answer("started" if self.started_here else "running", models)
            if self.started_here:  # ours, still coming up: wait for it rather than start another
                return self._wait()
            program = self._find()
            if program is None:
                return {"state": "not-installed", "detail": "", "models": []}
            try:
                self._log_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self._log_path, "wb") as log:  # this start only, so a failure shows its own reason
                    self._process = self._start([program, "serve"], stdin=subprocess.DEVNULL, stdout=log,
                                                stderr=subprocess.STDOUT, **_start_options())
            except OSError as err:
                self._process = None
                return {"state": "failed", "detail": err.strerror or str(err), "models": []}
            return self._wait()

    def _wait(self) -> dict:
        deadline = time.monotonic() + self._start_timeout
        while time.monotonic() < deadline:
            models = installed_models(self.url, timeout=1.0)
            if models is not None:
                return self._answer("started", models)
            if self._process is not None and self._process.poll() is not None:
                self._process = None
                return {"state": "failed", "detail": self._log_tail(), "models": []}
            time.sleep(0.25)
        return {"state": "failed", "detail": f"Ollama didn't answer within {self._start_timeout:g} seconds.",
                "models": []}

    def _answer(self, state: str, models: list[dict]) -> dict:
        return {"state": state, "detail": "", "models": chat_model_names(models)}

    def _log_tail(self) -> str:
        try:
            lines = self._log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
        except OSError:
            return ""
        errors = [line for line in lines if line.startswith("Error")]  # Ollama's reason for giving up
        return errors[-1] if errors else "\n".join(lines[-LOG_LINES:])

    def stop(self) -> None:
        """Stop Ollama if this keeper started it; one that was already running is left alone."""
        with self._lock:
            process, self._process = self._process, None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=STOP_TIMEOUT)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=STOP_TIMEOUT)


def context_size(prompt: str) -> int:
    """A context window that fits the prompt and a reply. Ollama's default (2-4K tokens) would
    silently cut a Long chat-memory prompt. Few sizes, so the model is rarely reloaded."""
    needed = len(prompt.encode("utf-8")) // 3 + 1024  # about 3 bytes a token, plus room for the reply
    return next((size for size in (4096, 8192, 16384) if needed <= size), 32768)


def ask(keeper: OllamaKeeper, model: str | None, prompt: str) -> str:
    """Ask the picked model one question and return its answer."""
    if not model:
        raise LocalAiError("no-model", status=400)
    status = keeper.ensure()
    if status["state"] == "not-installed":
        raise LocalAiError("ollama-missing")
    if status["state"] == "failed":
        raise LocalAiError("ollama-failed")
    tags = installed_models(keeper.url) or []
    found = next((m for m in tags if isinstance(m, dict) and _same_model(model, str(m.get("name")))), None)
    if found is None:
        raise LocalAiError("model-missing", status=400)
    payload: dict = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False,
                     "options": {"num_ctx": context_size(prompt)}}
    if "thinking" in (found.get("capabilities") or []):
        payload["think"] = False  # a study answer doesn't need the model's long reasoning first
    request = urllib.request.Request(f"{keeper.url.rstrip('/')}/api/chat", data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=ASK_TIMEOUT) as reply:
            answer = json.loads(reply.read())
        content = answer["message"]["content"]
    except urllib.error.HTTPError as err:
        raise LocalAiError("model-missing" if err.code == 404 else "ollama-unavailable") from None
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError):
        raise LocalAiError("ollama-unavailable") from None
    if not isinstance(content, str):
        raise LocalAiError("ollama-unavailable")
    return _without_thinking(content)


def _without_thinking(content: str) -> str:
    """Drop a <think>…</think> block some models still put in front of the answer."""
    text = content.strip()
    if text.startswith("<think>") and "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()
