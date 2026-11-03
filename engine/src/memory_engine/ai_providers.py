"""Opt-in remote AI. Credentials stay in protected app storage, never Study or UI preferences."""
import json
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from memory_engine.ai_http import ProviderError, endpoint, request

PROVIDERS = {"openai", "anthropic", "compatible", "chatgpt", "claude-code"}
BASES = {"openai": "https://api.openai.com/v1", "anthropic": "https://api.anthropic.com/v1", "chatgpt": "https://api.openai.com/v1"}


def cli_environment():
    env = dict(os.environ)
    # Frozen Python's library search path must not contaminate external applications.
    if "LD_LIBRARY_PATH_ORIG" in env:
        env["LD_LIBRARY_PATH"] = env.pop("LD_LIBRARY_PATH_ORIG")
    else:
        env.pop("LD_LIBRARY_PATH", None)
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"):
        env.pop(key, None)
    return env


def claude_binary():
    found = shutil.which("claude")
    if found:
        return found
    for path in [Path.home() / ".local/bin/claude", Path.home() / ".local/bin/claude.exe"]:
        if path.is_file():
            return str(path)
    return None


class ProviderStore:
    def __init__(self, root):
        self.root = Path(root)
        self.path = self.root / "ai-providers.json"
        self.lock = threading.RLock()

    def read(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"provider": "openai", "profiles": {}}
        except (OSError, ValueError):
            raise ProviderError("AI settings could not be read. Restore ai-providers.json from a backup.") from None
        if not isinstance(data, dict) or not isinstance(data.get("profiles"), dict):
            raise ProviderError("AI settings are invalid; restore ai-providers.json from a backup.")
        return data

    def write(self, data):
        self.root.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix=".ai-", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, self.path)  # mkstemp is owner-only from the first byte.
        finally:
            Path(temp).unlink(missing_ok=True)

    def settings(self):
        with self.lock:
            data = self.read()
        profiles = {name: {"model": profile.get("model", ""), "baseUrl": profile.get("baseUrl", BASES.get(name, "")), "keySet": bool(profile.get("key"))} for name, profile in data["profiles"].items()}
        return {"provider": data["provider"], "profiles": profiles, "claudeInstalled": bool(claude_binary())}

    def save(self, changes):
        provider = changes.get("provider")
        if provider not in PROVIDERS:
            raise ProviderError("Choose an AI provider.")
        with self.lock:
            data = self.read()
            profile = dict(data["profiles"].get(provider, {}))
            model = changes.get("model", profile.get("model", ""))
            if not isinstance(model, str) or len(model) > 200 or any(ord(c) < 32 for c in model):
                raise ProviderError("Enter a valid model name.")
            profile["model"] = model.strip()
            if provider == "compatible":
                base = endpoint(changes.get("baseUrl", profile.get("baseUrl", "")))
                if base != profile.get("baseUrl"):
                    profile.pop("key", None)  # Keys are bound to the explicitly saved endpoint.
                profile["baseUrl"] = base
            if "key" in changes:
                key = changes["key"]
                if key is not None and (not isinstance(key, str) or len(key) > 4096 or any(ord(c) < 32 for c in key)):
                    raise ProviderError("Enter a valid API key.")
                if key:
                    profile["key"] = key.strip()
                else:
                    profile.pop("key", None)
            data["provider"] = provider
            data["profiles"][provider] = profile
            self.write(data)
        return self.settings()


