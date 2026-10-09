#!/usr/bin/env bash
# Daily collector run for cron / Windows Task Scheduler. Adds random jitter, then runs
# `pnpm collect` from the repo root. Logs to ~/.local/state/tora/collect.log.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
MAX_JITTER_SECONDS="${MAX_JITTER_SECONDS:-3600}"
mkdir -p "$LOG_DIR"

# cron starts with a bare PATH; load nvm if present so node/pnpm resolve.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

if [ "${NO_JITTER:-0}" != "1" ]; then
  sleep $((RANDOM % (MAX_JITTER_SECONDS + 1)))
fi

cd "$REPO_DIR"
{
  echo "=== $(date -Iseconds) ==="
  pnpm collect
} >>"$LOG_DIR/collect.log" 2>&1
