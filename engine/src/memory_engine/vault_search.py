"""Rebuildable local full-text index. Markdown remains authoritative, including external edits."""
import re
import sqlite3
import threading
from pathlib import Path
from memory_engine.vault import Vault


class VaultSearch:
    def __init__(self, vault: Vault):
        self.vault = vault
        self.lock = threading.Lock()
        folder = vault.root / ".study"
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "search.sqlite3"
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(path UNINDEXED, body)")
        self.seen = {}

    def refresh(self):
        with self.lock, sqlite3.connect(self.path) as db:
            seen = {}
            for folder, _, files in self.vault.walk():
                for name in files:
                    if Path(name).suffix.lower() not in {".md", ".txt"}:
                        continue
                    relative = (folder / name).relative_to(self.vault.root).as_posix()
                    try:
                        file = self.vault.resolve(relative)  # refuse symlinks outside the vault
                        stat = file.stat()
                        stamp = (stat.st_mtime_ns, stat.st_size)
                        seen[relative] = stamp
                        if self.seen.get(relative) == stamp:
                            continue
                        text = file.read_text(encoding="utf-8")
                    except (OSError, ValueError):
                        continue
                    db.execute("DELETE FROM notes WHERE path = ?", (relative,))
                    db.execute("INSERT INTO notes(path, body) VALUES (?, ?)", (relative, text))
            for (path,) in db.execute("SELECT path FROM notes").fetchall():
                if path not in seen:
                    db.execute("DELETE FROM notes WHERE path = ?", (path,))
            self.seen = seen

    def search(self, query: str, limit: int = 10) -> list[dict]:
        words = re.findall(r"\w+", query, re.UNICODE)[:32]
        if not words:
            return []
        self.refresh()
        expression = " OR ".join('"' + word + '"' for word in words)
        with self.lock, sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT path, snippet(notes, 1, '', '', ' … ', 48) FROM notes "
                              "WHERE notes MATCH ? ORDER BY rank LIMIT ?", (expression, max(1, min(limit, 50))))
            return [{"path": path, "text": text} for path, text in rows]
