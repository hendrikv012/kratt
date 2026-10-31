# 04 — Decisions

Why things are the way they are. Newest first. Any change to `02_Architecture.md` adds a row here.

| Date | Decision | Why |
|---|---|---|
| 2026-10-31 | One monorepo; `kratt-study` and `kratt-engine` (empty) abandoned | Solo dev + AI agents need one source of truth; split repos impose team-scale overhead (two PRs per cross-cutting ticket, versioned contracts); extracting the engine later is cheap, maintaining the split now is not |
| 2026-10-31 | Restructure: `claude/` planning set retired, replaced by `docs/` (00–04 + `logs/`); mascot SVGs to `design/`; template fix-spec to `docs/` | The old set predated the Lokus/OpenNB pivot, all tickets were `todo`, and the required `logs/` never existed — it described a project that no longer matched reality |
| 2026-10-31 | `kratt/` template left untouched; its fate deferred (T-03) | Owner decision; the template has no product code and its fix-spec is pending — nothing is blocked by keeping it |
| 2026-10-19 | BaseN → KRATT rename; real workspace moved to a local folder (`apps/study`, `engine/`, `docs/`, `scripts/`) | Recorded from the previous root CLAUDE.md |
| earlier | Lokus/OpenNB forks supersede the Obsidian/Logseq base idea; glue service FastAPI vs Express left open (B-01) | Final confirmation pending (A-01) |
