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

## Trust territory (Tier 2)

Collectors and price parsing or matching, sources, valuation, FX and portfolio values, buy
timing, opportunities and popularity math, alerts (who gets what, how often), auth and access
checks in server actions, migrations, backups and restore, imports, merges and deletes, the
self-update and server scripts.

## Domain checklist

- Unknown stays unknown (never 0, never a guess); stale data is never shown as current.
- Money carries its currency; per unit vs per lot kept apart.
- A price matched to the right item and condition; raw observations never edited or deleted
  (exclusions are marked); derived values can be recomputed.
- No look-ahead in tests of signals (prices read before their day).
- Quantiles and medians not computed on too few points.
- Plug-ins (collectors) never write to the database directly.

## Owner decides

What a price, signal or alert means; direction (what a phase covers, new features); anything
costing money or public (pushes, publishing, external services); production data changes (give
the command, never run it).

## Texts and time

- User-facing text: `apps/web/messages/en.json` (other languages fall back to it).
- Days and day boundaries in the install's time zone.

## CHECKS

`pnpm check:all` (in Claude's sandbox use the split commands in the private rules: the web
typecheck and `next build` need workarounds there).

## Models and efforts

The orchestrator passes these values as `model` and `effort` when it starts each agent.

| Role                | Model  | Effort | Note                                                         |
| ------------------- | ------ | ------ | ------------------------------------------------------------ |
| builder             | sonnet | medium | pages, texts, glue, docs, tests                              |
| builder-heavy       | opus   | medium | `high` for auth, sessions, 2FA, devices and access checks    |
| code-reviewer-light | sonnet | medium |                                                              |
| code-reviewer       | opus   | medium | `high` for auth and access                                   |
| ux-reviewer         | sonnet | medium | every visible change; also asks the trust question           |
| trust-reviewer      | -      | -      | not used: the UX reviewer asks it (one run fewer per change) |
| triage              | -      | -      | not used: at most two reviewers, whose areas do not overlap  |
| summarizer          | haiku  | low    |                                                              |

Why medium, not Saku's high: Tora's math is medians, quantiles and joins over kept raw data, not
chained records, so a bug is recomputed away the next night.

## Reviews used

- Tier 0: none. Tier 1: code-reviewer-light (+ ux-reviewer if visible). Tier 2: code-reviewer
  (+ ux-reviewer if visible).
- Page crawler for screenshots: `pnpm crawl --views phone,wide,dark --shots <dir>` on the test
  copy (sync it first).

## Paths

- Spec template: `docs/spec-template.md`.
- Run logs: `.agent-runs/<date>-<slug>/` (git-ignored).
- Ledger: `collectors/ops/agent-ledger.csv`.
- Owner's actions: `collectors/ops/actions.md` (done items in `actions-done.md`).