class OnlineAi:
    def __init__(self, root):
        from memory_engine.chatgpt_auth import ChatGptAuth
        self.store = ProviderStore(root)
        self.auth = ChatGptAuth(self.store)
        self.login_process = None
        self.login_lock = threading.Lock()
        self.requests = set()
        self.closed = False

    def settings(self):
        return {**self.store.settings(), "chatgpt": self.auth.status()}

    def models(self):
        data = self.store.read()
        provider = data["provider"]
        profile = data["profiles"].get(provider, {})
        if provider == "claude-code":
            return {"models": [{"id": name, "name": name.title()} for name in ["sonnet", "opus", "haiku"]]}
        if provider == "chatgpt":
            headers = {"Authorization": "Bearer " + self.auth.access_token()}
        else:
            key = profile.get("key")
            if not key and provider != "compatible":
                raise ProviderError("Save an API key first.")
            headers = {"x-api-key": key or "", "anthropic-version": "2023-06-01"} if provider == "anthropic" else ({"Authorization": "Bearer " + key} if key else {})
        base = BASES.get(provider) or endpoint(profile.get("baseUrl", ""))
        result = request(base + "/models", headers=headers)
        rows = result.get("models", []) if provider == "chatgpt" else result.get("data", [])
        return {"models": [{"id": row.get("slug") or row.get("id"), "name": row.get("display_name") or row.get("id") or row.get("slug")} for row in rows if isinstance(row, dict) and (row.get("id") or row.get("slug")) and (provider != "chatgpt" or row.get("visibility") == "list")]}

    def ask(self, prompt):
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode()) > 1024 * 1024:
            raise ProviderError("The AI prompt must contain text and fit within 1 MB.")
        data = self.store.read()
        provider = data["provider"]
        profile = data["profiles"].get(provider, {})
        model = profile.get("model")
        if not model:
            raise ProviderError("Choose a model in Settings > AI first.")
        if provider == "claude-code":
            return self.claude_ask(prompt, model)
        key = self.auth.access_token() if provider == "chatgpt" else profile.get("key")
        if not key and provider != "compatible":
            raise ProviderError("Add an API key in Settings > AI first.")
        headers = {"Authorization": "Bearer " + key} if key else {}
        base = BASES.get(provider) or endpoint(profile.get("baseUrl", ""))
        if provider in {"openai", "chatgpt"}:
            payload = {"model": model, "input": [{"role": "user", "content": prompt}], "store": False}
            if provider == "chatgpt":
                output = request(base + "/responses", {**payload, "stream": True}, headers, stream=True)
            else:
                result = request(base + "/responses", payload, headers)
                if result.get("status") in {"failed", "incomplete"}:
                    raise ProviderError("The provider did not finish its answer. Try again.", 502)
                output = "\n".join(part.get("text", "") for item in result.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
        elif provider == "anthropic":
            result = request(base + "/messages", {"model": model, "max_tokens": 8192, "messages": [{"role": "user", "content": prompt}]}, {"x-api-key": key, "anthropic-version": "2023-06-01"})
            if result.get("stop_reason") == "max_tokens":
                raise ProviderError("Claude's answer reached its output limit. Use a smaller request.", 502)
            output = "\n".join(part.get("text", "") for part in result.get("content", []) if part.get("type") == "text")
        else:
            result = request(base + "/chat/completions", {"model": model, "messages": [{"role": "user", "content": prompt}]}, headers)
            try:
                choice = result["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise ProviderError("The answer reached the provider's output limit.", 502)
                output = choice["message"]["content"]
            except (KeyError, IndexError, TypeError):
                raise ProviderError("The provider returned no text answer.", 502) from None
        if not isinstance(output, str) or not output.strip():
            raise ProviderError("The provider returned no text answer.", 502)
        return output

    def claude_ask(self, prompt, model):
        binary = claude_binary()
        if not binary:
            raise ProviderError("Install Claude Code and sign in to your Claude plan first.")
        if not self.claude_status()["signedIn"]:
            raise ProviderError("Sign in to a Claude subscription in Settings > AI first. API billing is not used for this option.", 401)
        # Official subscription client; no tools, MCP, hooks, history, or vault working directory.
        command = [binary, '-p', '--output-format', 'json', '--model', model, '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence', '--settings', '{"disableAllHooks":true}', '--permission-mode', 'dontAsk', '--system-prompt', 'You are Kratt, a study helper. Answer only from the supplied question and notes.']
        with tempfile.TemporaryDirectory(prefix="kratt-claude-") as directory:
            try:
                with self.login_lock:
                    if self.closed:
                        raise ProviderError("Kratt is shutting down.")
                    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", cwd=directory, env=cli_environment(), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    self.requests.add(process)
                try:
                    output, _ = process.communicate(prompt, timeout=180)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    raise
                finally:
                    with self.login_lock:
                        self.requests.discard(process)
                answer = json.loads(output)
            except subprocess.TimeoutExpired:
                raise ProviderError("Claude took too long to answer. Try again.", 504) from None
            except (OSError, ValueError):
                raise ProviderError("Claude Code could not answer. Check its installation and sign-in.", 502) from None
        if process.returncode or answer.get("is_error") or not answer.get("result"):
            raise ProviderError("Claude Code could not answer. Check your subscription sign-in and usage limits.", 502)
        return answer["result"]

    def claude_status(self):
        binary = claude_binary()
        if not binary:
            return {"installed": False, "signedIn": False}
        try:
            result = subprocess.run([binary, "auth", "status", "--json"], capture_output=True, check=False, text=True, encoding="utf-8", timeout=10, env=cli_environment(), cwd=tempfile.gettempdir(), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            status = json.loads(result.stdout)
            return {"installed": True, "signedIn": result.returncode == 0 and bool(status.get("loggedIn")) and status.get("authMethod") in {"claude.ai", "claudeai"}}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return {"installed": True, "signedIn": False}

    def claude_login(self):
        binary = claude_binary()
        if not binary:
            raise ProviderError("Install Claude Code first, then return here to sign in.")
        with self.login_lock:
            if self.login_process and self.login_process.poll() is None:
                return {"pending": True}
            self.login_process = subprocess.Popen([binary, "auth", "login", "--claudeai"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=cli_environment(), cwd=tempfile.gettempdir(), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            process = self.login_process
            def expire():
                try:
                    process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            threading.Thread(target=expire, daemon=True).start()
        return {"pending": True}

    def close(self):
        self.auth.close()
        with self.login_lock:
            self.closed = True
            for process in self.requests:
                if process.poll() is None:
                    process.kill()
            if self.login_process and self.login_process.poll() is None:
                self.login_process.terminate()
