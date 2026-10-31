# Phase 1: SQLite Storage, Code Graph and Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested Python package that indexes Markdown and Python files from disk into one SQLite database and answers hybrid (keyword + meaning) searches within a fixed token budget, as Phase 1 of the local 8B memory architecture.

**Architecture:** Files on disk are the truth; the database is an index that can always be rebuilt from them. `db.py` opens SQLite in WAL mode with mmap and the sqlite-vec extension and creates every table. Markdown is split into heading sections, Python is parsed with tree-sitter into symbols and references. Each section gets an FTS5 trigram row and an 8-bit vector, and search fuses both rankings with Reciprocal Rank Fusion. Embeddings come from Ollama behind an `Embedder` interface; tests use a deterministic stand-in.

**Tech Stack:** Python 3.14, stdlib `sqlite3` (SQLite 3.53, FTS5), `sqlite-vec` 0.1.9, `tree-sitter` 0.26 with `tree-sitter-python` 0.25, `pytest` 9, Ollama HTTP API via `urllib`.

**Spec:** `/home/caesarsta/Downloads/BaseN/architecture_spec.md` (sections 1, 3, 6 Phase 1, and 7).

## Global Constraints

- Location: a self-contained project at `/home/caesarsta/Downloads/BaseN/memory-engine/` with its own git repository. All paths below are relative to it.
- "File-as-Truth": nothing may exist only in the database. Every indexed row must be rebuildable from a file (Task 8 proves it).
- "keep the 8B model's active context window strictly below 2,000 tokens": search output is packed to at most `max_tokens` (default 1800, leaving room for the prompt).
- "`PRAGMA journal_mode=WAL;`" and mmap must be on for every connection. This SQLite build caps `mmap_size` at 2147418112 bytes (`MAX_MMAP_SIZE=0x7fff0000`); request that value.
- "`sqlite-vec` (with 8-bit vector quantization)": vectors are stored as `int8[768]` via `vec_quantize_int8(?, 'unit')` on L2-normalized embeddings, cosine distance.
- "Implement Reciprocal Rank Fusion (RRF)": `score = Σ 1 / (60 + rank)`, ranks starting at 1.
- "Use `FTS5` for exact regex/symbol matches": FTS5 uses the `trigram` tokenizer (substring and symbol matches); true regular expressions are applied in Python to the candidates (FTS5 cannot run regex).
- Table names are fixed by the spec: `symbols`, `references`, `web_cache`, `learned_repairs`. `references` is an SQL keyword and must always be written as `"references"`.
- Runtime: Ollama at `http://localhost:11434`, embedding model `nomic-embed-text`, 768 dimensions, all set in `Settings`.
- Tests never need Ollama or the network. They use `FakeEmbedder`, or a stub HTTP server on 127.0.0.1.
- Tooling: Python 3.14, `python3 -m venv .venv`, `pip install -e '.[dev]'`, and a `pyproject.toml` built with setuptools. There is no uv.
- Commit messages carry no AI or assistant attribution lines (the user's rule: never mention Claude).

## Review Focus

1. Re-indexing a file whose text changed must leave no stale chunk, FTS row or vector behind, and an unchanged file must not be re-embedded. Task 4 tests this.
2. Removing a document must also remove its vectors: `vec0` rows do not cascade with foreign keys. Task 4 tests this.
3. A search query shorter than 3 characters has no trigram, so FTS returns nothing. Hybrid search must still return vector results without raising. Task 6 tests this.
4. When Ollama is not running, or returns vectors of the wrong length, `OllamaEmbedder` must raise `EmbeddingError` with a readable message within the timeout, never hang or store bad vectors. Task 3 tests this.
5. A Python file with a syntax error must still index the functions that parse, without raising. Task 5 tests this.

## File Structure

| File | Responsibility |
|---|---|
| `pyproject.toml`, `.gitignore` | Package metadata, dependencies, pytest config |
| `src/memory_engine/config.py` | `Settings` (paths, Ollama URL, model, dims, mmap) |
| `src/memory_engine/db.py` | `connect()` with pragmas + sqlite-vec, `init_schema()` |
| `src/memory_engine/schema.sql` | All tables, FTS5 tables, triggers, indexes (vec table created in `db.py` because its size comes from `Settings`) |
| `src/memory_engine/chunking.py` | Markdown → heading sections within a token limit |
| `src/memory_engine/embeddings.py` | `Embedder` protocol, `FakeEmbedder`, `OllamaEmbedder`, `normalize()` |
| `src/memory_engine/store.py` | Index / remove a document's chunks, FTS rows and vectors |
| `src/memory_engine/codegraph.py` | tree-sitter Python → `symbols`, `"references"`, code chunks; graph queries |
| `src/memory_engine/search.py` | FTS search, vector search, RRF, hybrid search with regex filter and token budget |
| `src/memory_engine/web_cache.py` | URL-hash → Markdown cache |
| `src/memory_engine/repairs.py` | `learned_repairs` record / find / mark used |
| `src/memory_engine/reindex.py` | Walk a folder and sync the index with the files |
| `src/memory_engine/__main__.py` | CLI: `reindex ROOT`, `search QUERY` |
| `tests/conftest.py` | `settings` and `conn` fixtures on a tmp file DB, `fake` embedder |

---

### Task 1: Project scaffold, connection and schema

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `src/memory_engine/__init__.py`, `src/memory_engine/config.py`, `src/memory_engine/db.py`, `src/memory_engine/schema.sql`, `tests/conftest.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Produces:
  - `Settings` (frozen dataclass): `db_path: Path`, `ollama_url: str = "http://localhost:11434"`, `embed_model: str = "nomic-embed-text"`, `embed_dims: int = 768`, `mmap_size: int = 2147418112`.
  - `connect(settings: Settings) -> sqlite3.Connection`: row factory `sqlite3.Row`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `mmap_size=settings.mmap_size`, sqlite-vec loaded, then extension loading disabled again.
  - `init_schema(conn, settings) -> None`: runs `schema.sql`, then creates `chunks_vec`. Idempotent.
  - conftest fixtures: `settings(tmp_path)` (= `Settings(db_path=tmp_path / "memory.db")`), `conn(settings)` (connected + schema, closed after the test). Task 3 adds `fake`.

- [ ] **Step 1: Create the project files**

`pyproject.toml`: `name = "memory-engine"`, `requires-python = ">=3.12"`, dependencies `sqlite-vec>=0.1.9`, `tree-sitter>=0.26`, `tree-sitter-python>=0.25`; optional `dev = ["pytest>=9"]`; setuptools `src` layout with `schema.sql` included as package data; `[tool.pytest.ini_options] testpaths = ["tests"]`. `.gitignore`: `.venv/`, `__pycache__/`, `*.db`, `*.db-wal`, `*.db-shm`, `.pytest_cache/`.

Then: `git init && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`
Expected: install succeeds.

- [ ] **Step 2: Write `schema.sql` exactly**

```sql
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('markdown', 'code')),
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  heading, text, content='chunks', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, text) VALUES ('delete', old.id, old.heading, old.text);
END;
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('function', 'method', 'class')),
  signature TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
