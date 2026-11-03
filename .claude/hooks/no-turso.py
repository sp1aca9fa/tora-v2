#!/usr/bin/env python3
# PreToolUse hook (Tora S19): Claude Code never reads the hosted database (Turso). Blocks shell
# commands that set the override, read the Turso settings, or point at Turso. Exit 2 = blocked.
import json, re, sys

BLOCK = [
    (r"TORA_ALLOW_TURSO", "the TORA_ALLOW_TURSO override (for the user's own terminal only)"),
    (r"\.env\.turso", "the Turso settings file"),
    (r"libsql://|turso\.io", "a Turso address"),
    (r"DATABASE_AUTH_TOKEN", "the database token"),
    (r"(^|[\s;&|(`])turso\s+(db|auth|org|group|dev|plan)\b", "the turso CLI"),
]

data = json.load(sys.stdin)
command = (data.get("tool_input") or {}).get("command") or ""
for pattern, what in BLOCK:
    if re.search(pattern, command):
        print(
            f"Blocked by the Tora hook: this command touches {what}. Claude Code never reads "
            "the hosted database; use the analysis copy (~/.local/share/tora/analysis/tora.db). "
            "The user can run Turso commands in their own terminal.",
            file=sys.stderr,
        )
        sys.exit(2)
sys.exit(0)
