#!/usr/bin/env bash
# Copies the daily database backups of a Tora server (the machine running the app and the nightly
# collect, e.g. a mini PC at home) to this machine, so a dead server disk does not take them along
# (requirements S6), and refreshes this machine's analysis copy (the newest backup, unpacked) for
# read-only queries. Mirrors the server's backup folder: what the server prunes (older than 30
# days, first of the month kept) is pruned here too, unless the server suddenly holds fewer than 3
# backups (a new or wiped disk): then nothing is deleted.
#
#   scripts/copy-backups.sh <ssh host>            copy now (e.g. scripts/copy-backups.sh minipc)
#   scripts/copy-backups.sh install <ssh host>    Windows (from WSL): a task copying 10 minutes after
#                                                 logon and every 6 hours while the PC is on
#
# The ssh host must log in without a password (a key). Logs to ~/.local/state/tora/copy-backups.log.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/tora"
LOCAL_DIR="${BACKUP_DIR:-$DATA/backups}"
ANALYSIS="${TORA_ANALYSIS_DB:-$DATA/analysis/tora.db}"
REMOTE_DIR="${REMOTE_BACKUP_DIR:-.local/share/tora/backups}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
LOG="$STATE_DIR/copy-backups.log"

if [ "${1:-}" = "install" ]; then
  HOST="${2:?usage: copy-backups.sh install <ssh host>}"
  DISTRO="${WSL_DISTRO_NAME:?run this from inside WSL}"
  chmod +x "$REPO_DIR/scripts/copy-backups.sh"
  powershell.exe -NoProfile -Command "
\$action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d $DISTRO -- bash -lc \"$REPO_DIR/scripts/copy-backups.sh $HOST\"'
\$logon = New-ScheduledTaskTrigger -AtLogOn -User \$env:USERNAME
\$logon.Delay = 'PT10M'
\$every = New-ScheduledTaskTrigger -Once -At 00:30 -RepetitionInterval (New-TimeSpan -Hours 6)
\$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
\$principal = New-ScheduledTaskPrincipal -UserId \$env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'tora-backup-copy' -Description 'Tora: copies the server backups to this PC (WSL)' -Action \$action -Trigger \$logon,\$every -Settings \$settings -Principal \$principal -Force | Out-Null
Get-ScheduledTask -TaskName 'tora-backup-copy' | Select-Object TaskName,State | Format-Table -HideTableHeaders
"
  exit 0
fi

HOST="${1:?usage: copy-backups.sh <ssh host>}"
mkdir -p "$LOCAL_DIR" "$STATE_DIR"
exec >>"$LOG" 2>&1
echo "=== $(date -Iseconds) from $HOST"

held="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "ls $REMOTE_DIR/*.db.gz 2>/dev/null | wc -l")"
delete=()
if [ "$held" -ge 3 ]; then
  delete=(--delete)
else
  echo "the server holds $held backup(s): copying without deleting anything here"
fi
rsync -a "${delete[@]}" --include='*.db.gz' --exclude='*' -e 'ssh -o BatchMode=yes' \
  "$HOST:$REMOTE_DIR/" "$LOCAL_DIR/"
newest="$(ls "$LOCAL_DIR"/*.db.gz 2>/dev/null | sort | tail -1)"
echo "$(ls "$LOCAL_DIR"/*.db.gz 2>/dev/null | wc -l) backup(s) here, newest $(basename "${newest:-none}")"

# The analysis copy follows the newest backup.
if [ -n "$newest" ] && [ "$newest" -nt "$ANALYSIS" ]; then
  mkdir -p "$(dirname "$ANALYSIS")"
  gunzip -c "$newest" >"$ANALYSIS.part" && mv "$ANALYSIS.part" "$ANALYSIS"
  echo "analysis copy refreshed"
fi
