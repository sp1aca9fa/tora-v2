# Sources, markets and currency

Which sources count for what, how a supporting source earns or loses its place, which items need
an identity link, the one price a compared market shows, and how amounts become the base currency.
This file is the one home of these rules and their numbers. The code is
`packages/core/src/sources.ts`, `packages/db/src/registry.ts`, `fx.ts` and `base-currency.ts`, and
`packages/collector-sdk/src/rates.ts`. How to choose and set them:
[Sources and roles](../sources.md), [Markets and currency](../markets.md).

Not here: how a value is made from the valuation order ([Values](values.md)); what a plug-in
declares ([Collectors](../collectors.md)).

## Roles and the valuation order

- Each source has one role per item type: reference, supporting, comparison or off. A type its
  plug-in does not list is off. The admin's roles replace the plug-in's suggestions.
- **The valuation order** of an item type in a market: that market's sources with the role
  reference, then those with the role supporting. Within a role: the admin's order for the type,
  then the other sources by their plug-in's priority, then by key. Comparison and off sources are
  never in it.
- **The main source** of a type is the first of the order when its role is reference; with two
  references, the first one.
- Markets are told apart by the market each source declares, not by currency.

## The quality gate

Run at the end of each collect, for every source whose role for an item type is supporting,
against that type's main source in the same market.

1. Take the kept sales of the last 90 days (24-hour days) of both sources, per item and condition.
   Sales with no condition are left out.
2. A **pair** is an item and condition in which each of the two has 3 or more sales. One item in
   two conditions is two pairs.
3. Per pair: the source's median price against the main source's, as a share above or under it.
4. With fewer than 10 pairs the source is **unverified** and keeps its role. So is a source of a
   type with no reference.
5. With 10 or more: the **gap** is the median of the pairs' differences taken without their sign.
   A gap over 15 % **disagrees**; 15 % or less **agrees**.

A source that disagrees counts as comparison for that type until a later check agrees or is
unverified; its role then comes back by itself. Admins get one item on Actions per source and
type; when dismissed it stays dismissed while the source keeps disagreeing. Only a move into or
out of "disagrees" rebuilds values.

Settings shows a second number, the **direction**: the median of the same differences with their
sign. It is not the gap the 15 % is compared with, and it is never larger than the gap.

Example. A flea market is supporting for cards and shares 40 pairs with the main card shop. Its
median is under the shop's in 28 pairs and over it in 12; without their sign the differences have
a median of 10.5 %, with it of -3.9 %. The gap is 10.5 %: it agrees, and Settings reads "4 %
below". A source 12 % under on half its pairs and 12 % over on the other half has a gap of 12 %
and a direction of 0.

## Identity links

- An item's identity link is expected for cards and sealed products always, and for any other
  item type only when the person's owned lots of the item cost in total more than the admin's
  amount.
- The amount's default: 3,000 when the base currency is the yen, else 20 units of the base
  currency.
- A link from any source that declares identity pages for the type counts. The admin's chosen
  source is the one looked for first; with none chosen for a market, no link is expected there.
- A missing link in the primary market is a notice; in the secondary market a quieter one; other
  markets are not flagged.

## Markets and the compared price

- The primary market makes values. Without a choice: the market of the best-placed source is
  primary and the next market secondary.
- The collect gathers the markets in use: the primary and the secondary, or every market when
  item pages compare them all.
- **The one price of a compared market**: the first source of that market's valuation order that
  has a price for the item. Its prices: the kept rows fetched in the last 14 days, the newest per
  listing, in the compared condition; of several, the middle one by price (the lower middle of an
  even count).
- **The compared condition**: a raw card in its own grade; a graded card at raw A; a sealed
  product with shrink wrap unless the lot has none; any other item in the lot's own condition. A
  price with no condition counts for cards and sealed products, and elsewhere only when the lot is
  in its list's best condition.
- **The spread** is the compared price against the primary value, in whole percent. A value that
  is only the retail price is not compared.

## Currency and rates

- Every amount is stored in the base currency (the yen unless chosen otherwise), in its smallest
  unit.
- A plug-in reports amounts in its own currency. The collect converts each with the rate of its
  own day in the app's time zone and keeps the rate used.
- **The rate of a day**: that day's, else the last one before it, else the first one after it.
- **Fetching**: at the start of a collect, from the newest stored day on; the first time, 400 days
  back. A typed rate is never fetched and applies from the day it was typed.
- **A stale rate**: a fetched rate whose newest day is more than 7 days old is reported in the
  collect's log and still used.
- **No rate at all** for a currency: its prices are not saved until it has one.
- **Changing the base currency** converts every stored amount with the rate of its own date.
  Amounts with no date of their own (list prices, watch targets, a plan's budget, the identity
  amount, the saved opportunities) use today's rate. Values and their history are then rebuilt.

## What a plug-in's declarations do

- `priceKinds`: a reference or supporting source that declares neither `sold` nor `market` is
  marked in Settings as giving asking or store prices. A `market` price is saved by its plug-in as
  one sale a day. Only sources declaring `sold` are watched by the data checks.
- `noAi`: the source's data is left out of everything that feeds a model (the data review, the MCP
  tools, the re-check of sales, the game rules and item checks, the data checks).
- `detailsDays`: at the end of each collect, rows of that source older than that many days lose
  their listing details; the price stays.

## Numbers

Each is a choice.

| Number                               | Value              | In the code                            | Chosen                                      |
| ------------------------------------ | ------------------ | -------------------------------------- | ------------------------------------------- |
| Quality gate: window, sales per side | 90 days, 3         | set in `checkSourceQuality`            | built 2026-10-13                            |
| Quality gate: pairs, gap             | 10, over 15 %      | `QUALITY_MIN_PAIRS`, `QUALITY_MAX_GAP` | built 2026-10-13                            |
| Identity amount, default             | 3,000 yen, else 20 | `identityMinCostFor`                   | decided 2026-10-12; per currency 2026-10-24 |
| A compared market's prices           | fetched in 14 days | set in `foreignPrices`                 | built 2026-10-12                            |
| Rates: first fetch                   | 400 days back      | set in `rates.ts`                      | built 2026-10-12                            |
| A stale rate                         | over 7 days        | set in `rates.ts`                      | built 2026-10-31                            |
