# Trip Planner — notes for Claude Code

Personal, locally run trip planner for two people. Windows 11, PowerShell/Git Bash, no Docker.
Backend is Python 3.13 (uv) in `backend/`; frontend is Vite + React 19 in `frontend/`.

## Commands (repo root)
- `npm run setup` once; `npm start` runs web + worker at http://localhost:8000; `npm run dev` for hot reload (UI on :5173).
- `npm test` (pytest + vitest), `npm run lint` (ruff + oxlint + tsc), `npm run format`.
- `npm run test:e2e`: Playwright smoke test in Edge on port 8011; it resets the test database
  (`backend/tests/e2e_seed.py`) and never touches the real one. Pytest and this both wipe
  `tripplanner_test`, so reseed before checking the UI on `app-testdb` afterwards.
- `npm run gen:api` after changing any API route or schema — commit the regenerated types
  (`frontend/src/lib/api/schema.d.ts`).
- Backend tests need the `tripplanner_test` database that setup creates.
- While the user's `npm start` is running, `uv sync` can't replace `backend/.venv/Scripts/trip-planner.exe`;
  use `uv run --no-sync` and `uv sync --no-install-project --inexact`, and check UI changes with
  `.claude/launch.json` → `app-testdb` (port 8010, test database) instead of touching their data.

## Rules
- Secrets live only in `.env` (gitignored); document new variables in `.env.example`.
- Any subagent spawned while building this project must use the Sonnet model.
- Respect site terms: never fetch Airbnb/Vrbo/Booking pages automatically; no scraper libraries.

## Where knowledge lives
- Read `.claude/rules/database-migrations.md` before any change to models or migrations.
- Read `.claude/rules/agent-routines.md` before touching the worker, agent bridge, agent/runs API,
  or agent tests.
- Read `.claude/rules/frontend.md` before changing UI copy, styling, or frontend dependencies.
- Topic index for everything else: `knowledge/INDEX.md`.

## Context layout

This project uses a three-tier layout. Do not add knowledge to this file on
your own initiative. If something seems worth keeping, say so in one line and
let me decide.

- Conditional knowledge lives in `.claude/rules/` with `paths` frontmatter.
- Reference and procedures live in `knowledge/` and `.claude/skills/`.
- A procedure that repeats gets captured into `.claude/skills/`. Tell me in one
  line after you create it; do not add it here.
- This file is capped at 200 lines.

To reorganize any of it, run `/context-init`.
