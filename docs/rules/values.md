# Values and confidence

What an item is worth in Tora, and how sure that number is. This file is the one home of these
rules and their numbers: other docs and the app's texts point here. The code is
`packages/core/src/valuation.ts` (one unit) and `packages/db/src/valuation.ts` (lots, totals, the
chart, saved values).

Not here: what a bucket is and its keys ([Categories](../categories.md)); roles, the valuation order, the quality gate, markets and the base currency
([Sources, markets and currency](sources-markets.md); how to set them:
[Sources and roles](../sources.md), [Markets and currency](../markets.md)).

## Words

- **Value**: what one unit of an item would sell for now in one condition, in the base currency.
  It is worked out, never stored as a fact, and unknown stays unknown: no value is never shown as 0.
- **Bucket**: the condition a price is for. A lot is valued in the bucket of its own condition. A
  lot whose condition is not complete (a card without a grade) has no bucket.
- **Sale**: a sold price a source reported. A daily market price a site works out from its own
  sales is saved as one sale a day and counts like a sale.
- **Day**: in windows and ages, 24 hours counted back from the moment of valuing, not a calendar day (the exception to [Data model](data-model.md), "Times"). A window of N days takes prices at most N x 24 hours old, both ends included; the same for "at most 30 days old" and "used for 3 days" (72 hours).

## Which prices count

- Only the primary market's: prices in its currency (or stored with none), from the sources in the valuation order of
  the item's type (references first, then supporting sources; [Sources, markets and currency](sources-markets.md)). A supporting source the quality gate found to disagree is out of the order. Before any plug-in has saved its source's description, every source counts, ordered by its key. Once one has, an item type with no source in its valuation order gets no value from sales or asking prices: its retail price, else unknown.
- Only kept prices: a sale marked excluded never counts.
- Only prices no later than the moment of valuing.
- Each price counts once, per unit and as its source saved it (nothing added or taken off for shipping or tax), dated by its `observedAt`, not by when it was collected.
- A sale whose lot size was estimated (the source did not say how many units it covered) counts at
  its estimated unit price. The value says how many of its sales are estimated.
- Another market's prices never make a value, nor does a buy-back price.

## The value of one unit

The first of these that gives a price:

1. **Manual price.** The person's own price for that item and bucket (the newest one). It always
   wins, for that person only. It has no confidence.
2. **Median of sales.** For each source in the valuation order, the steps below are tried in
   order, and the first step with 3 or more of that source's sales is taken:

   | Step | Sales of                       | Looking back |
   | ---- | ------------------------------ | ------------ |
   | 1    | the lot's own bucket           | 30 days      |
   | 2    | the lot's own bucket           | 90 days      |
   | 3    | the lot's own bucket           | 180 days     |
   | 4    | the lot's own bucket           | 365 days     |
   | 5    | similar conditions (see below) | 180 days     |
   | 6    | similar conditions             | 365 days     |

   The first source with such a step makes the value: the median of that step's sales after outliers are left out (see below; the step is chosen on its count before they are), the mean of the two middle prices for an even count, rounded to the nearest whole unit of the base currency's smallest unit (yen, cents), a half up. Sources are never mixed in one
   median.

   When no source has a step with 3 sales, the first source with any sale in one of the steps (its own bucket or similar conditions, within 365 days) makes the value, from its first step that has a sale.

   So the order of sources comes before how fresh the sales are: a reference with 3 sales over 365
   days makes the value even when a supporting source has 10 in the last 30 days.

3. **An asking price.** Only when no source has a sale in any step: the newest asking
   price stored from a source in the valuation order, in the lot's own bucket, at most 30 days
   old. A marketplace's asks count too when its plug-in stores them as prices.
4. **Retail price.** The item's list price, when it has one.
5. **None.** The value is unknown.

A lot with no bucket skips items 1 to 3 of this list (a manual price, the median, an asking price).

Example. A card in raw A. The reference has 2 sales in the last 30 days and 4 in the last 90: step
1 has too few, step 2 is taken. The 4 prices are 9,800, 10,000, 10,400 and 30,000. The last one is
an outlier (above 23,325, see below), so the value is the median of the other three: 10,000. It
shows 4 sales over 90 days and medium confidence.

### Similar conditions

Conditions close enough to be valued together when an item has too few sales in the lot's own:

- an item's conditions (new, like new, good, fair) with each other;
- a card's raw grades with each other;
- an intact box with and without shrink wrap;
- the values an admin put in one pool group of their own condition list.