CREATE TABLE IF NOT EXISTS "references" (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  from_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  to_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('call', 'import')),
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS references_to ON "references"(to_name);
CREATE TABLE IF NOT EXISTS web_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  markdown TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learned_repairs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('compile', 'test', 'lint', 'format')),
  error_trace TEXT NOT NULL,
  fix_diff TEXT NOT NULL,
  file_path TEXT,
  created_at TEXT NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS learned_repairs_fts USING fts5(
  error_trace, content='learned_repairs', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS learned_repairs_ai AFTER INSERT ON learned_repairs BEGIN
  INSERT INTO learned_repairs_fts(rowid, error_trace) VALUES (new.id, new.error_trace);
END;
```

`init_schema` then runs `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding int8[{settings.embed_dims}] distance_metric=cosine)`.

- [ ] **Step 3: Write the failing tests** in `tests/test_db.py`

```python
def test_wal_mode(conn):
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"

def test_mmap_enabled(conn):
    assert conn.execute("PRAGMA mmap_size").fetchone()[0] == 2147418112

def test_foreign_keys_on(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1

def test_sqlite_vec_loaded(conn):
    assert conn.execute("SELECT vec_version()").fetchone()[0].startswith("v0.1")

def test_all_tables_exist(conn):
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"documents", "chunks", "chunks_fts", "chunks_vec", "symbols", "references",
            "web_cache", "learned_repairs", "learned_repairs_fts"} <= names

