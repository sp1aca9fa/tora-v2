# Buy timing

How Tora judges today's price of an item against its own history: the numbers saved each day, the
buy zone of each strategy, the verdict, and the tests of the strategies. This file is the one home
of these rules and their numbers. The code is `packages/core/src/signals.ts` (the rules) and
`packages/db/src/signals.ts` (what is saved). Where it shows in the app:
[the Buy timing guide](../buy-timing.md).

Not here: how a value is made ([Values](values.md)); the alerts sent for a watch
([Alerts](../alerts.md)); the buy plan and the signals of Opportunities
([Opportunities](opportunities.md)).

## Words

- **Daily price**: the median of one calendar day's kept sales of an item in one condition, per
  unit, on one source. Buy timing works on daily prices, so a day with 50 sales weighs like a day
  with one.
- **The last N days**: N calendar days, today included.
- **Typical price around a day**: the median of the daily prices within 7 days either side, from 2
  or more days with sales.
- **Fair value**: the item's saved market value in that condition (without anyone's manual price).
  Without one: the median of the last 30 days' daily prices, else of the last 90.
- **Similar items**: cards and sealed products of the same kind, franchise and language; games of
  the same kind and platform; other items of the same kind. Every person's items count.
- **Release date**: the date of the item's set in the catalog, else the item's own. A first
  collected sale is shown as a date but is never a real release date.
- **Line**: a set's place among its franchise's releases (main expansion, sub-expansion, high
  class pack, special). A study of similar items uses the item's line when the line alone has
  enough items for that study, else the whole group, and the app says which. The list of lines is an
  admin setting; an item's line is set by hand on its edit page (by the person who made it or an
  admin), and Pokemon items get theirs from the set's official title.

## What is saved

After each collect, one row per day for every item and condition that someone owns or watches,
that is in the saved opportunities, or that is in someone's buy plan. The source is the one the
value came from, else the one with the most days of sales in that condition. Pages read the latest
row when it is at most 3 days old.

| Number        | How                                                                                | Needs                               |
| ------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| Usual price   | the median of the last 180 days' daily prices                                      | 3 days with sales                   |
| Lower quarter | the 0.25 quantile of the last 180 days' daily prices                               | 10 days with sales                  |
| Upper quarter | the 0.75 quantile of the same                                                      | 10 days with sales                  |
| Year's tenth  | the 0.1 quantile of the last 365 days' daily prices                                | 20 days with sales                  |
| Trend         | the change of a line fitted to the log daily prices, over the last 14, 28, 84 days | 4 days, spread over half the window |
| Held          | the last 14 days' median daily price against the 30 days before them               | 2 days in each                      |
| Year position | the share of the last 365 days' daily prices at or under fair value                | 20 days, the first 300+ days back   |
| Lowest ask    | the cheapest listing now, per unit, in that condition                              | see below                           |

Quantiles are read by linear interpolation; prices are rounded to whole amounts. A number without
what it needs is unknown.

**Lowest ask.** Only listings of the source the prices come from (another site's cheapest listing
is too often something else), from that source's latest report when it is at most 3 days old. A
game's listing not yet verified as the item counts as no ask.

## The market, the pattern and the new-release wait

- **Market**: the median 12-week trend of the similar items, each on its condition with the most
  days of sales in the last 100 days, the item itself included. Needs 5 items with a trend. The
  market is **falling** under -15 %.
- **New-set pattern**, in an item's first 365 days after a real release date: over the other
  similar items, the median change of their typical price from this age to 90 days later, counting
  only what had happened by today (the later day plus 7 days has passed). Needs 3 items.
- **Usual age of the low**: over similar items released 372 or more days ago with prices from
  their first 30 days to past day 300, the median age at which each one's typical price was lowest
  in its first 365 days. Needs 3 items.
- **New release**: an item with a real release date, younger than the usual age of the low, or
  than 90 days when that age is unknown.
- **How far similar items fell** (shown during a new-release wait, for reference only: it never
  ends the wait): over similar items with such a full first year, the median fall from this age to
  their first-year low; the deeper quarter too with 8 or more items. As a price: the item's
  typical price of the last week times one plus the fall.

## Strategies and the buy zone

Each person picks a strategy per item type. Until they do, Tora's suggestion is used: Steady for
cards and sealed products, Margin at 10 % for everything else. The zone's top is the price at or
under which the item is a good buy.

| Strategy        | Top of the zone                                         | Without its range    |
| --------------- | ------------------------------------------------------- | -------------------- |
| Steady          | the lower quarter of the last 180 days                  | 10 % under the usual |
| Bargain hunter  | the year's tenth                                        | 10 % under the usual |
| Margin          | X % under the usual price (X from 1 to 50, 10 if unset) |                      |
| Catch the dip   | as Steady                                               | 10 % under the usual |
| Own target only | none: only the watch's own target price counts          |                      |

Without a usual price, "under the usual" is taken under fair value, so only a listing can be in
the zone. With no fair value there is no zone.

In the first 365 days, when the new-set pattern is a fall and fair value lowered by that fall is
under the zone's top, that lower price becomes the top.

## The verdict

In this order:

1. No fair value: no verdict.
2. Fair value at or under the zone's top: **Good price**, unless one of these holds, which makes
   it **Wait** (never for Catch the dip, which warns instead):
   - falling fast: the 2-week trend is under -5 % and the 4-week trend is under 0 or unknown;
   - the market is falling, and the item is not cheap and steady;
   - it is a new release (the verdict then reads "New release: wait").
