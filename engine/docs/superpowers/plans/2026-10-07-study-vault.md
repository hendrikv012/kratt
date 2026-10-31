# Study Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The study app's subjects, folders, pages, quick notes and sources live as Markdown files in a Study folder. A small memory-engine service reads and writes them, and the app shows changes made on disk live.

**Architecture:**
- **The service:** `memory-engine serve` is a stdlib `ThreadingHTTPServer` on `127.0.0.1:5057` wrapped around a `Vault` class. The `Vault` does safe paths, atomic writes, versions, clashes, trash and the layout file. A polling watcher streams change events.
- **The app:** pages stay HTML inside the app, because the Lokus editor re-sets its content whenever the text it's given differs from its HTML. Conversion to and from Markdown happens only at the vault boundary (`data/markdown.js`).
- **Syncing:** `data/vaultState.js` maps the service's snapshot to the existing app state and diffs states into file operations. `data/vaultSync.js` runs those operations with retries and a safety copy. `data/StudyProvider.jsx` swaps `localStorage` for all of this, and `data/operations.js` is unchanged.

**Tech Stack:** Python 3.14 stdlib (`http.server`, `threading`, `hashlib`) with PyYAML; React 19, Vitest + jsdom, `markdown-it` (already a Lokus dependency), `turndown` 7 and `turndown-plugin-gfm` (new).

**Spec:** `/home/caesarsta/Downloads/BaseN/memory-engine/docs/superpowers/specs/2026-10-07-study-vault-design.md` (approved 2026-10-07).

## Global Constraints

- **Two repositories:**
  - Tasks 1-2 and the README go in `/home/caesarsta/Downloads/BaseN/memory-engine/` (`main` at `c307160`).
  - Tasks 3-6 go in `/home/caesarsta/Downloads/BaseN/lokus/`, under `src/views/studyhome/`.
  - `start.fish` is in `/home/caesarsta/Downloads/BaseN/` (not a repository).
- **Self-hosted only:** no cloud calls. The graph's lines and look don't change. Lokus's main app (`src/views/Workspace.jsx`) is not touched.
- **The service:**
  - It runs on `127.0.0.1:5057`.
  - It refuses any request whose `Origin` is present and not one of `http://localhost:1420`, `tauri://localhost` or `http://tauri.localhost`, and any request whose `Host` isn't `127.0.0.1:5057` or `localhost:5057` (the port is the one actually bound).
  - It is the only writer of the Study folder. Writes are atomic (`memory_engine.frontmatter.atomic_write`). Only paths inside the folder are accepted.
  - Delete moves into `.study/trash/<timestamp>/<old path>`.
- **The layout** (spec section 2):
  - Subjects and folders are directories. A page is `<title>.md`.
  - `Unsorted/`, `Quick notes/<YYYY-MM-DD HH-MM>.md`, `Sources/<title>.md` with originals in `Sources/files/`.
  - Hidden `.study/layout.json` holds `subjects`, `colors`, `order`, `expanded` and `recent`.
- **Ids:**
  - Pages, quick notes and sources are identified by their YAML `id`.
  - Subjects and folders have no header, so their app id is their folder path (`Biology`, `Biology/Cells`). The layout keys them by their current path; renaming one rewrites those keys.
- **YAML headers:**
  - Pages: `id`, `title`, `created`, `updated`, then `also_in` and `mastery` only when set.
  - Quick notes: `id`, `created`.
  - Sources: `id`, `title`, `type`, `url` or `file`, `use`, `created`, `updated`, plus `pages`, `read_pages` and `truncated` for PDFs.
  - A `.md` without an `id` gets one (a 32-hex `uuid4`) the first time the service reads it.
- **Names:**
  - `/ \ : * ? " < > |` and control characters become `-` in file names, the name is trimmed, and an empty name becomes `Untitled`. The YAML title keeps the real name.
  - Clashes get ` (2)`, ` (3)`, … before the extension.
- **Versions and clashes:**
  - A version is the first 16 hex digits of the sha256 of the file's bytes. Every write sends the version it was based on.
  - On a mismatch, the service keeps the disk text as `<stem> (from disk YYYY-MM-DD HH-MM).md` in the same folder, writes the new text, and returns the clash path.
- **Live updates:** the watcher polls every 1 s (modification time and size) and sends server-sent events `{"type": "added"|"changed"|"removed", "path"}` on `GET /events`. It ignores `.study/` and hidden directories.
- **Saving:**
  - Page edits are written after 800 ms of quiet. Pending operations are kept in `localStorage` key `study-vault-pending-v1` until the service confirms them.
  - Retries wait 1 s, 2 s, 5 s, then every 10 s. A warning shows only when something has been unsaved for over 30 s, or the service is unreachable.
- **Copy:**
  - The offline message is exactly ``Study folder not connected. Start it with: memory-engine serve``.
  - The clash notice is exactly `Kept both versions: the one on disk is saved as {name}`.
