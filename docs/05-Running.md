# 05 — Running the app (runbook)

Verified 2026-10-31 on Arch Linux. `scripts/start.py` (or `scripts/start.fish`) starts
everything, skips anything already running, and opens the browser at http://localhost:1420.

## What runs, in order

| Piece | What it is | Address |
|---|---|---|
| SurrealDB | Kratt's engine's database (`rocksdb:apps/notebook/surreal_data`) | 127.0.0.1:8000 |
| Kratt's engine | Open Notebook's API without its web UI (`apps/notebook`, uvicorn) | 127.0.0.1:5055 |
| Study folder service | `memory-engine serve` (`engine/`) — also starts Ollama when the AI runs locally | 127.0.0.1:5057 |
| Study app | Vite dev server (`apps/study`) | localhost:1420 |

All service logs land in `/tmp/kratt-logs/`.

## One-time setup

1. **System deps** (Arch): `sudo pacman -S ollama surrealdb uv` (node/npm assumed present).
   Fallbacks: `curl -sSf https://install.surrealdb.com | sh`, `curl -LsSf https://astral.sh/uv/install.sh | sh`.
2. **Ollama model**: `ollama list`. The app's Settings → AI names the model it calls; pull it
   (`ollama pull <model>`). The memory-engine is built around a small 8B model.
3. **Engine env**: `apps/notebook/.env` (gitignored — never pushed) must contain at least
   `SURREAL_USER`, `SURREAL_PASSWORD`, `KRATT_ENGINE_PASSWORD`. Copy from a previous
   workspace or create with arbitrary local values.
4. **Rebuild the venvs in place** (they hardcode paths and break when the folder is copied/moved):
```bash
cd apps/notebook && uv sync
cd ../../engine && uv sync
cd ../apps/study && npm install
```
(Note: from `engine/` the study app is at `../apps/study`.)

## Daily run

```bash
cd <repo root>
python3 scripts/start.py      # opens the browser; Ctrl+C stops what it started
```

## Gotchas seen on 2026-10-31

- **Copied venvs are broken venvs.** `uv sync` in `apps/notebook` and `engine/` re-pointed
  both from `Downloads/KRATT/...` to the repo. After any folder move: re-run `uv sync`.
- **`; and` is fish-only** — in bash use `&&`.
- **"Kratt's engine is already running"** means something already listens on :5055 — possibly a
  stale process from an old workspace copy, serving old code. Clean slate:
  `ss -tlnp | grep -E ':(8000|5055|5057|1420)'` and kill stale PIDs before relaunching.
- **npm install-scripts blocked esbuild's postinstall** (allowScripts policy). Vite still ran.
  If a production build later fails on esbuild: `npm install-scripts approve esbuild`.
- **npm audit reports 28 vulnerabilities** in the dev chain. Deliberately not auto-fixed
  (`npm audit fix --force` would churn deps mid-M1); triage is ticket T-04.
