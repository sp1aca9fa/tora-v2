# Alerts and the self check

What Tora sends outside the app (Telegram, Discord): each message, who gets it, what triggers it
and when it repeats; the flags that only show in Settings; and the self check of the collected
sales. This file is the one home of these rules and their numbers. The code is `packages/db/src/alerts.ts` (most of it; `pnpm alerts` in `packages/db/src/scripts/alerts.ts`, a hosted app's daily job in `apps/web/src/app/api/cron/daily/route.ts`), `stepAlert` in `packages/core/src/signals.ts` and `savedAlertState` in `packages/db/src/watches.ts` (the watch memory), `quietSources` and `collectorHealth` in `packages/db/src/sources.ts`, `checkDbBudget` in `packages/db/src/db-usage.ts`, `packages/core/src/data-check.ts` and `packages/db/src/data-check.ts` (the self check), and `packages/db/src/schedule.ts` and `apps/web/src/app/(app)/settings/collectors/data-check-section.tsx` (two Settings flags).
Channels, message style and setup: [the Alerts guide](../alerts.md).

Not here: the buy zone and the verdict an alert is sent from ([Buy timing](buy-timing.md)); when a
store post makes a message ([the Alerts guide](../alerts.md#store-notices-how-you-are-told),
[Store notices](../store-feeds.md)); the alerts of wished games, which have their own rules (the Wishlist chapter of `requirements.md`, until it has a rules file).

## Words

- **Admins to alert**: admins who are not disabled and have the "failures" kind on.
- **Kinds**: failures, imports, actions, buy, drops. Each is on until the person turns it off.
- **Sent**: at least one of the person's channels took the message; for a message to admins, a channel of any admin. A rule's memory of what was told is written only then, unless the rule says otherwise, so a message no channel took goes again at the next occasion.
- **Day**: a calendar day in the app's time zone, unless hours are said.
- **The morning check**: once a day. A self-hosted app runs it itself from 08:00 app time (it looks every 2 minutes whether today's ran); a hosted app is called by a daily job at a fixed UTC hour (`apps/web/vercel.json`, 08:00 in Japan). On a self-hosted app one step failing does not skip the others; on a hosted app a failing check skips that morning's summaries.

## What is sent

| Message                                                                                                                                    | To                    | When                  | Repeats                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------- | ----------------------------------------------- |
| The collect or the backup failed                                                                                                           | admins                | right after the run   | one per kind a day (1)                          |
| No collect, or no backup, for 26 hours or more                                                                                             | admins                | the morning check     | at most once in 20 hours                        |
| Listings set aside ([Collecting](collectors.md#what-is-read))                                                                              | admins                | right after the run   | one a day (1)                                   |
| Saved results that differed and were rebuilt                                                                                               | admins                | right after the run   | one a day (1)                                   |
| A quiet source                                                                                                                             | admins                | the morning check     | at most once in 20 hours, while quiet           |
| The database's month past its read budget, or heading past it                                                                              | admins                | the morning check     | at most once in 20 hours                        |
| A self check finding                                                                                                                       | admins                | the morning check     | once while it lasts (1)                         |
| The self check itself failed or stopped running                                                                                            | admins                | at once, or after run | at most once in 20 hours                        |
| An automatic server update that failed (went back, or stayed on its version), was refused (CI failed, uncommitted edits) or waits 24 hours | admins                | at once               | once per update                                 |
| A marketplace refused or stopped the daytime reads                                                                                         | admins                | at once               | once                                            |
| A failed sign-in                                                                                                                           | the account, else (2) | at once               | one per account in 15 minutes (3)               |
| Imports that did not add every row                                                                                                         | each person           | the morning summary   |                                                 |
| How many things wait on Actions                                                                                                            | each person           | the morning summary   |                                                 |
| A watched item turned Good price, or an ask is at or under its target                                                                      | each person           | after each collect    | again only after 14 days out                    |
| Sharp drops of owned or watched items                                                                                                      | each person           | the morning summary   | each item and condition at most once in 14 days |
| Store posts for the person's area                                                                                                          | each person           | at once               | [Store notices](../store-feeds.md)              |

1. One message a day per kind of entry (a failed collect, a failed backup, listings set aside, and
   so on). A second entry of the same kind on the same day is in Activity only and is never sent.
   When every channel of every admin failed, the entries wait for the next occasion, for 24 hours at most; with no admin channel at all they are dropped. For the morning check's rows the 20 hours count from the entry, whether a channel took it or not, and a self check finding counts as told when found: one that no channel took within those 24 hours is never sent.
2. The account's own channels. When none took it, or for a disabled or unknown account: the admins.
3. Further failures within the 15 minutes are counted in the next message. The 15 minutes start at a message's attempt, whether a channel took it or not; the app forgets them when it restarts, and each running copy of a hosted app keeps its own. A failure with the right password has its own 15 minutes; all names no account has share one.

**Nothing ran.** Counted from the newest collect, or backup, in Activity; a failed run counts as a
run. Nothing is said before the first run ever.

**A quiet source.** Its last 3 days with runs added no sale, while of the up to 14 days with runs
before them (at least 7 are needed) 80 % or more added some. Failed and refused runs are not days
with runs. Only runs of the last 24 days count, so a source with runs on fewer than 10 of them is never quiet. It is told each morning it is quiet: a source that runs daily and stays silent, on its 3rd to 5th silent days (its silent days soon count among the days before); one that runs less often, or stops running, on more.

**The read budget** (a hosted database). The rows read this UTC month are over the budget (150 million unless the admin sets another), or, from the 5th UTC day, the rows read so far divided by the UTC days gone (the current one in part) times the days in the month are over it.

**The morning summary.** One message per person with a channel, with what applies of: imports since their last summary that did not add every row, Actions (admins
also get how many items wait for a new page link), sharp drops. Nothing to say, nothing sent. At
most one in 20 hours.

## Watch alerts

Sent after each collect, for every watch except games (wished games have their own alerts), and each goes once even when two collects end close together. They go on what was saved today only (the Target floor excepted): an item with no numbers or listing report today sends nothing, and a collect in which some sources failed still sends from what it saved.

- **Good price**: the item's saved numbers are today's and its verdict under the person's strategy
  is Good price. A verdict of Wait sends nothing. With limited data it is sent only while the watch's "even with limited data" switch is on. Any other verdict (no verdict included, when today's numbers have no fair value), or Good price on limited data with the switch off, counts as out.
- **Target**: each source's lowest ask in the watch's condition, from its listing report of today (every source, not only the one the prices come from as in [Buy timing](buy-timing.md#what-is-saved); per unit, as listed there). A source whose lowest ask is under half the fair value of the newest saved numbers of the watch's item and condition, at most 3 days old, is left out for the night (more likely a part or another product). Without such numbers, or when they have no fair value, every source counts. The alert goes when the lowest left is at or under the watch's target.
- **Memory**, kept per watch for each of the two: sent on entering the condition; nothing while it
  stays in; after it leaves, sent again only on an entry 14 or more days after the day it last
  left. A night with no numbers for it (no saved numbers today, or no ask left) neither enters nor leaves. A new condition starts both over; a new target, in the edit form or by watching the item and condition again, starts over the target's only. A new watch, or a memory started over, counts as out: an item already in on its first night with numbers sends. The memory is kept for people with no channel or with the kind off too, so turning alerts on sends no old news; for anyone else it is written when a channel took the alert, and until then the alert goes again after the next collect.

Example. A watch with a target of 8,000 on an item with a fair value of 9,000. Tonight one source's lowest ask is 4,000 and another's is 7,900: the first source is left out (4,000 is under half of 9,000) and 7,900 is at or under 8,000, so the alert goes. Had both been on one source, its report would hold only the 4,000 and nothing would go. The next night's 7,800 sends nothing. The ask rises to 8,500 on the 3rd and is back at
7,900 on the 10th: 7 days out, nothing. It leaves again on the 12th and returns on the 27th: 15
days after it last left, so the alert goes again.

## Sharp drops

For every item and condition the person owns or watches, games included: the newest saved numbers, when they are today's or yesterday's and have a fair value, against the oldest fair value saved 6 to 8 days before them (7 days, a day either way). A fall of 15 % or more is told, the biggest first, each item and condition at most once in 14 days. The earlier
numbers must be from after the item's last re-check of stored sales, which changes values without
the market moving.

## What was sent

Every delivery is kept in the person's history for 180 days of 24 hours. A self-hosted app drops older rows in
its morning check; a hosted app's daily job does not drop them.

## Shown in Settings only

Never sent as a message.

- **Not collected for 3+ days** (per source): active listings added over a day ago whose last
  successful read is over 72 hours old, or that were never read.
- **A long run, a long night**: in [Collecting](collectors.md#when-the-collect-runs).
- **Median moved more than 50 %** (per source, item and condition): the median of the single sales
  of today and the 7 days before it against the median of the 30 days before those, with 3 or more sales on each side, when the first differs from the second by more than 50 % of it.
- **No check heard from the server**: more than 3 times its usual interval (the median gap between its past checks) has passed since the
  server last asked the app whether to collect.
- **The self check has not run** since a date: its last run is over 2 days old. Before its first run, it shows that the check never ran.

## The self check

Each morning, once, Tora checks the collected sales and tells admins what looks odd. It fixes
nothing. It skips a morning with no collect in the last 26 hours (a failed one counts, as in Nothing ran). It reads the sources that declare
sold prices and are not kept from models.

Words:

- **The week**: the last 7 calendar days, the check's own day included.
- **Judged sale**: a sale of the week whose item and condition have 5 or more sales of the same
  source in the last 60 days. Sales with a guessed lot size, with no condition or with no price
  are counted as kept: they are not judged sales and do not count toward the 5.
- **Found** and **kept** sales: the sale rows of the week a source stored, all of them, and those not excluded.
- **Far sale**: a judged sale over 2 times, or under half, the median of those 60 days.
- **Usual**: a number's own earlier level. For a source's shares and rates: the median of its last 28 nights that had one, whatever their dates, 14 needed. For counts (the week's kept or judged sales, as counted each night): the median of the last 7 nights at least a week old, or of fewer when fewer are left. Nights under an open finding stay out, and so do Judged's nights held back with Kept; while Kept or Judged is open, so do the nights from 6 days before it opened (for Judged, the earlier of its own and Kept's opening). For Nothing compared: the median of the items and conditions compared on the check's last 7 nights at least a week old, nights under its finding included.
- **Learning**: a source's checks, Leans included, say nothing until 14 nights of its own numbers exist, counted from its last reset. Apart and Nothing compared wait only for 14 nights of the check as a whole, whatever the source's. A source newly kept from models starts the whole check over.

| Check            | Fires when                                                                                                                                                   | Needs                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Far share        | the far share of the judged sales is 1.5 times its usual or more, with 5 or more far sales and 1 point or more above it                                      | 100 or more judged sales                                                |
| Far share, level | the far share is 5 % or more, whatever is usual                                                                                                              | 100 or more judged sales                                                |
| Kept             | the week's kept sales are under 0.7 times the usual                                                                                                          | a usual of 100 or more; an OK or partial run on 6 or more of the 7 days |
| Keep rate        | kept sales over found sales is under 0.7 times its usual                                                                                                     | 100 or more found sales                                                 |
| Judged           | the judged sales are under half the usual                                                                                                                    | a usual of 100 or more                                                  |
| Nothing compared | no item and condition has 5 or more sales in the 30 days at each of two sources of one market                                                                | a usual of 20 or more                                                   |
| Apart            | for an item and condition, two sources of one market have 30-day medians over 2 times apart                                                                  | 5 or more sales of each in the 30 days                                  |
| Leans            | a source's 30-day median is over 2 times (high) or under half (low) the other sources' of its market pooled, on 10 or more items more one way than the other | 5 or more sales of each in the 30 days                                  |

- Exactly at a limit ("0.7 times", "half", "2 times") nothing fires.
- While Kept is open or firing, Judged falling with it is the same fault and is held back, unless
  it fell clearly harder (its ratio to its usual under 0.7 times Kept's).
- After a re-check of stored sales, the far share has no usual until 14 new nights; an open finding
  keeps its level.
- Markets are never compared with each other.

**A finding** is told once while it lasts: a source's finding on the morning it opens; the Apart ones together, at most once in 7 days, on a morning they fire (one that stops firing first may close untold). A message shows 10 lines, then how many more, with the link to all of them; those are not sent later. It closes after 3 nights in a row judged and fine; a night not judged does not count nor break the row. An Apart finding also closes when it could not be
judged for 30 days. A closed finding that comes back is told again.

**A reset** (`pnpm alerts data-check-reset <source>`) accepts a source's numbers as they are: its levels start over from that day and its own findings close (Apart findings stay until they close as above).

**The check itself**: a check that throws is told at once. A check that has not run while collects
ran on 3 or more days since its last run is told after the next run.

Example. A source with 400 judged sales this week, 14 of them far: a far share of 3.5 %. Its usual
is 2.1 %. 3.5 is over 1.5 times 2.1 (3.15), 14 is over 5 and the share is 1.4 points above: the far
share fires. With a usual of 2.5 % it would not (1.5 times is 3.75).

## Numbers

Each is a choice.

| Number                                                          | Value                                      | In the code                                                               | Chosen                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing ran                                                     | 26 hours                                   | `MISSED_HOURS`                                                            | Claude, at build, 2026-10-16                                                                                                                                                                                                                             |
| Morning check: from, looks every                                | 08:00; 2 minutes                           | `MORNING_CHECK_HOUR`, `FEED_CHECK_MINUTES`                                | Claude, at build: the 08:00 2026-10-16 (the hosted daily job), kept in the app 2026-10-21; the 2 minutes 2026-10-19 (the store feeds' check)                                                                                                             |
| Morning check on a hosted app                                   | 23:00 UTC (08:00 in Japan)                 | `MORNING_CHECK_UTC_HOUR`                                                  | Claude, at build, 2026-10-16                                                                                                                                                                                                                             |
| Morning items, the summary: not again in                        | 20 hours                                   | `SUMMARY_GAP_HOURS`; the other 20 hours a literal                         | Claude, at build, 2026-10-16                                                                                                                                                                                                                             |
| Quiet source                                                    | 3 days; 80 % of 7 to 14                    | `QUIET_DAYS`, `USUAL_DAYS`, `quietSources`                                | the owner, 2026-10-25; the minimum of 7: Claude, at build, 2026-10-25                                                                                                                                                                                    |
| Read budget, pace from                                          | 150 million; the 5th                       | `DEFAULT_ROWS_READ_BUDGET`, `PACE_FROM_DAY`                               | Claude, at build, 2026-10-18, under the owner's "well under the quota" of 2026-10-17                                                                                                                                                                     |
| Watch alert again after                                         | 14 days out                                | `ALERT_QUIET_DAYS`                                                        | the owner, 2026-10-18                                                                                                                                                                                                                                    |
| Asks left out of the target alert                               | under half fair value                      | `ASK_FLOOR`                                                               | Claude, at build, 2026-10-31                                                                                                                                                                                                                             |
| Sharp drop                                                      | 15 %, 7 days, 14 days                      | `SHARP_DROP_7D`, `SHARP_DROP_DAYS`, `ALERT_QUIET_DAYS`                    | the owner, 2026-10-18                                                                                                                                                                                                                                    |
| Failed sign-in                                                  | one in 15 minutes                          | `LOGIN_ALERT_QUIET_MS`                                                    | the owner, 2026-10-30                                                                                                                                                                                                                                    |
| History kept                                                    | 180 days                                   | `ALERT_LOG_DAYS`                                                          | the owner, 2026-10-24                                                                                                                                                                                                                                    |
| Store notices: a sent message's record kept                     | 3 days                                     | `MESSAGE_DAYS`                                                            | Claude, at build, 2026-10-26                                                                                                                                                                                                                             |
| Store feed silence: the limit chosen; the default               | 15, 30 or 60 minutes; 15                   | `FEED_SILENT_MINUTES`, `DEFAULT_FEED_PREFS`                               | the choices and the default of 10: Claude, at build, 2026-10-19; 5 and 10 dropped and the default 15: Claude, 2026-11-26 (review of the board userscript 1.19, round 2); a stored 5 or 10 reads as 15                                                    |
| Store feed silence: a board's limit                             | the limit times the boards watched times 2 | `BOARD_ROUND_FACTOR`, `boardSilentMinutes`                                | Claude, 2026-11-26, from a simulation in that review (pages 180 to 300 seconds apart, with pages before: 3 boards gave about 3.9 false alerts a day at times 1 and 0.03 at times 2; the simulation had no steps or blocks, a rerun with them is pending) |
| Store feed silence: a board counts as watched if visited within | 6 hours                                    | `WATCHED_RECENT_HOURS`                                                    | Claude, 2026-11-26 (the same review)                                                                                                                                                                                                                     |
| Store feed silence: told again every                            | 2 hours                                    | `REMIND_HOURS` (`packages/db/src/stores.ts`)                              | the owner, 2026-10-22 (decision log)                                                                                                                                                                                                                     |
| Store feed: the next visit a push may announce                  | within 9 hours                             | `NEXT_MAX_MS` (`packages/db/src/stores.ts`)                               | Claude, at build, 2026-10-24 (6 hours); 9 hours: Claude, 2026-11-26 (the board userscript's longest blocked wait is 8 hours)                                                                                                                             |
| Settings: not collected, median moved                           | 3 days; 50 %, 7 and 30                     | `HEALTH_STALE_DAYS`, `JUMP_SHARE`, `JUMP_RECENT_DAYS`, `JUMP_BEFORE_DAYS` | 50 %: the owner's requirements, 2026-10-09; the rest: Claude, at build, 2026-10-09                                                                                                                                                                       |
| Settings: self check not run, server not heard from             | 2 days; 3 intervals                        | `STALE_DAYS`, `collectSchedule`                                           | Claude, at build: the 2 days 2026-11-07; the 3 intervals 2026-10-21                                                                                                                                                                                      |
| Self check: every limit above                                   | as stated                                  | `DATA_CHECK`                                                              | the owner and Claude, 2026-11-07 (see below)                                                                                                                                                                                                             |
| Self check: skips after, stopped after, lines a message         | 26 hours; collects on 3 days; 10 lines     | `NO_COLLECT_HOURS`, `STOPPED_COLLECT_DAYS`, `DATA_CHECK_LINES`            | Claude, at build, 2026-11-07                                                                                                                                                                                                                             |

The self check's limits: learning 14 nights, 1.5 times the usual far share, over 2 times apart with 5 sales each and 10 items one way are the owner's proposal of 2026-11-07. The far sale's measure (over 2 times or under half the 60-day median) is the one the sales accuracy chapter counted with ([history](../history.md)). Claude added the others when the check was planned and built (2026-11-07), after a replay on the owner's sales. All wait for the owner's answer in the actions file; until then the check runs on them.