- **First start:** if the service's vault has no pages, subjects, quick notes or sources, and `localStorage["study-app-data-v1"]` holds data, everything is written once. The key is then renamed `study-app-data-v1-imported`.
- **The Study folder setting:** the default is `~/Study`. It is remembered in `~/.config/memory-engine/study.json`; `MEMORY_ENGINE_CONFIG` overrides that path, for tests.
- **Commits:**
  - memory-engine commits go on branch `study-vault`.
  - lokus commits only as the user decides at hand-off.
  - No AI or assistant attribution anywhere (the user's rule).

## Review Focus

1. **The service isn't running when the app opens, or stops mid-session.** The app shows the offline message, typing stays safe in the safety copy, and everything saves once the service is back. Task 5 tests this.
2. **A page open with unsaved typing is changed on disk** (by hand, or later by the local AI). Both versions are kept and the notice shows. Without unsaved typing, the page reloads from disk. Tasks 1 and 5 test this.
3. **Another web page in the same browser calls the service.** It is refused by the Origin and Host checks, and nothing is read or written. Task 2 tests this.
4. **Names that file systems reject, or that clash** (`a/b`, `Notes` twice in one folder, a trailing space). Files get safe, de-duplicated names, the app shows the real title, and renaming keeps the page's `id`. Tasks 1 and 4 test this.
5. **Existing browser data on the first start.** It is imported once, with nothing lost, and the import never repeats. Task 5 tests this.

## File Structure

| File | Responsibility |
|---|---|
| `memory-engine/src/memory_engine/vault.py` | Create: the Study folder as files: safe paths, names, snapshot, versions, clashes, move, trash, layout, upload |
| `memory-engine/src/memory_engine/serve.py` | Create: the HTTP service, Origin/Host checks, the watcher and events, the folder setting |
| `memory-engine/src/memory_engine/__main__.py` | Modify: `serve` subcommand |
| `lokus/src/views/studyhome/data/markdown.js` | Create: page HTML ↔ Markdown |
| `lokus/src/views/studyhome/data/vaultClient.js` | Create: fetch and `EventSource` wrapper |
| `lokus/src/views/studyhome/data/vaultState.js` | Create: snapshot → state, state diff → file operations, file texts |
| `lokus/src/views/studyhome/data/vaultSync.js` | Create: the operation queue with retries, safety copy and status |
| `lokus/src/views/studyhome/data/StudyProvider.jsx` | Modify: load from the vault, sync, events, first-start import, status |
| `lokus/src/views/studyhome/VaultBanner.jsx` | Create: offline, at-risk and clash messages |
| `lokus/src/views/studyhome/settings/…` and `sources/AddSourceDialog.jsx` | Modify: the "Study folder" field; upload originals |
| `BaseN/start.fish`, `memory-engine/README.md` | Modify: start and stop the service; document it |

---

### Task 1: The Vault (memory-engine)

**Files:**
- Create: `src/memory_engine/vault.py`
- Test: `tests/test_vault.py`

**Interfaces:**
- Consumes: `atomic_write`, `split_frontmatter`, `join_frontmatter` (Phase 2).
- Produces:
  - `class VaultError(ValueError)`.
  - `sanitize_name(name: str) -> str`.
  - `version_of(data: bytes) -> str`.
  - `class Vault(root: Path)` with:
    - `resolve(rel: str) -> Path`, which refuses an empty or absolute path, a `..` part, hidden parts (including `.study`) and control characters with `VaultError("… is not a path in the Study folder")`;
    - `snapshot() -> dict`, returning `{"folders": [rel, …], "files": [{"path", "id", "meta", "body", "version"}], "layout": dict}`. Paths are sorted, `.md` files only, `id` is filled in where missing, and hidden folders are skipped;
    - `read(rel) -> tuple[str, str]`, returning `(text, version)`;
    - `write(rel, text, base_version: str | None = None, create: bool = False) -> dict`, returning `{"path", "version", "clash"}`. `create` picks a free name;
    - `mkdir(rel) -> str` and `move(src, dst) -> str`, both picking free names;
    - `trash(rel) -> str`;
    - `read_layout() -> dict` and `write_layout(layout: dict) -> None`;
    - `upload(rel, data: bytes) -> str`, which only accepts paths under `Sources/files/` and picks a free name.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("rel", ["/etc/x.md", "../x.md", ".study/layout.json", "a/.git/x.md", "a\x00b.md", ""])
def test_paths_outside_the_study_folder_are_refused(tmp_path, rel):
    with pytest.raises(VaultError, match="is not a path in the Study folder"):
        Vault(tmp_path).resolve(rel)

def test_names_are_made_safe():
    assert sanitize_name(' Cells: a/b? ') == "Cells- a-b-"
    assert sanitize_name("  ") == "Untitled"

def test_snapshot_reads_folders_and_files_and_gives_missing_ids(tmp_path):
    (tmp_path / "Biology" / "Cells").mkdir(parents=True)
    (tmp_path / "Biology" / "Cells" / "Krebs cycle.md").write_text("Runs in the matrix.\n")
    (tmp_path / ".study").mkdir()
    (tmp_path / ".hidden").mkdir()
    snap = Vault(tmp_path).snapshot()
    assert snap["folders"] == ["Biology", "Biology/Cells"]
    [page] = snap["files"]
    assert page["path"] == "Biology/Cells/Krebs cycle.md" and len(page["id"]) == 32 and page["body"].strip() == "Runs in the matrix."
    assert split_frontmatter((tmp_path / "Biology/Cells/Krebs cycle.md").read_text())[0]["id"] == page["id"]

def test_write_with_the_right_version_replaces_the_file(tmp_path):
    vault = Vault(tmp_path)
    first = vault.write("Notes.md", "One.\n", create=True)
    second = vault.write("Notes.md", "Two.\n", base_version=first["version"])
    assert vault.read("Notes.md") == ("Two.\n", second["version"]) and second["clash"] is None

def test_a_stale_version_keeps_both_texts(tmp_path):                 # Review Focus 2
    vault = Vault(tmp_path)
    first = vault.write("Krebs cycle.md", "Mine.\n", create=True)
    (tmp_path / "Krebs cycle.md").write_text("Changed by hand.\n")
    result = vault.write("Krebs cycle.md", "My new typing.\n", base_version=first["version"])
    assert result["clash"].startswith("Krebs cycle (from disk ") and result["clash"].endswith(".md")
    assert (tmp_path / result["clash"]).read_text() == "Changed by hand.\n"
    assert vault.read("Krebs cycle.md")[0] == "My new typing.\n"

def test_creating_twice_picks_free_names(tmp_path):                  # Review Focus 4
    vault = Vault(tmp_path)
    assert [vault.write("Notes.md", "x", create=True)["path"] for _ in range(3)] == ["Notes.md", "Notes (2).md", "Notes (3).md"]
    assert [vault.mkdir("Biology") for _ in range(2)] == ["Biology", "Biology (2)"]

def test_move_picks_a_free_name(tmp_path):
    vault = Vault(tmp_path)
    vault.write("a.md", "A", create=True)
    vault.write("b.md", "B", create=True)
    assert vault.move("a.md", "b.md") == "b (2).md" and not (tmp_path / "a.md").exists()

def test_trash_keeps_the_old_path(tmp_path):
    vault = Vault(tmp_path)
    vault.mkdir("Biology")
    vault.write("Biology/Cells.md", "x", create=True)
    kept = vault.trash("Biology/Cells.md")
    assert kept.startswith(".study/trash/") and kept.endswith("/Biology/Cells.md") and (tmp_path / kept).read_text() == "x"

def test_layout_round_trip(tmp_path):
    vault = Vault(tmp_path)
    assert vault.read_layout() == {}
    vault.write_layout({"subjects": ["a1"], "colors": {"a1": "#4c90f0"}})
    assert vault.read_layout() == {"subjects": ["a1"], "colors": {"a1": "#4c90f0"}}

def test_uploads_only_go_into_sources_files(tmp_path):
    vault = Vault(tmp_path)
    assert vault.upload("Sources/files/lecture.pdf", b"%PDF") == "Sources/files/lecture.pdf"
    with pytest.raises(VaultError, match="Sources/files"):
        vault.upload("Biology/x.pdf", b"%PDF")
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_vault.py -q`. Expected: FAIL (`ModuleNotFoundError: memory_engine.vault`).
- [ ] **Step 3: Implement `vault.py`** as specified. Free names insert ` (n)` before the suffix (or at the end for folders), starting at 2. The clash timestamp uses local time, `%Y-%m-%d %H-%M`.
- [ ] **Step 4: Run, expect pass**: Expected: 15 passed (6 + 9).
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: the Study folder as files: safe paths, names, versions, clashes, trash"`

---

### Task 2: The service (memory-engine)

**Files:**
- Create: `src/memory_engine/serve.py`
- Modify: `src/memory_engine/__main__.py` (`serve [--folder PATH] [--port N]`)
- Test: `tests/test_serve.py`

**Interfaces:**
- Consumes: `Vault`, `VaultError` (Task 1).
- Produces:
  - `ALLOWED_ORIGINS`, `DEFAULT_PORT = 5057`.
  - `config_path() -> Path`: `$MEMORY_ENGINE_CONFIG`, or else `~/.config/memory-engine/study.json`.
  - `load_study_folder() -> Path` (default `~/Study`) and `save_study_folder(path: Path) -> None`.
  - `class Watcher(vault, interval=1.0)` with `poll() -> list[dict]`. The first call records the folder and returns `[]`.
  - `make_server(folder: Path, port: int = DEFAULT_PORT) -> ThreadingHTTPServer`. It has `server.vault` and `server.switch(folder)`, and starts a watcher thread that fans events out to `/events` clients.
- **Routes** (JSON in and out):

| Route | Body or query | Answer |
|---|---|---|
| `GET /vault` | | `snapshot()` |
| `GET /file?path=` | | `{"text", "version"}` |
| `PUT /file` | `{"path", "text", "version"?, "create"?}` | `write()` |
| `POST /folder` | `{"path"}` | `{"path"}` |
| `POST /move` | `{"from", "to"}` | `{"path"}` |
| `POST /trash` | `{"path"}` | `{"path"}` |
| `PUT /layout` | `{"layout"}` | `{}` |
| `POST /upload?path=` | raw bytes | `{"path"}` |
| `GET /setting/folder` | | `{"path"}` |
| `PUT /setting/folder` | `{"path"}` | `{"path"}` |
| `GET /events` | | `text/event-stream`, one `data: {json}` per event |

  - `OPTIONS` answers preflights for allowed origins.
  - A `VaultError` gives 400 `{"error"}`, a refused Origin or Host gives 403, and an unknown route gives 404.
  - Every answer carries `Access-Control-Allow-Origin` with the request's Origin when it is allowed.
  - `PUT /setting/folder` creates the folder, switches the vault and saves the setting.

- [ ] **Step 1: Write the failing tests** (a fixture starts `make_server(tmp_path / "Study", port=0)` in a thread and sets `MEMORY_ENGINE_CONFIG` to a temporary file)

```python
def call(server, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    conn.request(method, path, body=data, headers={"Origin": "http://localhost:1420", **(headers or {})})
    reply = conn.getresponse()
    return reply.status, reply.getheader("Access-Control-Allow-Origin"), reply.read()

def test_snapshot_is_served_to_the_app(service):
    status, allow, body = call(service, "GET", "/vault")
    assert status == 200 and allow == "http://localhost:1420" and json.loads(body)["files"] == []

@pytest.mark.parametrize("headers", [{"Origin": "https://evil.example"}, {"Host": "evil.example:5057"}])
def test_other_pages_are_refused(service, headers):                   # Review Focus 3
    status, _, _ = call(service, "PUT", "/file", {"path": "x.md", "text": "x", "create": True}, headers)
    assert status == 403 and not (service.vault.root / "x.md").exists()

def test_preflight_allows_the_app(service):
    status, allow, _ = call(service, "OPTIONS", "/file", headers={"Access-Control-Request-Method": "PUT"})
    assert status == 204 and allow == "http://localhost:1420"

def test_write_read_move_and_trash(service):
    status, _, body = call(service, "PUT", "/file", {"path": "Notes.md", "text": "One.\n", "create": True})
    written = json.loads(body)
    assert status == 200 and written["path"] == "Notes.md"
    assert json.loads(call(service, "GET", "/file?path=Notes.md")[2]) == {"text": "One.\n", "version": written["version"]}
    assert json.loads(call(service, "POST", "/move", {"from": "Notes.md", "to": "Kept.md"})[2]) == {"path": "Kept.md"}
    assert json.loads(call(service, "POST", "/trash", {"path": "Kept.md"})[2])["path"].startswith(".study/trash/")

def test_a_stale_save_reports_the_clash(service):
    v1 = json.loads(call(service, "PUT", "/file", {"path": "K.md", "text": "a", "create": True})[2])["version"]
    (service.vault.root / "K.md").write_text("by hand")
    clash = json.loads(call(service, "PUT", "/file", {"path": "K.md", "text": "mine", "version": v1})[2])["clash"]
    assert clash.startswith("K (from disk ")

def test_bad_paths_are_a_clear_error(service):
    status, _, body = call(service, "GET", "/file?path=../../etc/passwd")
    assert status == 400 and "is not a path in the Study folder" in json.loads(body)["error"]

def test_layout_and_upload(service):
    assert call(service, "PUT", "/layout", {"layout": {"subjects": ["s1"]}})[0] == 200
    assert service.vault.read_layout() == {"subjects": ["s1"]}
    assert json.loads(call(service, "POST", "/upload?path=Sources/files/a.pdf", b"%PDF")[2]) == {"path": "Sources/files/a.pdf"}

def test_the_folder_setting_switches_and_is_remembered(service, tmp_path):
    other = tmp_path / "Other study"
    assert json.loads(call(service, "PUT", "/setting/folder", {"path": str(other)})[2]) == {"path": str(other)}
    assert other.is_dir() and service.vault.root == other and load_study_folder() == other

def test_watcher_sees_changes_made_by_hand(tmp_path):
    vault = Vault(tmp_path)
    watcher = Watcher(vault)
    assert watcher.poll() == []
    (tmp_path / "a.md").write_text("x")
    assert watcher.poll() == [{"type": "added", "path": "a.md"}]
    (tmp_path / "a.md").write_text("longer")
    assert watcher.poll() == [{"type": "changed", "path": "a.md"}]
    (tmp_path / "a.md").unlink()
    assert watcher.poll() == [{"type": "removed", "path": "a.md"}]

def test_events_stream_a_change(service):
    conn = http.client.HTTPConnection("127.0.0.1", service.server_port, timeout=5)
    conn.request("GET", "/events", headers={"Origin": "http://localhost:1420"})
    reply = conn.getresponse()
    (service.vault.root / "new.md").write_text("x")
    line = reply.fp.readline()
    while not line.startswith(b"data:"):
        line = reply.fp.readline()
    assert json.loads(line[5:]) == {"type": "added", "path": "new.md"}

def test_cli_serve_prints_where_it_listens(tmp_path, monkeypatch):
    monkeypatch.setenv("MEMORY_ENGINE_CONFIG", str(tmp_path / "study.json"))
    started = []
    monkeypatch.setattr("memory_engine.__main__.serve_forever", lambda server: started.append(server))
    assert main(["serve", "--folder", str(tmp_path / "Study"), "--port", "0"]) == 0
    assert started and started[0].vault.root == tmp_path / "Study"
```

`__main__.serve_forever(server)` is a module-level function (`server.serve_forever()` until Ctrl+C), so the test can replace it. `serve` prints `Study folder: {path}` and `Listening on http://127.0.0.1:{port}`.

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_serve.py -q`. Expected: FAIL (`ModuleNotFoundError: memory_engine.serve`).
- [ ] **Step 3: Implement `serve.py` and the `serve` subcommand** as specified.
- [ ] **Step 4: Run, expect pass**: `.venv/bin/pytest -q`. Expected: 284 + 15 + 12 = 311 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: memory-engine serve: the Study folder service for the study app"`

---

### Task 3: Page HTML ↔ Markdown (lokus)

**Files:**
- Create: `src/views/studyhome/data/markdown.js`
- Modify: `package.json` (add `turndown@^7`, `turndown-plugin-gfm@^1`; run `npm install`)
- Test: `src/views/studyhome/data/markdown.test.js`

**Interfaces:**
- Produces:
  - `markdownToPageHtml(md: string) -> string`: `markdown-it` with `html: false` (raw HTML is shown as text, never kept), GFM tables, and Lokus's `src/core/markdown/plugins/wikilinks.js`. Task-list items (`- [ ]` / `- [x]`) become TipTap's `<ul data-type="taskList"><li data-type="taskItem" data-checked="…"><p>…</p></li></ul>`.
  - `pageHtmlToMarkdown(html: string) -> string`: `turndown` (`headingStyle: "atx"`, `bulletListMarker: "-"`, `codeBlockStyle: "fenced"`) plus the GFM plugin (tables and strikethrough). Its rules:
    - `a[data-type="wiki-link"]` becomes `[[target]]`, or `[[target|label]]` when the label differs;
    - `img[data-type="wiki-link"]` becomes `![[target]]`;
    - TipTap task items become `- [ ] text` / `- [x] text`.
  - The output ends with exactly one `\n`.

- [ ] **Step 1: Write the failing tests**

```js
const samples = {
  heading: "# Krebs cycle\n",
  emphasis: "Runs in the **matrix**, not the *cytoplasm*.\n",
  bullets: "- Citrate\n- Isocitrate\n",
  numbered: "1. First\n2. Second\n",
  tasks: "- [ ] Draw it\n- [x] Read it\n",
  wiki: "See [[Glycolysis]] and [[Krebs cycle|the cycle]].\n",
  code: "```python\nprint(1)\n```\n",
  table: "| Step | Enzyme |\n| --- | --- |\n| 1 | Citrate synthase |\n",
  link: "[Lecture](https://example.org/krebs)\n",
};

for (const [name, md] of Object.entries(samples)) {
  it(`keeps ${name} through a round trip`, () => {
    expect(pageHtmlToMarkdown(markdownToPageHtml(md))).toBe(md);
  });
}

it("turns wiki links into the editor's link nodes", () => {
  expect(markdownToPageHtml("[[Glycolysis]]\n")).toContain('data-type="wiki-link"');
});

it("never keeps raw HTML", () => {
  expect(pageHtmlToMarkdown(markdownToPageHtml("<script>alert(1)</script>\n"))).not.toContain("<script>");
});

it("reads the editor's own task list HTML", () => {
  const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Read it</p></div></li></ul>';
  expect(pageHtmlToMarkdown(html)).toBe("- [x] Read it\n");
});
```

- [ ] **Step 2: Run, expect failure**: `npx vitest run src/views/studyhome/data/markdown.test.js`. Expected: FAIL (cannot find `./markdown`).
- [ ] **Step 3: Implement `markdown.js`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 12 passed.
- [ ] **Step 5: Save the work** as the hand-off decides (see Execution Handoff).

---

### Task 4: Snapshot to state, and state changes to file operations (lokus)

**Files:**
- Create: `src/views/studyhome/data/vaultClient.js`, `src/views/studyhome/data/vaultState.js`
- Test: `src/views/studyhome/data/vaultState.test.js`, `src/views/studyhome/data/vaultClient.test.js`

**Interfaces:**
- Consumes: `markdownToPageHtml`, `pageHtmlToMarkdown` (Task 3); `EMPTY_STATE`, `UNSORTED`, `mutations` (`operations.js`); `js-yaml` (already a Lokus dependency) for YAML headers.
- Produces:
  - **`vaultClient.js`:**
    - `class VaultOffline extends Error`.
    - `createVaultClient({ baseUrl = "http://127.0.0.1:5057", fetchImpl = fetch, EventSourceImpl = globalThis.EventSource })` returns `{ snapshot, read, write, mkdir, move, trash, writeLayout, upload, folder, setFolder, subscribe(onEvent) → unsubscribe }`, one method per Task 2 route.
    - A network failure throws `VaultOffline`. A non-2xx answer throws `Error(body.error)`.
  - **`vaultState.js`:**
    - `sanitizeName(name)`: the same rule as Python's.
    - `stateFromSnapshot(snapshot) -> { state, paths, versions }`, where `paths` is `{ id: relPath }` and `versions` is `{ relPath: version }`. It builds:
      - top-level folders other than `Unsorted`, `Quick notes` and `Sources` as subjects, in `layout.subjects` order, then by name;
      - nested folders as folders and `.md` files as pages, with HTML from `markdownToPageHtml(body)`, `home` set to the folder, and also added to each `also_in` folder;
      - `Unsorted/*.md` as children of `UNSORTED`;
      - quick notes and sources from their folders;
      - colors, child order, `expanded` and `recent` from the layout.
    - `planSync(prev, next, paths) -> Op[]`. An `Op` is one of:
      - `{op: "mkdir", id, path}`;
      - `{op: "write", id, path, text, create}`;
      - `{op: "move", id, from, to}`;
      - `{op: "trash", id, path}`;
      - `{op: "layout", layout}`.
      Operations are ordered as mkdir (parents first), move, write, trash (children first), layout. New paths come from the parent's path plus `sanitizeName(name)` (plus `.md` for files).
    - `fileText(state, id, now) -> string`: the YAML header (spec fields; `updated` set to `new Date(now).toISOString()`) plus the Markdown body, for a page, quick note or source.

- [ ] **Step 1: Write the failing tests**

```js
const snapshot = {
  folders: ["Biology", "Biology/Cells", "Quick notes", "Sources", "Unsorted"],
  files: [
    { path: "Biology/Cells/Krebs cycle.md", id: "p1", meta: { id: "p1", title: "Krebs cycle", also_in: ["Biology"] }, body: "Runs in the **matrix**.\n", version: "v1" },
    { path: "Unsorted/Loose idea.md", id: "p2", meta: { id: "p2", title: "Loose idea" }, body: "Idea.\n", version: "v2" },
    { path: "Quick notes/2026-10-07 15-32.md", id: "q1", meta: { id: "q1", created: "2026-10-07T15:32:00Z" }, body: "Buy milk\n", version: "v3" },
    { path: "Sources/Lecture.md", id: "s1", meta: { id: "s1", title: "Lecture", type: "link", url: "https://e.org", use: true }, body: "Text.\n", version: "v4" },
  ],
  layout: { subjects: ["Biology"], colors: { Biology: "#4c90f0" } },
};

it("builds the app's state from the files", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const [subject] = state.subjects;
  expect(state.nodes[subject].name).toBe("Biology");
  const folder = state.nodes[subject].children.find((id) => state.nodes[id].type === "folder");
  expect(state.nodes[folder].children).toContain("p1");
  expect(state.nodes[subject].children).toContain("p1");
  expect(state.nodes.p1.content).toContain("<strong>matrix</strong>");
  expect(state.nodes[UNSORTED].children).toEqual(["p2"]);
  expect(state.quickNotes[0]).toMatchObject({ id: "q1", text: "Buy milk" });
  expect(state.sources[0]).toMatchObject({ id: "s1", title: "Lecture", url: "https://e.org", use: true });
  expect(paths.p1).toBe("Biology/Cells/Krebs cycle.md");
});

it("typing only rewrites that page", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const next = mutations.setContent(state, "p1", "<p>New text.</p>");
  const ops = planSync(state, next, paths);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ op: "write", id: "p1", path: "Biology/Cells/Krebs cycle.md", create: false });
  expect(ops[0].text).toMatch(/^---\nid: p1\ntitle: Krebs cycle\n[\s\S]*also_in:\n\s*- Biology\n---\nNew text\.\n$/);
});

it("renaming moves the file and keeps the id", () => {                  // Review Focus 4
  const { state, paths } = stateFromSnapshot(snapshot);
  const ops = planSync(state, mutations.rename(state, "p1", "Citric: acid/cycle"), paths);
  expect(ops[0]).toEqual({ op: "move", id: "p1", from: "Biology/Cells/Krebs cycle.md", to: "Biology/Cells/Citric- acid-cycle.md" });
  expect(ops[1]).toMatchObject({ op: "write", id: "p1", path: "Biology/Cells/Citric- acid-cycle.md" });
  expect(ops[1].text).toContain("title: 'Citric: acid/cycle'");
});

it("a new subject with a page makes the folder first", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const { state: s1, id: subject } = mutations.addSubject(state, { name: "Chemistry" });
  const { state: s2, id: page } = mutations.addChild(s1, subject, "page", "Atoms");
  const ops = planSync(state, s2, paths);
  expect(ops.map((o) => o.op)).toEqual(["mkdir", "write", "layout"]);
  expect(ops[0]).toMatchObject({ path: "Chemistry" });
  expect(ops[1]).toMatchObject({ id: page, path: "Chemistry/Atoms.md", create: true });
});

it("deleting a page moves it to the trash", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  expect(planSync(state, mutations.deletePage(state, "p2"), paths)).toEqual([{ op: "trash", id: "p2", path: "Unsorted/Loose idea.md" }]);
});

it("a quick note and a source become their own files", () => {
  const { state, paths } = stateFromSnapshot(snapshot);
  const ops = planSync(state, mutations.setSourcesUse(mutations.addQuickNote(state, "Call Sam"), ["s1"], false), paths);
  expect(ops.find((o) => o.op === "write" && o.create).path).toMatch(/^Quick notes\/\d{4}-\d{2}-\d{2} \d{2}-\d{2}\.md$/);
  expect(ops.find((o) => o.id === "s1").text).toContain("use: false");
});

// vaultClient.test.js
it("reports a missing service as offline", async () => {
  const client = createVaultClient({ fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
  await expect(client.snapshot()).rejects.toBeInstanceOf(VaultOffline);
});

it("passes the service's error message on", async () => {
  const client = createVaultClient({ fetchImpl: async () => new Response(JSON.stringify({ error: "x.md is not a path in the Study folder" }), { status: 400 }) });
  await expect(client.read("../x.md")).rejects.toThrow("is not a path in the Study folder");
});
```

Use the real names of the existing mutations (`deletePage` and the others) as `operations.js` exports them; adjust only the call names, never the assertions.

- [ ] **Step 2: Run, expect failure**: `npx vitest run src/views/studyhome/data/vaultState.test.js src/views/studyhome/data/vaultClient.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement both modules** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 8 passed.
- [ ] **Step 5: Save the work** as the hand-off decides.

---

### Task 5: Saving, live updates and the first start (lokus)

**Files:**
- Create: `src/views/studyhome/data/vaultSync.js`, `src/views/studyhome/VaultBanner.jsx`, `src/views/studyhome/data/testing/fakeVault.js`
- Modify: `src/views/studyhome/data/StudyProvider.jsx`, `src/views/studyhome/StudyPreview.jsx` (render `<VaultBanner />` above the main view)
- Test: `src/views/studyhome/data/vaultSync.test.js`, `src/views/studyhome/data/StudyProvider.test.jsx`

**Interfaces:**
- Consumes: Tasks 3-4.
- Produces:
  - **`createVaultSync({ client, storage = localStorage, onResult, onStatus, delays = [1000, 2000, 5000, 10000], now = Date.now })`** returns `{ push(ops), flush(), pending() }`.
    - Operations run one at a time. Page writes for the same `id` within 800 ms collapse into the last one.
    - Pending operations stay in `storage["study-vault-pending-v1"]` until confirmed.
    - `onResult(op, answer)` reports final paths, versions and clashes.
    - `onStatus({ offline, unsavedSince, notice })` drives the banner.
  - **`StudyProvider({ children, client })`.** The default client is `createVaultClient()`.
    - On mount it loads `snapshot()` and runs the first-start import when it applies.
    - Each state change runs `planSync`, then `push`.
    - It subscribes to events. For a path whose version it didn't write itself, it re-reads the snapshot after 300 ms and replaces only nodes with no pending operations.
    - `useStudy()` gains `vault: { offline, unsavedSince, notice }`.
  - **`VaultBanner`** shows the exact offline message, `Not saved for {n} s, still trying` after 30 s, and the clash notice. It renders nothing when everything is saved.

- [ ] **Step 1: Write the failing tests.** First write the test helpers in `data/testing/fakeVault.js`:
  - `fakeClient(snapshot, { clashOn, folder })`: an in-memory client with the Task 4 methods. It has:
    - `calls`, a list of `{ method, ...args }`;
    - `fail`, which makes every call throw `VaultOffline` while it is true;
    - `emit(event)`, which delivers to subscribers;
    - `setBody(path, body)`;
    - `snapshotNow()`.
    A write to `clashOn` answers with `clash: "<stem> (from disk 2026-10-07 15-32).md"`.
  - `renderAndGetStudy(client)`: renders `StudyPreview` inside `StudyProvider` and resolves to `{ actions, getState }` once loaded.
  - `renderWithProvider(client)`.
  - `legacyStateWithOnePage(name, html)`.

```js
it("loads the files on start", async () => {
  renderWithProvider(fakeClient(snapshot));
  expect(await screen.findByText("Krebs cycle")).toBeInTheDocument();
});

it("saves typing after a quiet moment, as Markdown", async () => {
  vi.useFakeTimers();
  const client = fakeClient(snapshot);
  const { actions } = await renderAndGetStudy(client);
  act(() => actions.setContent("p1", "<p><strong>New</strong> text.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(900));
  expect(client.calls.at(-1)).toMatchObject({ method: "write", path: "Biology/Cells/Krebs cycle.md" });
  expect(client.calls.at(-1).text).toContain("**New** text.");
});

it("keeps typing safe while the service is away, then saves it", async () => {   // Review Focus 1
  vi.useFakeTimers();
  const client = fakeClient(snapshot);
  const { actions } = await renderAndGetStudy(client);
  client.fail = true;
  act(() => actions.setContent("p1", "<p>Offline typing.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(31000));
  expect(screen.getByText("Study folder not connected. Start it with: memory-engine serve")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("study-vault-pending-v1"))[0].text).toContain("Offline typing.");
  client.fail = false;
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(localStorage.getItem("study-vault-pending-v1")).toBe("[]");
  expect(screen.queryByText(/not connected/)).toBeNull();
});

it("shows the clash notice", async () => {                                     // Review Focus 2
  vi.useFakeTimers();
  const client = fakeClient(snapshot, { clashOn: "Biology/Cells/Krebs cycle.md" });
  const { actions } = await renderAndGetStudy(client);
  act(() => actions.setContent("p1", "<p>Mine.</p>"));
  await act(() => vi.advanceTimersByTimeAsync(900));
  expect(screen.getByText(/^Kept both versions: the one on disk is saved as Krebs cycle \(from disk /)).toBeInTheDocument();
});

it("a page changed on disk reloads when it has no unsaved typing", async () => {
  vi.useFakeTimers();
  const client = fakeClient(snapshot);
  const { getState } = await renderAndGetStudy(client);
  client.setBody("Biology/Cells/Krebs cycle.md", "Changed by hand.\n");
  act(() => client.emit({ type: "changed", path: "Biology/Cells/Krebs cycle.md" }));
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(getState().nodes.p1.content).toContain("Changed by hand.");
});

it("imports browser data once on the first start", async () => {               // Review Focus 5
  localStorage.setItem("study-app-data-v1", JSON.stringify(legacyStateWithOnePage("Old page", "<p>Old text.</p>")));
  const client = fakeClient({ folders: [], files: [], layout: {} });
  await renderAndGetStudy(client);
  await waitFor(() => expect(client.calls.some((c) => c.method === "write" && c.text.includes("Old text."))).toBe(true));
  expect(localStorage.getItem("study-app-data-v1")).toBeNull();
  expect(localStorage.getItem("study-app-data-v1-imported")).not.toBeNull();
  cleanup();
  const again = fakeClient(client.snapshotNow());
  await renderAndGetStudy(again);
  expect(again.calls.filter((c) => c.method === "write")).toHaveLength(0);
});

// vaultSync.test.js
it("collapses quick page writes and retries with growing waits", async () => {
  vi.useFakeTimers();
  const calls = [];
  const client = { write: vi.fn(async (args) => { calls.push(Date.now()); if (calls.length < 3) throw new VaultOffline(); return { path: args.path, version: "v", clash: null }; }) };
  const sync = createVaultSync({ client, storage: memoryStorage(), onResult() {}, onStatus() {} });
  sync.push([{ op: "write", id: "p1", path: "a.md", text: "1" }]);
  sync.push([{ op: "write", id: "p1", path: "a.md", text: "2" }]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(client.write).toHaveBeenCalledTimes(3);
  expect(client.write.mock.calls.at(-1)[0].text).toBe("2");
  expect(calls[1] - calls[0]).toBe(1000);
  expect(calls[2] - calls[1]).toBe(2000);
});
```

- [ ] **Step 2: Run, expect failure**: `npx vitest run src/views/studyhome/data/vaultSync.test.js src/views/studyhome/data/StudyProvider.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `vaultSync.js`, the new `StudyProvider`, `VaultBanner` and its place in `StudyPreview.jsx`, as specified.
- [ ] **Step 4: Run the study tests**: `npx vitest run src/views/studyhome`. Expected: every earlier study test still passes (45 before, plus Tasks 3-5). Existing tests that rendered `StudyProvider` with no service pass a `fakeClient(EMPTY)`. Update that wiring only, never what they assert.
- [ ] **Step 5: Save the work** as the hand-off decides.

---

### Task 6: The folder setting, source originals, starting the service

**Files:**
- Modify: the Settings section that holds storage-like options (find it under `src/views/studyhome/settings/`) to add a "Study folder" field; `src/views/studyhome/sources/AddSourceDialog.jsx`; `BaseN/start.fish`; `memory-engine/README.md`
- Test: the settings test file next to the section you change, and `src/views/studyhome/sources/AddSourceDialog.test.jsx` (or the existing sources test file)

**Interfaces:**
- Consumes: `client.folder()`, `client.setFolder(path)`, `client.upload(path, blob)` (Task 4).
- Produces:
  - **Settings → "Study folder":** a text field showing `client.folder()` with a "Use this folder" button calling `setFolder`. After a switch, the app reloads its snapshot. If the new folder has no pages, it offers "Copy my pages there"; accepting runs the first-start import from the current state.
  - **Adding a file source:**
    - The original file is uploaded to `Sources/files/<file name>`.
    - The source's YAML `file:` is set to the returned path.
    - A failed upload keeps the source, adds no `file:`, and shows its error under the dialog.
  - **`start.fish`:** after Open Notebook starts, run `$BASEN_ROOT/memory-engine/.venv/bin/memory-engine serve &` and remember its PID; when Lokus exits, kill that PID. The existing lines stay as they are.
  - **README:** a "Study folder service" section covering what `serve` does, the port, the Origin rule, the folder setting and the config file.

- [ ] **Step 1: Write the failing tests**

```js
it("switches the Study folder from Settings", async () => {
  const client = fakeClient(snapshot, { folder: "/home/me/Study" });
  renderSettingsWithProvider(client);
  const field = await screen.findByLabelText("Study folder");
  expect(field).toHaveValue("/home/me/Study");
  await userEvent.clear(field);
  await userEvent.type(field, "/home/me/Exams");
  await userEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(client.calls).toContainEqual({ method: "setFolder", path: "/home/me/Exams" });
});

it("keeps the original file of an uploaded source", async () => {
  const client = fakeClient(snapshot);
  renderAddSourceWithProvider(client);
  await uploadFile(new File(["hello"], "notes.txt", { type: "text/plain" }));
  await waitFor(() => expect(client.calls).toContainEqual(expect.objectContaining({ method: "upload", path: "Sources/files/notes.txt" })));
});
```

- [ ] **Step 2: Run, expect failure**: `npx vitest run src/views/studyhome`. Expected: the 2 new tests FAIL.
- [ ] **Step 3: Implement** the field, the upload, the `start.fish` lines and the README section.
- [ ] **Step 4: Run all checks**:
  - `npx vitest run src/views/studyhome` and `.venv/bin/pytest -q` must both pass.
  - Then a real-browser check:
    1. Start `memory-engine serve --folder /tmp/<job tmp>/Study` and the dev server.
    2. Take headless Firefox screenshots of `http://localhost:1420/?view=study-preview`: a subject and a page, the page open, and the offline banner (with the service stopped).
    3. Then append a line to the page's `.md` file by hand, and confirm the open page shows it within 2 s.
- [ ] **Step 5: Save the work** as the hand-off decides, then commit memory-engine (`git add -A && git commit -m "docs: the Study folder service"`).

Piece 2 (the FSRS memory) gets its own spec and plan after this one is merged.
