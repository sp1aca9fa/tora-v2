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

- Public: `CLAUDE.md`, `requirements.md` (Core, and the chapter of the phase in progress), and
  `docs/rules/` (one file per concern: `values.md` for valuation, `buy-timing.md`, `opportunities.md`,
  `sources-markets.md`, `alerts.md`, `collectors.md`, `data-model.md`, `accounts.md`).
- Private: `collectors/ops/claude-rules.md` (read it if it exists; its hard rules never break).

## Risk class

B (recomputable): derived values are rebuilt nightly from kept raw data; user accounts make auth
and access the exception (`builder-heavy` at `high` effort there, as under "Models and efforts").

## Trust territory (Tier 2)

Areas: collectors and price parsing or matching, sources, valuation, FX and portfolio values, buy
timing, opportunities and popularity math, alerts (who gets what, how often), auth and access
checks in server actions, migrations, backups and restore, imports, merges and deletes, the
self-update and server scripts.

Paths (a changed file here makes the change Tier 2; a test or Markdown file under them stays Tier 0, as `CLAUDE.md`'s Tier 0 row ("tests only") and `ops/process-check.json` (`tier0`) have it):

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
- A price matched to the right item and condition; a collected price never deleted or changed to
  put a value right (a wrong one is marked; the two cases where prices leave are in
  `docs/rules/data-model.md`); derived values can be recomputed.
- No look-ahead in tests of signals (prices read before their day).
- Quantiles and medians not computed on too few points.
- Plug-ins (collectors) never write to the database directly.

## Owner decides

A closed list, with the items `/ship` section 4 always adds (pushing or deploying; a new dependency, service or cost; publishing; an irreversible action on real data; a conflict with the requirements); anything else the orchestrator decides and reports. What a price, signal or alert
means; direction (what a phase covers, new features); production data changes (give the command,
never run it).

## Doc levels

Doc review (`/ship` section 9) levels each changed doc hunk by its content (0 to 3); this section
only raises a level. Adopted by the commit in which `CLAUDE.md` points to `/ship` section 9, which also adds this section (`9943c31`, 2026-11-25): text from before
that commit is reviewed once, doc by doc (catch-up).

- Docs (public): `CLAUDE.md`, `README.md`, `requirements.md`, `docs/`, `.env.example`,
  `collectors-public/template/README.md`, and the message files `apps/web/messages/en.json`,
  `ja.json` and `es.json`.
- Docs (private submodule): `collectors/README.md`, `collectors/ops/claude-rules.md`,
  `collectors/ops/home-server.md`, and `collectors/ops/notes.md` without its to-do list and its
  findings (a source's quirk or a setup fact a builder relies on first moves out of them, into
  the notes' other sections or a rules file, where it is leveled by its content, as `/ship`
  section 9 says for level 0). Private docs are diffed in the submodule (`git -C collectors diff`, plus untracked files) and reviewed
  before the owner pushes it; their `doc-reviews.csv` row carries the submodule's commit.
- Message files: their top-level keys are their sections. A change to any of the three files
  brings the changed top-level keys into scope, in all three files, and a `doc-reviews.csv` row's
  scope lists the key names. A text takes the code's numbers by name (`docs/languages.md`,
  "Numbers in a text"), so most texts are help text at level 1; a text that defines a rule or
  types a number is leveled by its content. For the catch-up, parts are groups of whole top-level
  keys in file order, of the size `/ship` section 9 sets, counting the words of those keys in all
  three files.
