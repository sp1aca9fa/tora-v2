# Opportunities

How Tora finds items worth a look within each group of similar items: the signals and warnings,
how each is tested on past prices and when it counts as proven, the order of the lists, the target
on a card, the ways of spotting a deal, what is popular, the buy plan, the spread check and the
box opening value. This file is the one home of these rules and their numbers. The code is
`packages/core/src/opportunities.ts`, `deal-ways.ts`, `potential.ts`, `plan.ts`, `spread.ts` and
`opening.ts`, with what is saved in `packages/db/src/`. Where it shows in the app:
[the Opportunities guide](../opportunities.md).

Not here: similar items, lines, daily prices, the typical price around a day, the buy zone and the
verdict ([Buy timing](buy-timing.md)); how a value is made ([Values](values.md)); how plug-ins
give rankings, signals and pull rates ([Collectors](../collectors.md)).

Everything here works from past prices only and is never a sure thing.

## The numbers of an item

Worked out after each collect for every item with prices, whoever added it. Each item is studied
on one source and condition: a reference source's condition with the most days of sales (30 or
more), else the one with the most days on any source. Windows are calendar days, today included.

| Number         | How                                                                                                                                                                                                                                                                                                           | Needs                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Price          | the median of the last 30 days' daily prices, else of the last 90                                                                                                                                                                                                                                             | 2 days with sales                        |
| 12-week change | the fitted change of the last 84 days (as the trend of Buy timing)                                                                                                                                                                                                                                            | 4 days, 42 days apart                    |
| Line's change  | the median 12-week change of the items of a single's own set, else of the item's line, else of the group                                                                                                                                                                                                      | 5 items with a change, at each step      |
| Sales          | sales in the last 30 days; the monthly rate before: the sales of the 90 days before them, divided by 3                                                                                                                                                                                                        | for the rate: a first sale 119+ days ago |
| Jump           | the median of the last 14 days against the median of the 60 days before them                                                                                                                                                                                                                                  | 2 days in each                           |
| Held           | the median of the last 14 days against the median of the 30 days before them                                                                                                                                                                                                                                  | 2 days in each                           |
| Year position  | the share of the last 365 days' daily prices at or under the price                                                                                                                                                                                                                                            | 20 days, the first 300+ days back        |
| Change for age | the price against the median of the 30 days that ended 90 days ago, for an item 120 to 1,095 days after a real release date; and the typical such change: the median, over 3 or more other items, of their typical price at the same age against 90 days earlier, counting only what had happened by that day | 3 other items                            |

An item with no price is not saved.

## Signals and warnings

| Signal                   | On when                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Line rising              | the line's change is +10 % or more                                                  |
| Line falling (warning)   | the line's change is -10 % or less, and the item is not cheap with its fall paused  |
| Leads its line           | the item's 12-week change is 15 points or more above its line's                     |
| Lags a rising line       | the line is rising and the item is 15 points or more under it                       |
| Sales picking up         | 10 or more sales in the last 30 days, and 1.5 times the monthly rate before or more |
| Sales slowing (warning)  | a monthly rate before of 10 or more, and the last 30 days at 0.6 times it or less   |
| Quick rise               | the jump is +20 % or more                                                           |
| Cheap, fall paused       | the year position is 0.3 or less and Held is -2 % or more                           |
| Strong for its age       | the change for age is 20 points or more above the typical one                       |
| Weak for its age         | the change for age is 20 points or more under the typical one                       |
| Out of print             | an admin marked the item as not made again, else a plug-in's hint says so           |
| Reprint coming (warning) | an admin marked a reprint as expected, else a plug-in's hint says so                |

A mark counts in tests only from the day the admin gave; a mark without a day counts today and on
no past day. Signal plug-ins add an admin's own signals, tested the same way; a plug-in that fails
leaves its signal off.

