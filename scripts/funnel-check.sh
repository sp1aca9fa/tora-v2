#!/usr/bin/env bash
# Checks that a home server's public address (its Tailscale Funnel, docs/home-server.md) answers
# from the internet, and sets the Funnel up again when it does not. Run every 5 minutes by the
# tora-funnel timer.
#
# On the box the address resolves to its Tailscale address, which skips the public path: the
# check looks the name up in public DNS and connects through Tailscale's relays, as a phone
# would. Only when the app itself answers (otherwise the Funnel is not at fault):
#   2 failed checks in a row   the Funnel is reset and set up again (activity log)
#   4 failed checks in a row   tailscaled is restarted too, and admins are told it is down
#   answers again after that   admins are told it is back
# Needs `tailscale set --operator=<user>` (the Funnel without sudo) and a sudoers rule for
# `systemctl restart tailscaled`. Logs to ~/.local/state/tora/funnel.log.
set -uo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/tora"
LOG="$STATE_DIR/funnel.log"
FAILS_FILE="$STATE_DIR/funnel-fails"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p "$STATE_DIR"
exec >>"$LOG" 2>&1

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

status="$(tailscale funnel status 2>/dev/null)"
url="$(printf '%s\n' "$status" | grep -o 'https://[^ ]*\.ts\.net' | head -1)"
port="$(printf '%s\n' "$status" | grep -o 'proxy http://127\.0\.0\.1:[0-9]*' | head -1 | sed 's/.*://')"
# No Funnel set up: nothing to check (it was turned off on purpose, or never set).
[ -n "$url" ] || exit 0
port="${port:-3000}"
host="${url#https://}"

# The app must answer on the box first.
curl -sf -o /dev/null --max-time 10 "http://127.0.0.1:$port/login" || exit 0

# The address as the internet sees it: its public IPv4 from public DNS (over HTTPS).
ip="$(curl -s --max-time 10 -H 'accept: application/dns-json' \
  "https://cloudflare-dns.com/dns-query?name=$host&type=A" |
  grep -o '"data":"[0-9.]*"' | head -1 | cut -d'"' -f4)"
fails="$(cat "$FAILS_FILE" 2>/dev/null || echo 0)"
if [ -z "$ip" ]; then
  # No public DNS answer (this box offline?): not the Funnel's fault, nothing changed.
  exit 0
fi
if curl -sf -o /dev/null --max-time 20 --resolve "$host:443:$ip" "$url/login"; then
  if [ "$fails" -ge 4 ]; then
    echo "$(date -Iseconds) $url answers again"
    pnpm --silent alerts funnel back --url "$url" || true
  fi
  [ "$fails" = 0 ] || echo 0 >"$FAILS_FILE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" >"$FAILS_FILE"
echo "$(date -Iseconds) $url did not answer (via $ip), $fails in a row"
if [ "$fails" = 2 ] || [ "$fails" = 4 ]; then
  restarted=()
  if [ "$fails" = 4 ]; then
    sudo -n systemctl restart tailscaled && sleep 15
    restarted=(--restarted)
  fi
  tailscale funnel reset && tailscale funnel --bg "$port" >/dev/null &&
    echo "$(date -Iseconds) Funnel set up again${restarted:+ (tailscaled restarted)}"
  pnpm --silent alerts funnel reset --url "$url" "${restarted[@]}" || true
  if [ "$fails" = 4 ]; then pnpm --silent alerts funnel down --url "$url" || true; fi
fi
