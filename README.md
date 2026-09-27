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

After you update Trip Planner, `npm start` brings the database up to date by itself, backing it
up first (see [Backups](#backups)).

## Add your API keys

The app works without them, but these free keys unlock its data sources. Put them in `.env`,
then restart the app. **Settings → Setup** shows which ones are active.

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

**Choose your flight** with **Choose** on a fare in **Cheapest options**, or on a cell of the
date grid. The trip's dates become the flight's: it starts on the departure date and ends on
the return date. While a flight is chosen, the trip's dates can only change by choosing
another flight or clearing it (**Clear** under **Your flight**). Each check looks at the chosen
dates first, so you can see whether that flight's price has gone up or down.

## Plan each day

A trip's **Itinerary** page shows a card per day: its city, and its first and last plans.
Open a day to plan it on a calendar:

- Drag across empty time to add something, drag a block to move it, or drag its bottom edge to
  change how long it takes. Click a block to edit it, move it to another day, or delete it.
- **Ideas** are things you might do, with no day yet. Drag one onto the calendar, or use its **+**.
- **Add activity** searches the day's destination: pick a category (restaurants, cafés, museums,
  landmarks, viewpoints, parks, beaches, nightlife, shopping) or type a name. A country or
  region is searched in full ("All of Costa Rica"); a city is searched within a distance you
  pick, in miles. To look around one town, move the map there and choose **Search this area**,
  or add the town as a destination. Results show on a map with their opening hours, website, a
  Wikipedia summary when there is one, and a link to Google Maps for reviews and photos. Or
  choose **Add your own**.
- Times are local to the destination, whatever time zone your phone or laptop is in. A late
  evening can end after midnight.
- If two of you change the same activity at once, the second change is refused with an
  explanation, and the latest version is shown so nothing is silently overwritten.

Places come from Geoapify (OpenStreetMap data). Each search costs one of your 3,000 free daily
credits, and results are kept for a week, so repeating a search is free.

## Save places to stay

A trip's **Lodging** page collects the places you're considering, from any site. There are
three ways to add one:

- **Bookmarklet (computers).** Open "Save listings from any site with one click" on the Lodging
  page and drag **Save to Trip Planner** to your bookmarks bar. On a listing you're viewing
  (Airbnb, Vrbo, Booking.com, or anywhere else), click it: Trip Planner opens with the name,
  photos, price, and rating the page shows, ready to check and save. It reads only the page you
  have open; the app never visits those sites itself.
- **Add a place (works on phones).** Paste the listing's link and its dates and number of guests
  fill in from the link. **Get title and photo** reads the page once, like a chat app's link
  preview. Many listing sites block that, so type in the price and anything else it missed.
- **Search rentals** lists priced vacation rentals for your dates from Google Hotels' partners
  (Airbnb listings may not appear), and **Add to list** saves one. Each new search uses one of
  the month's SerpApi searches, shared with flight price checks; repeating a search within
  12 hours is free.

Each card shows the total, the price per night, and the price per person in the trip's
currency (other currencies are converted with the latest European Central Bank rates). Star your favorites,
give each place a heart from either of you, and mark it **Shortlisted**, **Booked**, or
**Not for us**. Tick **Compare** on two to four places to see them side by side, with the lowest
price, the best rating, and the one closest to your planned activities marked, plus a map.

## Present the trip

**Present**, at the top of every trip page, opens the trip as full-screen slides built from what's
saved right now:

- a title slide, then one slide for each destination (summary, local time, money, and a map)
- one for each flight route: the cheapest fares and how the lowest price has moved
- your lodging shortlist (or every place you're still considering)
- one for each day with plans: its timeline and a map of the stops
- a closing summary

Sections with nothing in them are left out.

Use → or Space for the next slide and ← to go back, Home and End for the first and last, F for
full screen, G to see every slide, and Esc to leave. On a phone, swipe. The address ends in the
slide number (`/present#5`), so a reload keeps your place.

To print or save a PDF, use the printer button (or Ctrl+P) and choose **Save as PDF** as the
printer: each slide prints on its own 16:9 page, and maps print as a simple plot of the stops.

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

- Every run uses the Sonnet model (`claude -p --model sonnet`, with no fallback model), and Claude
  Code's background work, like reading the pages it opens, is set to Sonnet too. If Claude
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
- To stop it for now (to restore a backup, say): `Stop-ScheduledTask -TaskName 'Trip Planner'`

## Backups

While the app runs, it saves a copy of the whole database each night at 3:30. If the PC was off
then, the copy is made the next time the app starts. Copies go to `data\backups` (set `BACKUP_DIR`
in `.env` to use another folder, like one that syncs to the cloud), and the newest 14 are kept.
**Settings → Backups** shows the last one and has **Back up now**; `npm run backup` does the same
from a terminal.

Backups use `pg_dump`, which comes with PostgreSQL. Trip Planner finds it in
`C:\Program Files\PostgreSQL\<version>\bin`; if PostgreSQL is installed somewhere else, set
`PG_BIN_DIR` in `.env` to its `bin` folder.

To go back to a backup:

1. Stop Trip Planner: press Ctrl+C in the `npm start` window, or run
   `Stop-ScheduledTask -TaskName 'Trip Planner'` if it starts at sign-in.
2. Run `npm run restore` and type `restore` to confirm. This replaces everything in the database
   with the newest backup. To pick another, name it:
   `npm run restore -- data\backups\tripplanner-20260926-033000.dump`
3. Start Trip Planner again.

To check that a backup restores without touching your data, restore it into the test database
instead: `npm run restore -- --test-db`.

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
| `npm run test:e2e` | Browser smoke test (Playwright, in Edge): creates a trip, tracks a route, plans a day, saves a place to stay, and presents it. Runs on port 8011 against the test database, so it's safe while the app runs |
| `npm run lint` | ruff for Python; oxlint and the TypeScript compiler for the frontend |
| `npm run format` | Auto-format Python code |
| `npm run gen:api` | Regenerate the frontend's API types after changing backend routes or schemas |
| `uv run --project backend trip-planner --help` | Backend CLI: `serve`, `web`, `worker`, `setup-db`, `migrate`, `seed-airports`, `backup`, `restore`, `openapi` |
| `npm run autostart:install` / `autostart:remove` | Start the app at Windows sign-in, or stop doing so |
| `npm run agent:smoke` | One real Claude flight-agent run against a throwaway trip in the test database (uses your subscription once) |

## Project layout

```
backend/     FastAPI app, background worker, database models and migrations (Python 3.13, uv)
frontend/    React + TypeScript web app (Vite, Tailwind, shadcn/ui); e2e/ is the browser smoke test
scripts/     Setup and Windows helper scripts
data/        Runtime files: caches, logs, and backups (not committed)
```

## Troubleshooting

- **"uv is not installed or not on PATH"** — install uv (above), then open a new terminal.
- **Setup can't connect to PostgreSQL** — check the service is running with
  `Get-Service postgresql*`, and that you entered the superuser password chosen during install.
- **"npm.ps1 cannot be loaded because running scripts is disabled"** — allow local scripts for
  your user once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Port 8000 is already in use** — if Trip Planner starts at sign-in, it's already running:
  open http://localhost:8000, or stop it with `Stop-ScheduledTask -TaskName 'Trip Planner'`.
  Otherwise another program has the port; set a different `PORT` in `.env`.
- **The Setup checklist says the background worker isn't running** — start the app with
  `npm start` (not only the web server).
- **Agent runs fail with "Claude Code isn't signed in"** — run `claude` in a terminal, type
  `/login`, then choose **Check again** on the Agents page.
- **Agent runs fail with "The trip tools didn't start"** — the web server must be running on
  `PORT` for agents to save anything. Check the run folder's `stderr.log` for details.
- **The app doesn't start at sign-in** — open Task Scheduler, find **Trip Planner**, and check
  *Last Run Result*; the app's own messages are in `data\logs\trip-planner.log`.
- **Backups fail with "Couldn't find pg_dump"** — set `PG_BIN_DIR` in `.env` to PostgreSQL's
  `bin` folder (the one with `pg_dump.exe`), restart the app, and choose **Back up now** in
  Settings to check.
- **Restoring fails or waits** — stop Trip Planner first; the database can't be replaced while
  the app is using it.
- **A page says "Trip Planner was updated"** — the app was rebuilt while that tab was open.
  Reload the page.
- **Maps say they need WebGL** — turn on hardware acceleration in the browser (in Edge or
  Chrome: Settings → System → *Use graphics acceleration when available*), then reload. Places
  search, lists, and everything else work without it.
- **`npm run test:e2e` can't start Edge** — install Microsoft Edge, or run
  `npx playwright install chromium` in `frontend` and set `E2E_BROWSER_CHANNEL=chromium`.