Never pooled: graded cards (a 10 and a 9 are priced far apart), nor a box that was opened. Steps 5 and 6 take the lot's own bucket's sales too; a condition in no pool has no steps 5 and 6.

### Outliers

With 4 or more sales in the step, sales outside 1.5 times the interquartile range are left out of
the median: below Q1 - 1.5 x (Q3 - Q1) or above Q3 + 1.5 x (Q3 - Q1), the quartiles by Hyndman and Fan's type 7 (R's default): position (n - 1) x p in the sorted prices, counting from 0, interpolated linearly. With 3 or fewer, every sale counts. The number of
sales shown with a value counts the ones left out too. When Q1 equals Q3 (many equal prices, as a daily market price gives), every sale away from that price is left out.

In the example above: Q1 = 9,950, Q3 = 15,300, so the upper limit is 15,300 + 1.5 x 5,350 =
23,325.

## Confidence

Counted on the source that made the value, in the lot's own bucket, sales left out as outliers included:

| Confidence | When                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| High       | a median from a 30, 90 or 180-day step of its own bucket, with 5 or more sales in the last 30 days    |
| Medium     | a median from a 30, 90 or 180-day step of its own bucket, with 3 or more sales in the last 180 days   |
| Low        | any other median (fewer sales, a 365-day step, similar conditions); an asking price; the retail price |
| None       | a manual price; no value                                                                              |

A value from similar conditions is labeled as pooled wherever it shows. Every value carries its
method, its source, the number of sales, the step's days and the age of its newest sale.

## Shown beside the value

- **Last sale**: the newest sale in the lot's own bucket from any source of the primary market's currency, in the valuation order or not (a sale marked excluded never), taken from the stored sales and from the newest trades each listing showed at its last
  read (read at most about a day ago; the trade itself can be older, and its time approximate; a trade is a stored sale marked excluded, and left out, when source, condition and base price match and the time is the same, or, for an approximate time, within the short window of the sale's time, or the long window for a trade more than the long window old (exactly the long window uses the short one) ([Numbers](#numbers)); the age is counted when the value is worked out (a page view, the collect's review or an MCP tool); nearest first, one trade per sale. A site gives an approximate time in days up to the long window and in months beyond it. Known limit: the price compared is the base price, so a foreign trade converted at another rate than when the sale was stored does not match). The trend is (last sale - value) / value, in percent rounded to one decimal (above 0 when the last sale is higher), shown only when the value is a median. Totals
  and profit use the value, never the last sale.
- **Per source**: for each source with a sale or a listing's trade in the bucket, of any age: its last sale, its own median (the same steps, fallback and outlier rule, on that source alone), the number of sales and its trend, (last sale - its median) / its median. Valued sources come first, in their order, then the others by key.
- **Instant sell floor**: the newest buy-back price (what a shop pays) from any source of the primary market's currency, at most 30 days old, in the lot's own bucket or with no condition, the newest of both (a lot with no bucket: with no condition only). Shown apart; it never makes a value.

## A lot, the totals and the profit

A person's totals read only their own lots.

- A lot's value is the unit value times its units.
- Each lot has two switches, "count in cost" and "count in value" (both on for an investment).
- **Spent**: the cost of the lots counted in cost, owned or opened (sold and lost lots are not in it).
- **Value**: the values of the owned lots counted in value. A lot with no value adds nothing, and
  the total says how many of the lots are valued.
- **Unrealized profit**: the value of the owned lots counted in both and valued, less their cost and the cost of the opened items counted in both. An owned lot with no value is left out on both sides.
- **An opened item** (a box used up for its cards) keeps its full cost in Spent (when counted in
  cost) and in the profit's cost (when counted in both), at no value: its value lives in the
  cards pulled from it, which cost nothing. Cards not logged are not guessed at.

## Box view

For a person's sealed item and the cards they logged from it:

- **Paid**: the box's cost.
- **Value as received**: the box valued in the state it was received in (recorded when it was
  added; a box the clerk opened is not valued as a shrink-wrapped one).
- **Pulls**: a card still held counts at its value now; a card sold at what the sale brought (its
  price less its fees; unknown when the sale has no amount); a lost card at nothing.
- **Net**: pulls less paid. A pull with no value, or sold with no amount, adds nothing to Pulls, and the view says how many pulls are valued.
- **Estimated cost of a pull** (shown on the pull, never in a total): the box's cost split over its logged pulls by value (unit value x units; a pull with no value at the median of the known unit values, by units alone when none is known), rounded to the smallest unit.

