# Opportunities

How Tora finds items worth a look within each group of similar items: the signals and warnings,
how each is tested on past prices and when it counts as proven, the order of the lists, the target
on a card, the ways of spotting a deal, what is popular, the buy plan, the spread check and the
box opening value. This file is the one home of these rules and their numbers. The code is
`packages/core/src/opportunities.ts`, `deal-ways.ts`, `potential.ts`, `plan.ts`, `spread.ts` and
`opening.ts`, with what is saved in `packages/db/src/` (popular items and ranks in `popularity.ts` and `rankings.ts`); the bar is in the Opportunities page's `cards.ts` and held little in the spread page, both in `apps/web`. Where it shows in the app:
[the Opportunities guide](../opportunities.md).

Not here: similar items, lines, daily prices, the typical price around a day, the buy zone and the
verdict ([Buy timing](buy-timing.md)); how a value is made ([Values](values.md)); how plug-ins
give rankings, signals and pull rates ([Collectors](../collectors.md)).

Everything here works from past prices only and is never a sure thing.

## The numbers of an item

Worked out after each collect for every item with prices and a group of similar items, whoever
added it, except games kept only on the tracked games list: nobody holds or watches them and no ranking has them among its candidates. Each item is studied
on one source and condition: a reference source's condition with the most days of sales (30 or more), else the one with the most days on any source; days are counted over the whole history, so a series with no recent sales can be picked. Windows are calendar days, today included.

| Number         | How                                                                                                                                                                                                                                                                                                                                                                                                                 | Needs                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Price          | the median of the last 30 days' daily prices, else of the last 90                                                                                                                                                                                                                                                                                                                                                   | 2 days with sales in the window (30 days, else 90)                                |
| 12-week change | a least-squares line through the log daily prices of the last 84 days; the change is e^(84 x slope) - 1 (the trend of Buy timing)                                                                                                                                                                                                                                                                                   | 4 days with prices, the first and last 42 or more days apart                      |
| Line's change  | the median 12-week change of the items of a single's own set, else of the item's line, else of the group, the item itself included                                                                                                                                                                                                                                                                                  | 5 items with a change, at each step                                               |
| Sales          | sales in the last 30 days; the monthly rate before: the sales of the 90 days before them, divided by 3                                                                                                                                                                                                                                                                                                              | for the rate: a first sale 119+ days ago                                          |
| Jump           | the median of the last 14 days against the median of the 60 days before them                                                                                                                                                                                                                                                                                                                                        | 2 days in each                                                                    |
| Held           | the median of the last 14 days against the median of the 30 days before them, as in [Buy timing](buy-timing.md)                                                                                                                                                                                                                                                                                                     | 2 days in each                                                                    |
| Year position  | the share of the last 365 days' daily prices at or under the price (against Price here, not fair value as in Buy timing)                                                                                                                                                                                                                                                                                            | 20 days with sales in the 365, the series' first sale 300+ days back              |
| Change for age | the price against the median of the 30 days that ended 90 days ago, for an item 120 to 1,095 days after a real release date; and the typical such change: the median, over 3 or more other items of its group with a release date and a typical price at both ages (one missing either is not counted), of their typical price at the same age against 90 days earlier, counting only what had happened by that day | 3 other items; 2 days with sales in the item's own 30 days that ended 90 days ago |

An item with no price is not saved.

## Signals and warnings

