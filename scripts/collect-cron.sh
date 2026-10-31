#!/usr/bin/env bash
# Daily collector run for Windows Task Scheduler (at logon + daily) or cron, then the day's
# database backup (`pnpm backup`), then alerts (`pnpm alerts after-run`: failures to admins at
# once, the daily summaries; requirements S17). Runs at most once per day: it exits early when today's run
# already succeeded, so it is safe to trigger often. After that, a "collect now" left in the app
# (Settings > Collectors, requirements S21) runs it again; only the task without arguments takes
# those requests.
# Logs to ~/.local/state/tora/collect.log (TORA_STATE_DIR: elsewhere).
#
# Arguments go to `pnpm collect` (e.g. `collect-cron.sh --market us`), to spread markets or
# collectors across the night (requirements S16); each set of arguments runs once per day.
#
#   MAX_JITTER_SECONDS=300  random wait before starting (default 300 s; 0 to disable)
#   FORCE=1                 run even if today's run already succeeded
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# TORA_STATE_DIR (environment or the repo's .env): a second Tora on this PC keeps its own folder.
TORA_STATE_DIR="${TORA_STATE_DIR:-$(sed -n 's/^TORA_STATE_DIR=//p' "$REPO_DIR/.env" 2>/dev/null | tail -n 1)}"
STATE_DIR="${TORA_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/tora}"
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
done_today=0
if [ "${FORCE:-0}" != "1" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$today" ]; then
  done_today=1
  [ -z "$SUFFIX" ] || exit 0
fi

# One run at a time (logon and daily triggers can overlap).
exec 9>"$LOCK"
flock -n 9 || exit 0

# Task Scheduler / cron start with a bare PATH; load nvm if present so node/pnpm resolve.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

cd "$REPO_DIR"

# A "collect now" from the app: taken (so the app shows it started) and run without waiting.
# A normal run takes a waiting request too, as it does the same.
if [ -z "$SUFFIX" ] && pnpm --silent collect:request >>"$LOG" 2>/dev/null; then
  MAX_JITTER_SECONDS=0
elif [ "$done_today" = 1 ]; then
  exit 0
fi

if [ "$MAX_JITTER_SECONDS" -gt 0 ]; then
  sleep $((RANDOM % (MAX_JITTER_SECONDS + 1)))
fi
started="$(date -Iseconds)"
echo "=== $started $* ===" >>"$LOG"
ok=1
collect_rc=0
pnpm --silent collect "$@" >>"$LOG" 2>&1 || collect_rc=$?
# Exit 2: a collector stopped at its request cap with listings left (not a failure); the next
# trigger continues it, as it does after a failure (exit 1). Either way the day is not stamped.
if [ "$collect_rc" = 2 ]; then
  echo "collect stopped at a request cap; continues on the next trigger" >>"$LOG"
  ok=0
elif [ "$collect_rc" != 0 ]; then
  echo "collect failed (exit $collect_rc); will retry on the next trigger" >>"$LOG"
  ok=0
fi
# The day's backup of the whole database (requirements S6), whatever the collect did; one a day.
backup_rc=0
pnpm --silent backup >>"$LOG" 2>&1 || backup_rc=$?
if [ "$backup_rc" != 0 ]; then
  echo "backup failed (exit $backup_rc); will retry on the next trigger" >>"$LOG"
  ok=0
fi
# Alerts (S17); their own failure never fails the run.
pnpm --silent alerts after-run --since "$started" --collect-exit "$collect_rc" \
  --backup-exit "$backup_rc" --log "$LOG" >>"$LOG" 2>&1 || echo "alerts failed; see above" >>"$LOG"
[ "$ok" = 1 ] || exit 1
echo "$today" >"$STAMP"
