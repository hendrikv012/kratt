"""The run log: one JSON object per line of everything a run sent, got back, searched and checked."""

import json
import sys
from pathlib import Path

from memory_engine.doctor import Promotion
from memory_engine.search import SearchHit


class RunLog:
    """Appends events to `path`; `RunLog(None)` does nothing.

    A log that cannot be written warns once on stderr and stops writing, so it never ends a run.
    """

    def __init__(self, path: Path | None):
        self._path = Path(path) if path is not None else None

    def model(self, step: int | None, messages: list[dict], reply: dict | str) -> None:
        self._write({"event": "model", "step": step, "messages": messages, "reply": reply})

    def search(self, step: int | None, query: str, hits: list[SearchHit]) -> None:
        self._write({"event": "search", "step": step, "query": query,
                     "hits": [{"source": h.source, "path": h.path, "heading": h.heading, "text": h.text} for h in hits]})

    def fix(self, step: int | None, target: str, messages: list[dict], reply: dict | str, problem: str) -> None:
        """One Doctor fix: its prompt, the reply (or the error text) and why it failed ("" when applied)."""
        self._write({"event": "fix", "step": step, "target": target, "messages": messages, "reply": reply,
                     "problem": problem})

    def doctor(self, promotion: Promotion) -> None:
        self._write({"event": "doctor", "target": promotion.target, "ok": promotion.ok,
                     "fixes": promotion.fixes, "message": promotion.message,
                     "blocked": promotion.blocked})

    def _write(self, event: dict) -> None:
        if self._path is None:
            return
        try:
            with self._path.open("a", encoding="utf-8") as out:
                out.write(json.dumps(event, ensure_ascii=False) + "\n")
        except (OSError, TypeError, ValueError) as err:
            print(f"warning: run log not written: {err}", file=sys.stderr)
            self._path = None