**Facts, shown and never tested.** A listing under the market: the lowest ask on the same source
as the prices, in the studied condition, at 50 % to 85 % of the price (under half, it is too
often something else; a game's unverified listing does not count). A shop buy price near the
price: the newest buy-back price of the last 30 days, in that condition or with none, at 80 % of
the price or more.

## Tests and "proven"

Each signal is tested on its group's whole history after every collect:

- every 7th day counted back from today, from 120 days after the item's first sale, the numbers
  are worked out from the prices up to that day;
- a signal counts on the first tested day of each stretch it is on;
- its outcome is the typical price 90 days later against the price that day, known only once 97
  days have passed; "higher" means above, not equal;
- buying on any tested day with an outcome is the comparison.

A signal is **proven** in a group with 10 or more outcomes and a share higher that beats any
day's by 5 points or more; a warning with 10 or more and a share 5 points or more under any
day's. Its **edge** is that difference, negative for a warning.

A long rise in the history flatters signals that follow a rise; re-testing after every collect
lets a signal that stops working stop ranking items.

## Worth a look and the order of the list

- **Score**: the sum of the edges of the item's proven signals and warnings.
- **The market's warning**: a built-in warning that is proven and on for 80 % or more of an item
  type's items (5 or more items). It is said once above the list and taken out of each item's
  warnings and score, so items are ranked by what sets them apart.
- **Worth a look**: at least one proven signal on, and a score above 0.
- **Order**: worth a look first, then an admin's picks (an unproven plug-in signal the admin
  chose), then by score, and at equal scores nearest the target.
- The MCP tool's list is ordered differently: any proven signal first, then the admin's picks,
  then by score, with the market's warnings still counted in the score.

## The target on a card

- **Target**: the top of the person's buy zone for the item, else their watch's own target.
  **Now**: the fair value of Buy timing, else the price above.
- **The bar**: green at or under the target, blue within 10 % over it, red 30 % or more over it,
  amber while a warning says wait.
