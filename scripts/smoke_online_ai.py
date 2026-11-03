"""Exercise a packaged Linux app with a local fake API, without paid calls or personal data.

Requires a graphical session and WebKitWebDriver on PATH:
  python scripts/smoke_online_ai.py path/to/kratt --screenshot /tmp/ai-settings.png
Checks settings, model discovery, an authenticated chat, disk persistence and restart.
"""

import argparse, base64, json, os, signal, socket, subprocess, tempfile, time, urllib.request, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

requests = []
class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        assert self.path == '/v1/models'
        self.reply({'data': [{'id': 'fixture-model'}]})
    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        assert self.headers.get('Authorization') == 'Bearer fixture-key'
        requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.reply({'choices': [{'message': {'content': 'Verified provider reply: cells use ATP.'}, 'finish_reason': 'stop'}]})
provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
threading.Thread(target=provider.serve_forever, daemon=True).start()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("application", type=Path)
parser.add_argument("--screenshot", type=Path)
args = parser.parse_args()
APP = args.application.resolve()
if not APP.is_file():
    raise SystemExit("Application launcher does not exist")
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
base = f"http://127.0.0.1:{port}"
with tempfile.TemporaryDirectory(prefix="kratt-native-ui-") as tmp:
    (Path(tmp) / 'config.json').write_text(json.dumps({'folder': str(Path(tmp) / 'Study'), 'local': False, 'preferences': {'appearance': {'themeId': 'ember', 'upgraded': 2, 'openingAnimation': False}, 'ai': {'model': 'cloud'}}}))
    vault = Path(tmp) / "Study"
    (vault / "Biology").mkdir(parents=True)
    note = vault / "Biology/Cells.md"
    note.write_text("---\nid: native-cells\ntitle: Cells\n---\nCells use ATP.\n")
    log = open(Path(tmp) / "webdriver.log", "w")
    driver = subprocess.Popen(
        ["WebKitWebDriver", f"--port={port}", "--host=127.0.0.1"],
        env={
            **os.environ,
            "TAURI_WEBVIEW_AUTOMATION": "true",
            "KRATT_DATA_DIR": tmp,
            "XDG_DATA_HOME": tmp + "/platform-data",
            "XDG_CONFIG_HOME": tmp + "/platform-config",
            "XDG_CACHE_HOME": tmp + "/platform-cache",
        },
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    sid = None

    def call(method, path, data=None):
        raw = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(
            base + path,
            data=raw,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                result = json.load(r)["value"]
        except urllib.error.HTTPError as e:
            raise RuntimeError(e.read().decode()) from e
        if isinstance(result, dict) and "error" in result:
            raise RuntimeError(result)
        return result

    def wait(fn, timeout=30):
        deadline = time.monotonic() + timeout
        error = None
        while time.monotonic() < deadline:
            try:
                result = fn()
                if result:
                    return result
            except Exception as e:
                error = e
            time.sleep(0.25)
        raise RuntimeError(f"Timed out: {error}")

    def js(script, args=[]):
        return call(
            "POST", f"/session/{sid}/execute/sync", {"script": script, "args": args}
        )

    def element(selector):
        return call(
            "POST",
            f"/session/{sid}/element",
            {"using": "css selector", "value": selector},
        )["element-6066-11e4-a52e-4f735466cecf"]

    def click(selector):
        return js(
            "const e=document.querySelector(arguments[0]);e.focus();e.click()",
            [selector],
        )

    def keys(selector, text):
        return call(
            "POST", f"/session/{sid}/element/{element(selector)}/value", {"text": text}
        )


    try:
        wait(lambda: call("GET", "/status"))
        for turn in range(2):
            session = call(
                "POST",
                "/session",
                {
                    "capabilities": {
                        "alwaysMatch": {
                            "webkitgtk:browserOptions": {"binary": str(APP), "args": []}
                        }
                    }
                },
            )
            sid = session["sessionId"]
            call('POST', f'/session/{sid}/window/rect', {'width': 1280, 'height': 900})
            print("Started native WebKit session", turn, flush=True)
            wait(lambda: js('return !!document.querySelector(".study")'), 45)
            assert not js('return !!document.querySelector(".kratt-startup")')
            def button(text):
                return js('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]); if(!b)throw Error(arguments[0]); b.click()', [text])
            button('Settings')
            button('AI')
            wait(lambda: js('return !!document.querySelector("#st-ai-provider") && !document.querySelector("#st-ai-provider").disabled'))
            if turn == 0:
                js('const e=document.querySelector("#st-ai-provider");e.value="compatible";e.dispatchEvent(new Event("change",{bubbles:true}))')
                wait(lambda: js('return !!document.querySelector("#st-ai-base")'))
                keys('#st-ai-base', f'http://127.0.0.1:{provider.server_port}/v1')
                keys('#st-ai-secret', 'fixture-key')
                button('Load models')
                wait(lambda: js('return document.querySelector("#st-online-models option")?.value==="fixture-model"'))
                keys('#st-online-model', 'fixture-model')
                button('Save AI provider')
                wait(lambda: js('return document.body.textContent.includes("AI provider saved.")'))
                assert js('return document.querySelector("#st-ai-secret").value') == ''
                js('document.querySelector("#st-ai-provider").scrollIntoView({block: "center"})')
                if args.screenshot:
                    screenshot = call('GET', f'/session/{sid}/screenshot')
                    args.screenshot.write_bytes(base64.b64decode(screenshot))
                button('Close')
                click('.st-side-newchat')
                wait(lambda: js('return !!document.querySelector("textarea[aria-label=Message]")'))
                keys('textarea[aria-label=Message]', 'What do cells use?\ue007')
                wait(lambda: js('return document.body.textContent.includes("Verified provider reply: cells use ATP.")'))
                wait(lambda: any('Verified provider reply' in p.read_text() for p in vault.rglob('*.md')))
                assert len(requests) == 1 and requests[0]['model'] == 'fixture-model'
                assert 'What do cells use?' in json.dumps(requests[0])
                assert not any('fixture-key' in p.read_text() for p in vault.rglob('*.md'))
                assert 'fixture-key' not in (Path(tmp) / 'config.json').read_text()
                js('localStorage.clear()')
                print('PASS: native settings, model catalog, authenticated provider request, answer saved to Markdown; key absent from notes/preferences', flush=True)
            else:
                assert js('return document.querySelector("#st-ai-provider").value') == 'compatible'
                assert js('return document.querySelector("#st-online-model").value') == 'fixture-model'
                assert js('return document.querySelector("#st-ai-secret").value') == ''
                assert 'key is saved' in js('return document.querySelector("#st-ai-secret").placeholder')
                print('PASS: app reopened directly without Ollama, restored online provider/model from disk after browser storage cleared', flush=True)
            call("DELETE", f"/session/{sid}")
            sid = None
            time.sleep(2)
        print(
            "PASS: packaged native online AI integration and restart persistence",
            flush=True,
        )
    finally:
        if sid:
            try:
                call("DELETE", f"/session/{sid}")
            except Exception:
                pass
        try:
            os.killpg(driver.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            driver.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(driver.pid, signal.SIGKILL)
            driver.wait()
        log.close()
        provider.shutdown()
        provider.server_close()
