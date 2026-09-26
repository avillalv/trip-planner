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

## Agent routines (Claude)

On the **Agents** page, **New routine** sets up work for Claude to do on a schedule:

- **Flight search** looks for fares the price APIs miss, like budget airlines, airline sales, and
  deal posts, and saves each price with a link to the page that showed it.
- **Research** looks into a topic you choose (events during your dates, places that need
  reservations, and so on) and saves notes with their sources. They appear on the trip's
  overview under **Found by agents**.

Each run's page shows a live log, what it saved, anything that was rejected and why, and the
exact task and command Claude was given. **Stop run** ends a run early; anything saved so far
is kept.

**Sign Claude Code in once.** Runs use your Claude subscription through Claude Code on this PC.
Open a terminal, run `claude`, and type `/login`. The Agents page shows whether Claude Code is
signed in, and runs stop right away with instructions if it isn't.

How runs are kept safe and predictable:

- Every run uses the Sonnet model (`claude -p --model sonnet`, with no fallback model). If Claude
  reports a different model, the app stops the run.
- Claude gets only web search, web page fetching, and five trip tools. There's no shell and no
  file access, your own Claude Code settings, hooks, and skills aren't used, and it never opens
  Airbnb, Vrbo, or Booking.com pages.
- Agents never write to the database. The trip tools send everything to the app's ingest API,
  which only accepts calls from this PC with `AGENT_INGEST_API_KEY` and checks every item: the
  route, airports, dates, a public source link, a believable price, and the currency. Prices
  from agents are marked *indicative*: seen on the linked page, but not live-checked.
- Runs stop after 40 turns or 20 minutes for flight searches (30 turns or 15 minutes for
  research) unless you change the limits, and only one agent runs at a time.
- Each run counts toward your Claude plan's usage limits. The run page shows the tokens it used
  and what it would have cost at API prices.

Run folders (the prompt, Claude's raw output, and its error log) are kept in
`%LOCALAPPDATA%\TripPlanner\agent-runs`, outside this repo so agents never see project files.

To try the ingest API yourself (it only answers on this PC):

```powershell
$key = (Select-String -Path .env -Pattern '^AGENT_INGEST_API_KEY=(.+)$').Matches[0].Groups[1].Value
curl.exe -H "Authorization: Bearer $key" "http://127.0.0.1:8000/api/agent/v1/airports?q=tokyo"
```

Writes only work for a run that's in progress. The full API reference is at
http://localhost:8000/api/docs.

## Start automatically when you sign in

```powershell
npm run autostart:install
```

This adds a Task Scheduler task named **Trip Planner** that starts the app with no window 30
seconds after you sign in to Windows. It runs as you, without admin rights, and writes its log
to `data\logs\trip-planner.log`. If Windows says access is denied, run the command once from
PowerShell opened as administrator.

- Start it now without signing out: `Start-ScheduledTask -TaskName 'Trip Planner'`
- Don't also run `npm start`; both use port 8000.
- Routines that were due while the PC was off or asleep run once after it starts.
- To undo: `npm run autostart:remove` (this also stops the running copy).

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
| `npm run autostart:install` / `autostart:remove` | Start the app at Windows sign-in, or stop doing so |
| `npm run agent:smoke` | One real Claude flight-agent run against a throwaway trip in the test database (uses your subscription once) |

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
- **Agent runs fail with "Claude Code isn't signed in"** — run `claude` in a terminal, type
  `/login`, then choose **Check again** on the Agents page.
- **Agent runs fail with "The trip tools didn't start"** — the web server must be running on
  `PORT` for agents to save anything. Check the run folder's `stderr.log` for details.
- **The app doesn't start at sign-in** — open Task Scheduler, find **Trip Planner**, and check
  *Last Run Result*; the app's own messages are in `data\logs\trip-planner.log`.
