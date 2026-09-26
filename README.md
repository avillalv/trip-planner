# Trip Planner

A personal, locally run web app for planning trips together: track flight prices over time,
plan each day on a calendar, shortlist places to stay, and walk through it all in a
full-screen presentation. Background research runs as Claude Code agent routines on your own
Claude subscription.

Everything runs on this PC: a Python (FastAPI) backend, a React frontend, and a local
PostgreSQL database. **Docker is not needed.**

## Requirements (Windows 11)

| Tool | Version | Install |
|---|---|---|
| PostgreSQL | 18 | `winget install --id PostgreSQL.PostgreSQL.18 -e --interactive` — choose a superuser password, keep port 5432, skip Stack Builder |
| uv (Python manager) | 0.12+ | `winget install --id astral-sh.uv -e` |
| Node.js | 22.12+ | `winget install --id OpenJS.NodeJS.LTS -e` |
| Git for Windows | recent | Includes Git Bash, which Claude Code needs on Windows |
| Claude Code | latest | `claude update` (only needed for agent routines) |

Open a new terminal after installing so the new commands are on your PATH.

## First-time setup

```powershell
npm run setup
```

This checks the prerequisites, creates `.env` from `.env.example` with generated secrets,
installs dependencies, creates the `tripplanner` database role plus the `tripplanner` and
`tripplanner_test` databases, applies migrations, loads airport data, and builds the web app.

You'll be asked once for the PostgreSQL superuser password you chose when installing
PostgreSQL. It is used only to create the app's own database login and is never stored.
Setup is safe to re-run.

## Run the app

```powershell
npm start
```

Then open http://localhost:8000. This runs the web server and the background worker together;
press Ctrl+C to stop both.

## Add your API keys

The app works without them, but these free keys unlock its data sources. Put them in `.env`,
then restart the app. The home page's **Setup** checklist shows which ones are active.

| Key | Used for | Where to get it |
|---|---|---|
| `GEOAPIFY_API_KEY` | Places search and destination lookup (3,000 free credits/day) | https://myprojects.geoapify.com → create a project |
| `SERPAPI_API_KEY` | Live Google Flights prices and vacation rentals (250 free searches/month) | https://serpapi.com/manage-api-key |
| `TRAVELPAYOUTS_TOKEN` | Cached Aviasales fare calendars (free) | https://www.travelpayouts.com → Profile → API token |
| `WIKIMEDIA_CONTACT` | Destination summaries and photos from Wikipedia (free, no key) | Your email address or a website URL; Wikipedia requires apps to identify a contact |

## How flight tracking works

Add a route on a trip's **Flights** page: up to four airports on each side, a departure
window, and either a trip length in nights or a return window. The first check starts right
away; after that, checks run on the trip's schedule (twice a day by default, changeable on
the same page). Every price found is kept, so the history chart and date grid show how fares
move.

- **Aviasales (Travelpayouts)** fares are free and cover whole months, but they're prices
  other travelers found in the last few days, per adult, economy only.
- **Google Flights (SerpApi)** prices are live. The free plan allows 250 searches a month;
  Trip Planner uses at most 240 and spreads them evenly over the days left in the month, so
  a search always goes where it's most useful: the current cheapest dates, then cheap cached
  fares, then dates nobody has checked yet.
- If the computer was off or asleep at a scheduled time, the missed check runs once when the
  app is back.

## Use it from phones and other computers on your Wi‑Fi

By default only this PC can open Trip Planner. To let other devices on your home network in:

1. In `.env`, set `HOST=0.0.0.0` and choose an `APP_PASSCODE`.
2. Allow the app through Windows Firewall on private networks. Run this once in PowerShell
   opened as Administrator (change the port if you changed `PORT`), and make sure your Wi‑Fi
   network is set to *Private* in Windows settings:

   ```powershell
   New-NetFirewallRule -DisplayName "Trip Planner (LAN)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Profile Private -Action Allow
   ```

3. Restart the app. **Settings → Other devices** lists the addresses to open on your phone.

Each device asks for the passcode once and then stays signed in for 30 days (changing the
passcode signs everyone out). This PC never asks. Traffic on your home network is plain HTTP,
so only enable this on a network you trust.

## Development

```powershell
npm run dev
```

Runs the API with auto-reload, the worker, and the Vite dev server. Open http://localhost:5173
(API calls are proxied to port 8000).

| Command | What it does |
|---|---|
| `npm test` | Backend tests (pytest, uses the `tripplanner_test` database) and frontend tests (Vitest) |
| `npm run lint` | ruff for Python; oxlint and the TypeScript compiler for the frontend |
| `npm run format` | Auto-format Python code |
| `npm run gen:api` | Regenerate the frontend's API types after changing backend routes or schemas |
| `uv run --project backend trip-planner --help` | Backend CLI: `serve`, `web`, `worker`, `setup-db`, `migrate`, `seed-airports`, `openapi` |

## Project layout

```
backend/     FastAPI app, background worker, database models and migrations (Python 3.13, uv)
frontend/    React + TypeScript web app (Vite, Tailwind, shadcn/ui)
scripts/     Setup and Windows helper scripts
data/        Runtime files: caches, logs, agent run folders (not committed)
```

## Troubleshooting

- **"uv is not installed or not on PATH"** — install uv (above), then open a new terminal.
- **Setup can't connect to PostgreSQL** — check the service is running with
  `Get-Service postgresql*`, and that you entered the superuser password chosen during install.
- **"npm.ps1 cannot be loaded because running scripts is disabled"** — allow local scripts for
  your user once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Port 8000 is already in use** — set a different `PORT` in `.env`.
- **The Setup checklist says the background worker isn't running** — start the app with
  `npm start` (not only the web server).
