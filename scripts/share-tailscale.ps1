# Shares Trip Planner privately through Tailscale: devices in your Tailscale network, and people you
# share this PC with, can open it from anywhere. Nobody else on the internet can reach it.
# Run it yourself from the repo folder after installing Tailscale and signing in:  npm run share
# Stop sharing:  tailscale serve --https=443 off
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo '.env'
$taskName = 'Trip Planner'

if (-not (Test-Path $envFile)) {
    Write-Host "There's no .env yet. Run 'npm run setup' first." -ForegroundColor Red
    exit 1
}

$tailscale = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $tailscale) {
    $installed = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path $installed) { $tailscale = $installed }
}
if (-not $tailscale) {
    Write-Host "Tailscale isn't installed. Get it from https://tailscale.com/download, sign in, then run 'npm run share' again." -ForegroundColor Red
    exit 1
}

try {
    $status = (& $tailscale status --json 2>$null | Out-String) | ConvertFrom-Json
} catch {
    $status = $null
}
if (-not $status -or $status.BackendState -ne 'Running') {
    Write-Host "Tailscale isn't connected. Open Tailscale from the Start menu, sign in, then run 'npm run share' again." -ForegroundColor Red
    exit 1
}
$name = $status.Self.DNSName.TrimEnd('.').ToLower()

$raw = [System.IO.File]::ReadAllText($envFile)
$newline = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = [System.Collections.Generic.List[string]]($raw -split "\r?\n")
if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }

$port = 8000
$passcode = ''
foreach ($line in $lines) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') { $port = [int]$Matches[1] }
    if ($line -match '^\s*APP_PASSCODE\s*=\s*(.*)$') { $passcode = $Matches[1].Trim() }
}
if (-not $passcode) {
    Write-Host "Set APP_PASSCODE in .env first (anything you'll both remember); other devices sign in with it." -ForegroundColor Red
    exit 1
}

# HTTPS on this PC's Tailscale name, passed on to the app. The app stays on 127.0.0.1, so your
# Wi-Fi can't reach it, and no firewall rule is needed. --bg keeps it on across restarts.
& $tailscale serve --bg --https=443 "http://127.0.0.1:$port"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tailscale couldn't start sharing (see its message above). If it says access is denied, run 'npm run share' in PowerShell opened as administrator." -ForegroundColor Red
    exit 1
}

# The app only answers to host names it knows, so add this PC's Tailscale name to ALLOWED_HOSTS.
$changed = $false
$index = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*ALLOWED_HOSTS\s*=') { $index = $i }
}
if ($index -ge 0) {
    $hosts = @(($lines[$index] -replace '^\s*ALLOWED_HOSTS\s*=', '').Split(',') | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
    if ($hosts -notcontains $name) {
        $lines[$index] = 'ALLOWED_HOSTS=' + (($hosts + $name) -join ',')
        $changed = $true
    }
} else {
    $lines.Add("ALLOWED_HOSTS=$name")
    $changed = $true
}
if ($changed) {
    [System.IO.File]::WriteAllText($envFile, ($lines -join $newline) + $newline, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Added $name to ALLOWED_HOSTS in .env."

    # Settings are read at startup, so restart the app for the new name to work.
    $exe = Join-Path $repo 'backend\.venv\Scripts\trip-planner.exe'
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'trip-planner.exe'" |
        Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '\bserve\b' })
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Write-Host 'Restarting Trip Planner...'
        Stop-ScheduledTask -TaskName $taskName
        $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
        }
        Start-ScheduledTask -TaskName $taskName
    } elseif ($running.Count -gt 0) {
        Write-Host "Restart Trip Planner (Ctrl+C in its window, then 'npm start') so it answers at the new address." -ForegroundColor Yellow
    }
}

$machine = $name.Split('.')[0]
Write-Host ''
Write-Host "Trip Planner is shared privately at:  https://$name" -ForegroundColor Green
Write-Host ''
Write-Host 'To let your partner in:'
Write-Host "  1. Open https://login.tailscale.com/admin/machines, open the menu for $machine, choose Share, and send them the invite link."
Write-Host '  2. They install Tailscale (https://tailscale.com/download), sign in with their own account, and accept the invite.'
Write-Host "  3. They open https://$name and enter the passcode once."
Write-Host 'Your own phone or laptop: install Tailscale and sign in with your account, then open the same link.'
Write-Host 'To stop sharing: tailscale serve --https=443 off'