## Value over time

Rebuilt after each collect for every day a lot was held, from the day it was acquired, from at most 1,098 calendar days before today through today (1,099 days at most):

- A past day is valued at the end of that calendar day in the app's time zone: with the sales and asking prices dated by then, including ones collected later, the person's manual price set by then (a cleared one is gone from every day), and the item's retail price as it is today. Today's saved point is valued at the moment of the rebuild; the Portfolio page sums today's point again when shown, from the values its totals use, so it equals the total Value plus the lots shown at cost.
- Each day uses the lot as it is today (condition, units, cost, the two switches) and today's source roles, markets, pool groups and marks on sales.
- A lot counts from the day it was acquired to the day before it was sold. From the day a box was
  opened its value is 0 and its cost stays. A lost lot is left out of every day.
- The chart's value line adds the lots counted in value, a lot with no value that day counting at
  its cost (shown as "at cost"). Its cost line adds the lots counted in cost.

A lot's days are one saved row, rewritten when any of its days changed (a day with no value is kept, with no value) and removed when the lot is no longer valued (lost or deleted).

## Saved values

The value of every item and bucket someone holds or watches is saved at the end of each collect,
without manual prices (they are applied per person when read). A saved value is used for 3 days,
and never when it is older than the last change of a source's description, its roles or order, the markets or the categories; otherwise the value is worked
out from the sales and saved again. A saved value keeps its step, count, confidence, last sale and buy-back floor as at the save; only the age of its newest sale is counted again when it is shown. Whatever changes an item's sales or details clears its saved
values. A change of roles or of the order of sources, markets, the base currency, the time zone or the categories, or a source moving into or out of "disagrees" at the quality gate, clears them all and rebuilds the values and their history.

## Numbers

Each is a choice, not a standard, except the outlier rule's 1.5 (Tukey's fences); its type 7 quartiles (Tukey's hinges differ at an even count) and its 4-sale minimum are choices.

| Number                                           | Value                                                                           | In the code                                     | Chosen                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sales a step needs                               | 3                                                                               | `MIN_SAMPLES`                                   | first design, 2026-10-09 (history, "Core section 6")                                          |
| Steps in the own bucket                          | 30, 90, 180 days                                                                | `WINDOWS`                                       | first design, 2026-10-09 (history, "Core section 6")                                          |
| Longest look back                                | 365 days                                                                        | `LONG_WINDOW`                                   | Decision log, 2026-10-11 (commit `990885c`); whose not recorded                               |
| Steps with similar conditions                    | 180, 365 days                                                                   | set in `valueUnit`                              | Decision log, 2026-10-11 (commit `990885c`); whose not recorded                               |
| Outliers                                         | 1.5 x IQR, 4+ sales                                                             | set in `withoutOutliers`                        | Tukey's 1.5; the 4-sale minimum Claude's, at build, 2026-10-10 (commit `7af6f29`)             |
| High confidence                                  | 5+ sales in 30 days                                                             | `HIGH_CONFIDENCE_SALES`, `HIGH_CONFIDENCE_DAYS` | first design, 2026-10-09 (history, "Core section 6")                                          |
| Medium confidence                                | 3+ sales in 180 days                                                            | `MIN_SAMPLES`, `MEDIUM_CONFIDENCE_DAYS`         | first design, 2026-10-09 (history, "Core section 6")                                          |
| A shop's asking price, at most                   | 30 days old                                                                     | `STORE_DAYS`                                    | Claude, at build, 2026-10-12 (Decision log of that day; the 30 days in commit `d48e094`)      |
| A buy-back price, at most                        | 30 days old                                                                     | set in `buylistFloor`                           | Claude, at build, 2026-10-10 (commit `7af6f29`); no decision names the 30 days                |
| A recent trade matched to a sale marked excluded | short window 1 day; long window 30 days, used for a trade more than 30 days old | `excludedMatchWindowMs`                         | Claude, at build, 2026-11-26                                                                  |
| A saved value is used for                        | 3 days                                                                          | `BUCKET_VALUE_MAX_AGE_DAYS`                     | Claude, at build, 2026-10-12 (Decision log of that day; commit `e7131df`)                     |
| The chart goes back at most                      | 1,098 days                                                                      | `MAX_HISTORY_DAYS`                              | Claude, at build, 2026-10-10 (commit `5f422b3`): 3 x 366 days, so three years back always fit |
