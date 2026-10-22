#!/usr/bin/env bash
# Moved to the private plug-ins repo (collectors/ops/); kept until the timers point there.
exec "$(dirname "${BASH_SOURCE[0]}")/../collectors/ops/funnel-check.sh" "$@"
