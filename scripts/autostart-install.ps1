# Adds a Task Scheduler task that starts Trip Planner, with no window, when you sign in to Windows.
# Run it yourself from the repo folder:  npm run autostart:install   (undo: npm run autostart:remove)
# The task runs as you, without admin rights, and only while you're signed in.
$ErrorActionPreference = 'Stop'

$taskName = 'Trip Planner'
$repo = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-hidden.ps1'
$exe = Join-Path $repo 'backend\.venv\Scripts\trip-planner.exe'
if (-not (Test-Path $exe)) {
    Write-Host "Run 'npm run setup' first: $exe is missing." -ForegroundColor Red
    exit 1
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# conhost --headless runs PowerShell without flashing a console window.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$arguments = "--headless `"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$runner`""

$action = New-ScheduledTaskAction -Execute $conhost -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# Give the PostgreSQL service a moment to start after sign-in.
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -Principal $principal -Force `
        -Description 'Starts Trip Planner (web app and background worker) when you sign in.' | Out-Null
} catch {
    Write-Host "Windows didn't allow creating the task: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Open PowerShell as administrator in this folder and run: npm run autostart:install'
    Write-Host '(The task itself still runs as you, without admin rights.)'
    exit 1
}

Write-Host "Added the '$taskName' task. Trip Planner now starts when you sign in."
Write-Host "Logs: $(Join-Path $repo 'data\logs\trip-planner.log')"
Write-Host "To start it now without signing out: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "If 'npm start' is already running in a terminal, stop it first; both use port 8000."
