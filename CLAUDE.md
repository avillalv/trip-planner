# Trip Planner — notes for Claude Code

Personal, locally run trip planner for two people. Windows 11, PowerShell/Git Bash, no Docker.

## Layout
- `backend/` — Python 3.13 (uv). Package `tripplanner/`: FastAPI app (`main.py`), `api/` routers,
  `models/` (SQLAlchemy 2 typed), `schemas/` (Pydantic v2), `services/`, `providers/` (external APIs),
  `worker/` (background process), `migrations/` (Alembic), `cli.py` (`trip-planner ...`).
- `frontend/` — Vite + React 19 + TypeScript, Tailwind v4 + shadcn/ui (Radix), TanStack Query,
  React Router 7 (v8 needs Node ≥22.22). API types are generated into `src/lib/api/schema.d.ts`.
- `scripts/` — setup and Windows helper scripts. `data/` — runtime files (gitignored).

## Commands (repo root)
- `npm run setup` once; `npm start` runs web + worker at http://localhost:8000; `npm run dev` for hot reload (UI on :5173).
- `npm test` (pytest + vitest), `npm run lint` (ruff + oxlint + tsc), `npm run format`.
- `npm run gen:api` after changing any API route or schema — commit the regenerated types.
- Backend tests need the `tripplanner_test` database that setup creates.
- While the user's `npm start` is running, `uv sync` can't replace `backend/.venv/Scripts/trip-planner.exe`;
  use `uv run --no-sync` and `uv sync --no-install-project --inexact`, and check UI changes with
  `.claude/launch.json` → `app-testdb` (port 8010, test database) instead of touching their data.

## Rules
- Every schema change gets an Alembic migration in `backend/tripplanner/migrations/versions/`.
- Secrets live only in `.env` (gitignored); document new variables in `.env.example`.
- Agent routines (`claude -p`) must always run with `--model sonnet` and no fallback model.
  Agents never touch the database; they write only through the ingest API (`/api/agent/v1`),
  which requires the API key and a localhost client. The whole `claude` command line lives in
  `backend/tripplanner/worker/agents/runner.py`; agents reach the API through the stdio MCP
  bridge in `backend/tripplanner/agent_bridge/`. Pipeline tests use `backend/tests/fake_claude.py`,
  never the real CLI.
- Any subagent spawned while building this project must use the Sonnet model.
- Respect site terms: never fetch Airbnb/Vrbo/Booking pages automatically; no scraper libraries.
- UI copy: sentence case, plain verbs, errors say what happened and how to fix it.
- Design tokens live in `frontend/src/index.css` (passport theme: security-paper ground, navy ink,
  burgundy accent; guilloche linework is the signature — see `components/brand/`).
