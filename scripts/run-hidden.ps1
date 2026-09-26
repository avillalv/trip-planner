# Starts Trip Planner (web app and background worker) with no window, logging to data\logs.
# The sign-in task from autostart-install.ps1 runs this; you can also run it by hand.
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo 'backend\.venv\Scripts\trip-planner.exe'
$logDir = Join-Path $repo 'data\logs'
$log = Join-Path $logDir 'trip-planner.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
# Start a fresh log once the current one passes 5 MB, keeping one old copy.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
    Move-Item -Force $log "$log.1"
}

if (-not (Test-Path $exe)) {
    "$(Get-Date -Format s) Can't start: $exe is missing. Run 'npm run setup' in $repo." |
        Out-File -Append -Encoding utf8 $log
    exit 1
}

Set-Location $repo
$env:PYTHONUNBUFFERED = '1'
"$(Get-Date -Format s) Starting Trip Planner" | Out-File -Append -Encoding utf8 $log
# cmd handles the redirection so Python's output lands in the log as plain text.
& cmd.exe /d /c "`"$exe`" serve >> `"$log`" 2>&1"
"$(Get-Date -Format s) Trip Planner stopped (exit code $LASTEXITCODE)" | Out-File -Append -Encoding utf8 $log
