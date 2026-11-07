# Agent profile

Read by the shared agents (the `selfhost-blueprint` repo's `claude/agents`, linked into
`~/.claude`) and by the orchestrator. The loop, tiers and report format are in `CLAUDE.md`
("Agents").

## The app

Tora is a self-hosted collection tracker: prices collected from shops and marketplaces, a
portfolio, buy suggestions and store notices. The worst failure is a wrong price, a wrong
portfolio value, a missed or duplicated alert, or a leak between accounts. Raw prices are kept and
derived values (valuations, signals, popularity) are recomputed each night, so most calculation
bugs cost a few wrong days; a leak between accounts cannot be recomputed away.

## Rules files

- Public: `CLAUDE.md`, and `requirements.md` Core (rules 5-7 for data, valuation and collectors).
- Private: `collectors/ops/claude-rules.md` (read it if it exists; its hard rules never break).

## Risk class

B (recomputable): derived values are rebuilt nightly from kept raw data; user accounts make auth
and access the exception (`high`).

## Trust territory (Tier 2)

Areas: collectors and price parsing or matching, sources, valuation, FX and portfolio values, buy
timing, opportunities and popularity math, alerts (who gets what, how often), auth and access
checks in server actions, migrations, backups and restore, imports, merges and deletes, the
self-update and server scripts.

Paths (a changed file here makes the change Tier 2):

- `packages/core/`, `packages/db/`, `packages/auth/`, `packages/collector-sdk/`, `packages/mcp/`
- `collectors-public/src/`, `collectors/` code (not `collectors/ops/`)
- `apps/web/src/lib/` and every `actions.ts`, `*-actions.ts` or route under `apps/web/src/app/`
- a new `page.tsx` under `apps/web/src/app/` (a change to an existing page is not Tier 2 by path)
- `ops/update-server.sh`, `ops/ci-status.sh`, `ops/env-value.sh`, `ops/systemd/`,
  `scripts/collect-cron.sh`
- `.github/workflows/`, `ops/process-check.mjs`, `ops/process-check.json`

## Domain checklist

- Unknown stays unknown (never 0, never a guess); stale data is never shown as current.
- Money carries its currency; per unit vs per lot kept apart.
- A price matched to the right item and condition; raw observations never edited or deleted
  (exclusions are marked); derived values can be recomputed.
- No look-ahead in tests of signals (prices read before their day).
- Quantiles and medians not computed on too few points.
- Plug-ins (collectors) never write to the database directly.

## Owner decides

A closed list; anything else the orchestrator decides and reports. What a price, signal or alert
means; direction (what a phase covers, new features); production data changes (give the command,
never run it).

## Standing rules

Confirmed by the owner 2026-11-04.

- 2026-10-29: reviewer findings: fix what is right, take the recommended option on "ask"
  findings, skip what is wrong; ideas for the reviewed pages are built, others go to the notes'
  to-do list.

## Texts and time

- User-facing text: `apps/web/messages/en.json` (other languages fall back to it).
- Days and day boundaries in the install's time zone.

## CHECKS

`pnpm check:all` (in Claude's sandbox use the split commands in the private rules: the web
typecheck and `next build` need workarounds there).

## Models and efforts

The orchestrator passes these values as `model` and `effort` when it starts each agent.

| Role                                 | Model  | Effort | Note                                                         |
| ------------------------------------ | ------ | ------ | ------------------------------------------------------------ |
| builder                              | sonnet | medium | pages, texts, glue, docs, tests                              |
| builder-heavy                        | opus   | medium | `high` for auth, sessions, 2FA, devices and access checks    |
| code-reviewer-light                  | sonnet | medium |                                                              |
| code-reviewer                        | opus   | high   | above the class's minimum; see below                         |
| ux-reviewer                          | sonnet | medium | every visible change; also asks the trust question           |
| trust-reviewer                       | -      | -      | not used: the UX reviewer asks it (one run fewer per change) |
| triage                               | opus   | medium | Tier 3 only: elsewhere at most two reviewers, no overlap     |
| Tier 3: builder-heavy, code-reviewer | opus   | xhigh  | plan, build, normal and adversarial review                   |
| challenger                           | opus   | high   | direction only, on request or at a phase's start             |
| summarizer                           | haiku  | low    |                                                              |

Why the builder stays at medium, not Saku's high: Tora's math is medians, quantiles and joins over
kept raw data, not chained records, so a bug is recomputed away the next night. Why `code-reviewer`
is at high: on 4 past changes with known bugs, high caught 11 of 12 and medium 9 of 12, for about
22% more cost. All of the gap is one change, so this is a hint; the cost is small enough to take it.

## Reviews used

- Tier 0: none. Tier 1: code-reviewer-light (+ ux-reviewer if visible). Tier 2: code-reviewer
  (+ ux-reviewer if visible). Tier 3: code-reviewer on the plan, then code-reviewer normal and
  adversarial, triage.
- Owner's actions file: code-reviewer-light with `Mode: actions`, once per task, when items with
  commands changed.
- Page crawler for screenshots: `pnpm crawl --views phone,wide,half,full,dark --shots <dir>` on the test
  copy (sync it first).

## Paths

- Spec template: `docs/spec-template.md`.
- Run logs: `.agent-runs/<date>-<slug>/` (git-ignored).
- Ledgers: `collectors/ops/agent-ledger.csv` (per reviewer run), `collectors/ops/run-ledger.csv`
  (per task, from 2026-11-03).
- Owner's actions: `collectors/ops/actions.md` (done items in `actions-done.md`).

## Setup changes

- 2026-11-03: risk class B recorded; Tier 3 row added (`xhigh`); triage used in Tier 3; run
  ledger started.
- 2026-11-04: challenger added (opus high); evaluated per `/ship` section 8, not by the noisy or redundant triggers.
- 2026-11-05: process check added (`docs/ci.md`, `ops/process-check.json`, which must agree with the Paths list above): commit trailers state tier and reviews, CI compares them with the changed files. The workflows and the check's own files joined the Paths, and so did `*-actions.ts` files and new pages, which the list did not name.
- 2026-11-07: from a spend measure over one session in each project, about a tenth of it avoidable around builders: builders auto-compact at 200k, a long rehearsal runs in the background with no polling and on a small sample while fixing, a start map goes in the builder's prompt, a stale resume above about 150k gives way to a fresh builder; the agent ledger gains `severe` and `fix_caused`; `spend-view.mjs` joins the setup review. No review step changed.
- 2026-11-07: `code-reviewer` moved from medium to high, by the owner, on the comparison noted under "Models and efforts"; the class table stays as it is.
