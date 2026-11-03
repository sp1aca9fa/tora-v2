#!/usr/bin/env bash
# Updates a Tora home server (ops/home-server.md) to the latest pushed code: both repos, the Node
# version the repo names (.nvmrc), packages, database migrations, the plug-ins' data, a new build,
# and a restart of the app, then checks the app answers. When a step fails, it goes back to the version before (migrations already run stay:
# they only add) and keeps that running. A repo with uncommitted changes is not updated (going back
# would drop them).
#
#   ops/update-server.sh          now, by hand: `ssh -t <server> code/tora-v2/ops/update-server.sh`
#   ops/update-server.sh --auto   what the tora-update timer runs every few minutes: nothing to do
#                                     unless GitHub has new commits; never while a collect runs; a
#                                     version that failed is not tried again until a newer push.
#                                     Logs to ~/.local/state/tora/update.log; the result goes to the
#                                     activity log, a failure to admins (Discord, Telegram).
#
# The restart needs `sudo systemctl restart tora-app`; a sudoers rule allowing only that command
# lets the timer run it without a password (ops/home-server.md).
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
# Where collects keep their locks: resolved as scripts/collect-cron.sh does (TORA_STATE_DIR from the
# environment or the repo's .env, else the folder above).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TORA_STATE_DIR="${TORA_STATE_DIR:-$(sed -n 's/^TORA_STATE_DIR=//p' "$REPO_DIR/.env" 2>/dev/null | tail -n 1)}"
COLLECT_STATE_DIR="${TORA_STATE_DIR:-$STATE_DIR}"
# The services run Node through this link (their PATH: $NODE_LINK/bin), so a new Node needs no
# change to them (ops/home-server.md).
NODE_LINK="${XDG_DATA_HOME:-$HOME/.local/share}/tora/node"

# The Node version the repo names (.nvmrc): installed when missing (nvm), made the default, and
# the services' link pointed at it. A Node security release is then just a push.
ensure_node() {
  [ -f .nvmrc ] && command -v nvm >/dev/null || return 0
  local want dir
  want="$(tr -d ' \n' <.nvmrc)"
  if [ "$(nvm version "$want")" = "N/A" ]; then
    echo "installing Node $want"
    nvm install "$want" >/dev/null || return 1
  fi
  nvm alias default "$want" >/dev/null
  nvm use "$want" >/dev/null || return 1
  corepack enable || return 1
  dir="$(dirname "$(dirname "$(nvm which "$want")")")"
  if [ "$(readlink "$NODE_LINK" 2>/dev/null)" != "$dir" ]; then
    mkdir -p "$(dirname "$NODE_LINK")"
    ln -sfn "$dir" "$NODE_LINK"
    echo "Node $want now runs the services"
  fi
}

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
  # The main repo (this file is in its ops/ folder).
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
    # A collect reads the code as it runs: wait for it (the next check tries again). Each set of
    # arguments has its own lock (collect.lock, collect-market-us.lock...): all of them are held
    # until the update is done, so none starts meanwhile.
    mkdir -p "$COLLECT_STATE_DIR"
    local lock fd
    for lock in "$COLLECT_STATE_DIR/collect.lock" "$COLLECT_STATE_DIR"/collect-*.lock; do
      [ "$lock" = "$COLLECT_STATE_DIR/collect-*.lock" ] && continue
      exec {fd}>>"$lock"
      if ! flock -n "$fd"; then
        echo "$(date -Iseconds) new commits, waiting: a collect is running ($(basename "$lock"))"
        return 0
      fi
    done
    echo "=== $(date -Iseconds) update"
  fi

  # Uncommitted edits to tracked files would be lost going back (git reset --hard): no update.
  if [ -n "$(git status --porcelain --untracked-files=no --ignore-submodules=all)" ]; then
    local target
    target="$(git rev-parse --short '@{u}')"
    echo "Update to $target refused: the repo has uncommitted changes (git status). Commit or drop them, then run this by hand."
    git rev-parse '@{u}' >"$failed_file"
    if [ "$AUTO" = 1 ]; then
      pnpm --silent alerts update --from "$(git rev-parse --short HEAD)" --to "$target" --failed uncommitted || true
    fi
    return 1
  fi

  local before step=pull
  before="$(git rev-parse --short HEAD)"
  run() {
    step="$1"
    shift
    "$@"
  }
  if run pull git pull --ff-only &&
    run submodules git submodule update --init &&
    run node ensure_node &&
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
  git rev-parse '@{u}' >"$failed_file"
  if [ "$step" = pull ] && [ "$(git rev-parse --short HEAD)" = "$before" ]; then
    # The pull itself failed: nothing changed (no reset, which would drop edits), the app runs on.
    echo "Update to $target failed at '$step': still on $before, nothing changed."
  else
    echo "Update to $target failed at '$step': going back to $before."
    git reset -q --hard "$before"
    git submodule update --init
    if ensure_node && pnpm install --frozen-lockfile && pnpm build && restart_app && app_answers; then
      echo "Back on $before, running."
    else
      echo "Going back failed too: the app may be down. journalctl -u tora-app -n 50 --no-pager"
    fi
  fi
  if [ "$AUTO" = 1 ]; then
    pnpm --silent alerts update --from "$before" --to "$target" --failed "$step" || true
  fi
  return 1
}

main "$@"
exit
