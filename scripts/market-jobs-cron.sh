#!/usr/bin/env bash
# Daytime reads of the marketplaces (requirements S36 B4), started every 30 minutes by the
# tora-market-jobs timer (docs/home-server.md): `pnpm market-jobs`, then the alert pass for a
# refusal or a run that could not run (`pnpm alerts market-refusals`), whatever the run's exit.
# The runner keeps its own lock (`market-jobs.lock` in the state folder), checks the hours
# (05:00 to 22:00, app time zone) and each marketplace's number a day, and stops when a collect
# runs. Logs to ~/.local/state/tora/market-jobs.log (TORA_STATE_DIR: elsewhere).
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Read as scripts/collect-cron.sh reads it, so both use the same locks.
# shellcheck source=ops/env-value.sh
. "$REPO_DIR/ops/env-value.sh"
TORA_STATE_DIR="${TORA_STATE_DIR:-$(env_value TORA_STATE_DIR "$REPO_DIR/.env")}"
STATE_DIR="${TORA_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/tora}"
export TORA_STATE_DIR="$STATE_DIR"
LOG="$STATE_DIR/market-jobs.log"
mkdir -p "$STATE_DIR"

# systemd and cron start with a bare PATH; load nvm if present so node and pnpm resolve.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

cd "$REPO_DIR" || exit 1
echo "=== $(date -Is) market jobs" >>"$LOG"
# The package's own script: the root one goes through `pnpm --filter`, which turns exit 4 into 1.
(cd "$REPO_DIR/packages/collector-sdk" && pnpm --silent market-jobs) >>"$LOG" 2>&1
code=$?
# It sends only what was not sent yet: a refusal, a stop, or a run that failed (once a day).
pnpm --silent alerts market-refusals >>"$LOG" 2>&1 || true
# 4: a marketplace refused; recorded, and the alert went out above. Not a failure of the unit.
[ "$code" = 4 ] && exit 0
exit "$code"
