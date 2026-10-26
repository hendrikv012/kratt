# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this folder is (read first)

`~/Kratt` (this folder) is **not** the live Kratt codebase. Don't confuse it with `~/Downloads/KRATT`. The project was renamed BaseN → KRATT and restructured on 2026-10-19. The real workspace is `~/Downloads/KRATT` (`apps/study`, `engine/`, `docs/`, `scripts/`), which has its own CLAUDE.md. Do study app work there.

This folder holds:
- `kratt/`: a stock shadcn/ui Next.js template (its own git repo, one commit, no remote). It contains no product code yet.
- `claude/`: the original planning set (agent rules, roadmap M1–M5, architecture, backlog). It predates the Lokus/Open Notebook/`apps/study` work. Every backlog ticket is still `todo`, and the `logs/` folder that `00_README.md` requires does not exist. Use it for product intent (mastery map, append-only `score_events`, time-decayed mastery, local-first via Ollama). Do not use it for current status.
- `kratt_four_colors_dark_and_light.svg`, `kratt_animated.svg`: source art for the Kratt mascot (pixel sprite; animation states are idle blink, thinking, hop and asleep). `apps/study` uses them.
- `.ember-preview/project/`: the Ember redesign design boards (`*.dc.html`, versions v1–v5, laid out by `canvas.json`). They are reference only.

Current status lives in the Obsidian note `~/Documents/Dev/Kratt/Kratt.md` under "Now".

## kratt template

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
