"""Exercise Sources boxes in a packaged Linux app using isolated example files.

Requires a graphical session and WebKitWebDriver on PATH:
  python scripts/smoke_source_boxes.py path/to/kratt --screenshot /tmp/source-boxes.png
Checks styles, subject navigation, source content and preference persistence across restart.
"""

import argparse, base64, json, os, signal, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path

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
    (vault / 'Sources').mkdir()
    (vault / '.study').mkdir()
    (vault / '.study/layout.json').write_text(json.dumps({'subjects': ['Biology']}))
    (vault / 'Sources/Energy.md').write_text('---\nid: energy-source\ntitle: Energy\ntype: text\nsubjects: [Biology]\n---\nCells use ATP for energy.\n')
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
            button('Sources')
            wait(lambda: js('return !!document.querySelector(".st-src[data-box-style]")'))
            if turn == 0:
                click('button[aria-label="Open Biology, 1 source"]')
                click('button[aria-label="Open Energy"]')
                wait(lambda: js('return !!document.querySelector(".st-src-detail-title")'))
                assert 'Cells use ATP for energy.' in js('return document.body.textContent')
                button('All sources')
                wait(lambda: js('return !!document.querySelector(".st-src-card-open")'))
                assert not js('return !!document.querySelector("#st-source-box-style")')
                button('Settings')
                button('Layout and home screen')
                wait(lambda: js('return !!document.querySelector("#st-source-box-style")'))
                js('const e=document.querySelector("#st-source-box-style");e.value="preview";e.dispatchEvent(new Event("change",{bubbles:true}))')
                button('Close')
                wait(lambda: js('return document.querySelector(".st-src").dataset.boxStyle === "preview"'))
                wait(lambda: json.loads((Path(tmp) / 'config.json').read_text()).get('preferences', {}).get('layout', {}).get('sources', {}).get('style') == 'preview')
                if args.screenshot:
                    args.screenshot.write_bytes(base64.b64decode(call('GET', f'/session/{sid}/screenshot')))
                js('localStorage.clear()')
                print('PASS: native subject boxes, source content, preview style saved to config.json', flush=True)
            else:
                wait(lambda: js('return !!document.querySelector(".st-src-card-preview")'))
                assert js('return document.querySelector(".st-src").dataset.boxStyle') == 'preview'
                assert js('return document.querySelector(".st-src-box-heading h2").textContent') == 'Biology'
                print('PASS: box style and subject restored from disk after browser storage cleared', flush=True)
            call("DELETE", f"/session/{sid}")
            sid = None
            time.sleep(2)
        print(
            "PASS: packaged native Sources boxes and restart persistence",
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
