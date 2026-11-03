# CLAUDE.md (Tora)

Rules for Claude Code in this repo. The owner's private rules (their setup, sources, server) are
in the private `collectors/` submodule, loaded through `CLAUDE.local.md` when it is checked out.

## Reading protocol (every session)

1. `requirements.md`: Core fully, then only the current session (the first one not marked done in
   the Status table). Finished phases' full chapters are in `docs/history.md`; read them only
   when needed.
2. The private notes' to-do list and `actions.md`, when the private submodule is checked out (the
   owner may have written answers into it).

If a request conflicts with the requirements, point out the conflict and ask before proceeding.

## Decisions

- Small choices (naming, layout details, which of two equivalent fixes, test shape): take the
  option you would mark "(Recommended)" and say so in one line afterwards.
- Ask first on direction (what a phase covers, new features, trade-offs the owner would feel),
  anything costing money, anything public (pushes, publishing, external services), and production
  data changes.
- Production data changes only when they serve the request; give the owner the command, never run
  it.
- New decisions go in the log that fits; mixed ones are split (the generic part in the public
  "Decision log", specifics in the private notes).

## Hard rules

- Never read the hosted database (Turso); a hook and the sandbox enforce it too. Heavy analysis on
  the analysis copy (MCP `query_sql`).
- Never print `.env` values.
- Sources marked `noAi` never reach Claude.
- Collectors run only on the server, never from Claude's sandbox against live sites unless the
  owner asks for a one-off check.
- No private scraping code or real private names in public files; public examples use neutral
  made-up names.
- Never `git add -A`; add files by name. Commit when a piece of work is done and tested; the owner
  pushes.
- Migrations are add-only (drop in a later migration). Collectors never write to the database.

## Agents

The main session (Opus, high effort) orchestrates: it plans, writes the spec, routes, triages,
commits and keeps the owner's actions file current. The loop is the shared `/ship`
(`~/.claude/commands/ship.md`, from the `selfhost-blueprint` repo linked into `~/.claude`): tiers
0-3 decided by the changed files, Tier 3 handling, which questions may stop the work, how to write
for the owner, the setup review. Read it before any Tier 1-3 work, with or without `/ship`. This
project's profile is `docs/agents.md`: risk class, trust-territory paths, domain checklist, the
model and effort per role (pass them as `model` and `effort` every time an agent is started), the
owner's list, standing rules. Small changes (a few files, one area) the main session does itself,
since an agent re-reads everything cold. Subagents cannot start subagents.

| Tier | When                                                                                         | Review                                                    |
| ---- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0    | docs, notes, comments, wording in `en.json` only, tests only, config with no behavior change | none; CHECKS only                                         |
| 1    | product code outside trust territory                                                         | `code-reviewer-light`; `ux-reviewer` if visible           |
| 2    | a file on the trust-territory paths (`docs/agents.md`)                                       | `code-reviewer`; `ux-reviewer` if visible                 |
| 3    | Tier 2 the normal loop cannot verify (`/ship` section 1 triggers)                            | plan review, then normal and adversarial review, `triage` |

Project specifics: visible changes sync the test copy and crawl the changed pages
(`--views phone,wide,dark`); reviewer ideas for the reviewed pages are built, ideas about other
pages go to the notes' to-do list; anything public or a production data change is an owner stop.

## Report

After each task, short, no step recap, only the lines that have something:

```
Done: <what changed; tier and why>
Tested: <checks and tests; what was not tested>
Needs you: <decisions and blockers, each with a recommendation>
Open issues: <unresolved after 2 rounds, known limits>
Assumed: <assumptions about data, prices or users, with the rule they rest on>
Ideas: <for the to-do list>
Reviewers: <each that ran: findings N, accepted N; useful, noisy or redundant>
```

Do not retell what a reviewer said; say so only if a review was useless.

## Style

- Prettier on changed files (`./node_modules/.bin/prettier --write <files>`; `requirements.md`
  and `collectors/` are ignored by it).
- Commands for the owner: every part to replace is in capitals inside `<<...>>` (for example
  `<<YOUR_TAILNET>>`), with a line before the block saying what to replace and where to find it.
- No em dashes, no emoji. Plain, short explanations.
- Code reads like the code around it. US English.
