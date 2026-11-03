# shellcheck shell=bash
# Sourced by ops/update-server.sh and scripts/collect-cron.sh, so both read .env alike:
#
#   env_value <name> <.env file>
#
# prints the value as the app reads it (process.loadEnvFile in packages/db/src/env.ts): the last
# line naming it (`export ` allowed); a quoted value up to its closing quote, else up to a `#`
# comment; CR and surrounding spaces dropped. No file, or no such line: empty (sed's error must not
# end a script under pipefail).
env_value() {
  local v
  v="$({ sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=//p" "$2" 2>/dev/null || true; } |
    tail -n 1 | tr -d '\r')"
  while [[ "$v" == [[:space:]]* ]]; do v="${v#[[:space:]]}"; done
  case "$v" in
    \"*) v="${v#\"}" && v="${v%%\"*}" ;;
    \'*) v="${v#\'}" && v="${v%%\'*}" ;;
    *)
      v="${v%%#*}"
      while [[ "$v" == *[[:space:]] ]]; do v="${v%[[:space:]]}"; done
      ;;
  esac
  printf '%s\n' "$v"
}
