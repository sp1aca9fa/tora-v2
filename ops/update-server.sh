#!/usr/bin/env bash
# Updates a Tora home server (ops/home-server.md) to the latest pushed code: both repos, the Node
# version the repo names (.nvmrc), packages, database migrations, the plug-ins' data, a new build,
# and a restart of the app, then checks the app answers. When a step fails, it goes back to the version before (migrations already run stay:
# they only add) and keeps that running. A repo with uncommitted changes is not updated (going back
# would drop them).
#
#   ops/update-server.sh          now, by hand: `ssh -t <server> code/tora-v2/ops/update-server.sh`
#   ops/update-server.sh --auto   what the tora-update timer runs every few minutes: nothing to do
#                                     unless GitHub has new commits; then only once GitHub CI passed
#                                     on that exact commit (ops/ci-status.sh), and to that commit
#                                     even when a later one arrived meanwhile; never while a collect
#                                     runs; a version that failed, here or in CI, is not tried again
#                                     until a newer push. Logs to ~/.local/state/tora/update.log;
#                                     the result goes to the activity log, a failure to admins
#                                     (Discord, Telegram).
#
# By hand it prints the commit's CI status as a warning and updates anyway (the owner chose to).
# TORA_UPDATE_REQUIRE_CI=0 (environment or the repo's .env) turns the CI gate off, for a fork
# without CI. The private collectors submodule is not gated (CI does not check it out); the main
# repo's commit is.
#
# The restart needs `sudo systemctl restart tora-app`; a sudoers rule allowing only that command
# lets the timer run it without a password (ops/home-server.md).
set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
# Where collects keep their locks: resolved as scripts/collect-cron.sh does (TORA_STATE_DIR from the
# environment or the repo's .env, else the folder above).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The .env reader shared with scripts/collect-cron.sh (env_value <name> <file>).
# shellcheck source=ops/env-value.sh
. "$REPO_DIR/ops/env-value.sh"
TORA_STATE_DIR="${TORA_STATE_DIR:-$(env_value TORA_STATE_DIR "$REPO_DIR/.env")}"
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

# The CI gate is on unless TORA_UPDATE_REQUIRE_CI is 0 (the environment wins over .env).
ci_required() {
  [ "${TORA_UPDATE_REQUIRE_CI-$(env_value TORA_UPDATE_REQUIRE_CI "$REPO_DIR/.env")}" != 0 ]
}

# How long the server may go without updating while CI is not green (pending or unknown) before
# admins are told, once per wait (the clock in update-ci); it keeps waiting after that.
CI_WAIT_ALERT_SECONDS=86400

# The CI gate's state (--auto), one line in update-ci:
#   <here> <target> <status> <since> <told>
# here: the server's commit; target: the new commit last asked about and its status; since (epoch
# seconds): when the server, on `here`, first had a commit waiting. The 24 h clock runs from
# there: a newer push does not restart it, an update (which moves HEAD) does. told: the admins'
# alert for this state (the 24 h wait, or a CI failure): 0 not tried, 2 tried and not sent (tried
# again each check, with --retry so the activity log gets one entry), 1 sent.
# Reads and sets ci_here ci_target ci_status ci_since ci_told; uses main's target, short,
# failed_file and ci_file.
ci_read() {
  ci_here="" ci_target="" ci_status="" ci_since="" ci_told=0
  if [ -f "$ci_file" ]; then
    read -r ci_here ci_target ci_status ci_since ci_told <"$ci_file" || true
  fi
  [[ "$ci_told" =~ ^[012]$ ]] || ci_told=0
}

ci_write() {
  echo "$ci_here $ci_target $ci_status $ci_since $ci_told" >"$ci_file"
}

# Tells admins (`pnpm alerts update` with the arguments given) for the state's `told`: logs the
# first try and the first failure only, so a 5-minute timer does not fill the log.
ci_tell() {
  local what="$1"
  shift
  [ "$ci_told" = 2 ] && set -- "$@" --retry
  [ "$ci_told" = 0 ] && echo "$(date -Iseconds) telling admins: $what"
  if pnpm --silent alerts update "$@"; then
    [ "$ci_told" = 2 ] && echo "$(date -Iseconds) admins are told: $what"
    ci_told=1
  else
    [ "$ci_told" = 0 ] && echo "$(date -Iseconds) could not tell admins ($what); trying again at each check"
    ci_told=2
  fi
}

# A CI failure's alert no channel took: tried again at each check while the failed commit is the
# newest; then nothing more.
ci_failure_retry() {
  local here
  here="$(git rev-parse --short HEAD)"
  ci_read
  [ "$ci_here" = "$here" ] && [ "$ci_target" = "$target" ] && [ "$ci_status" = failure ] || return 0
  if [ "$ci_told" != 1 ]; then
    ci_tell "CI failed on $short" --from "$here" --to "$short" --failed ci
  fi
  ci_write
}

