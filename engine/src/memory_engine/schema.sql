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
CREATE INDEX IF NOT EXISTS symbols_document ON symbols(document_id);
CREATE INDEX IF NOT EXISTS symbols_parent ON symbols(parent_id);
CREATE TABLE IF NOT EXISTS "references" (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  from_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  to_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('call', 'import')),
  line INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS references_to ON "references"(to_name);
CREATE INDEX IF NOT EXISTS references_document ON "references"(document_id);
CREATE INDEX IF NOT EXISTS references_from ON "references"(from_symbol_id);
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
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
