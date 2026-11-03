"""OpenAI's public-client ChatGPT-plan flow: PKCE, validated OIDC, rotating tokens.

Official contract and review date: docs/ai-providers.md. No Codex credentials are read.
"""
import base64
import hashlib
import hmac
import math
import secrets
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import jwt

from memory_engine.ai_http import ProviderError, request

AUTH = "https://auth.openai.com"
TOKEN = AUTH + "/api/accounts/oauth/token"
RESOURCE = "https://api.openai.com/v1"
PLAN_SCOPE = "chatgpt.tokens.use.direct"


def auth_endpoint(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "auth.openai.com":
        raise ProviderError("OpenAI returned an unexpected authentication endpoint.")
    return url


def validate_identity(token, client_id, nonce=None):
    try:
        discovery = request(AUTH + "/.well-known/openid-configuration")
        keys = request(auth_endpoint(discovery["jwks_uri"]))
        header = jwt.get_unverified_header(token)
        if header.get("alg") not in {"RS256", "ES256"}:
            raise ValueError("Unexpected signature algorithm")
        key = next(key for key in keys["keys"] if key.get("kid") == header.get("kid"))
        claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=[header["alg"]], audience=client_id, issuer=AUTH, options={"require": ["exp", "iat", "sub", "aud", "iss"]})
        if nonce is not None and not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
            raise ValueError("Nonce mismatch")
        return claims
    except (jwt.PyJWTError, ValueError, KeyError, StopIteration, TypeError):
        raise ProviderError("ChatGPT sign-in could not be verified. Please start sign-in again.") from None


def token_record(reply, previous=None):
    previous = previous or {}
    scope = reply.get("scope", previous.get("scope", ""))
    if not isinstance(scope, str) or PLAN_SCOPE not in scope.split() or not isinstance(reply.get("access_token"), str) or not reply["access_token"]:
        raise ProviderError("ChatGPT plan access was not granted. Enable app usage during sign-in, or use an API key.")
    if str(reply.get("token_type", "Bearer")).lower() != "bearer":
        raise ProviderError("ChatGPT returned an unsupported token type.")
    try:
        lifetime = float(reply.get("expires_in", 3600))
        if not math.isfinite(lifetime) or lifetime <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise ProviderError("ChatGPT returned an invalid token lifetime. Sign in again.") from None
    return {"access_token": reply["access_token"], "refresh_token": reply.get("refresh_token", previous.get("refresh_token")), "id_token": reply.get("id_token", previous.get("id_token")), "scope": scope, "expires_at": time.time() + lifetime}


