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
commits and keeps the owner's actions file current. The agents are shared across projects (the
`selfhost-blueprint` repo's `claude/agents`, linked into `~/.claude`); this project's profile is
`docs/agents.md` (the app, trust territory, domain checklist, and the model and effort per role:
pass those as `model` and `effort` every time an agent is started). `/ship <task>` runs the whole
loop. Subagents cannot start subagents.

**Tiers** (judge by the diff; trust territory, listed in `docs/agents.md`, decides the whole
change):

| Tier | When                                                                                         | Review                                          |
| ---- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0    | docs, notes, comments, wording in `en.json` only, tests only, config with no behavior change | none; CHECKS only                               |
| 1    | product code outside trust territory                                                         | `code-reviewer-light`; `ux-reviewer` if visible |
| 2    | trust territory                                                                              | `code-reviewer`; `ux-reviewer` if visible       |

A Tier 0 or 1 change that fails CHECKS twice moves up a tier. Never review Tier 0 "to be safe".

**Loop:**

1. Tier 1 and 2: a spec in `.agent-runs/<date>-<slug>/spec.md` (`docs/spec-template.md`): goal,
   acceptance criteria, the requirement sections it rests on (point, don't copy), pages touched,
   tier. Unclear details: the conservative reading under "Assumed".
2. Build: small changes (a few files, one area) the main session does itself, since an agent
   re-reads everything cold. Bigger chunks: `builder`, or `builder-heavy` in trust territory.
   Give the spec path, the chunk and CHECKS; never paste code.
3. CHECKS; on failure back to the builder, at most 2 tries. Visible changes: sync the test copy
   and crawl the changed pages (`--views phone,wide,dark`).
4. Review: the tier's reviewers in one message (parallel). Code reviewers get the commit range,
   spec path and CHECKS output; the UX reviewer only screenshot paths and one line per page on
   its purpose, nothing else.
5. Triage: the main session checks every finding against the code. Act without asking: fix what
   is right, take the recommended option on "ask" findings, skip what is wrong. Ideas for the
   reviewed pages are built; ideas about other pages go to the notes' to-do list. Fixes in one
   batch. Re-review only Tier 2 logic fixes, by the reviewer that found them. At most 2 fix
   rounds; what is still open goes in the report.
6. Commit (files by name). Log in `.agent-runs/<date>-<slug>/log.md` (tier and why, chunks,
   check results, finding counts, decisions); one row per reviewer run in the ledger
   (`date,slug,tier,reviewer,findings,accepted,rejected,duplicate`); update the actions file
   (paths in `docs/agents.md`).
7. Every 10 reviewer runs of a kind, read the ledger and propose model or effort changes as the
   shared agents' README says.

**Stop and ask** only for: a destructive or irreversible action; pushing or deploying; a new
dependency, external service or cost; anything public; production data changes; a request that
conflicts with the requirements; a choice that changes what a price, signal or alert means; two
failed fix rounds on a bug. When the owner asked for continuous work, prepare the decision in the
actions file (section C) with a recommendation and continue with other work.

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