| Signal                   | On when                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Line rising              | the line's change is +10 % or more                                                                                        |
| Line falling (warning)   | the line's change is -10 % or less, and the item is not cheap with its fall paused                                        |
| Leads its line           | the item's 12-week change is 15 points or more above its line's                                                           |
| Lags a rising line       | the line is rising and the item is 15 points or more under it                                                             |
| Sales picking up         | 10 or more sales in the last 30 days, and 1.5 times the monthly rate before or more                                       |
| Sales slowing (warning)  | a monthly rate before of 10 or more, and the last 30 days at 0.6 times it or less                                         |
| Quick rise               | the jump is +20 % or more                                                                                                 |
| Cheap, fall paused       | the year position is 0.3 or less and Held is -2 % or more (Buy timing's "Cheap and steady", `cheapSteady`; numbers there) |
| Strong for its age       | the change for age is 20 points or more above the typical one                                                             |
| Weak for its age         | the change for age is 20 points or more under the typical one                                                             |
| Out of print             | an admin marked the item as not made again, else a plug-in's hint says so                                                 |
| Reprint coming (warning) | an admin marked a reprint as expected, else a plug-in's hint says so                                                      |

A signal or warning whose number is unknown is off; in Line falling, an unknown year position or Held counts as not cheap. A mark counts in tests only from the day the admin gave; a mark without a day, and a plug-in's hint, count today and on no past day, so a hint alone is never tested. Only the item's current mark is kept. Signal plug-ins add an admin's own signals, tested the same way; a plug-in that fails
leaves its signal off.

**Facts, shown and never tested.** A listing under the market (here: under the item's Price): Buy timing's lowest ask (the prices' own source, a report at most 3 days old, a game's unverified listing none; see [Buy timing](buy-timing.md)), in the studied condition, as listed (shipping not added), at 50 % to 85 % of the price (under half, it is too often something else). A shop buy price near the
price: the newest buy-back price of the last 30 days, in that condition or with none, at 80 % of
the price or more.

## Tests and "proven"

Each signal is tested on its group's whole history after every collect:

- every 7th day counted back from today, from 120 days after the item's first sale on its studied
  series, the numbers are worked out from the prices up to that day; a tested day with no price is skipped and does not end a stretch; on a tested day with a price, a signal whose number is unknown is off, which ends its stretch;
- a signal counts on the first tested day of each stretch it is on;
- its outcome is the typical price 90 days later against the price that day, known only once 97
  days have passed (the typical price reads 7 days on each side); "higher" means above, not equal;
- buying on any tested day with an outcome is the comparison.

A signal is **proven** in a group with 10 or more outcomes and a share higher that beats any
day's by 5 points or more; a warning with 10 or more and a share 5 points or more under any
day's. Its **edge** is that difference, negative for a warning. This is a margin on the raw
shares, not a significance test: with 10 outcomes, one outcome more or less moves a share by 10
points.

A long rise in the history flatters signals that follow a rise; re-testing after every collect
lets a signal that stops working stop ranking items.

## Worth a look and the order of the list

- **Score**: the sum of the edges of the item's proven signals and warnings.
- **The market's warning** (an item type's, not Buy timing's Market): a built-in warning that is on, and proven in the item's own group, for
  80 % or more of an item type's items (the type having 5 or more items). It is said once above the list and taken out of each item's
  warnings and score, so items are ranked by what sets them apart.
- **Worth a look**: at least one proven signal on, and a score above 0.
- **Order**: the list keeps only the conditions the person wants suggested for the type (every condition until chosen). With a way chosen and criteria set, the items meeting the most criteria come first (Potential); then worth a look, then an admin's picks (an unproven plug-in signal the admin chose), then by score, and at equal scores the least over the target first (at or under it counts as 0; no target or no price last).
- The MCP tool's list is ordered differently: any proven signal first, then the admin's picks,
  then by score, with the market's warnings still counted in the score. It leaves out items priced
  from a `noAi` source, and such asks and shop buy prices, as in
  [Sources and markets](sources-markets.md).

## The target on a card

- **Target**: the top of the person's buy zone for the item, else their watch's own target.
  **Now**: the fair value of Buy timing, else the price above. Both on the item's studied condition: a buy zone or watch in another condition gives no target.
- **The bar**: with a warning that says wait, it measures against the wait price below: green at
  or under it, else amber. Otherwise green at or under the target, blue up to 10 % over, red 30 %
  or more over, neutral between and with no target.
- **Wait, or under**: with a proven warning on (the market's too) whose median outcome 90 days
  later in the item's group is below 0, the target (else the price now) lowered by that median;
  of several, the largest fall. Never under Buy timing's year's tenth: a lower result is replaced
  by it.

## Ways of spotting a deal

A view of Worth a look, not a signal: no way has a record, so a way never ranks, counts as proven,
or feeds alerts, the plan or scores. An item whose numbers leave a way unknown is in no list.

| Way                        | On when                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falling hard               | the jump is -20 % or less                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Cheap, fall paused         | that signal is on                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Sales picking up           | that signal is on                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Listings drying up         | on the prices' own source and the studied condition, the count in its latest report (at most 3 days old; a condition missing from a report that counts others: 0) is 30 % or more under its count 14 days before that report, which was 5 or more; the earlier report the one nearest that day, at most 3 days either side (the earlier on a tie); for a game, a count only against one taken the same way (before or after its rules went on) |
| A listing under the market | the fact above                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Rising fast                | the quick rise signal is on                                                                                                                                                                                                                                                                                                                                                                                                                    |

Each list says its record per item type from the one measure made (2026-11-07): "weak or mixed"
for a way and item type the measure covered (the list `WEAK_OR_MIXED`), "cannot be tested yet"
for any other. The measure is `collectors/ops/deal-ways-record.md` (private).

**Potential.** What a person looks for: up to 10 subject words (40 characters each, matched
anywhere inside the name and alias), up to 20 rarities, marked out of print, has a current rank.
Each word, each rarity, and out of print and has a rank when the person picks them, is one criterion; a word found in both the name and the alias counts once. It is a stated preference, not proven: it only orders a
list by way, by how many criteria an item meets.

## Popular and rankings

- **Most traded**: sales in the last 30 days, summed over every source and condition. **This
  year**: the last 365 days. These windows count back from now, not in calendar days.
- **Trending**: counted only on sources whose first sale of the item in the last year is more
  than 120 days (30 + 90) back, summed over those sources: 10 or more sales in the last 30 days,
  10 or more in the 90 days before, and the last 30 days at 1.5 times the monthly rate of those
  90 days or more. (A different check from the item numbers' 119+ calendar days.)
- **Site rankings**: read once a day by ranking plug-ins. A rank shows when it is at most 3 days
  old, with the rank of a week before (the newest read 6 to 8 days before it).
- **Candidates**: a ranked entry in the top 60 that matches no item becomes an item ("suggested"),
  collected like a watched one while it was in the top 60 within the last 30 days.

Rank changes are not a signal: too few days of ranks are saved yet to test one.

## Buy plan

Each item says when to buy and at what price, from its Buy timing and the person's strategy.
Rows are checked in this order (a new release before Good price, whatever the strategy):

| The item's state                                    | The plan says                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| no fair value                                       | no price                                                                              |
| a new release                                       | from the day its wait ends, at the top of the zone (an own-target strategy: no price) |
| Good price                                          | now, at the lower of fair value and a listing in the zone                             |
| Wait, or above the zone                             | once under the top of the zone, at that price (no day)                                |
| an own-target strategy (no zone), not a new release | no price                                                                              |

The total is the prices of the ticked items times their units; an item is late when its day is
after the plan's date.

**Suggest a mix** takes only items with a reason to buy (worth a look, or watched), with a price
for one unit, none over 40 % of the budget (with a monthly amount, of what is left), none whose day is after the date. Best first: worth a
look; then buy now, then from a day, then once under a price; then by score; then watched. The
best of each item type first (types in the order of their best item), then the next best of any
type; never two items of one set (an item with no set counts its group), never over what is left. A pick can be
swapped for the next best that fits, of the same type first.

**A monthly amount**: what is left is the amount less the month's lots acquired by purchase and
counted in cost, at cost (the month of the app's time zone); a lot with no cost written counts as
0, and the page says how many. Nothing carries over to the next month. An item bought that month (in its ticked condition, or in any for one ticked in any) is in what was spent: it leaves the items to buy and is not offered to a mix or a swap.

## Spread check

The lots counted in value, each at its value, or at its cost when it has none, grouped by item
type, franchise, set, era and price of one unit. A lot worth 0 (no value and no cost written) is left out; one with no franchise, set or release date is in that dimension's unknown group. Eras go by the item's own release date.

- **Heavy group**: 50 % or more of the total (not said of franchises, nor of the unknown group, nor when there is only one known group). **Heavy item**: 20 % or more, unless it is the only one.
- **Held little**: an item type or known set under 5 % that has an item worth a look.
- Eras: before 2016, 2016 to 2019, 2020 to 2022, then each year. Price levels: under 1,000,
  under 10,000, under 100,000, and more, in the base currency's smallest unit (yen; cents), as in
  [Data model](data-model.md).

## Box opening value

- **Break-even box price**: for each rarity tier, its hits per box times the average value of its cards, added up. A card's value is the sales price read for it with its set's cards, else the ask read there, in the base currency, less the selling fee once (10 % unless the admin sets another); sales prices are read for the 10 cards with the largest share of the break-even value worked out from their asks, the other cards count at their ask; a tier's average counts only cards with a value. An admin's pull rates win over a plug-in's suggestion. Among the plug-ins' suggestions, the first whose franchise and region are the set's and whose name the set's name holds (spaces and case aside) wins, in load order (the public package's first).
- **Spread**: 20,000 simulated boxes: in each pack, each tier gives a hit with chance its hits per box over the box's packs (from the pull rates), at most 1, the card drawn evenly from the tier's valued cards; low and high are the boxes at index floor(q x n) of the boxes sorted from lowest, counted from 0 (with 20,000 boxes the 2,001st and the 18,001st, one place above the nearest-rank percentiles); the box price is its fair value, else its lowest ask; the chance of getting it back is
  the share of boxes at or above it.
- A set's cards are read again when 7 or more days old, or when its code or rarities change.

## Numbers

Each is a choice. The thresholds of signals do not need to be right by themselves: a signal ranks
items only while its test proves it. "Claude, at build" is Claude's choice when it was built, with
no replay behind it.

| Number                                               | Value                                    | In the code                                                                         | Chosen                                                                             |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Line rising or falling; items for a line             | 10 %; 5                                  | `LINE_MOVE`, `LINE_MIN_ITEMS`                                                       | Claude, at build, 2026-10-21                                                       |
| Leads or lags                                        | 15 points                                | `AGAINST_LINE`                                                                      | Claude, at build, 2026-10-21                                                       |
| Sales up, down, minimum                              | 1.5, 0.6, 10                             | `SALES_UP`, `SALES_DOWN`, `SALES_MIN`                                               | Claude, at build, 2026-10-21                                                       |
| Sales windows                                        | 30, 90 days                              | `SALES_RECENT_DAYS`, `SALES_BEFORE_DAYS`                                            | Claude, at build, 2026-10-21                                                       |
| Price windows; days; change for age's earlier window | 30, else 90 days; 2 days; 30 days        | set in `numbers`, `Indexed.price`                                                   | Claude, at build, 2026-10-21                                                       |
| Quick rise; falling hard                             | 20 %                                     | `QUICK_RISE`                                                                        | Claude, at build, 2026-10-28; falling hard 2026-11-07                              |
| Jump windows                                         | 14, 60 days                              | `QUICK_RISE_DAYS`, `QUICK_RISE_BEFORE_DAYS`                                         | Claude, at build, 2026-10-28                                                       |
| For its age: points, items, ages                     | 20; 3; 120 to 1,095                      | `AGAINST_AGE`, `AGE_MIN_ITEMS`, `AGE_RANGE`                                         | Claude, at build, 2026-10-21                                                       |
| Change for age: back                                 | 90 days                                  | `AGE_CHANGE_DAYS`                                                                   | Claude, at build, 2026-10-21                                                       |
| Tests: days ahead, outcomes, points                  | 90; 10; 5                                | `OPPORTUNITY_HORIZON`, `PROVEN_MIN_CHECKS`, `PROVEN_POINTS`                         | the owner, 2026-10-21                                                              |
| Tests: every, from                                   | 7 days; 120 days after the first sale    | set in `tests`                                                                      | Claude, at build, 2026-10-21                                                       |
| A listing under the market                           | 50 % to 85 %                             | `ASK_FLOOR`, `ASK_UNDER`                                                            | Claude, at build, 2026-10-21                                                       |
| A shop buy price near                                | 80 %, 30 days                            | `BUYLIST_NEAR`, `BUYLIST_DAYS`                                                      | Claude, at build, 2026-10-21                                                       |
| The market's warning                                 | 80 % of 5+ items                         | `MARKET_SHARE`; the 5 set in `withMarket`                                           | the owner, 2026-10-28 (nearly every item); 80 % and 5 Claude, at build, 2026-10-28 |
| The bar: close, too high                             | 10 %, 30 %                               | `CLOSE`, `TOO_HIGH`                                                                 | Claude, at build, 2026-10-28                                                       |
| Days of sales for a reference's series               | 30                                       | `STEADY_DAYS`                                                                       | Claude, at build, 2026-10-28                                                       |
| Listings drying up                                   | 30 %; 5; 14 and 3 days                   | `LISTINGS_DRYING`, `LISTINGS_MIN`, `LISTINGS_BACK_DAYS`, `LISTINGS_GAP_DAYS`        | Claude, at build, 2026-11-07                                                       |
| Potential                                            | 10 words of 40 characters, 20 rarities   | `POTENTIAL_SUBJECTS`, `POTENTIAL_SUBJECT_CHARS`, `POTENTIAL_RARITIES`               | Claude, at build, 2026-11-07                                                       |
| Trending                                             | 10, 10, 1.5; 120 days                    | `TRENDING_MIN` (both 10s), `TRENDING_RATIO`, `POPULAR_DAYS` + `POPULAR_BEFORE_DAYS` | Claude, at build, 2026-10-28                                                       |
| Popular: sold, this year                             | 30, 365 days                             | `POPULAR_DAYS`, `POPULAR_YEAR_DAYS`                                                 | Claude, at build, 2026-10-28                                                       |
| A rank: shown for, the week before                   | 3 days; 6 to 8 days                      | `RANKING_FRESH_DAYS`; set in `latestRanks`                                          | Claude, at build, 2026-10-21                                                       |
| Candidates                                           | top 60, 30 days                          | `CANDIDATE_TOP`, `CANDIDATE_DAYS`                                                   | the owner, 2026-10-27 (top 60); 30 days Claude, at build, 2026-10-21               |
| A pick's share of the budget, at most                | 40 %                                     | `MIX_MAX_SHARE`                                                                     | Claude, at build, 2026-10-28                                                       |
| Spread: heavy group, heavy item, little              | 50 %, 20 %, 5 %                          | `SPREAD_HEAVY_SHARE`, `SPREAD_HEAVY_ITEM`, `SPREAD_LITTLE_SHARE`                    | Claude, at build, 2026-10-31, first guesses                                        |
| Spread: eras, price levels                           | 2016, 2020, 2023; 1,000, 10,000, 100,000 | set in `eraOf`, `priceLevelOf`                                                      | Claude, at build, 2026-10-31                                                       |
| Opening: boxes, fee, re-read                         | 20,000; 10 %; 7 days                     | set in `openingValue`, `DEFAULT_OPENING_FEE`, `READ_EVERY_DAYS`                     | Claude, at build, 2026-10-19                                                       |
| Opening: low, high                                   | q 0.1, 0.9 (index floor(q x n))          | set in `openingValue`                                                               | Claude, at build, 2026-10-19                                                       |
| Opening: cards whose sales are read                  | 10                                       | `SOLD_CARDS`                                                                        | Claude, at build, 2026-10-19                                                       |
