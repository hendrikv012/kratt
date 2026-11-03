# Repository Guidelines

## Project Structure & Module Organization

Kratt is a local-first study application. The monorepo contains:
- `apps/study/src/views/studyhome/`: React study workspace; shared editor code lives in `apps/study/src/editor/`.
- `engine/src/memory_engine/`: Python storage, search, AI integration, and Study folder service; tests live in `engine/tests/`.
- `apps/desktop/`, `apps/notebook/`, and `apps/study-ollama/`: supporting applications and forks; consult their local documentation before editing.
- `docs/`: roadmap, architecture, backlog, decisions, and daily logs. `design/` contains mascot assets; `.ember-preview/` contains design references.
- `kratt/`: unused Next.js starter, separate from the working study app.

## Build, Test, and Development Commands

Run commands from the indicated directory; there is no root package script.

From `apps/study/`:
- `npm ci`: install locked dependencies.
- `npm run dev`: start Vite at `http://localhost:1420`.
- `npm run build`: build production assets into `dist/`.
- `npm test`: run Vitest.
- `npx vitest run src/views/studyhome/chats/ChatPanel.test.jsx`: run one test file.

From `engine/`:
- `python3 -m venv .venv` and `.venv/bin/pip install -e '.[dev]'`: prepare Python 3.12+.
- `.venv/bin/memory-engine serve`: start the Study folder service on port 5057.
- `.venv/bin/pytest`: run backend tests without Ollama.

## Coding Style & Naming Conventions

Match surrounding files: study JavaScript/JSX uses two-space indentation, double quotes, and semicolons; Python uses four spaces and snake_case. Use PascalCase for React component filenames and `use` prefixes for hooks. Keep dependencies pinned. The study app has no configured lint/format script; the separate Next.js starter has ESLint and Prettier. Ruff and mypy are engine dependencies used by its generated-code checks.

## Testing Guidelines

Frontend tests use Vitest, jsdom, and Testing Library; colocate `*.test.js` or `*.test.jsx` with features. Backend tests use pytest and `test_*.py`. Cover changed behavior and regressions. No coverage percentage is configured in these test configurations. Real-model smoke tests require Ollama and installed models.

## Commit & Pull Request Guidelines

History uses imperative summaries, optional `docs:`/`chore:` prefixes, and ticket prefixes such as `T-01:`. Keep commits focused. PRs should explain behavior, reference tickets/issues, list validation, and include screenshots for UI changes. Identify breaking changes.

## Contributor Workflow & Configuration

Read `docs/00_README.md`, architecture, and the relevant backlog ticket. Update ticket status and daily logs; record architecture decisions. Verify outdated documentation against code. Preserve port 1420 for service origin checks. Never commit credentials, personal Study files, virtual environments, or generated databases.
