# CLAUDE.md

Kratt (formerly BaseN) — a study app that helps students genuinely learn instead of letting AI do the work for them. This repository is the monorepo root: planning docs, design assets, and (once ticket T-01 lands) the real code.

## Read first

1. `docs/00_README.md` — agent rules. Every agent session starts there.
2. `docs/04_Decisions.md` — why things are the way they are.
3. Current status: newest file in `docs/logs/`.

## Layout

- `apps/study/` — the study app, web + Tauri desktop *(lands via ticket T-01)*
- `engine/` — memory-engine and kratt-service *(lands via ticket T-01)*
- `scripts/` *(lands via ticket T-01)*
- `docs/` — agent rules, roadmap, architecture, backlog, decisions, daily logs
- `design/` — Kratt mascot art (pixel sprite; animation states: idle blink, thinking, hop, asleep)
- `.ember-preview/` — Ember redesign boards (`*.dc.html`, v1–v5, laid out by `canvas.json`). Reference only.
- `kratt/` — stock shadcn/ui Next.js template with no product code. Fate undecided: ticket T-03.
- `kratt-study`, `kratt-engine` (separate GitHub repos) — empty, abandoned in favour of the monorepo (decision 2026-10-31). Safe to archive or delete.

## Repo conventions

- Docs are the source of truth; code follows them, and they are updated when reality changes.
- One ticket at a time from `docs/03_Backlog.md`; update its status there.
- Architecture changes need a reason in `docs/04_Decisions.md` plus an entry in `docs/logs/YYYY-MM-DD.md`.

## kratt/ template notes (unchanged by the 2026-10-31 restructure)

Run all commands from `kratt/`:

```bash
npm run dev         # next dev (Turbopack)
npm run build       # production build, also type-checks
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (flat config, next core-web-vitals + typescript)
npm run format      # prettier --write on ts/tsx
npx shadcn@latest add <component>   # adds into components/ui
```

The template has no test runner.

Stack notes that differ from the usual defaults:
- **Next.js 16.3 / React 19.3.** `kratt/AGENTS.md` says APIs differ from training data. Before writing Next code, read the matching guide in `kratt/node_modules/next/dist/docs/`. `next dev` regenerates the AGENTS.md block.
- **shadcn style `base-nova` on `@base-ui/react`, not Radix.** Components wrap Base UI primitives such as `@base-ui/react/button`.
- **`cn` comes from the `cn` npm package** (shadcn's compiled replacement for clsx + tailwind-merge). `lib/utils.ts` only re-exports it.
- **Tailwind v4 with CSS-only config.** Theme tokens live in `app/globals.css` (`@theme inline`, `.dark` custom variant). There is no `tailwind.config`.
- Theming uses `next-themes` with the class strategy. `components/theme-provider.tsx` toggles dark mode when you press `d` outside text inputs.
- Prettier settings: no semicolons, double quotes, `es5` trailing commas, and the tailwind plugin sorts classes inside `cn`/`cva`.
