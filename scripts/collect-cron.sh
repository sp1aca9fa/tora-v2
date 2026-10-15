#!/usr/bin/env bash
# Daily collector run for Windows Task Scheduler (at logon + daily) or cron, then the day's
# database backup (`pnpm backup`). Runs at most once per day: it exits early when today's run
# already succeeded, so it is safe to trigger often.
# Logs to ~/.local/state/tora/collect.log.
#
# Arguments go to `pnpm collect` (e.g. `collect-cron.sh --market us`), to spread markets or
# collectors across the night (requirements S16); each set of arguments runs once per day.
#
#   MAX_JITTER_SECONDS=300  random wait before starting (default 300 s; 0 to disable)
#   FORCE=1                 run even if today's run already succeeded
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
LOG="$STATE_DIR/collect.log"
# One stamp and lock per set of arguments ("--market us" -> "market-us").
SUFFIX="$(printf '%s' "$*" | tr -c 'A-Za-z0-9_' '-' | sed 's/^-*//')"
STAMP="$STATE_DIR/last-success-date${SUFFIX:+-$SUFFIX}"
LOCK="$STATE_DIR/collect${SUFFIX:+-$SUFFIX}.lock"
MAX_JITTER_SECONDS="${MAX_JITTER_SECONDS:-300}"
mkdir -p "$STATE_DIR"

# The day in the app's time zone (Settings > Admin preferences > Time zone), which each collect
# writes down; before the first one, the PC's own.
APP_TZ="$(cat "$STATE_DIR/time-zone" 2>/dev/null || true)"
today="$(${APP_TZ:+env TZ="$APP_TZ"} date +%F)"
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
echo "=== $(date -Iseconds) $* ===" >>"$LOG"
ok=1
rc=0
pnpm --silent collect "$@" >>"$LOG" 2>&1 || rc=$?
if [ "$rc" != 0 ]; then
  echo "collect failed (exit $rc); will retry on the next trigger" >>"$LOG"
  ok=0
fi
# The day's backup of the whole database (requirements S6), whatever the collect did; one a day.
rc=0
pnpm --silent backup >>"$LOG" 2>&1 || rc=$?
if [ "$rc" != 0 ]; then
  echo "backup failed (exit $rc); will retry on the next trigger" >>"$LOG"
  ok=0
fi
[ "$ok" = 1 ] || exit 1
echo "$today" >"$STAMP"