# A new commit whose CI has not passed (failure, pending or unknown), in --auto. Nothing changes in
# the code, so it waits for no collect.
ci_waits() {
  local status="$1" here now last
  here="$(git rev-parse --short HEAD)"
  now="$(date +%s)"
  ci_read
  if [ "$ci_here" != "$here" ] || ! [[ "$ci_since" =~ ^[0-9]+$ ]]; then
    ci_here="$here" ci_target="" ci_status="" ci_since="$now" ci_told=0
  fi
  # The last status logged for this commit (none for a newer one).
  last=""
  [ "$ci_target" = "$target" ] && last="$ci_status"
  # A CI failure was already reported: the wait for the next commit is a new one, with its own
  # 24 h clock and its own alert.
  if [ "$ci_status" = failure ] && [ "$status" != failure ]; then ci_since="$now" ci_told=0; fi
  ci_target="$target" ci_status="$status"
  if [ "$status" = failure ]; then
    # Like a failed update: not tried again until a newer push (a later tick sees update-failed
    # and does not ask GitHub again; it only retries the alert while it was not sent).
    echo "=== $(date -Iseconds) CI failed on $short: not updating; staying on $here until a newer push."
    echo "$target" >"$failed_file"
    ci_told=0
    ci_tell "CI failed on $short" --from "$here" --to "$short" --failed ci
    ci_write
    return 0
  fi
  [ "$last" = "$status" ] || echo "$(date -Iseconds) new commit $short, waiting: CI is $status"
  if [ "$ci_told" != 1 ] && [ $((now - ci_since)) -ge "$CI_WAIT_ALERT_SECONDS" ]; then
    ci_tell "no update for 24 h; $short waits for CI ($status)" --from "$here" --to "$short" --waiting "$status"
  fi
  ci_write
}

# GitHub CI's verdict on a commit: success, failure, pending or unknown (never empty).
ci_status() {
  local word
  word="$(bash "$REPO_DIR/ops/ci-status.sh" "$1" 2>/dev/null)" || true
  case "$word" in
    success | failure | pending) echo "$word" ;;
    *) echo unknown ;;
  esac
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

# The whole run is one function, read in full before it starts: the update may rewrite this file.
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
  # The CI gate's state (ci_read): a 5-minute timer logs a waiting commit once per status change
  # and tells admins once when the server went 24 h without updating.
  local ci_file="$STATE_DIR/update-ci"
  # The commit this run updates to: the upstream as fetched now, never a later one fetched after
  # its CI status was read.
  local target short status
  if [ "$AUTO" = 1 ]; then
    exec >>"$STATE_DIR/update.log" 2>&1
    exec 7>"$STATE_DIR/update.lock"
    flock -n 7 || return 0
    git fetch -q origin
    target="$(git rev-parse '@{u}')"
    if [ "$(git rev-parse HEAD)" = "$target" ]; then
      # Nothing waits: no 24 h clock running.
      rm -f "$ci_file"
      return 0
    fi
    short="$(git rev-parse --short "$target")"
    if [ "$(cat "$failed_file" 2>/dev/null)" = "$target" ]; then
      ci_failure_retry
      return 0
    fi
    if ci_required; then
      # Only a green CI run updates: pending, unknown (no answer, an error, a rate limit) and
      # failure leave the server as it is. The API is called only while a commit waits here.
      status="$(ci_status "$target")"
      if [ "$status" != success ]; then
        ci_waits "$status"
        return 0
      fi
    fi
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
    rm -f "$ci_file"
    echo "=== $(date -Iseconds) update"
  else
    if ! git fetch -q origin; then
      echo "Could not fetch from GitHub: nothing changed."
      return 1
    fi
    target="$(git rev-parse '@{u}')"
    short="$(git rev-parse --short "$target")"
    if [ "$(git rev-parse HEAD)" != "$target" ] && ci_required; then
      status="$(ci_status "$target")"
      if [ "$status" = success ]; then
        echo "CI passed on $short."
      else
        echo "Warning: CI on $short is $status (not passed); updating anyway, by hand."
      fi
    fi
  fi

  # Uncommitted edits to tracked files would be lost going back (git reset --hard): no update.
  if [ -n "$(git status --porcelain --untracked-files=no --ignore-submodules=all)" ]; then
    echo "Update to $short refused: the repo has uncommitted changes (git status). Commit or drop them, then run this by hand."
    echo "$target" >"$failed_file"
    if [ "$AUTO" = 1 ]; then
      pnpm --silent alerts update --from "$(git rev-parse --short HEAD)" --to "$short" --failed uncommitted || true
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
  if run pull git merge -q --ff-only "$target" &&
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
    rm -f "$failed_file" "$ci_file"
    echo "Tora is up: $before -> $after (collectors $(git -C collectors rev-parse --short HEAD))."
    if [ "$AUTO" = 1 ] && [ "$before" != "$after" ]; then
      pnpm --silent alerts update --from "$before" --to "$after" || true
    fi
    return 0
  fi

  echo "$target" >"$failed_file"
  target="$short"
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
