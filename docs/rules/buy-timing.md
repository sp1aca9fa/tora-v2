# Buy timing

How Tora judges today's price of an item against its own history: the numbers saved each day, the
buy zone of each strategy, the verdict, and the tests of the strategies. This file is the one home
of these rules and their numbers. The code is `packages/core/src/signals.ts` (the rules) and
`packages/db/src/signals.ts` (what is saved); also `buy-targets.ts`, `strategy-examples.ts` and `lines.ts` in `packages/core/src`, `packages/db/src/release.ts` (similar items, release dates) and the item page's `buy-timing.tsx` (better or worse). Where it shows in the app:
[the Buy timing guide](../buy-timing.md).

Not here: how a value is made ([Values](values.md)); the alerts sent for a watch
([Alerts](alerts.md#watch-alerts)); the buy plan and the signals of Opportunities
([Opportunities](opportunities.md)).

## Words

- **Daily price**: the median of one calendar day's kept sales of an item in one condition, per
  unit, on one source, in the base currency; a day is a day in the app's time zone ([Data model](data-model.md)). Only sales in the primary market's currency count, and those without a currency; a source's sales in another currency are left out of every number here. Buy timing works on daily prices, so a day with 50 sales weighs like a day
  with one.
- **The last N days**: N calendar days, today included.
- **Typical price around a day**: the median of the daily prices within 7 days either side, from 2
  or more days with sales.
- **Fair value**: the item's saved market value in that condition (without anyone's manual price).
  Without one: the median of the last 30 days' daily prices (from 1 day with sales), else of the last 90; with no daily price in 90 days there is none.
- **Similar items**: cards and sealed products of the same kind, franchise and language; games of
  the same kind and platform; other items of the same kind. Every person's items count. An item missing what decides its group (franchise or language; platform) has none.
- **Release date**: the date of the item's set in the catalog, else the item's own. A first
  collected sale is shown as a date but is never a real release date.
- **Line**: a set's place among its franchise's releases (main expansion, sub-expansion, high
  class pack, special). A study of similar items uses the item's line when the line alone has
  enough items for that study (the study's own minimum, or the line minimum it states: the rule tests and the target prices state one), else the whole group, and the app says which. The list of lines is an
  admin setting; an item's line is set by hand on its edit page (by the person who made it or an
  admin), and Pokemon items get theirs from the set's official title.
- **Other items' prices**: the first-year studies (the new-set pattern, the usual age of the low, how far similar items fell) and the rule tests take each similar item in the item's condition, on its source with the most days of sales over its whole history. The first-year studies count only similar items with a real release date.

## What is saved

After each collect, one row per day (a second collect that day replaces it) for every item and condition that someone owns or watches,
that is in the saved opportunities, or that is in someone's buy plan. The source is the one the
value came from, else the one with the most days of sales in that condition in today and the 455 days before (a year plus 90 days). Pages read the latest
row when it is at most 3 days old (today or the 3 days before); an older row counts as none.

| Number        | How                                                                                                                                                                  | Needs                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Usual price   | the median of the last 180 days' daily prices                                                                                                                        | 3 days with sales                                                    |
| Lower quarter | the 0.25 quantile of the last 180 days' daily prices                                                                                                                 | 10 days with sales                                                   |
| Upper quarter | the 0.75 quantile of the same                                                                                                                                        | 10 days with sales                                                   |
| Year's tenth  | the 0.1 quantile of the last 365 days' daily prices                                                                                                                  | 20 days with sales                                                   |
| Trend         | e^(slope x window) - 1, the slope of a least-squares line of ln(daily price) against the calendar day, over the last 14, 28, 84 days (the 2-, 4- and 12-week trends) | 4 days with sales, the first and last at least half the window apart |
| Held          | the last 14 days' median daily price over the median of the 30 days before them, minus 1                                                                             | 2 days with sales in each                                            |
| Year position | the share of the last 365 days' daily prices at or under fair value                                                                                                  | 20 days with sales, and a daily price 300 or more days before today  |
| Where it sits | the share of the last 180 days' daily prices at or above fair value (shown as "at or below the price on N % of the last 180 days")                                   | 10 days with sales                                                   |
| Lowest ask    | the cheapest listing now, per unit, in that condition                                                                                                                | see below                                                            |

Quantiles (of daily prices, and of the falls below) are read by linear interpolation between the sorted values at position (n - 1) x q, counted from 0 (Hyndman and Fan's type 7, the default of R and NumPy). Daily prices are not rounded; fair value, the saved prices and each zone's top are rounded to the nearest whole smallest unit of the base currency (half up). A number without
what it needs is unknown.

**Lowest ask.** Only listings of the source the prices come from (another site's cheapest listing
is too often something else), from the source's latest report when the row's numbers were worked out, while that report is at most 3 days before today. With no daily prices on any source there is no lowest ask. A report whose cheapest listing is under half the fair value (`ASK_FLOOR`, [Alerts, Numbers](alerts.md#numbers)) gives no ask, as for alerts; with no fair value, no ask is left out (Opportunities has no fair-value floor; its band is of its own Price, [there](opportunities.md)). A
game's listing not yet verified as the item counts as no ask. An ask is taken as listed, shipping not added.

## The market, the pattern and the new-release wait

- **Market**: the median 12-week trend of the similar items, each on its source and condition with the most
  days of sales in today and the 100 days before, the item itself included. Needs 5 items with a trend. The
  market is **falling** under -15 %.
- **New-set pattern**, in an item's first 365 days after a real release date: over the other
  similar items, the median change of their typical price from this age to 90 days later (the later price over the earlier, minus 1), counting
  only what had happened by today (the later day plus 7 days has passed). Needs 3 items. The age is the number of whole days from the release date to today; the pattern is a fall when that median change is under 0.
- **Usual age of the low**: over similar items released 372 or more days ago with a daily price at an age of 0 to 30 days and one at 300 to 365, the median age at which each one's typical price was lowest
  in its first 365 days (on a tie, the earliest age), rounded to whole days. Needs 3 items. 372 is 365 days plus the 7 the last typical price needs.
- **New release**: an item with a real release date, younger than the usual age of the low, or
  than 90 days when that age is unknown.
- **How far similar items fell** (shown during a new-release wait, for reference only: it never
  ends the wait): over 3 or more similar items with such a full first year and a typical price at this age, the median fall from it to their lowest typical price from this age to day 365 (a fall is 0 or negative: that low over the price at this age, minus 1); the deeper quarter (the 0.25 quantile of the falls) too with 8 or more items. As a price: the item's typical price now (the median of its daily prices of today and the 7 days before, from 2 or more days with sales; none with fewer) times one plus the fall.

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

Without a usual price, "under the usual" is taken under fair value, so only a listing can be in the zone (unless the cut is worth half a unit or less). With no fair value there is no zone. With 10 to 19 days of sales in the year, Bargain hunter's 10 % under the usual can sit above Steady's lower quarter.

In the first 365 days, for every strategy with a top, when the new-set pattern is a fall and fair value lowered by that fall (fair value times one plus the fall) is under the zone's top, that lower price becomes the top. It is then under fair value unless rounding brings it back (when that fall is worth half a unit or less), so while the pattern is a fall, fair value is otherwise never in the zone: only a listing can be, and the verdict is Fair price or High, never Good price or a wait.

## The verdict

In this order:

1. No fair value: no verdict.
2. Fair value at or under the zone's top: **Good price**, unless one of these holds, which makes
   it **Wait** (shown as "Falling: wait"; never for Catch the dip, which warns instead):
   - falling fast: the 2-week trend is under -5 % and the 4-week trend is under 0 or unknown;
   - the market is falling, and the item is not cheap and steady;
   - it is a new release (the verdict then reads "New release: wait").
3. Fair value over the upper quarter: **High**.
4. Else: **Fair price**.

So a wait only ever replaces a Good price. The lowest ask never changes the verdict: at or under the zone's top it is shown as a listing in the zone now. Above the zone the verdict stays Fair or High and the
fall, the market or the new release shows as a warning. An unknown number never holds: with no top (Own target only) step 2 is skipped; an unknown upper quarter gives Fair price, never High; an unknown 2-week trend is not falling fast; an unknown market is not falling; an unknown year position or Held is not cheap and steady.

**Cheap and steady**: the year position is 0.3 or less (among the cheapest 30 % of its year) and
Held is -2 % or more (its fall has paused). Such an item does not wait for a falling market; it
still waits when it falls fast itself.

**Limited data** is said with the verdict, which is still given: fewer than 3 sales in the last 30
days (sales, not days with sales), or no 180-day range (no lower quarter: under 10 days with sales in 180).

Example. A box under Steady, fair value 9,000. Its last 180 days have 40 days with sales: lower
quarter 9,400, upper quarter 11,000. The zone's top is 9,400, so 9,000 is in the zone. Its 2-week
trend is -3 %: not falling fast. Its market (12 similar items) is at -18 %: falling. It was
released 400 days ago: no new release. Its year position is 0.22 and Held is -1 %: cheap and
steady, so the falling market does not count. Verdict: Good price. With Held at -6 % instead, the
verdict would be Wait.

## Trying and testing the strategies

**Three fixed examples** (the strategy page): each strategy replayed on three price series that
are the same for everyone, each past day with sales judged only on the prices up to it, with no market, pattern or lowest ask; every day at Good price is a call. Each day's fair value is the median of its last 30 days' daily prices (else 90), that day included. The new-set example waits a fixed 90 days after release. A call is checked against the typical price around the day 90 days later, once 97 days have passed, and counts as higher when that price is over the call's fair value.

**Rule tests** (the Buy timing page), worked out after each collect on the whole history of the similar items, for each group and condition with an item someone owns or watches (an item only in the saved opportunities or a buy plan gets no test of its own group), for Steady, Bargain hunter, Catch the dip and each margin someone chose (10 % always):

- each day with sales is judged only on the prices up to it, that day included, with fair value the median of its last 30 days' daily prices (else 90), never the saved market value, and with no market, pattern, lowest ask
  or release date (so no new-release wait);
- a signal is the first day of each stretch at Good price (a stretch ends only on a day with sales not at Good price; days without sales do not end it), checked against the typical price around the day 90 days later once 97 days have passed: it is higher when that price is over the day's fair value; buying on any day is every day with sales, checked the same way;
- the item's line is used when it has 3 or more items with prices in that condition and any of the tested strategies has 10 or more checked signals there, else the whole group;
- a result shows from 10 checked signals; it reads better (or worse) when the share of checked signals that were higher is 5 percentage points or more over (or under) the same share for any day. This is a plain difference, not a statistical test.

What the tests and backtests found is in the records: [history](../history.md#buy-timing-record).

## Target prices with a date (built, shown nowhere)

Good and Ideal prices from how far similar items fell from this age to their first-year low are
worked out in `packages/core/src/buy-targets.ts` and tested, but no page, alert or tool shows them
until the owner decides what the card shows. As built: Good is the fall 6 in 10 similar items
reached, Ideal the one 3 in 10 reached; 3 similar items are needed, fewer than 5 reads "rough",
and a line is used from 5 items; an item with a sale more than 30 days before its release date is
left out (the date is wrong). Unlike the fall above, no first month of prices is needed. The "target" on cards elsewhere is the top of the buy zone, or the
watch's own target. Their backtest (`collectors/ops/buy-timing-backtest.md`, 2026-11-07, private) found a weak record for cards and for sealed products.

## Numbers

Each is a choice. The ones marked "measured" rest on a test on collected prices, kept in the
records. "Claude, at build" is Claude's choice when it was built, with no test behind it. Cheap and steady was measured on 2026-10-28 on singles (25 of 37 higher 90 days later, median +6 %; boxes had 6 cases, too few; history, Opportunities part 2); a later test (`collectors/ops/deal-ways-record.md`, 2026-11-07, private) found it weak or mixed on cards and not yet testable on sealed products.

| Number                                                              | Value               | In the code                                                   | Chosen                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Days with sales: 180-day range, year's tenth and year position      | 10, 20              | `RANGE_MIN_DAYS`                                              | Claude, at build, 2026-10-17                                                                                                                   |
| Days for a usual price                                              | 3                   | set in `seriesStats`                                          | Claude, at build, 2026-10-17                                                                                                                   |
| Days for a trend                                                    | 4, half or more     | set in `fittedChange`                                         | Claude, at build, 2026-10-17                                                                                                                   |
| Fair value without a saved value                                    | 30 days, else 90    | `FAIR_DAYS`; 90 set in `seriesStats`                          | Claude, at build, 2026-10-17                                                                                                                   |
| Range windows                                                       | 180, 365 days       | `RANGE_DAYS`; 365 set in `seriesStats`                        | the owner, 2026-10-16                                                                                                                          |
| Year's tenth                                                        | 0.1                 | `YEAR_LOW_SHARE`                                              | the owner, 2026-10-16                                                                                                                          |
| Trend windows                                                       | 14, 28, 84 days     | `FALL_DAYS`, `MONTH_TREND_DAYS`, `TREND_DAYS`                 | the owner, 2026-10-16 (14, 28) and 2026-10-17 (84, the market's 12 weeks)                                                                      |
| Held: recent days, days before                                      | 14, 30              | `HOLD_DAYS`, `HOLD_BEFORE_DAYS`                               | the owner, 2026-10-28                                                                                                                          |
| Typical price: days either side, days with sales                    | 7, 2                | set in `priceAround`                                          | Claude, at build, 2026-10-17                                                                                                                   |
| Market: days an item's series is picked on                          | 100                 | set in `refreshSignals`                                       | Claude, at build, 2026-10-17                                                                                                                   |
| Item's own source: days counted                                     | 455                 | `SERIES_DAYS`                                                 | Claude, at build, 2026-10-17 (commit `f62052c`)                                                                                                |
| Margin range                                                        | 1 to 50 %           | set in the watchlist's `actions.ts`                           | Claude, at build, 2026-10-17                                                                                                                   |
| Falling fast                                                        | under -5 %, 2 weeks | `FALLING_2W`                                                  | the owner, 2026-10-16                                                                                                                          |
| Market: items, fall                                                 | 5, under -15 %      | `MARKET_MIN_ITEMS`, `MARKET_FALLING_12W`                      | the owner, 2026-10-17, measured                                                                                                                |
| Items a group study needs, the pattern's days ahead, the oldest age | 3, 90, 365          | `PATTERN_MIN_ITEMS`, `PATTERN_HORIZON`, `PATTERN_MAX_AGE`     | the owner, 2026-10-16 (3, 365), 2026-10-18 (3 for the usual age of the low) and 2026-11-03 (3 for the fall); Claude, at build, 2026-10-17 (90) |
| New-release wait when the age is unknown                            | 90 days             | `NEW_RELEASE_DAYS`                                            | the owner, 2026-10-18                                                                                                                          |
| A full first year                                                   | day 30 to day 300   | `FULL_YEAR`                                                   | Claude, at build, 2026-10-18                                                                                                                   |
| Deeper quarter of the fall                                          | 8 items             | `LOW_DROP_QUARTER_MIN`                                        | the owner, 2026-11-03                                                                                                                          |
| Cheap and steady                                                    | 0.3, -2 %, 300 days | `CHEAP_YEAR`, `HELD_2W`, `YEAR_MIN_DAYS`                      | the owner, 2026-10-28, measured                                                                                                                |
| Default margin                                                      | 10 %                | `DEFAULT_MARGIN`                                              | the owner, 2026-10-16                                                                                                                          |
| Limited data                                                        | under 3 sales       | `LIMITED_SALES`                                               | Claude, at build, 2026-10-17                                                                                                                   |
| Rule tests: signals shown from, margin                              | 10, 5 points        | `RULE_TEST_MIN_SIGNALS`, `RULE_TEST_MARGIN`                   | the owner, 2026-10-18 (10); 5 points Claude's, at build, 2026-10-18 (later Opportunities' proof rule, the owner, 2026-10-21)                   |
| A saved row, a listing report is used for                           | 3 days              | `SIGNAL_FRESH_DAYS`, `SUPPLY_FRESH_DAYS`                      | Claude, at build, 2026-10-17 (row) and 2026-10-16 (report)                                                                                     |
| Line suggestion                                                     | 20 and 10 points    | `UNLIKE_GROUP`, `LIKE_LINE`                                   | Claude, at build, 2026-10-18                                                                                                                   |
| Target shares, rough under, wrong date                              | 0.6, 0.3; 5; 30     | `TARGET_SHARES`, `TARGET_ROUGH_UNDER`, `WRONG_AGE_EARLY_DAYS` | Claude's proposal to the owner, 2026-11-07, not answered yet (shares, rough under); the 30 days Claude's, built with them                      |

**Line suggestion.** Tora suggests a line on Actions for a card or sealed item without one, with
a real release date, whose typical price change from day 7 to day 97 after release is 20 percentage points or more away from the median change of the rest of its group (3 or more items with that change) and within 10 points of the median change of a line's items (3 or more); the line with the closest median is suggested. Each item is read on its source and condition with the most days of sales.
