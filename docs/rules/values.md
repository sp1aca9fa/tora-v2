# Values and confidence

What an item is worth in Tora, and how sure that number is. This file is the one home of these
rules and their numbers: other docs and the app's texts point here. The code is
`packages/core/src/valuation.ts` (one unit) and `packages/db/src/valuation.ts` (lots, totals, the
chart, saved values).

Not here: what a bucket is and its keys ([Categories](../categories.md)); roles, the source order
and the quality gate ([Sources and roles](../sources.md)); markets and the base currency
([Markets and currency](../markets.md)).

## Words

- **Value**: what one unit of an item would sell for now in one condition, in the base currency.
  It is worked out, never stored as a fact, and unknown stays unknown: no value is never shown as 0.
- **Bucket**: the condition a price is for. A lot is valued in the bucket of its own condition. A
  lot whose condition is not complete (a card without a grade) has no bucket.
- **Sale**: a sold price a source reported. A daily market price a site works out from its own
  sales is saved as one sale a day and counts like a sale.
- **Day**: in windows and ages, 24 hours counted back from the moment of valuing, not a calendar
  day.

## Which prices count

- Only the primary market's: prices in its currency, from the sources in the valuation order of
  the item's type (references first, then supporting sources). A supporting source the quality
  gate found to disagree is out of the order. Before any source is described, every source counts,
  in alphabetical order.
- Only kept prices: a sale marked excluded never counts.
- Only prices no later than the moment of valuing.
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

   The first source with such a step makes the value: the median of that step's sales after
   outliers are left out (see below), rounded to a whole amount. Sources are never mixed in one
   median.

   When no source has a step with 3 sales, the first source with any sale within 365 days makes
   the value, from its first step that has a sale.

   So the order of sources comes before how fresh the sales are: a reference with 3 sales over 365
   days makes the value even when a supporting source has 10 in the last 30 days.

3. **A shop's asking price.** Only when no source has a sale within 365 days: the newest asking
   price stored from a source in the valuation order, in the lot's own bucket, at most 30 days
   old. In practice a shop's: a marketplace's asks are not stored as prices.
4. **Retail price.** The item's list price, when it has one.
5. **None.** The value is unknown.

A lot with no bucket skips steps 1 to 3.

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

Never pooled: graded cards (a 10 and a 9 are priced far apart), nor a box that was opened.

### Outliers

With 4 or more sales in the step, sales outside 1.5 times the interquartile range are left out of
the median: below Q1 - 1.5 x (Q3 - Q1) or above Q3 + 1.5 x (Q3 - Q1), the quartiles read by
linear interpolation between the sorted prices. With 3 or fewer, every sale counts. The number of
sales shown with a value counts the ones left out too.

In the example above: Q1 = 9,950, Q3 = 15,300, so the upper limit is 15,300 + 1.5 x 5,350 =
23,325.

## Confidence

Counted on the source that made the value, in the lot's own bucket:

| Confidence | When                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| High       | a median from steps 1 to 3, with 5 or more sales in the last 30 days                                        |
| Medium     | a median from steps 1 to 3, with 3 or more sales in the last 180 days                                       |
| Low        | any other median (fewer sales, a 365-day step, similar conditions); a shop's asking price; the retail price |
| None       | a manual price; no value                                                                                    |

A value from similar conditions is labeled as pooled wherever it shows. Every value carries its
method, its source, the number of sales, the step's days and the age of its newest sale.

## Shown beside the value

- **Last sale**: the newest sale in the lot's own bucket from any source of the primary market's
  currency, taken from the stored sales and from the newest trades each listing showed at its last
  read (so it is at most about a day old; such a time may be approximate). The trend is the last
  sale against the value, in percent to one decimal, shown only when the value is a median. Totals
  and profit use the value, never the last sale.
- **Per source**: for each source with a sale in the bucket, its last sale, its own median (the
  same steps and outlier rule, on that source alone), the number of sales and the trend. Valued
  sources come first, in their order.
