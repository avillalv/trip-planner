# Removes the sign-in task that autostart-install.ps1 added, and stops the copy it started.
# Run it yourself from the repo folder:  npm run autostart:remove
$ErrorActionPreference = 'Stop'

$taskName = 'Trip Planner'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "There's no '$taskName' task, so nothing to remove."
    exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo 'backend\.venv\Scripts\trip-planner.exe'
if ($task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
    # Stopping the task ends its launcher; also stop the app it started (web and worker exit with it).
    Get-CimInstance Win32_Process -Filter "Name = 'trip-planner.exe'" |
        Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '\bserve\b' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed the '$taskName' task. Trip Planner no longer starts when you sign in."