class ChatGptAuth:
    def __init__(self, store):
        self.store = store
        self.pending = None
        self.message = ""

    def status(self):
        with self.store.lock:
            config = self.store.read().get("chatgpt", {})
            accounts = config.get("accounts", {})
            active = config.get("active")
            account = accounts.get(active, {})
            return {"accounts": [{"id": key, "label": f"{a.get('email') or 'ChatGPT account'} · {key[-6:]}", "signedIn": bool(a.get("tokens"))} for key, a in accounts.items()], "active": active, "signedIn": bool(account.get("tokens")), "pending": bool(self.pending), "message": self.message}

    def start(self, account_id=None):
        self.close()
        with self.store.lock:
            data = self.store.read()
            config = data.setdefault("chatgpt", {})
            config.setdefault("host", uuid.uuid4().urn)
            # 1.4.0 saved a bare UUID, but OpenAI accepts UUID *URIs* (urn:uuid:...).
            # Migrate its representation without rotating the host or its registrations.
            try:
                config["host"] = uuid.UUID(config["host"]).urn
            except (ValueError, AttributeError, TypeError):
                # Other supported opaque identifiers (JWK thumbprints / did:key) stay intact.
                pass
            account = config.get("accounts", {}).get(account_id) if account_id else None
            if account_id and not account:
                raise ProviderError("Choose an existing ChatGPT account or add another.")
            self.store.write(data)
            state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(48)
            pending = {"state": state, "nonce": nonce, "verifier": verifier, "account": account_id, "stop": threading.Event()}
            owner = self
            class Callback(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass  # Authorization codes and URL hints must never reach logs.

                def do_GET(self):
                    url = urlparse(self.path)
                    query = parse_qs(url.query)
                    valid = url.path == "/auth/callback" and self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}" and all(len(v) == 1 for v in query.values()) and hmac.compare_digest(query.get("state", [""])[0], state)
                    if not valid:
                        self.send_error(400, "Invalid sign-in callback")
                        return
                    try:
                        owner.complete(pending, {k: v[0] for k, v in query.items()})
                        message = "Connected. Return to Kratt and choose a model."
                    except ProviderError as error:
                        owner.message = str(error)
                        message = "Sign-in was not completed. Return to Kratt for details."
                    finally:
                        pending["stop"].set()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(message.encode())
            server = HTTPServer(("127.0.0.1", 0), Callback)
            server.timeout = .5
            redirect = f"http://127.0.0.1:{server.server_port}/auth/callback"
            pending["redirect"] = redirect
            self.pending = pending
            self.message = "Finish signing in in your browser."
            parameters = {"client_id": account_id or "dynamic_agent_client", "ext_agent_host_id": config["host"], "response_type": "code", "redirect_uri": redirect, "scope": "openid profile email offline_access resource.invoke " + PLAN_SCOPE, "resource": RESOURCE, "state": state, "nonce": nonce, "code_challenge_method": "S256", "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()}
            if not account_id:
                parameters["agent_name_hint"] = "Kratt"
            # Do not return retained ID tokens through the webview; account selection stays in the browser.
            def listen():
                deadline = time.monotonic() + 300
                try:
                    while not pending["stop"].is_set() and time.monotonic() < deadline:
                        server.handle_request()
                finally:
                    server.server_close()
                    with self.store.lock:
                        if self.pending is pending:
                            self.pending = None
                            if not pending["stop"].is_set():
                                self.message = "Sign-in timed out. Continue with ChatGPT to try again."
            threading.Thread(target=listen, daemon=True).start()
            return {"url": AUTH + "/api/accounts/authorize?" + urlencode(parameters)}

    def complete(self, pending, query):
        with self.store.lock:
            if self.pending is not pending or pending["stop"].is_set():
                raise ProviderError("This sign-in attempt has expired.")
            if not hmac.compare_digest(query.get("state", ""), pending["state"]):
                raise ProviderError("Invalid sign-in state. Start sign-in again.")
            if query.get("error"):
                raise ProviderError("ChatGPT sign-in was cancelled or refused. You can try again.")
            client_id = query.get("client_id", pending["account"])
            if not client_id or client_id == "dynamic_agent_client" or (pending["account"] and client_id != pending["account"]):
                raise ProviderError("ChatGPT returned an unexpected account registration.")
            if not query.get("code"):
                raise ProviderError("ChatGPT did not return an authorization code.")
            reply = request(TOKEN, form={"grant_type": "authorization_code", "client_id": client_id, "code": query["code"], "code_verifier": pending["verifier"], "redirect_uri": pending["redirect"], "resource": RESOURCE})
            claims = validate_identity(reply.get("id_token", ""), client_id, pending["nonce"])
            data = self.store.read()
            config = data.setdefault("chatgpt", {})
            accounts = config.setdefault("accounts", {})
            previous = accounts.get(client_id)
            if previous and previous["sub"] != claims["sub"]:
                raise ProviderError("ChatGPT returned a different identity for this registration.")
            accounts[client_id] = {"sub": claims["sub"], "email": claims.get("email", ""), "tokens": token_record(reply)}
            if config.get("active") != client_id:
                data["profiles"].setdefault("chatgpt", {})["model"] = ""
            config["active"] = client_id
            self.store.write(data)
            self.message = "Connected to ChatGPT. Load models to choose one available to your account."

    def select(self, account_id):
        self.close()
        with self.store.lock:
            data = self.store.read()
            config = data.setdefault("chatgpt", {})
            if account_id not in config.get("accounts", {}):
                raise ProviderError("Unknown ChatGPT account.")
            if config.get("active") != account_id:
                data["profiles"].setdefault("chatgpt", {})["model"] = ""
            config["active"] = account_id
            self.store.write(data)
            self.message = ""
        return self.status()

    def access_token(self):
        with self.store.lock:  # Serialize rotating refresh tokens.
            data = self.store.read()
            config = data.get("chatgpt", {})
            account = config.get("accounts", {}).get(config.get("active"), {})
            tokens = account.get("tokens")
            if not tokens:
                raise ProviderError("Continue with ChatGPT in Settings > AI first.", 401)
            if tokens["expires_at"] < time.time() + 60:
                if not tokens.get("refresh_token"):
                    raise ProviderError("ChatGPT sign-in expired. Sign in again in Settings > AI.", 401)
                reply = request(TOKEN, form={"grant_type": "refresh_token", "client_id": config["active"], "refresh_token": tokens["refresh_token"], "resource": RESOURCE})
                if reply.get("id_token"):
                    claims = validate_identity(reply["id_token"], config["active"])
                    if claims["sub"] != account["sub"]:
                        raise ProviderError("ChatGPT refreshed a different account. Sign in again.", 401)
                account["tokens"] = tokens = token_record(reply, tokens)
                self.store.write(data)
            return tokens["access_token"]

    def sign_out(self):
        self.close()
        with self.store.lock:
            data = self.store.read()
            config = data.get("chatgpt", {})
            account = config.get("accounts", {}).get(config.get("active"), {})
            tokens = account.pop("tokens", {})
            self.message = "Signed out of ChatGPT in Kratt."
            if tokens.get("refresh_token"):
                try:
                    discovery = request(AUTH + "/.well-known/openid-configuration")
                    request(auth_endpoint(discovery["revocation_endpoint"]), form={"token": tokens["refresh_token"], "token_type_hint": "refresh_token", "client_id": config["active"]}, empty=True)
                except (ProviderError, KeyError):
                    self.message += " Remote revocation was not confirmed; disconnect Kratt in ChatGPT Settings."
            self.store.write(data)
        return self.status()

    def close(self):
        with self.store.lock:
            if self.pending:
                self.pending["stop"].set()
                self.pending = None

    def cancel(self):
        self.close()
        self.message = "Sign-in cancelled."
        return self.status()