3. Fair value over the upper quarter: **High**.
4. Else: **Fair price**.

So a wait only ever replaces a Good price. Above the zone the verdict stays Fair or High and the
fall, the market or the new release shows as a warning.

**Cheap and steady**: the year position is 0.3 or less (among the cheapest 30 % of its year) and
Held is -2 % or more (its fall has paused). Such an item does not wait for a falling market; it
still waits when it falls fast itself.

**Limited data** is said with the verdict, which is still given: fewer than 3 sales in the last 30
days, or no 180-day range.

Example. A box under Steady, fair value 9,000. Its last 180 days have 40 days with sales: lower
quarter 9,400, upper quarter 11,000. The zone's top is 9,400, so 9,000 is in the zone. Its 2-week
trend is -3 %: not falling fast. Its market (12 similar items) is at -18 %: falling. It was
released 400 days ago: no new release. Its year position is 0.22 and Held is -1 %: cheap and
steady, so the falling market does not count. Verdict: Good price. With Held at -6 % instead, the
verdict would be Wait.

## Trying and testing the strategies

**Three fixed examples** (the strategy page): each strategy replayed on three price series that
are the same for everyone, each past day judged only on the prices up to it, with no market and no
pattern. The new-set example waits a fixed 90 days after release. A call is checked against the
typical price 90 days later.

**Rule tests** (the Buy timing page), worked out after each collect on the whole history of the
similar items:

- each day with sales is judged only on the prices up to it, with no market, pattern, lowest ask
  or release date (so no new-release wait);
- a signal is the first day of each stretch at Good price, checked against the typical price 90
  days later once 97 days have passed, and compared with buying on any day;
- the item's line is used when it has 3 or more items and a strategy with 10 or more checked
  signals, else the whole group;
- a result shows from 10 checked signals, and reads better or worse than any day from 5 points.

What the tests and backtests found is in the records: [history](../history.md#buy-timing-record).

## Target prices with a date (built, shown nowhere)

Good and Ideal prices from how far similar items fell from this age to their first-year low are
worked out in `packages/core/src/buy-targets.ts` and tested, but no page, alert or tool shows them
until the owner decides what the card shows. As built: Good is the fall 6 in 10 similar items
reached, Ideal the one 3 in 10 reached; 3 similar items are needed, fewer than 5 reads "rough",
and a line is used from 5 items; an item with a sale more than 30 days before its release date is
left out (the date is wrong). The "target" on cards elsewhere is the top of the buy zone, or the
watch's own target.

## Numbers

Each is a choice. The ones marked "measured" rest on a test on collected prices, kept in the
records.

| Number                                    | Value               | In the code                              | Chosen                           |
| ----------------------------------------- | ------------------- | ---------------------------------------- | -------------------------------- |
| Days for a 180-day range, a year's tenth  | 10, 20              | `RANGE_MIN_DAYS`                         | built 2026-10-17                 |
| Days for a usual price                    | 3                   | set in `seriesStats`                     | built 2026-10-17                 |
| Days for a trend                          | 4, over half        | set in `fittedChange`                    | built 2026-10-17                 |
| Falling fast                              | under -5 %, 2 weeks | `FALLING_2W`                             | built 2026-10-17                 |
| Market: items, fall                       | 5, under -15 %      | `MARKET_MIN_ITEMS`, `MARKET_FALLING_12W` | the owner, 2026-10-17, measured  |
| Pattern: items, days ahead, oldest age    | 3, 90, 365          | `PATTERN_MIN_ITEMS`, `PATTERN_HORIZON`   | built 2026-10-17                 |
| New-release wait when the age is unknown  | 90 days             | `NEW_RELEASE_DAYS`                       | the owner, 2026-10-18, measured  |
| A full first year                         | day 30 to day 300   | `FULL_YEAR`                              | built 2026-10-18                 |
| Deeper quarter of the fall                | 8 items             | `LOW_DROP_QUARTER_MIN`                   | the owner, 2026-11-03, measured  |
| Cheap and steady                          | 0.3, -2 %, 300 days | `CHEAP_YEAR`, `HELD_2W`, `YEAR_MIN_DAYS` | built 2026-10-28, measured       |
| Default margin                            | 10 %                | `DEFAULT_MARGIN`                         | built 2026-10-17                 |
| Limited data                              | under 3 sales       | `LIMITED_SALES`                          | built 2026-10-17                 |
| Rule tests: signals shown from, margin    | 10, 5 points        | `RULE_TEST_MIN_SIGNALS`                  | the owner, 2026-10-18            |
| A saved row, a listing report is used for | 3 days              | `SIGNAL_FRESH_DAYS`, `SUPPLY_FRESH_DAYS` | built 2026-10-16 and 10-17       |
| Line suggestion                           | 20 and 10 points    | set in `suggestLines`                    | built 2026-10-18                 |
| Target shares, rough under, wrong date    | 0.6, 0.3; 5; 30     | `TARGET_SHARES`, `TARGET_ROUGH_UNDER`    | the owner's proposal, 2026-11-07 |

**Line suggestion.** Tora suggests a line on Actions for a card or sealed item without one, with
a real release date, whose price from day 7 to day 97 moved 20 points or more unlike the rest of
its group (3 or more items) and within 10 points of a line's items (3 or more).
