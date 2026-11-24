# Alerts and the self check

What Tora sends outside the app (Telegram, Discord): each message, who gets it, what triggers it
and when it repeats; the flags that only show in Settings; and the self check of the collected
sales. This file is the one home of these rules and their numbers. The code is
`packages/db/src/alerts.ts`, `packages/core/src/data-check.ts` and `packages/db/src/data-check.ts`
(the self check), and `collectorHealth` in `packages/db/src/sources.ts` (the Settings flags).
Channels, message style and setup: [the Alerts guide](../alerts.md).

Not here: the buy zone and the verdict an alert is sent from ([Buy timing](buy-timing.md)); when a
store post makes a message ([the Alerts guide](../alerts.md#store-notices-how-you-are-told),
[Store notices](../store-feeds.md)); the alerts of wished games, which have their own rules.

## Words

- **Admins to alert**: admins who are not disabled and have the "failures" kind on.
- **Kinds**: failures, imports, actions, buy, drops. Each is on until the person turns it off.
- **Sent**: at least one of the person's channels took the message. What Tora remembers as "already
  told" is written only then, so a message no channel took goes again at the next occasion.
- **Day**: a calendar day in the app's time zone, unless hours are said.
- **The morning check**: once a day from 08:00 app time. A self-hosted app runs it itself (it looks
  every 2 minutes whether today's ran); a hosted app is called by a daily job. One step failing
  does not skip the others.

## What is sent

| Message                                                               | To                    | When                  | Repeats                              |
| --------------------------------------------------------------------- | --------------------- | --------------------- | ------------------------------------ |
| The collect or the backup failed                                      | admins                | right after the run   | one per kind a day (1)               |
| No collect, or no backup, for 26 hours or more                        | admins                | the morning check     | at most once in 20 hours             |
| Listings set aside (gone 3 nights)                                    | admins                | right after the run   | one a day (1)                        |
| Saved results that differed and were rebuilt                          | admins                | right after the run   | one a day (1)                        |
| A quiet source                                                        | admins                | the morning check     | at most once in 20 hours while quiet |
| The database's month past its read budget, or heading past it         | admins                | the morning check     | at most once in 20 hours             |
| A self check finding                                                  | admins                | the morning check     | once while it lasts                  |
| The self check itself failed or stopped running                       | admins                | at once, or after run | at most once in 20 hours             |
| A server update that went back, could not start, or waits 24 hours    | admins                | at once               | once per update                      |
| A marketplace refused or stopped the daytime reads                    | admins                | at once               | once                                 |
| A failed sign-in                                                      | the account, else (2) | at once               | one per account in 15 minutes (3)    |
| Imports that did not add every row                                    | each person           | the morning summary   |                                      |
| How many things wait on Actions                                       | each person           | the morning summary   |                                      |
| A watched item turned Good price, or an ask is at or under its target | each person           | after the night's run | again only after 14 days out         |
| Sharp drops of owned or watched items                                 | each person           | the morning summary   | each item at most once in 14 days    |
| Store posts for the person's area                                     | each person           | at once               | [Store notices](../store-feeds.md)   |

1. One message a day per kind of entry (a failed collect, a failed backup, listings set aside, and
   so on). A second entry of the same kind on the same day is in Activity only and is never sent.
   When every channel of every admin failed, the entries wait for the next occasion instead.
2. The account's own channels. With none, or for a disabled or unknown account: the admins.
3. Further failures within the 15 minutes are counted in the next message. A failure with the
   right password has its own 15 minutes.

**Nothing ran.** Counted from the newest collect, or backup, in Activity; a failed run counts as a
run. Nothing is said before the first run ever.

**A quiet source.** Its last 3 days with runs added no sale, while of the up to 14 days with runs
before them (at least 7 are needed) 80 % or more added some. Failed and refused runs are not days
with runs.

**The read budget** (a hosted database). The rows read this UTC month are over the budget (150
million unless the admin sets another), or from the 5th the month heads past it at this pace.

**The morning summary.** One message per person with what applies of: imports, Actions (admins
also get how many items wait for a new page link), sharp drops. Nothing to say, nothing sent. At
most one in 20 hours.

## Watch alerts

Sent after the night's collect, for every watch except games (wished games have their own alerts).
They use that night's numbers only, so a failed collect sends none.

- **Good price**: the item's saved numbers are today's and its verdict under the person's strategy
  is Good price. A verdict of Wait sends nothing. With limited data it is sent only while the
  watch's "even with limited data" switch is on.
- **Target**: the lowest ask among today's listings in the watch's condition is at or under the
  watch's target. An ask under half the fair value is left out (more likely a part or another
  product); without a fair value every ask counts.
- **Memory**, kept per watch for each of the two: sent on entering the condition; nothing while it
  stays in; after it leaves, sent again only on an entry 14 or more days after the day it last
  left. Changing the watch's condition or target starts over. The memory is kept for people with
  no channel or with the kind off too, so turning alerts on sends no old news.

Example. A watch with a target of 8,000 on an item with a fair value of 9,000. Tonight's asks are
4,000 and 7,900: 4,000 is under half of 9,000 and is left out; 7,900 is at or under 8,000, so the
alert goes. The next night's 7,800 sends nothing. The ask rises to 8,500 on the 3rd and is back at
7,900 on the 10th: 7 days out, nothing. It leaves again on the 12th and returns on the 27th: 15
days after it last left, so the alert goes again.

## Sharp drops

For every item and condition the person owns or watches, games included: the fair value of the
saved numbers of today or yesterday against the fair value 7 days before them (a day either way).
A fall of 15 % or more is told, the biggest first, each item at most once in 14 days. The earlier
numbers must be from after the item's last re-check of stored sales, which changes values without
the market moving.

## What was sent

Every delivery is kept in the person's history for 180 days. A self-hosted app drops older rows in
its morning check; a hosted app's daily job does not drop them.

## Shown in Settings only

Never sent as a message.

- **Not collected for 3+ days** (per source): active listings added over a day ago whose last
  successful read is over 72 hours old, or that were never read.
- **Median moved more than 50 %** (per source, item and condition): the median of the single sales
  of today and the 7 days before it against the median of the 30 days before those, with 3 or more
  sales on each side.
- **No check heard from the server**: more than 3 of its usual intervals have passed since the
  server last asked the app whether to collect.
- **The self check has not run** since a date: its last run is over 2 days old.

## The self check

Each morning, once, Tora checks the collected sales and tells admins what looks odd. It fixes
nothing. It skips a morning with no collect in the last 26 hours. It reads the sources that declare
sold prices and are not kept from models.

Words:

- **The week**: the last 7 calendar days, tonight included.
- **Judged sale**: a sale of the week whose item and condition have 5 or more sales of the same
  source in the last 60 days. Sales with a guessed lot size, with no condition or with no price
  are counted as kept but left out of prices.
- **Far sale**: a judged sale over 2 times, or under half, the median of those 60 days.
- **Usual**: a source's own earlier level of a number. For shares and rates: the median of the
  last 28 nights, 14 needed. For counts: the median of 7 nights that are at least a week old.
  Nights under an open finding stay out.
- **Learning**: a source says nothing until 14 nights of its own numbers exist, counted from its
  last reset. The checks across sources need 14 nights of the check as a whole.

| Check            | Fires when                                                                                                      | Needs                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Far share        | the far share of the judged sales is 1.5 times its usual or more, with 5 or more far sales and 1 point above it | 100 judged sales                        |
| Far share, level | the far share is 5 % or more, whatever is usual                                                                 | 100 judged sales                        |
| Kept             | the week's kept sales are under 0.7 times the usual                                                             | a usual of 100; runs on 6 of the 7 days |
| Keep rate        | kept sales over found sales is under 0.7 times its usual                                                        | 100 found sales                         |
| Judged           | the judged sales are under half the usual                                                                       | a usual of 100                          |
| Nothing compared | no item and condition has sales of two sources of one market                                                    | a usual of 20                           |
| Apart            | for an item and condition, two sources of one market have 30-day medians over 2 times apart                     | 5 sales of each in the 30 days          |
| Leans            | a source's 30-day median is over 2 times (high) or under half (low) the other sources' on 10 more items one way |                                         |

- Exactly at a limit ("0.7 times", "half", "2 times") nothing fires.
- While Kept is open or firing, Judged falling with it is the same fault and is held back, unless
  it fell clearly harder (its ratio to its usual under 0.7 times Kept's).
- After a re-check of stored sales, the far share has no usual until 14 new nights; an open finding
  keeps its level.
- Markets are never compared with each other.

**A finding** is told once while it lasts: a source's finding on the morning it opens, the Apart
ones together at most once in 7 days, 10 lines a message. It closes after 3 nights in a row judged
and fine; a night not judged does not count. An Apart finding also closes when it could not be
judged for 30 days. A closed finding that comes back is told again.

**A reset** (`pnpm alerts data-check-reset <source>`) accepts a source's numbers as they are: its
levels start over from that day and its findings close.

**The check itself**: a check that throws is told at once. A check that has not run while collects
ran on 3 or more days since its last run is told after the next run.

Example. A source with 400 judged sales this week, 14 of them far: a far share of 3.5 %. Its usual
is 2.1 %. 3.5 is over 1.5 times 2.1 (3.15), 14 is over 5 and the share is 1.4 points above: the far
share fires. With a usual of 2.5 % it would not (1.5 times is 3.75).

## Numbers

Each is a choice.

| Number                                   | Value                   | In the code                                                               | Chosen                 |
| ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------- | ---------------------- |
| Nothing ran                              | 26 hours                | `MISSED_HOURS`                                                            | built 2026-10-16       |
| Morning items, the summary: not again in | 20 hours                | `SUMMARY_GAP_HOURS`                                                       | built 2026-10-16       |
| Quiet source                             | 3 days; 80 % of 7 to 14 | `QUIET_DAYS`, `USUAL_DAYS`                                                | the owner, 2026-10-25  |
| Read budget, pace from                   | 150 million; the 5th    | `DEFAULT_ROWS_READ_BUDGET`, `PACE_FROM_DAY`                               | built 2026-10-18       |
| Watch alert again after                  | 14 days out             | `ALERT_QUIET_DAYS`                                                        | the owner, 2026-10-18  |
| Asks left out of the target alert        | under half fair value   | `ASK_FLOOR`                                                               | built 2026-10-31       |
| Sharp drop                               | 15 %, 7 days, 14 days   | `SHARP_DROP_7D`, `ALERT_QUIET_DAYS`                                       | the owner, 2026-10-18  |
| Failed sign-in                           | one in 15 minutes       | `LOGIN_ALERT_QUIET_MS`                                                    | the owner, 2026-10-30  |
| History kept                             | 180 days                | `ALERT_LOG_DAYS`                                                          | the owner, 2026-10-24  |
| Settings: not collected, median moved    | 3 days; 50 %, 7 and 30  | `HEALTH_STALE_DAYS`, `JUMP_SHARE`, `JUMP_RECENT_DAYS`, `JUMP_BEFORE_DAYS` | decided 2026-10-09     |
| Self check: every limit above            | as stated               | `DATA_CHECK`                                                              | 2026-11-07 (see below) |

The self check's limits: learning 14 nights, 1.5 times the usual far share, over 2 times apart with
5 sales each and 10 items one way are the owner's proposal of 2026-11-07. The others were added
when it was planned and built and wait for the owner's confirmation; until then the check runs on
them.
