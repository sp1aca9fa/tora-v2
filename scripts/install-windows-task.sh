#!/usr/bin/env bash
# Registers a Windows Task Scheduler task that runs scripts/collect-cron.sh in this WSL distro:
#   - 5 minutes after you log on to Windows
#   - daily at 12:00, and as soon as possible if the PC was off then
# collect-cron.sh itself runs at most once per day, so extra triggers are harmless.
#
# Many markets or collectors (requirements S16): one task per market at its own time, e.g.
#   AT=01:00 scripts/install-windows-task.sh --market jp    # task tora-collect-market-jp
#   AT=03:00 scripts/install-windows-task.sh --market us    # task tora-collect-market-us
# Arguments go to `pnpm collect`; AT (default 12:00) is the daily time.
# Re-run to update; remove with: powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISTRO="${WSL_DISTRO_NAME:?run this from inside WSL}"
SCRIPT="$REPO_DIR/scripts/collect-cron.sh"
chmod +x "$SCRIPT"
AT="${AT:-12:00}"
SUFFIX="$(printf '%s' "$*" | tr -c 'A-Za-z0-9_' '-' | sed 's/^-*//')"
TASK="tora-collect${SUFFIX:+-$SUFFIX}"
COMMAND="$SCRIPT${*:+ $*}"

powershell.exe -NoProfile -Command "
\$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d $DISTRO -- bash -lc \"$COMMAND\"'
\$logon = New-ScheduledTaskTrigger -AtLogOn -User \$env:USERNAME
\$logon.Delay = 'PT5M'
\$daily = New-ScheduledTaskTrigger -Daily -At $AT
\$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
\$principal = New-ScheduledTaskPrincipal -UserId \$env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName '$TASK' -Description 'Tora price collectors (WSL), once per day' -Action \$action -Trigger \$logon,\$daily -Settings \$settings -Principal \$principal -Force | Out-Null
Get-ScheduledTask -TaskName '$TASK' | Select-Object TaskName,State | Format-Table -HideTableHeaders
"
