---
name: restart-live-app
description: Rebuild frontend/dist and restart the user's live Trip Planner (the "Trip Planner" Windows sign-in task on port 8000) without breaking it. Use after changing code the running app should pick up, or when the user asks to restart the app or the build.
---

# Restart the live app

The user's app runs from this checkout through the Task Scheduler task **Trip Planner**
(`scripts/autostart-install.ps1` → `scripts/run-hidden.ps1` → `trip-planner.exe serve` → web + worker).
It serves `frontend/dist` straight from disk.

- **Frontend-only change**: `npm run build` is enough; the app serves the new files at once. No restart.
- **Backend change**: build, then restart (steps below). Startup also backs up the DB and applies pending migrations.
- `npm run test:e2e` rebuilds `frontend/dist` too, so the live UI changes as soon as it runs.

## Steps (PowerShell, repo root)

1. Make sure no run is in progress; if one is queued or running, wait:
   ```powershell
   (Invoke-WebRequest 'http://localhost:8000/api/v1/runs?limit=5' -UseBasicParsing).Content | ConvertFrom-Json |
     Select-Object kind, trigger, status, queued_at
   ```
2. `npm run build`
3. Stop the task **and** the app. `Stop-ScheduledTask` only ends the launcher, and the task can read "Ready"
   while an instance started by `run-hidden.ps1` is still serving. Same as `scripts/autostart-remove.ps1`:
   ```powershell
   $exe = "$PWD\backend\.venv\Scripts\trip-planner.exe"
   Stop-ScheduledTask -TaskName 'Trip Planner'
   Get-CimInstance Win32_Process -Filter "Name = 'trip-planner.exe'" |
     Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '\bserve\b' } |
     ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
   ```
   Then wait until port 8000 stops listening (`Get-NetTCPConnection -LocalPort 8000 -State Listen`) and no
   `python.exe … tripplanner.cli web|worker` without `--test-db` is left. Web and worker exit by themselves
   and log `Supervisor (pid N) is gone; exiting.`; that's expected. Never touch the `--test-db` preview.
4. `Start-ScheduledTask -TaskName 'Trip Planner'`
5. Verify:
   - `(Get-ScheduledTask -TaskName 'Trip Planner').State` is `Running`
   - `http://localhost:8000/api/health` answers 200 (allow up to ~60 s)
   - `data\logs\trip-planner.log` gains a new `Starting Trip Planner` and `Uvicorn running`
   - the latest run from step 1 is unchanged. At startup the worker queues a `catch_up` run for any routine
     whose latest scheduled slot has no run since, and that spends SerpApi searches. Restarting between
     slots queues nothing.

## Don't

- Don't `uv sync` while the app runs: it can't replace the locked `trip-planner.exe`. Use `uv run --no-sync`.
- Don't click Choose or Hide on the live page to check a change. Use the `app-testdb` preview (port 8010)
  for anything that writes.