- Excluded: `LICENSE.md`; `docs/history.md` (a record of each phase, nothing is built from it);
  generated files (`collectors-public/catalog/data/`, drizzle's migration output); the S36
  chapter of `requirements.md` ("S36: Wishlist") until the Wishlist has its rules file, then that
  file comes in at its levels.
- `docs/decisions.md` is the decisions log: an entry added after adoption is at least level 2 and
  no past entry is edited (`/ship` section 9). Entries added before the adoption commit are
  records and are not caught up, except the entry of 2026-11-24 "The log moved here from the
  requirements" (which entry replaced which), since builders read it for what holds now.
- Level 0 kinds, never reviewed as docs: `collectors/ops/actions.md` and `actions-done.md` (they
  keep `Mode: actions`), the notes' to-do list and findings, `assumptions.md`,
  `doc-code-differences.md`, the plan, proposal, replay, rehearsal, sample and record files in
  `collectors/ops/`, the ledgers, `collectors/ops/doc-sort/`, the drill folders and run folders.
- Floor: 1 for every hunk, wording-only hunks included, in `CLAUDE.md`, this profile,
  `requirements.md` outside the Status table, and `collectors/ops/claude-rules.md`. On the other
  doc paths outside `docs/rules/`, a wording-only hunk stays level 0, recorded as `/ship` section
  9 says.
- Paths that raise: every hunk in `docs/rules/`, wording-only hunks included, is at least 2, and
  3 in a section that states a number, a window, a limit or an order of steps, or in a "Numbers"
  table. In the catch-up a rules file that states any number is reviewed whole at level 3.
- A number of the code is stated once, in its rules file, with its constant. A guide, the
  requirements or a text that repeats it with a pointer to that file is at least level 1 and must
  match it; without a pointer it counts in full (level 3) and the fix is the pointer.
- Reference tools: none. Most of Tora's numbers are choices (a threshold, a window, a pace) backed
  by a dated decision or by a replay on the owner's data, not by a standard. For
  `doc-reviewer-source` the outside authorities are: a site's own rules where a doc cites them (a
  robots file, an API's terms; read only pages the project's rules allow, never a page behind a
  refusal or a bot check), the definitions of the statistics used (median, quantiles, Tukey's
  fences, Wilson's interval and the like), and the docs of the tools named (SQLite, Next.js,
  systemd, TOTP). A number that is a choice is confirmed by the decision, replay or rehearsal the
  doc names for it (the private record files; `docs/decisions.md`), not by a web page; one that
  names nothing is a finding.
- Doc and code: the code came first in Tora. A reviewer that finds a doc and the code apart
  files it as an `ask` quoting both sides; whatever it recommends, the orchestrator settles it by
  the plan's steps (`collectors/ops/doc-review-plan.md`, "When a doc and the code disagree") and records the
  case in `collectors/ops/doc-code-differences.md`. A doc commit never changes code.

## Doc review focus

- Also the Domain checklist above, `CLAUDE.md`'s hard rules and the private rules file's.
- Which price: asked or sold, with or without shipping, in which currency, tax included or not,
  and from which night's read. A rule that compares two prices says both are the same kind.
- Time: the app's time zone (`docs/rules/data-model.md`), what a "night" and a "day" are, and that a rule reads only what
  was stored by then.
- Missing, unknown or unverified data: what the rule does (never 0 or a guess; an unverified ask
  sends no alert, `requirements.md`, "S36: Wishlist").
- A number is stated once and matches the constant in the code; a text that repeats it points to
  its home. Windows and limits say whether their ends are included ("5 or more", "under 30 days").
- Collectors: the pace, the daily number and the "never" rules in a doc match the plug-in,
  `docs/rules/collectors.md` (the pace, "Refusals": a refusal is never worked around), the hard
  rules in `CLAUDE.md` and the per-site rules in `collectors/ops/claude-rules.md`.
- Public and private: no private name, board code or scraping detail in a public doc; public
  examples use the neutral made-up names.
- Evidence: a threshold that rests on a replay, a rehearsal or a labeled sample names it (file
  and date); one that is a choice says whose and when.
- Migrations add-only and collectors never write to the database: any doc that describes these
  says the same as `CLAUDE.md`. A source marked `noAi` is left out of everything that feeds a
  model, as `docs/rules/sources-markets.md` says; that is wider than `CLAUDE.md`'s "never reach
  Claude", which a doc may also state.
- Accounts: every rule that reads a person's data says whose rows it reads; nothing in a doc lets
  one account see another's.

## Standing rules

Confirmed by the owner 2026-11-04.

- 2026-10-29: reviewer findings: fix what is right, take the recommended option on "ask"
  findings, skip what is wrong; ideas for the reviewed pages are built, others go to the notes' to-do list. (An ask on the "Owner decides" list, or on `/ship` section 4's always-list, still goes to the actions file: `/ship` section 5 step 7.)

