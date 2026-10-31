"""Bridge from the study app to a local Open Notebook, for extension AI prompts.

Extensions never reach Open Notebook directly: the app checks permission, size and rate limits
first, then asks the Study folder service, which runs the prompt through one Open Notebook
transformation named "Study app prompt" (created the first time it is missing). This was Lokus's
Rust `on_bridge.rs`; it lives here now that the study app runs in the browser.
"""

import json
import os
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

TRANSFORMATION_NAME = "Study app prompt"
ASK_TIMEOUT = 60.0
STATUS_TIMEOUT = 3.0
UNAVAILABLE = "ai-unavailable"
PASSWORD_FILE = "notebook-password"

# (base address, transformation id) of the last transformation found or created.
_cache: tuple[str, str] | None = None
_cache_lock = threading.Lock()


class NotebookError(Exception):
    """A bridge call that failed; the message is what the app sees."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def find_prompt_transformation(list_json: str) -> str | None:
    """The id of the "Study app prompt" transformation in what `GET /api/transformations` returns."""
    try:
        listing = json.loads(list_json)
    except ValueError:
        return None
    if not isinstance(listing, list):
        return None
    for item in listing:
        if isinstance(item, dict) and item.get("name") == TRANSFORMATION_NAME:
            found = item.get("id")
            return found if isinstance(found, str) else None
    return None


def map_error(status: int | None) -> str:
    """The error the app sees for a failed request; None is a connection failure."""
    return "ai-auth" if status == 401 else UNAVAILABLE


def clean_base_url(base_url: str) -> str:
    """Only http(s) addresses with a host are accepted, so the setting can't point at file:// or
    similar. Returns the address without a trailing slash."""
    url = urlparse(base_url.strip())
    if url.scheme not in ("http", "https") or not url.hostname:
        raise NotebookError("The Open Notebook address must start with http:// or https://", status=400)
    return url.geturl().rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None  # answered as a failed request instead of being followed


_opener = urllib.request.build_opener(_NoRedirect)


def _request(method: str, url: str, password: str | None, timeout: float, body: dict | None = None) -> bytes:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        request.add_header("Content-Type", "application/json")
    if password:
        request.add_header("Authorization", f"Bearer {password}")
    try:
        with _opener.open(request, timeout=timeout) as reply:
            return reply.read()
    except urllib.error.HTTPError as err:
        raise NotebookError(map_error(err.code)) from None
    except (OSError, ValueError):  # refused, timed out, or not an address urllib can open
        raise NotebookError(map_error(None)) from None


def _json(payload: bytes) -> object:
    try:
        return json.loads(payload)
    except ValueError:
        raise NotebookError(UNAVAILABLE) from None


def _forget_transformation() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def _transformation_id(base: str, password: str | None) -> str:
    global _cache
    with _cache_lock:
        if _cache is not None and _cache[0] == base:
            return _cache[1]
    listing = _request("GET", f"{base}/api/transformations", password, ASK_TIMEOUT)
    found = find_prompt_transformation(listing.decode("utf-8", "replace"))
    if found is None:
        created = _json(_request("POST", f"{base}/api/transformations", password, ASK_TIMEOUT, {
            "name": TRANSFORMATION_NAME,
            "title": TRANSFORMATION_NAME,
            "description": "Runs prompts sent by study app extensions",
            "prompt": "Follow the instructions in the input exactly. Reply with only the answer.",
            "apply_default": False,
        }))
        new_id = created.get("id") if isinstance(created, dict) else None
        if not isinstance(new_id, str):
            raise NotebookError(UNAVAILABLE)
        found = new_id
    with _cache_lock:
        _cache = (base, found)
    return found


def ask(base_url: str, prompt: str, password: str | None) -> str:
    """Run the prompt through the "Study app prompt" transformation and return its output."""
    base = clean_base_url(base_url)
    transformation = _transformation_id(base, password)
    try:
        reply = _request("POST", f"{base}/api/transformations/execute", password, ASK_TIMEOUT,
                         {"transformation_id": transformation, "input_text": prompt})
    except NotebookError:
        _forget_transformation()  # it may have been deleted; look it up again next time
        raise
    data = _json(reply)
    output = data.get("output") if isinstance(data, dict) else None
    if not isinstance(output, str):
        raise NotebookError(UNAVAILABLE)
    return output


def status(base_url: str, password: str | None) -> bool:
    """Whether Open Notebook answers at this address."""
    base = clean_base_url(base_url)
    try:
        _request("GET", f"{base}/api/config", password, STATUS_TIMEOUT)
    except NotebookError:
        return False
    return True


def load_password(config_dir: Path) -> str | None:
    try:
        password = (config_dir / PASSWORD_FILE).read_text(encoding="utf-8")
    except OSError:
        return None
    return password or None


def save_password(config_dir: Path, password: str | None) -> None:
    """Keep the password in a file only this user can read, or remove it when it is empty."""
    target = config_dir / PASSWORD_FILE
    try:
        if not password:
            target.unlink(missing_ok=True)
            return
        config_dir.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".tmp")
        handle = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(password)
        os.chmod(partial, 0o600)
        os.replace(partial, target)
    except OSError as err:
        raise NotebookError(f"Couldn't save the password: {err.strerror or err}", status=400) from None
