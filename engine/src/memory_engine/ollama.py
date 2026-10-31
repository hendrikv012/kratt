"""One JSON request to Ollama, with errors that say what went wrong and how to fix it."""

import json
import urllib.error
import urllib.request


class OllamaError(RuntimeError):
    pass


def post_json(
    url: str, path: str, payload: dict, timeout: float, model: str, error: type[OllamaError] = OllamaError
) -> dict:
    """POST `payload` to `{url}{path}` and return the JSON object Ollama answers with."""
    url = url.rstrip("/")
    request = urllib.request.Request(
        f"{url}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as err:
        raise error(_http_error_message(err, url, model)) from err
    except urllib.error.URLError as err:
        if isinstance(err.reason, TimeoutError):
            raise error(_timeout_message(url, timeout)) from err
        raise error(f"Ollama not reachable at {url}: {err.reason}") from err
    except TimeoutError as err:
        raise error(_timeout_message(url, timeout)) from err
    except OSError as err:
        raise error(f"Ollama not reachable at {url}: {err}") from err
    try:
        answer = json.loads(body)
        if not isinstance(answer, dict):
            raise ValueError("not a JSON object")
    except ValueError as err:
        raise error(f"Ollama at {url} gave an unexpected response ({err})") from err
    return answer


def _timeout_message(url: str, timeout: float) -> str:
    return f"Ollama at {url} did not answer within {timeout:g} s"


def _http_error_message(err: urllib.error.HTTPError, url: str, model: str) -> str:
    body = err.read().decode("utf-8", errors="replace")
    try:
        detail = str(json.loads(body)["error"])
    except (ValueError, KeyError, TypeError):
        detail = body.strip() or str(err.reason)
    if err.code == 404 and "not found" in detail and "model" in detail:
        return f"Ollama does not have the model {model}: run `ollama pull {model}`"
    return f"Ollama at {url} answered HTTP {err.code}: {detail}"