- **Wait, or under**: with a proven warning on (the market's too) after which prices fell, the
  target (else the price now) lowered by that warning's median change 90 days later; of several,
  the deepest. Never under the year's tenth: then the year's tenth is shown.

## Ways of spotting a deal

A view of Worth a look, not a signal: no way has a record, so a way never ranks, counts as proven,
or feeds alerts, the plan or scores. An item whose numbers leave a way unknown is in no list.

| Way                        | On when                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Falling hard               | the jump is -20 % or less                                                                                                               |
| Cheap, fall paused         | that signal is on                                                                                                                       |
| Sales picking up           | that signal is on                                                                                                                       |
| Listings drying up         | the listings count is 30 % or more under its count 14 days before, which was 5 or more; the earlier report at most 3 days from that day |
| A listing under the market | the fact above                                                                                                                          |
| Rising fast                | the quick rise signal is on                                                                                                             |

Each list says its record per item type from the one measure made (2026-11-07): "weak or mixed"
or "cannot be tested yet". The measure is in the private records.

**Potential.** What a person looks for: up to 10 subject words (40 characters each, matched
anywhere inside the name and alias), up to 20 rarities, marked out of print, has a current rank.
Each word and rarity is one criterion. It is a stated preference, not proven: it only orders a
list by way, by how many criteria an item meets.

## Popular and rankings

- **Most traded**: sales in the last 30 days on every source. **This year**: the last 365 days.
- **Trending**: counted only on sources whose first sale of the item is 120 or more days back: 10
  or more sales in the last 30 days, 10 or more in the 90 days before, and the last 30 days at 1.5
  times the monthly rate of those 90 days or more.
- **Site rankings**: read once a day by ranking plug-ins. A rank shows when it is at most 3 days
  old, with the rank of a week before (7 days, give or take one).
- **Candidates**: a ranked entry in the top 60 that matches no item becomes an item ("suggested"),
  collected like a watched one while it was in the top 60 within the last 30 days.

Rank changes are not a signal: too few days of ranks are kept to test one.

## Buy plan

Each item says when to buy and at what price, from its Buy timing and the person's strategy:

| The item's state        | The plan says                                             |
| ----------------------- | --------------------------------------------------------- |
| no fair value           | no price                                                  |
| a new release           | from the day its wait ends, at the top of the zone        |
| Good price              | now, at the lower of fair value and a listing in the zone |
| Wait, or above the zone | once under the top of the zone (no day)                   |

The total is the prices of the ticked items times their units; an item is late when its day is
after the plan's date.

**Suggest a mix** takes only items with a reason to buy (worth a look, or watched), with a price,
none over 40 % of the budget, none whose day is after the date. Best first: worth a look, then buy
now before from a day before under a price, then by score. The best of each item type first, then
the next best of any type; never two items of one set, never over what is left. A pick can be
swapped for the next best that fits, of the same type first.

**A monthly amount**: what is left is the amount less the month's purchases counted in cost (the
month of the app's time zone). Nothing carries over to the next month.

## Spread check

The lots counted in value, each at its value, or at its cost when it has none, grouped by item
type, franchise, set, era and price of one unit.

- **Heavy group**: 50 % or more of the total (not said of franchises, nor when there is only one
  group). **Heavy item**: 20 % or more, unless it is the only one.
- **Held little**: a group under 5 % that has an item worth a look.
- Eras: before 2016, 2016 to 2019, 2020 to 2022, then each year. Price levels: under 1,000,
  under 10,000, under 100,000, and more, in the base currency.

## Box opening value

- **Break-even box price**: for each rarity tier, its hits per box times the average value of its
  cards after the selling fee (10 % unless the admin sets another), added up. An admin's pull
  rates win over a plug-in's suggestion.
- **Spread**: 20,000 simulated boxes; low and high are the 10th and 90th percentiles; the chance
  of getting the box price back is the share of boxes at or above it.
- A set's cards are read again when 7 or more days old, or when its code or rarities change.

## Numbers

Each is a choice. The thresholds of signals do not need to be right by themselves: a signal ranks
items only while its test proves it.

| Number                                   | Value                  | In the code                                                                  | Chosen                          |
| ---------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| Line rising or falling; items for a line | 10 %; 5                | `LINE_MOVE`, `LINE_MIN_ITEMS`                                                | built 2026-10-21                |
| Leads or lags                            | 15 points              | `AGAINST_LINE`                                                               | built 2026-10-21                |
| Sales up, down, minimum                  | 1.5, 0.6, 10           | `SALES_UP`, `SALES_DOWN`, `SALES_MIN`                                        | built 2026-10-21                |
| Quick rise                               | 20 %                   | `QUICK_RISE`                                                                 | built 2026-10-28                |
| For its age: points, items, ages         | 20; 3; 120 to 1,095    | `AGAINST_AGE`, `AGE_MIN_ITEMS`, `AGE_RANGE`                                  | built 2026-10-21                |
| Tests: days ahead, outcomes, points      | 90; 10; 5              | `OPPORTUNITY_HORIZON`, `PROVEN_MIN_CHECKS`, `PROVEN_POINTS`                  | the owner, 2026-10-21           |
| A listing under the market               | 50 % to 85 %           | `ASK_FLOOR`, `ASK_UNDER`                                                     | built 2026-10-21                |
| A shop buy price near                    | 80 %, 30 days          | `BUYLIST_NEAR`, `BUYLIST_DAYS`                                               | built 2026-10-21                |
| The market's warning                     | 80 % of 5+ items       | `MARKET_SHARE`                                                               | the owner, 2026-10-28           |
| Days of sales for a reference's series   | 30                     | `STEADY_DAYS`                                                                | built 2026-10-28                |
| Listings drying up                       | 30 %; 5; 14 and 3 days | `LISTINGS_DRYING`, `LISTINGS_MIN`, `LISTINGS_BACK_DAYS`, `LISTINGS_GAP_DAYS` | built 2026-11-07                |
| Potential                                | 10 words, 20 rarities  | `POTENTIAL_SUBJECTS`, `POTENTIAL_RARITIES`                                   | built 2026-11-07                |
| Trending                                 | 10, 10, 1.5; 120 days  | `TRENDING_MIN`, `TRENDING_RATIO`                                             | built 2026-10-28                |
| Candidates                               | top 60, 30 days        | `CANDIDATE_TOP`, `CANDIDATE_DAYS`                                            | the owner, 2026-10-27           |
| A pick's share of the budget, at most    | 40 %                   | `MIX_MAX_SHARE`                                                              | built 2026-10-28                |
| Spread: heavy group, heavy item, little  | 50 %, 20 %, 5 %        | `SPREAD_HEAVY_SHARE`, `SPREAD_HEAVY_ITEM`, `SPREAD_LITTLE_SHARE`             | built 2026-10-31, first guesses |
| Opening: boxes, fee, re-read             | 20,000; 10 %; 7 days   | set in `openingValue`, `DEFAULT_OPENING_FEE`                                 | built 2026-10-19                |