def test_init_schema_is_idempotent(conn, settings):
    init_schema(conn, settings)
    init_schema(conn, settings)

def test_vector_size_comes_from_settings(conn):
    import json, pytest, sqlite3
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("INSERT INTO chunks_vec(chunk_id, embedding) VALUES (1, vec_quantize_int8(?, 'unit'))",
                     (json.dumps([0.5] * 4),))
```

- [ ] **Step 4: Run, expect failure**

Run: `.venv/bin/pytest tests/test_db.py -v`
Expected: FAIL (`ModuleNotFoundError: memory_engine.db`).

- [ ] **Step 5: Implement `config.py`, `db.py` and the fixtures** as specified in Interfaces. Load `schema.sql` with `importlib.resources`.

- [ ] **Step 6: Run, expect pass**

Run: `.venv/bin/pytest tests/test_db.py -v`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: SQLite connection (WAL, mmap, sqlite-vec) and Phase 1 schema"
```

---

### Task 2: Markdown chunking

**Files:**
- Create: `src/memory_engine/chunking.py`
- Test: `tests/test_chunking.py`

**Interfaces:**
- Produces:
  - `Chunk` (frozen dataclass): `ordinal: int`, `heading: str | None`, `text: str`, `token_estimate: int`.
  - `estimate_tokens(text: str) -> int`: `math.ceil(len(text) / 4)`.
  - `split_markdown(text: str, max_tokens: int = 400) -> list[Chunk]`. Approach:
    - Strip a leading `---` YAML frontmatter block.
    - Start a new section at each ATX heading (`#` to `######`) outside fenced code blocks (` ``` ` or `~~~`); `heading` is that line's text without the `#`s.
    - Split a section longer than `max_tokens` at blank lines; a single paragraph that is still too long is split at the character limit `max_tokens * 4`.
    - Drop whitespace-only chunks; number the rest from 0.

- [ ] **Step 1: Write the failing tests**

```python
def test_frontmatter_is_dropped():
    chunks = split_markdown("---\ntitle: X\n---\nHello there")
    assert [c.text for c in chunks] == ["Hello there"]

def test_sections_follow_headings():
    chunks = split_markdown("Intro\n# Krebs cycle\nRuns in the matrix.\n## Steps\nEight steps.")
    assert [(c.heading, c.text) for c in chunks] == [
        (None, "Intro"), ("Krebs cycle", "Runs in the matrix."), ("Steps", "Eight steps.")]
    assert [c.ordinal for c in chunks] == [0, 1, 2]

def test_hash_inside_code_fence_is_not_a_heading():
    chunks = split_markdown("# Code\n```python\n# not a heading\nx = 1\n```")
    assert len(chunks) == 1 and "# not a heading" in chunks[0].text

def test_long_section_is_split_within_limit():
    body = "\n\n".join(["word " * 60] * 10)
    chunks = split_markdown("# Long\n" + body, max_tokens=100)
    assert len(chunks) > 1
    assert all(c.token_estimate <= 100 for c in chunks)
    assert all(c.heading == "Long" for c in chunks)

def test_empty_document_has_no_chunks():
    assert split_markdown("   \n\n") == []
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_chunking.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `chunking.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 5 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: split Markdown into heading sections within a token limit"`

---

### Task 3: Embedders

**Files:**
- Create: `src/memory_engine/embeddings.py`
- Test: `tests/test_embeddings.py`

**Interfaces:**
- Produces:
  - `class EmbeddingError(RuntimeError)`.
  - `class Embedder(Protocol)`: `dims: int`; `embed(self, texts: list[str]) -> list[list[float]]`.
  - `normalize(vec: list[float]) -> list[float]`: L2-normalize; a zero vector becomes `[1.0, 0.0, …]`.
  - `FakeEmbedder(dims: int = 768)`: deterministic and similarity-preserving. The algorithm, which tests rely on: lowercase the text; for each character trigram, `h = blake2b(trigram, digest_size=8)` as an int, with index `h % dims` and sign `+1` if `(h >> 32) & 1` else `-1`; add the sign at that index; return `normalize(vec)`.
  - `OllamaEmbedder(url: str, model: str, dims: int, timeout: float = 30.0)`:
    - POSTs JSON `{"model": model, "input": texts}` to `{url}/api/embed` with `urllib.request` and reads `"embeddings"`.
    - Raises `EmbeddingError` if any vector's length ≠ `dims`, with message `f"{model} returned {n} dimensions, expected {dims}"`.
    - Raises `EmbeddingError` on any connection or HTTP error, with a message starting `f"Ollama not reachable at {url}"`.
    - Returns normalized vectors.

- [ ] **Step 1: Write the failing tests**

```python
def cos(a, b): return sum(x * y for x, y in zip(a, b))

def test_fake_is_deterministic_and_unit_length():
    e = FakeEmbedder(dims=64)
    a, b = e.embed(["Krebs cycle"])[0], e.embed(["Krebs cycle"])[0]
    assert a == b and abs(cos(a, a) - 1.0) < 1e-9 and len(a) == 64

def test_fake_keeps_similar_texts_closer():
    e = FakeEmbedder()
    q, near, far = e.embed(["citric acid cycle", "the citric acid cycle in cells", "tax law of 1820"])
    assert cos(q, near) > cos(q, far)

def test_ollama_parses_embeddings(stub_ollama):        # stub returns [[3.0, 4.0]]
    v = OllamaEmbedder(stub_ollama.url, "m", dims=2).embed(["x"])
    assert v == [pytest.approx([0.6, 0.8])]

def test_ollama_wrong_dims_raises(stub_ollama):
    with pytest.raises(EmbeddingError, match="returned 2 dimensions, expected 3"):
        OllamaEmbedder(stub_ollama.url, "m", dims=3).embed(["x"])

def test_ollama_unreachable_raises_quickly():
    with pytest.raises(EmbeddingError, match="Ollama not reachable"):
        OllamaEmbedder("http://127.0.0.1:9", "m", dims=2, timeout=2).embed(["x"])
```

`stub_ollama`: a fixture in this test file running `http.server.ThreadingHTTPServer` on `127.0.0.1:0`. It answers POST `/api/embed` with `{"embeddings": [[3.0, 4.0]]}`, exposes `.url`, and shuts down after the test.

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_embeddings.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `embeddings.py`** as specified; also add the `fake` fixture to `conftest.py`.
- [ ] **Step 4: Run, expect pass**: Expected: 5 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: embedder interface with Ollama and deterministic stand-in"`

---

### Task 4: Indexing Markdown documents

**Files:**
- Create: `src/memory_engine/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: `split_markdown`, `Chunk`, `estimate_tokens` (Task 2); `Embedder`, `normalize` (Task 3); schema (Task 1).
- Produces:
  - `content_hash(text: str) -> str`: sha256 hex.
  - `upsert_document(conn, path: str, kind: str, text: str) -> tuple[int, bool]`: returns `(id, changed)`. If `path` exists with the same `content_hash`, returns `(id, False)` and writes nothing; otherwise inserts or updates the row (keeping its id, `updated_at` UTC ISO-8601) and returns `(id, True)`. Reused by Task 5.
  - `index_markdown(conn, path: str, text: str, embedder: Embedder) -> int`: returns the document id.
    - If `upsert_document` reports no change, return the id without calling the embedder.
    - Otherwise, in the same transaction (`kind='markdown'`): delete the old `chunks_vec` rows for that document's chunk ids, then the old `chunks`; insert the new chunks; embed all chunks in one `embed()` call, each as `f"{heading}\n{text}"` when it has a heading, else `text`; insert each vector with `vec_quantize_int8(?, 'unit')`, passing `json.dumps(vector)`.
  - `replace_chunks(conn, document_id: int, chunks: list[Chunk], embedder: Embedder) -> None`: the shared delete-and-insert step, reused by Task 5.
  - `remove_document(conn, path: str) -> bool`: deletes that document's `chunks_vec` rows, then the `documents` row (cascades to chunks, FTS, symbols and references). Returns False if the path wasn't indexed.

- [ ] **Step 1: Write the failing tests**

```python
DOC = "# Krebs cycle\nRuns in the mitochondrial matrix.\n# Glycolysis\nSplits glucose in the cytoplasm."

def counts(conn):
    return tuple(conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("chunks", "chunks_vec"))

def test_index_creates_chunks_fts_and_vectors(conn, fake):
    index_markdown(conn, "notes/bio.md", DOC, fake)
    assert counts(conn) == (2, 2)
    hit = conn.execute("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH '\"mitochondri\"'").fetchall()
    assert len(hit) == 1

def test_unchanged_file_is_not_reembedded(conn, counting):
    index_markdown(conn, "notes/bio.md", DOC, counting)
    index_markdown(conn, "notes/bio.md", DOC, counting)
    assert counting.calls == 1

def test_changed_file_leaves_nothing_stale(conn, fake):           # Review Focus 1
    index_markdown(conn, "notes/bio.md", DOC, fake)
    index_markdown(conn, "notes/bio.md", "# Only\nPhotosynthesis.", fake)
    assert counts(conn) == (1, 1)
    assert conn.execute("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH '\"mitochondri\"'").fetchone()[0] == 0

def test_remove_document_removes_vectors_too(conn, fake):         # Review Focus 2
    index_markdown(conn, "notes/bio.md", DOC, fake)
    assert remove_document(conn, "notes/bio.md") is True
    assert counts(conn) == (0, 0)
    assert remove_document(conn, "notes/bio.md") is False
```

`counting`: a fixture in this file wrapping `FakeEmbedder` that counts `embed()` calls in `.calls`. No mocking library is needed.

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_store.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `store.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 4 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: index Markdown documents into chunks, FTS and int8 vectors"`

---

### Task 5: tree-sitter code graph

**Files:**
- Create: `src/memory_engine/codegraph.py`
- Test: `tests/test_codegraph.py`

**Interfaces:**
- Consumes: `upsert_document`, `replace_chunks` (Task 4); `Chunk`, `estimate_tokens` (Task 2).
- Produces:
  - `SymbolRow` (frozen dataclass): `id: int`, `path: str`, `name: str`, `kind: str`, `signature: str`, `start_line: int`, `end_line: int`.
  - `index_code(conn, path: str, source: str, embedder: Embedder) -> int`: only `.py` paths, otherwise `ValueError("unsupported file type: …")`. Skips unchanged content via `upsert_document` (`kind='code'`), like Task 4. In one transaction it deletes the old symbols and references, then inserts:
    - **Symbols:**
      - `class` for `class_definition`.
      - `method` for a `function_definition` whose parent `block` belongs to a `class_definition`, looking through a `decorated_definition` wrapper (`@property` methods sit one level deeper); its `parent_id` is that class's id.
      - `function` for every other `function_definition`.
      - `signature` is the source from the node's start to its `body` field's start, with trailing whitespace and the final `:` removed, e.g. `def m(self, x: int) -> int`.
      - Lines are 1-based.
    - **References:**
      - `kind='call'` for each `call` node: `to_name` is the callee text (`helper`, `os.path.join`), `from_symbol_id` is the innermost enclosing symbol (NULL at module level), `line` is 1-based.
      - `kind='import'` for each `import_statement` and `import_from_statement`, one row per imported module: `os` from `import os`, and `pathlib` for `from pathlib import Path`.
    - **Chunks:** one `Chunk` per symbol, with `heading=signature` and `text` = that symbol's source cut to 1600 characters (400 tokens, the Markdown chunk size), written through `replace_chunks`.
  - The tree-sitter query uses `Query(PY, …)` with `QueryCursor(query).captures(root)`, which returns a dict of capture name → nodes (tree-sitter 0.26 API).
  - `find_symbol(conn, name: str) -> list[SymbolRow]`.
  - `callers_of(conn, name: str) -> list[SymbolRow]`: symbols that have a `call` reference whose `to_name` equals `name` or ends with `"." + name`.
  - `callees_of(conn, symbol_id: int) -> list[str]`: `to_name` of that symbol's calls, in line order.

- [ ] **Step 1: Write the failing tests**

```python
SRC = """import os
from pathlib import Path

class A:
    def m(self, x: int) -> int:
        return helper(x)

def helper(y):
    os.path.join('a')
    return y
"""

def test_symbols_and_kinds(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    got = {(s.name, s.kind) for s in find_symbol(conn, "m") + find_symbol(conn, "A") + find_symbol(conn, "helper")}
    assert got == {("m", "method"), ("A", "class"), ("helper", "function")}

def test_signature_and_lines(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    m = find_symbol(conn, "m")[0]
    assert m.signature == "def m(self, x: int) -> int" and (m.start_line, m.end_line) == (5, 6)

def test_callers_and_callees(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    assert [s.name for s in callers_of(conn, "helper")] == ["m"]
    assert callees_of(conn, find_symbol(conn, "helper")[0].id) == ["os.path.join"]

def test_imports_recorded(conn, fake):
    index_code(conn, "pkg/a.py", SRC, fake)
    names = {r[0] for r in conn.execute("SELECT to_name FROM \"references\" WHERE kind='import'")}
    assert names == {"os", "pathlib"}

def test_syntax_error_still_indexes_valid_parts(conn, fake):      # Review Focus 5
    index_code(conn, "pkg/b.py", "def ok():\n    return 1\n\ndef broken(:\n", fake)
    assert [s.name for s in find_symbol(conn, "ok")] == ["ok"]

def test_decorated_method_is_a_method(conn, fake):
    index_code(conn, "pkg/d.py", "class B:\n    @property\n    def size(self):\n        return 1\n", fake)
    assert [(s.name, s.kind) for s in find_symbol(conn, "size")] == [("size", "method")]

def test_unsupported_file_type(conn, fake):
    with pytest.raises(ValueError, match="unsupported file type"):
        index_code(conn, "pkg/a.rs", "fn main() {}", fake)
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_codegraph.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `codegraph.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 7 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: tree-sitter code graph with symbols and references"`

---

### Task 6: Hybrid search with RRF and a token budget

**Files:**
- Create: `src/memory_engine/search.py`
- Test: `tests/test_search.py`

**Interfaces:**
- Consumes: the `chunks`, `chunks_fts` and `chunks_vec` tables; `Embedder`, `normalize`; `estimate_tokens`.
- Produces:
  - `SearchHit` (frozen dataclass): `chunk_id: int`, `path: str`, `heading: str | None`, `text: str`, `score: float`.
  - `fts_search(conn, query: str, limit: int = 20) -> list[int]`: chunk ids by `bm25` (best first). The match expression is the query's whitespace-separated words of 3+ characters, each double-quoted (internal `"` doubled), joined by ` OR `; returns `[]` when no word has 3+ characters.
  - `vector_search(conn, query: str, embedder: Embedder, limit: int = 20) -> list[int]`: chunk ids nearest first, via `embedding MATCH vec_quantize_int8(?, 'unit') AND k = ?`.
  - `rrf(rankings: list[list[int]], k: int = 60) -> list[tuple[int, float]]`: sorted by score desc, ties by first appearance.
  - `hybrid_search(conn, query: str, embedder: Embedder, limit: int = 5, max_tokens: int = 1800, regex: str | None = None) -> list[SearchHit]`:
    - Fuses `fts_search` and `vector_search` (each with `limit * 4`) via `rrf`.
    - Keeps only chunks whose text matches `regex` (`re.search`), if given; an invalid pattern raises `ValueError(f"invalid regex: {err}")`.
    - Takes hits in order until `limit` or until adding the next would exceed `max_tokens` (by `estimate_tokens(text)`).
    - If the first hit alone exceeds `max_tokens`, it is returned with `text` cut to `max_tokens * 4` characters.

- [ ] **Step 1: Write the failing tests**

```python
def seed(conn, fake):
    index_markdown(conn, "a.md", "# Krebs\nThe citric acid cycle runs in the mitochondrial matrix.", fake)
    index_markdown(conn, "b.md", "# Tax\nThe tax law of 1820 changed tariffs.", fake)
    index_code(conn, "c.py", "def parse_header(line):\n    return line.split(':')\n", fake)

def test_rrf_math():
    assert rrf([[1, 2], [1, 3]]) == [(1, 2 / 61), (2, 1 / 62), (3, 1 / 62)]

def test_keyword_hit(conn, fake):
    seed(conn, fake)
    assert hybrid_search(conn, "parse_header", fake)[0].path == "c.py"

def test_misspelled_query_found_by_vectors(conn, fake):
    seed(conn, fake)
    assert fts_search(conn, "mitokondrial matrx") == []
    assert hybrid_search(conn, "mitokondrial matrx", fake, limit=1)[0].path == "a.md"

def test_short_query_falls_back_to_vectors(conn, fake):             # Review Focus 3
    seed(conn, fake)
    assert fts_search(conn, "ab") == []
    assert len(hybrid_search(conn, "ab", fake)) > 0

def test_regex_filter(conn, fake):
    seed(conn, fake)
    hits = hybrid_search(conn, "the", fake, regex=r"\b18\d\d\b")
    assert [h.path for h in hits] == ["b.md"]

def test_invalid_regex(conn, fake):
    seed(conn, fake)
    with pytest.raises(ValueError, match="invalid regex"):
        hybrid_search(conn, "the", fake, regex="(")

def test_token_budget(conn, fake):
    index_markdown(conn, "big.md", "# Big\n" + "matrix " * 3000, fake)
    hits = hybrid_search(conn, "matrix", fake, max_tokens=200)
    assert sum(estimate_tokens(h.text) for h in hits) <= 200

def test_empty_index(conn, fake):
    assert hybrid_search(conn, "anything", fake) == []
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_search.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `search.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 8 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: hybrid FTS5 + sqlite-vec search with RRF, regex filter and token budget"`

---

### Task 7: Web cache and learned repairs

**Files:**
- Create: `src/memory_engine/web_cache.py`, `src/memory_engine/repairs.py`
- Test: `tests/test_web_cache.py`, `tests/test_repairs.py`

**Interfaces:**
- Produces:
  - `url_hash(url: str) -> str`: sha256 hex of the URL normalized with `urllib.parse`: scheme and host lowercased, the fragment dropped, and one trailing `/` dropped from the path.
  - `cache_get(conn, url: str) -> str | None` and `cache_put(conn, url: str, markdown: str) -> None` (upsert; `fetched_at` UTC ISO-8601).
  - `Repair` (frozen dataclass): `id: int`, `kind: str`, `error_trace: str`, `fix_diff: str`, `file_path: str | None`, `times_used: int`.
  - `record_repair(conn, kind: str, error_trace: str, fix_diff: str, file_path: str | None = None) -> int`. An invalid `kind` raises `sqlite3.IntegrityError` from the CHECK.
  - `find_repairs(conn, error_trace: str, limit: int = 3) -> list[Repair]`:
    - Searches `learned_repairs_fts` with the trace's words matching `[A-Za-z_][A-Za-z0-9_]{2,}`, deduplicated in first-appearance order. At most 32 words, each double-quoted, joined by ` OR `.
    - Ranks by `bm25` and returns `[]` when no words qualify.
  - `mark_used(conn, repair_id: int) -> None`: increments `times_used`.

- [ ] **Step 1: Write the failing tests**

```python
def test_url_normalization():
    assert url_hash("HTTPS://Docs.Python.org/3/library/#top") == url_hash("https://docs.python.org/3/library")

def test_cache_roundtrip_and_update(conn):
    assert cache_get(conn, "https://a.org/x") is None
    cache_put(conn, "https://a.org/x", "# One")
    cache_put(conn, "https://a.org/x/", "# Two")
    assert cache_get(conn, "https://a.org/x") == "# Two"

TRACE = 'File "app.py", line 12, in run\nKeyError: \'user_id\''

def test_find_similar_repair(conn):
    rid = record_repair(conn, "test", TRACE, "- d['user_id']\n+ d.get('user_id')", "app.py")
    record_repair(conn, "lint", "E501 line too long (120 > 100 characters)", "wrap line")
    hits = find_repairs(conn, 'File "app.py", line 40, in run\nKeyError: \'user_id\'')
    assert hits[0].id == rid

def test_unrelated_trace_finds_nothing(conn):
    record_repair(conn, "test", TRACE, "fix")
    assert find_repairs(conn, "ZeroDivisionError: division by zero") == []

def test_mark_used_and_bad_kind(conn):
    rid = record_repair(conn, "format", "missing yaml key: title", "add title")
    mark_used(conn, rid)
    assert find_repairs(conn, "missing yaml key: title")[0].times_used == 1
    with pytest.raises(sqlite3.IntegrityError):
        record_repair(conn, "magic", "x", "y")
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_web_cache.py tests/test_repairs.py -v`. Expected: FAIL (import errors).
- [ ] **Step 3: Implement `web_cache.py` and `repairs.py`** as specified.
- [ ] **Step 4: Run, expect pass**: Expected: 5 passed.
- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: web cache and learned repairs tables"`

---

### Task 8: Rebuild the index from files, and a CLI

**Files:**
- Create: `src/memory_engine/reindex.py`, `src/memory_engine/__main__.py`
- Test: `tests/test_reindex.py`

**Interfaces:**
- Consumes: `index_markdown`, `remove_document` (Task 4); `index_code` (Task 5); `hybrid_search` (Task 6); `Settings`, `connect`, `init_schema` (Task 1); `OllamaEmbedder` (Task 3).
- Produces:
  - `ReindexReport` (frozen dataclass): `indexed: int`, `unchanged: int`, `removed: int`.
  - `reindex_folder(conn, root: Path, embedder: Embedder) -> ReindexReport`:
    - Walks `*.md` and `*.py` under `root`. Paths are stored relative to `root` with `/`. Files are read as UTF-8; undecodable files are skipped.
    - Indexes changed and new files. Removes documents whose files no longer exist.
    - Skips `.venv`, `.git`, `__pycache__` and any directory starting with `.`.
  - `main(argv: list[str] | None = None, embedder: Embedder | None = None) -> int`:
    - argparse with global `--db PATH` (default `./memory.db`) and subcommands `reindex ROOT` and `search QUERY [--regex PATTERN] [--limit N]`.
    - `reindex` prints `indexed N, unchanged N, removed N`. `search` prints each hit as `path — heading` followed by the text.
    - Uses `OllamaEmbedder` from `Settings` unless `embedder` is passed. Returns the exit code.

- [ ] **Step 1: Write the failing tests**

```python
def test_reindex_syncs_with_files(tmp_path, conn, fake):
    (tmp_path / "a.md").write_text("# A\nMatrix notes.")
    (tmp_path / "b.py").write_text("def f():\n    return 1\n")
    (tmp_path / ".git").mkdir(); (tmp_path / ".git" / "x.md").write_text("ignored")
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=2, unchanged=0, removed=0)
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=0, unchanged=2, removed=0)
    (tmp_path / "a.md").unlink()
    assert reindex_folder(conn, tmp_path, fake) == ReindexReport(indexed=0, unchanged=1, removed=1)

def test_index_is_rebuildable_from_files(tmp_path, settings, fake):   # File-as-Truth
    (tmp_path / "a.md").write_text("# A\nThe citric acid cycle.")
    first = connect(settings); init_schema(first, settings); reindex_folder(first, tmp_path, fake); first.close()
    for f in tmp_path.glob("memory.db*"): f.unlink()      # db, -wal, -shm
    second = connect(settings); init_schema(second, settings); reindex_folder(second, tmp_path, fake)
    assert hybrid_search(second, "citric", fake)[0].path == "a.md"

def test_cli_reindex_and_search(tmp_path, fake, capsys):
    (tmp_path / "a.md").write_text("# Krebs\nThe citric acid cycle.")
    db = str(tmp_path / "m.db")
    assert main(["--db", db, "reindex", str(tmp_path)], embedder=fake) == 0
    assert "indexed 1, unchanged 0, removed 0" in capsys.readouterr().out
    assert main(["--db", db, "search", "citric"], embedder=fake) == 0
    assert "a.md" in capsys.readouterr().out
```

- [ ] **Step 2: Run, expect failure**: `.venv/bin/pytest tests/test_reindex.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement `reindex.py` and `__main__.py`** as specified.
- [ ] **Step 4: Run the whole suite**

Run: `.venv/bin/pytest -v`
Expected: 44 passed, 0 failed (Task 1: 7, Task 2: 5, Task 3: 5, Task 4: 4, Task 5: 7, Task 6: 8, Task 7: 5, Task 8: 3).

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat: rebuild the index from files and a reindex/search CLI"`

Phase 1 is complete when the whole suite passes. Phase 2 (the `INDEX.md` / `SCRATCHPAD.md` router) gets its own plan.