## Texts and time

- User-facing text: `apps/web/messages/en.json` (other languages fall back to it).
- Days and day boundaries in the app's time zone (`docs/rules/data-model.md`).

## CHECKS

`pnpm check:all`. CI then also runs `pnpm build` (`.github/workflows/ci.yml`), which `check:all` leaves out. In Claude's sandbox use the split commands in the private rules (`collectors/ops/claude-rules.md`, "Commands"): the web typecheck needs a workaround there, and `next build` fails.

## Models and efforts

The orchestrator passes these values as `model` and `effort` when it starts each agent.

| Role                                 | Model  | Effort | Note                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| builder                              | sonnet | medium | pages, texts, glue, docs, tests                                                                                                                                                                                                                                                                                                                          |
| builder-heavy                        | opus   | medium | `high` for auth, sessions, 2FA, devices and access checks                                                                                                                                                                                                                                                                                                |
| code-reviewer-light                  | sonnet | medium |                                                                                                                                                                                                                                                                                                                                                          |
| code-reviewer                        | opus   | high   | above the class's minimum; see below                                                                                                                                                                                                                                                                                                                     |
| ux-reviewer                          | sonnet | medium | every visible change; also asks the trust question                                                                                                                                                                                                                                                                                                       |
| trust-reviewer                       | -      | -      | not used: the UX reviewer asks it (one run fewer per change)                                                                                                                                                                                                                                                                                             |
| triage                               | opus   | medium | Tier 3 with no doc reviewer; a batch holding a doc reviewer uses the row `triage, Mode: docs`; otherwise none, and the main session checks the findings itself: the code and UX reviewers and the `Mode: actions` run look at different things and cannot overlap (the owner, 2026-10-30, "no triage agent"; Tier 3's triage: Setup changes, 2026-11-03) |
| Tier 3: builder-heavy, code-reviewer | opus   | xhigh  | plan, build, normal and adversarial review                                                                                                                                                                                                                                                                                                               |
| challenger                           | opus   | high   | direction only, on request or at a phase's start                                                                                                                                                                                                                                                                                                         |
| summarizer                           | haiku  | low    |                                                                                                                                                                                                                                                                                                                                                          |
| doc-reviewer-consistency             | opus   | high   | doc level 1-3; follows `code-reviewer`, see below                                                                                                                                                                                                                                                                                                        |
| doc-reviewer-clarity                 | sonnet | medium | doc level 2; a different model on purpose                                                                                                                                                                                                                                                                                                                |
| doc-reviewer-source                  | opus   | high   | doc level 3; web tools                                                                                                                                                                                                                                                                                                                                   |
| doc-reviewer-examples                | opus   | high   | doc level 3                                                                                                                                                                                                                                                                                                                                              |
| doc-reviewer-adversarial             | opus   | high   | doc level 3                                                                                                                                                                                                                                                                                                                                              |
| doc-reviewer-derive                  | sonnet | high   | on trial, doc drills only                                                                                                                                                                                                                                                                                                                                |
| triage, `Mode: docs`                 | opus   | medium | any batch of two or more reviewers holding a doc reviewer, Tier 3 and code reviewers included: one run for the batch                                                                                                                                                                                                                                     |

The doc reviewers are at the shared class table's row for class B, except
`doc-reviewer-consistency`: that table ties it to the code reviewer, which is at high here. In a
doc drill, `builder-heavy` (plants and scores) runs at the Tier 3 row.

Why `builder-heavy` stays at medium, not the shared class table's class A, which is at high: Tora's math is medians, quantiles and joins over
kept raw data, not chained records, so a bug is recomputed away the next night. Why `code-reviewer`
is at high: on 4 past changes with known bugs, high caught 11 of 12 and medium 9 of 12, for about
22% more cost. All of the gap is one change, so this is a hint; the cost is small enough to take it.

## Reviews used

- Tier 0: none, apart from doc review (below). Tier 1: code-reviewer-light (+ ux-reviewer if visible). Tier 2: code-reviewer
  (+ ux-reviewer if visible). Tier 3: code-reviewer on the plan, then code-reviewer normal and
  adversarial, triage.
- A recoverable one-off (`/ship` section 2, recoverable route): Tier 2 with a plan review, a normal
  review, and one narrow pass in adversarial mode.
- Owner's actions file: code-reviewer-light with `Mode: actions`, once per task, when items with
  commands changed.
- Docs, in any tier (`/ship` section 9; "Doc levels" above): level 1 `doc-reviewer-consistency`;
  level 2 adds `doc-reviewer-clarity`; level 3 is `doc-reviewer-consistency`,
  `doc-reviewer-source`, `doc-reviewer-examples` and `doc-reviewer-adversarial` (no `doc-reviewer-clarity`, as in `/ship` section 9's table; the catch-up adds it: `collectors/ops/doc-drill-2026-11-25.md`, "What follows from it"); `triage` with
  `Mode: docs` when the batch holds two or more reviewers, code reviewers included (one run for
  the batch; `/ship` sections 5 and 9).
- Page crawler for screenshots: `pnpm crawl --views phone,wide,half,full,dark --shots <dir>` on the test
  copy (sync it first).

## Paths

- Spec template: `docs/spec-template.md`.
- Run logs: `.agent-runs/<date>-<slug>/` (git-ignored).
- Ledgers: `collectors/ops/agent-ledger.csv` (per reviewer run), `collectors/ops/run-ledger.csv`
  (per task, from 2026-11-03), `collectors/ops/doc-reviews.csv` (per doc reviewed, from
  2026-11-25).
- Owner's actions: `collectors/ops/actions.md` (done items in `actions-done.md`).

## Setup changes

- 2026-11-03: risk class B recorded; Tier 3 row added (`xhigh`); triage used in Tier 3; run
  ledger started.
- 2026-11-04: challenger added (opus high); evaluated per `/ship` section 8, not by the noisy or redundant triggers.
- 2026-11-05: process check added (`docs/ci.md`, `ops/process-check.json`, which must agree with the Paths list above): commit trailers state tier and reviews, CI compares them with the changed files. The workflows and the check's own files joined the Paths, and so did `*-actions.ts` files and new pages, which the list did not name.
- 2026-11-07: from a spend measure over one session in each project, about a tenth of it avoidable around builders: builders auto-compact at 200k, a long rehearsal runs in the background with no polling and on a small sample while fixing, a start map goes in the builder's prompt, a stale resume above about 150k gives way to a fresh builder; the agent ledger gains `severe` and `fix_caused`; `spend-view.mjs` joins the setup review. No review step changed.
- 2026-11-07: `code-reviewer` moved from medium to high, by the owner, on the comparison noted under "Models and efforts"; the class table stays as it is.
- 2026-11-07: `/ship` gains, for class B, the recoverable route for one-offs and two triage rules (no real impact, fixes breeding findings), resting on one Tier 3 task, so reported at each setup review and easy to remove. Landed under the owner's exception to Tier 3 handling: one normal, one adversarial and one re-review, no builder or triage agent, and no rerun of the review measures, which cannot see the narrowed adversarial pass.
- 2026-11-07: by the owner, review measures run only when the setup changes, not per setup review: a reviewer's text, model or effort, or a new model version, which `setup-view.mjs` now reports. No review step changed.
- 2026-11-11: by the owner, edits to the shared setup are checked by what they change: any edit to `/ship` or a shared agent is Tier 3; review measures rerun only for what code reviewers get; a loop edit that could let more through gets a back-check on past tasks. Shared-setup items for the owner now live in the blueprint's `private/global-actions.md`. This project's own reviews are unchanged.
- 2026-11-25: doc review adopted (`/ship` section 9), by the owner's plan of 2026-11-24, after the docs were sorted so that each rule has one home (`docs/rules/`): "Doc levels" and "Doc review focus" added, the six doc reviewers in the table at class B's rows (`doc-reviewer-consistency` at high, as the code reviewer), `doc-reviews.csv` started. The Wishlist's chapter stays out until it has its rules file. Code review steps are unchanged, except that a batch holding a doc reviewer gets one triage for all (`/ship` section 5 step 6).