- **Instant sell floor**: the newest buy-back price (what a shop pays) at most 30 days old, in the
  lot's own bucket or with no condition. Shown apart; it never makes a value.

## A lot, the totals and the profit

- A lot's value is the unit value times its units.
- Each lot has two switches, "count in cost" and "count in value" (both on for an investment).
- **Spent**: the cost of the lots counted in cost, owned or opened.
- **Value**: the values of the owned lots counted in value. A lot with no value adds nothing, and
  the total says how many of the lots are valued.
- **Unrealized profit**: the value of the owned lots counted in both and valued, less their cost.
  A lot with no value is left out on both sides.
- **An opened item** (a box used up for its cards) keeps its full cost in Spent (when counted in
  cost) and in the profit's cost (when counted in both), at no value: its value lives in the
  cards pulled from it, which cost nothing. Cards not logged are not guessed at.

## Box view

For a sealed item and the cards pulled from it:

- **Paid**: the box's cost.
- **Value as received**: the box valued in the state it was received in (recorded when it was
  added; a box the clerk opened is not valued as a shrink-wrapped one).
- **Pulls**: a card still held counts at its value now; a card sold at what the sale brought (its
  price less its fees; unknown when the sale has no amount); a lost card at nothing.
- **Net**: pulls less paid.

## Value over time

Rebuilt after each collect for every day a lot was held, from the day it was acquired, at most
1,098 days back:

- A past day is valued with the sales known by the end of that calendar day in the app's time
  zone; today with the sales known now, so the chart's last point and the totals agree.
- Each day uses the lot's condition and the source roles as they are today.
- A lot counts from the day it was acquired to the day before it was sold. From the day a box was
  opened its value is 0 and its cost stays. A lost lot is left out of every day.
- The chart's value line adds the lots counted in value, a lot with no value that day counting at
  its cost (shown as "at cost"). Its cost line adds the lots counted in cost.

Only days whose numbers changed are written.

## Saved values

The value of every item and bucket someone holds or watches is saved at the end of each collect,
without manual prices (they are applied per person when read). A saved value is used for 3 days,
and never when it is older than the last change of the source roles; otherwise the value is worked
out from the sales and saved again. Whatever changes an item's sales or details clears its saved
values. A change of roles, markets, the base currency or the categories clears them all and
rebuilds the values and their history.

## Numbers

Each is a choice, not a standard, except the outlier rule (Tukey's fences, the usual one).

| Number                         | Value                | In the code                                     | Chosen                   |
| ------------------------------ | -------------------- | ----------------------------------------------- | ------------------------ |
| Sales a step needs             | 3                    | `MIN_SAMPLES`                                   | first design, 2026-10-09 |
| Steps in the own bucket        | 30, 90, 180 days     | `WINDOWS`                                       | first design, 2026-10-09 |
| Longest look back              | 365 days             | `LONG_WINDOW`                                   | decision of 2026-10-11   |
| Steps with similar conditions  | 180, 365 days        | set in `valueUnit`                              | decision of 2026-10-11   |
| Outliers                       | 1.5 x IQR, 4+ sales  | set in `withoutOutliers`                        | built 2026-10-10         |
| High confidence                | 5+ sales in 30 days  | `HIGH_CONFIDENCE_SALES`, `HIGH_CONFIDENCE_DAYS` | first design, 2026-10-09 |
| Medium confidence              | 3+ sales in 180 days | `MIN_SAMPLES`, `MEDIUM_CONFIDENCE_DAYS`         | first design, 2026-10-09 |
| A shop's asking price, at most | 30 days old          | `STORE_DAYS`                                    | built 2026-10-12         |
| A buy-back price, at most      | 30 days old          | set in `buylistFloor`                           | built 2026-10-10         |
| A saved value is used for      | 3 days               | `BUCKET_VALUE_MAX_AGE_DAYS`                     | built 2026-10-12         |
| The chart goes back at most    | 1,098 days           | `MAX_HISTORY_DAYS`                              | built with the chart     |
