"""Exercise the native Linux editor with WebKitWebDriver and an isolated vault/profile.

Requires a graphical session and WebKitWebDriver on PATH. Example:
  python scripts/smoke_native_ui.py apps/study/src-tauri/target/release/bundle/appimage/Kratt.AppDir/AppRun
All input is fixture data; this does not call an AI model or modify personal notes.
"""

import argparse, json, os, signal, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("application", type=Path)
APP = parser.parse_args().application.resolve()
if not APP.is_file():
    raise SystemExit("Application launcher does not exist")
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
base = f"http://127.0.0.1:{port}"
with tempfile.TemporaryDirectory(prefix="kratt-native-ui-") as tmp:
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

    def open_note():
        click(".st-side-find")
        wait(lambda: js("return !!document.querySelector('input[role=\"combobox\"]')"))
        keys('input[role="combobox"]', "Cells")
        wait(lambda: js("return !!document.querySelector('[role=\"option\"]')"))
        click('[role="option"]')
        wait(lambda: js('return !!document.querySelector(".st-editor .tiptap")'))

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
            print("Started native WebKit session", turn, flush=True)
            wait(
                lambda: js(
                    'return [...document.querySelectorAll("button")].some(b=>b.textContent==="Continue to notes")'
                ),
                45,
            )
            js(
                'document.querySelectorAll("button").forEach(b=>{if(b.textContent==="Continue to notes")b.click()})'
            )
            wait(lambda: js('return !!document.querySelector(".study")'))
            time.sleep(3)
            open_note()
            if turn == 0:
                click(".st-editor .tiptap")
                keys(".st-editor .tiptap", "Native desktop persistence check.")
                time.sleep(2)
                wait(
                    lambda: any(
                        "Native desktop persistence check." in p.read_text()
                        for p in vault.rglob("*.md")
                    )
                )
                print("Native editor saved a real Markdown file", flush=True)
                js("localStorage.clear()")
            else:
                assert "Native desktop persistence check." in js(
                    'return document.querySelector(".st-editor .tiptap").textContent'
                )
                print("Reopened saved note after clearing browser storage", flush=True)
            call("DELETE", f"/session/{sid}")
            sid = None
            time.sleep(2)
        print(
            "PASS: native first run, notes access, editor save, disk persistence and reopen",
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
