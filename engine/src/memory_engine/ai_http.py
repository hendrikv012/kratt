"""Provider HTTP transport. Never echo provider bodies or credentials in errors."""
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse


class ProviderError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def endpoint(value):
    if not isinstance(value, str):
        raise ProviderError("Enter an API base URL.")
    url = urlparse(value.strip())
    try:
        _ = url.port
    except ValueError:
        raise ProviderError("Invalid API port.") from None
    if (url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})) or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ProviderError("Use an HTTPS API URL, or HTTP on localhost, without credentials or query parameters.")
    return value.strip().rstrip("/")


def failure(status):
    if status in (401, 403):
        return ProviderError("The provider refused access. Check your key or sign in again in Settings > AI.", 401)
    if status == 429:
        return ProviderError("The provider's usage limit was reached. Check your plan or API quota and try later.", 429)
    return ProviderError(f"The provider could not complete the request (HTTP {status}). Check the model and API address in Settings > AI.", 502)


def request(url, data=None, headers=None, *, form=None, stream=False, empty=False):
    headers = dict(headers or {})
    headers.setdefault("User-Agent", "Kratt/1.4")
    if form is not None:
        from urllib.parse import urlencode
        body = urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    else:
        body = None
    req = urllib.request.Request(url, body, headers)
    try:
        # Never forward bearer credentials across redirects. Local custom servers bypass proxies.
        proxy = urllib.request.ProxyHandler({}) if urlparse(url).hostname in {"localhost", "127.0.0.1", "::1"} else urllib.request.ProxyHandler()
        with urllib.request.build_opener(proxy, NoRedirect()).open(req, timeout=180 if data is not None else 20) as response:
            if stream:
                return read_response_stream(response)
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ProviderError("The provider's response was too large.", 502)
            if empty and not raw:
                return {}
            parsed = json.loads(raw)
            if not isinstance(parsed, dict):
                raise ProviderError("The provider returned an unreadable response.", 502)
            return parsed
    except urllib.error.HTTPError as error:
        raise failure(error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ProviderError("Could not reach the AI provider. Check your connection and API address.", 502) from None
    except (ValueError, UnicodeError):
        raise ProviderError("The provider returned an unreadable response.", 502) from None


def read_response_stream(response):
    chunks, event_data, total = [], [], 0
    for line in response:
        total += len(line)
        if total > 8 * 1024 * 1024:
            raise ProviderError("The provider's response was too large.", 502)
        line = line.decode("utf-8").rstrip("\r\n")
        if line.startswith("data:"):
            event_data.append(line[5:].lstrip())
        elif not line and event_data:
            event = json.loads("\n".join(event_data))
            event_data = []
            if not isinstance(event, dict):
                raise ProviderError("The provider returned an unreadable response.", 502)
            kind = event.get("type")
            if kind == "response.output_text.delta":
                delta = event.get("delta", "")
                if not isinstance(delta, str):
                    raise ProviderError("The provider returned an unreadable response.", 502)
                chunks.append(delta)
            elif kind == "response.completed":
                return "".join(chunks)
            elif kind in {"response.failed", "response.incomplete", "error"}:
                result = event.get("response") or {}
                error = (result.get("error") if isinstance(result, dict) else None) or event.get("error") or {}
                code = str(error.get("code", "")) if isinstance(error, dict) else ""
                if code.startswith("subscription_sharing_usage"):
                    raise failure(429)
                raise ProviderError("The AI response did not finish. Try again or check your provider's usage limits.", 502)
    raise ProviderError("The AI connection ended before the answer was complete. Try again.", 502)
