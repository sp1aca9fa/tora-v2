#!/usr/bin/env bash
# Copies the daily database backups of a Tora server (the machine running the app and the nightly
# collect, e.g. a mini PC at home) to this machine, so a dead server disk does not take them along
# (requirements S6), and refreshes this machine's analysis copy (the newest backup, unpacked) for
# read-only queries. Mirrors the server's backup folder: what the server prunes (older than 30
# days, first of the month kept) is pruned here too, unless the server suddenly holds fewer than 3
# backups (a new or wiped disk): then nothing is deleted.
#
#   ops/copy-backups.sh <ssh host> [folder]            copy now (e.g. ops/copy-backups.sh <server>)
#   ops/copy-backups.sh install <ssh host> [folder]    Windows (from WSL): a task copying 10 minutes after
#                                                 logon and every 6 hours while the PC is on,
#                                                 in a hidden console (conhost --headless), so no
#                                                 window opens and none can be closed mid-copy
#
# The folder is where the copies go here (default BACKUP_DIR, else ~/.local/share/tora/backups);
# install bakes it into the task.
#
# The ssh host must log in without a password (a key). Logs to ~/.local/state/tora/copy-backups.log.
#
# Also watches the server from outside (nothing on it can say it is down): its status page through
# its public address (TORA_STATUS_URL and TORA_STATUS_TOKEN in the repo's .env); unreachable for
# TORA_WATCH_HOURS (default 24) is told once on Discord (TORA_WATCH_DISCORD in .env, a channel's
# webhook link), and again when it answers.
set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/copy-backups.sh"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/tora"
LOCAL_DIR="${BACKUP_DIR:-$DATA/backups}"
ANALYSIS="${TORA_ANALYSIS_DB:-$DATA/analysis/tora.db}"
REMOTE_DIR="${REMOTE_BACKUP_DIR:-.local/share/tora/backups}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
LOG="$STATE_DIR/copy-backups.log"

if [ "${1:-}" = "install" ]; then
  HOST="${2:?usage: copy-backups.sh install <ssh host> [folder]}"
  FOLDER="${3:+ $(realpath -m "$3")}"
  DISTRO="${WSL_DISTRO_NAME:?run this from inside WSL}"
  chmod +x "$SELF"
  powershell.exe -NoProfile -Command "
\$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless wsl.exe -d $DISTRO -- bash -lc \"$SELF $HOST$FOLDER\"'
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

HOST="${1:?usage: copy-backups.sh <ssh host> [folder]}"
LOCAL_DIR="${2:-$LOCAL_DIR}"
mkdir -p "$LOCAL_DIR" "$STATE_DIR"
exec >>"$LOG" 2>&1
echo "=== $(date -Iseconds) from $HOST"

REPO="$(cd "$(dirname "$SELF")/.." && pwd)"
env_value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" "$REPO/.env" 2>/dev/null | tail -1; }
notify() {
  local hook
  hook="$(env_value TORA_WATCH_DISCORD)"
  [ -n "$hook" ] || { echo "TORA_WATCH_DISCORD not set: not told"; return 1; }
  curl -fsS -m 30 -H 'content-type: application/json' -d "{\"content\":\"$1\"}" "$hook" >/dev/null
}
watch_server() {
  local url token down="$STATE_DIR/server-down" now since
  url="$(env_value TORA_STATUS_URL)"
  token="$(env_value TORA_STATUS_TOKEN)"
  [ -n "$url" ] && [ -n "$token" ] || return 0
  now=$(date +%s)
  if curl -fsS -m 30 -o /dev/null -H "authorization: Bearer $token" "${url%/}/api/server/status?lines=0"; then
    echo "server answers"
    if [ -f "$down" ]; then
      if grep -q told "$down"; then notify "Tora answers again." || true; fi
      rm -f "$down"
    fi
    return 0
  fi
  [ -f "$down" ] || echo "$now" >"$down"
  since=$(head -1 "$down")
  echo "server not answering since $(date -d "@$since" -Iseconds)"
  if [ $((now - since)) -ge $((${TORA_WATCH_HOURS:-24} * 3600)) ] && ! grep -q told "$down"; then
    notify "Tora (the server) has not answered since $(date -d "@$since" '+%Y-%m-%d %H:%M'): no collect, no store notices. Check its power and network." &&
      echo told >>"$down"
  fi
}
watch_server || true

held="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "ls $REMOTE_DIR/tora-*.db.gz 2>/dev/null | wc -l")"
delete=()
if [ "$held" -ge 3 ]; then
  delete=(--delete)
else
  echo "the server holds $held backup(s): copying without deleting anything here"
fi
rsync -a "${delete[@]}" --include='*.db.gz' --exclude='*' -e 'ssh -o BatchMode=yes' \
  "$HOST:$REMOTE_DIR/" "$LOCAL_DIR/"
newest="$(ls "$LOCAL_DIR"/tora-*.db.gz 2>/dev/null | sort | tail -1)"
echo "$(ls "$LOCAL_DIR"/*.db.gz 2>/dev/null | wc -l) backup(s) here, newest $(basename "${newest:-none}")"

# The analysis copy follows the newest backup.
if [ -n "$newest" ] && [ "$newest" -nt "$ANALYSIS" ]; then
  mkdir -p "$(dirname "$ANALYSIS")"
  gunzip -c "$newest" >"$ANALYSIS.part" && mv "$ANALYSIS.part" "$ANALYSIS"
  echo "analysis copy refreshed"
fi
