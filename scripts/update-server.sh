#!/usr/bin/env bash
# Updates a Tora home server (docs/home-server.md) to the latest pushed code: both repos, packages,
# database migrations, the plug-ins' data, a new build, and a restart of the app, then checks the
# app answers. When a step fails, it goes back to the version before (migrations already run stay:
# they only add) and keeps that running.
#
#   scripts/update-server.sh          now, by hand: `ssh -t minipc code/tora-v2/scripts/update-server.sh`
#   scripts/update-server.sh --auto   what the tora-update timer runs every few minutes: nothing to do
#                                     unless GitHub has new commits; never while a collect runs; a
#                                     version that failed is not tried again until a newer push.
#                                     Logs to ~/.local/state/tora/update.log; the result goes to the
#                                     activity log, a failure to admins (Discord, Telegram).
#
# The restart needs `sudo systemctl restart tora-app`; a sudoers rule allowing only that command
# lets the timer run it without a password (docs/home-server.md).
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"

restart_app() {
  if [ "$AUTO" = 1 ]; then sudo -n systemctl restart tora-app; else sudo systemctl restart tora-app; fi
}

app_answers() {
  for _ in $(seq 1 20); do
    sleep 3
    curl -sf -o /dev/null http://127.0.0.1:3000/login && return 0
  done
  echo "the app does not answer: journalctl -u tora-app -n 50 --no-pager"
  return 1
}

# The whole run is one function, read in full before it starts: `git pull` may rewrite this file.
main() {
  AUTO=0
  [ "${1:-}" = "--auto" ] && AUTO=1
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  mkdir -p "$STATE_DIR"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

  local failed_file="$STATE_DIR/update-failed"
  if [ "$AUTO" = 1 ]; then
    exec >>"$STATE_DIR/update.log" 2>&1
    exec 7>"$STATE_DIR/update.lock"
    flock -n 7 || return 0
    git fetch -q origin
    local upstream
    upstream="$(git rev-parse '@{u}')"
    [ "$(git rev-parse HEAD)" = "$upstream" ] && return 0
    [ "$(cat "$failed_file" 2>/dev/null)" = "$upstream" ] && return 0
    # A collect reads the code as it runs: wait for it (the next check tries again).
    exec 8>"$STATE_DIR/collect.lock"
    if ! flock -n 8; then
      echo "$(date -Iseconds) new commits, waiting: a collect is running"
      return 0
    fi
    echo "=== $(date -Iseconds) update"
  fi

  local before step=pull
  before="$(git rev-parse --short HEAD)"
  run() {
    step="$1"
    shift
    "$@"
  }
  if run pull git pull --ff-only &&
    run pull git submodule update --init &&
    run install pnpm install --frozen-lockfile &&
    run migrate pnpm db:migrate &&
    run plugins pnpm plugins &&
    run build pnpm build &&
    run restart restart_app &&
    run start app_answers; then
    local after
    after="$(git rev-parse --short HEAD)"
    rm -f "$failed_file"
    echo "Tora is up: $before -> $after (collectors $(git -C collectors rev-parse --short HEAD))."
    if [ "$AUTO" = 1 ] && [ "$before" != "$after" ]; then
      pnpm --silent alerts update --from "$before" --to "$after" || true
    fi
    return 0
  fi

  local target
  target="$(git rev-parse --short '@{u}')"
  echo "Update to $target failed at '$step': going back to $before."
  git rev-parse '@{u}' >"$failed_file"
  git reset -q --hard "$before"
  git submodule update --init
  if pnpm install --frozen-lockfile && pnpm build && restart_app && app_answers; then
    echo "Back on $before, running."
  else
    echo "Going back failed too: the app may be down. journalctl -u tora-app -n 50 --no-pager"
  fi
  if [ "$AUTO" = 1 ]; then
    pnpm --silent alerts update --from "$before" --to "$target" --failed "$step" || true
  fi
  return 1
}

main "$@"
exit
