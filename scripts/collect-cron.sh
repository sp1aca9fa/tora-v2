#!/usr/bin/env bash
# Daily collector run for Windows Task Scheduler (at logon + daily) or cron. Runs at most once
# per day: it exits early when today's run already succeeded, so it is safe to trigger often.
# Logs to ~/.local/state/tora/collect.log.
#
#   MAX_JITTER_SECONDS=300  random wait before starting (default 300 s; 0 to disable)
#   FORCE=1                 run even if today's run already succeeded
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
LOG="$STATE_DIR/collect.log"
STAMP="$STATE_DIR/last-success-date"
LOCK="$STATE_DIR/collect.lock"
MAX_JITTER_SECONDS="${MAX_JITTER_SECONDS:-300}"
mkdir -p "$STATE_DIR"

today="$(TZ=Asia/Tokyo date +%F)"
if [ "${FORCE:-0}" != "1" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$today" ]; then
  exit 0
fi

# One run at a time (logon and daily triggers can overlap).
exec 9>"$LOCK"
flock -n 9 || exit 0

# Task Scheduler / cron start with a bare PATH; load nvm if present so node/pnpm resolve.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

if [ "$MAX_JITTER_SECONDS" -gt 0 ]; then
  sleep $((RANDOM % (MAX_JITTER_SECONDS + 1)))
fi

cd "$REPO_DIR"
echo "=== $(date -Iseconds) ===" >>"$LOG"
if pnpm --silent collect >>"$LOG" 2>&1; then
  echo "$today" >"$STAMP"
else
  echo "collect failed (exit $?); will retry on the next trigger" >>"$LOG"
  exit 1
fi
