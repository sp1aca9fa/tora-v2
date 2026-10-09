#!/usr/bin/env bash
# Registers a Windows Task Scheduler task that runs scripts/collect-cron.sh in this WSL distro:
#   - 5 minutes after you log on to Windows
#   - daily at 12:00, and as soon as possible if the PC was off then
# collect-cron.sh itself runs at most once per day, so extra triggers are harmless.
# Re-run to update; remove with: powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${WSL_DISTRO_NAME:?run this from inside WSL}"
SCRIPT="$REPO_DIR/scripts/collect-cron.sh"
chmod +x "$SCRIPT"

powershell.exe -NoProfile -Command "
\$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d $DISTRO -- bash -lc \"$SCRIPT\"'
\$logon = New-ScheduledTaskTrigger -AtLogOn -User \$env:USERNAME
\$logon.Delay = 'PT5M'
\$daily = New-ScheduledTaskTrigger -Daily -At 12:00
\$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
\$principal = New-ScheduledTaskPrincipal -UserId \$env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'tora-collect' -Description 'Tora price collectors (WSL), once per day' -Action \$action -Trigger \$logon,\$daily -Settings \$settings -Principal \$principal -Force | Out-Null
Get-ScheduledTask -TaskName 'tora-collect' | Select-Object TaskName,State | Format-Table -HideTableHeaders
"
