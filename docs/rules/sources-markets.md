# Sources, markets and currency

Which sources count for what, how a supporting source earns or loses its place, which items need
an identity link, the one price a compared market shows, and how amounts become the base currency.
This file is the one home of these rules and their numbers. The code is
`packages/core/src/sources.ts`, `bucket.ts` (`compareBucket`) and `money.ts` (smallest units, conversion); `packages/db/src/registry.ts`
(the quality gate), `sources.ts` (`identityFor`), `actions.ts` (the identity notices), `fx.ts` and
`base-currency.ts`; `packages/collector-sdk/src/rates.ts` and `money.ts`; in `apps/web`, the item
page's `item-data.ts` (the page's condition) and `market-compare.tsx` and Settings' `sources-form.tsx`. How to choose and set them:
[Sources and roles](../sources.md), [Markets and currency](../markets.md).

Not here: how a value is made from the valuation order ([Values](values.md)); what a plug-in
declares ([Collectors](../collectors.md)).

## Roles and the valuation order

- Each source has one role per item type: reference, supporting, comparison or off. A type its
  plug-in does not list is off. Once the admin saves a source's roles, they replace all of its plug-in's
  suggestions (a type left out is off).
- **The valuation order** of an item type in a market: that market's sources with the role
  reference, then those with the role supporting. Within a role: the admin's order for the type,
  then the other sources by their plug-in's priority (lower first; none set counts as 100), then
  by key. Comparison and off sources are
  never in it.
- **The main source** of a type is the first of the order when its role is reference; with two
  references, the first one.
- Markets are told apart by the market each source declares, not by currency. A source that declares no market belongs to none once any source declares one, so it is never valued or compared; with no market declared anywhere, all sources are one market.

## The quality gate

Run at the end of each collect, for every source the admin (or its plug-in) made supporting for an
item type, including one the gate now counts as comparison, against that type's main source in the same market.

1. Take the kept sales (`sold` rows not marked excluded; a `market` price's one sale a day included) observed in the 90 days (24-hour days, by `observedAt`) before the check, of both sources, per item and condition. Prices are taken as each source saved them, in the base currency; the gate does not adjust for shipping or tax. Sales with no
   condition are left out. A source with no sales of its own (asks or store prices only) never
   makes a pair and stays unverified.
2. A **pair** is an item and condition in which each of the two has 3 or more sales. One item in
   two conditions is two pairs.
3. Per pair: the source's median price divided by the main source's, minus 1 (-10 % is 10 %
   under). Each median is of all the pair's prices, no outliers left out; of an even count, the
   average of the two middle ones, as for every median of the gate.
4. With fewer than 10 pairs the source is **unverified** and keeps its role. So is a source of a
   type with no reference.
5. With 10 or more: the **gap** is the median of the pairs' differences taken without their sign.
   A gap over 15 % **disagrees**; 15 % or less **agrees**.

A source that disagrees counts as comparison for that type until a later check agrees or is
unverified; its role then comes back by itself. Admins get one item on Actions per source and
type; when dismissed it stays dismissed while the source keeps disagreeing. Only a move into or
out of "disagrees" rebuilds values.

Settings and the admin's Actions item show a second number, the **direction**: the median of the same differences with their sign, shown in whole percent (its size rounded, halves away from zero). It is not the gap the 15 % is compared with, and it is never larger than the gap, so a source that disagrees can show under 15 %.

Example. A flea market is supporting for cards and shares 40 pairs with the main card shop. Its
median is under the shop's in 28 pairs and over it in 12; without their sign the differences have
a median of 10.5 %, with it of -3.9 %. The gap is 10.5 %: it agrees, and Settings reads "4 %
below". A source 12 % under on 10 of its 20 pairs and 12 % over on the other 10 has a gap of 12 %
and a direction of 0.

## Identity links

- An item's identity link is expected only for an item the person owns (lots still in the import review left out): for cards and sealed products always, for any other item type only when those lots cost in total more than the admin's amount. A listing whose page is left as gone counts as a link.
- The amount's default: 3,000 when the base currency is the yen, else 20 units of the base
  currency.
- A link from the chosen source, or from any source of that market that declares identity pages for the type, counts. The admin's chosen source is the one looked for first. Not chosen: the sources declaring identity pages for the type, in the type's order (the admin's, then the plug-ins' priority). Chosen "none": no link is expected in that market. A chosen source with no listing links, not of that market or no longer installed is passed over: the declaring sources are looked for.
- A missing link in the primary market is a notice; in the secondary market a quieter one; other
  markets are not flagged. The person can turn these notices off per item, for both markets at once.

## Markets and the compared price

- The primary market makes values. Without a choice: markets are ranked by the plug-in priority of their best source, whatever its roles (lower first, none set counting as 100; a tie by the source's key; shop-only sources, the shops purchases come from, aside); the first is primary and
  the next secondary.
- The collect gathers the markets in use: the primary and the secondary, or every market when
  item pages compare them all.
- **The one price of a compared market**: the first source of that market's valuation order that
  has a price in the compared condition among its rows not marked excluded and fetched in the last 14 days. Of that source's rows in the compared condition: the newest (by `observedAt`) per listing, variant (the plug-in's sub type: a printing, a condition group) and condition, so one listing's price with no condition and its raw A price are two; of several, the middle one by price in the base currency (of an even count, the lower of the two middle prices, not their average). Any kind of price counts as stored (sales, a daily market price, asks, buy prices); the item page labels only a median of several asks (it names their count), so a single ask or a buy price shows like a sale. A market with no reference or supporting source for the type shows no price.
- **The compared condition**: a raw card in its own grade; a graded card at raw A; a sealed product with shrink wrap unless the lot is in "no shrink" (an opened or empty box is compared with shrink wrap); any other item in the lot's own condition. A
  price with no condition counts for cards and sealed products, and elsewhere only when the lot is
  in its list's best condition. ("The lot" here is the item page's condition: the one its link asks for (`?condition=`) when the item has buy-timing numbers in it; else the one most of the viewing person's owned units are in (a tie: the first lot's); else, when they watch the item, their first watch's (none when it has no condition); else the one with the most 30-day sales in the item's newest buy-timing numbers; with none of these: raw A for a card, shrink wrap for a sealed product, the list's best for any other item.)
- **The spread** is the compared price against the primary value in the same compared condition
  (a graded lot: its raw A value): (price - value) / value, rounded to a whole percent (a half toward plus: -2.5 % shows as -2 %); it does not adjust for the kind of price. A value that is only the retail price is not compared; a value of zero gives no spread.

## Currency and rates

- Every amount is stored in the base currency (the yen unless chosen otherwise; the three exceptions are in [The data model](data-model.md), "General rules"), in its smallest
  unit (the decimals the runtime's currency formatting uses, which can differ from ISO 4217's minor unit: the yen none and the euro 2 in both, the Iraqi dinar 0 against ISO's 3); a conversion rounds to the nearest smallest unit.
- A plug-in reports amounts in its own currency. The collect converts each with the rate stored
  by then for its own day in the app's time zone (a price's: the day it was observed, `observedAt`; an order's: its order date; a rate's day is the date its provider gives it) and keeps the rate used; a rate fetched later does not change amounts already saved.
- **The rate of a day**: that day's, else the last one before it, else the first one after it.
- **Fetching**: at the start of a collect, for each currency set to a rate plug-in, from the newest stored day of the pair (that currency to the base) on, that day included (a newer rate for it replaces the stored one); when the pair has no stored day (a day typed before the switch to a plug-in counts), 400 days back. A currency set to a typed rate is never fetched; the typed rate is stored as the
  rate of the day it was typed, so later days use it until it changes, earlier days keep their
  own rates, and days before every stored rate use it (the rate of a day above).
- **A stale rate**: a fetched rate whose newest day is more than 7 days old is reported in the
  collect's log and still used.
- **No rate at all** for a currency: its prices are not saved until it has one.
- **Changing the base currency** converts every amount stored in the base with the rate of its own date (the
  rate of a day above: an amount older than every stored rate takes the first one), rounded to
  the new currency's smallest unit.
  Amounts with no date of their own (list prices, watch targets, a plan's budget, a typed
  identity amount, the saved opportunities) use today's rate; an identity amount never typed
  takes the new currency's default. Values and their history are then rebuilt. A collect already running converts with the base it started with, so the change is made while none runs. With nothing stored yet the change converts nothing, and a typed identity amount goes back to the new currency's default.

## What a plug-in's declarations do

- `priceKinds`: a reference or supporting source that declares price kinds, none of them `sold`
  or `market`, is
  marked in Settings as giving asking or store prices; one that declares no price kinds gets no mark. A `market` price is saved by its plug-in as
  one sale a day. Only sources declaring `sold` are watched by the data checks.
- `noAi`: the source's data is left out of everything that feeds a model (the data review, the MCP
  tools, the re-check of sales, the game rules and item checks, the data checks).
- `detailsDays`: at the end of each collect, rows of that source observed (`observedAt`) more than that many days ago lose their listing details; the price stays.

## Numbers

Each is a choice.

| Number                               | Value              | In the code                               | Chosen                                                                                                                                                             |
| ------------------------------------ | ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quality gate: window, sales per side | 90 days, 3         | set in `checkSourceQuality`               | Claude, at build, 2026-10-13 (commit `70e3859`)                                                                                                                    |
| Quality gate: pairs, gap             | 10, over 15 %      | `QUALITY_MIN_PAIRS`, `QUALITY_MAX_GAP`    | the owner and Claude, 2026-10-13, as an example (history, "Sources with roles"); built that day                                                                    |
| Identity amount, default             | 3,000 yen, else 20 | `IDENTITY_MIN_COST`, `identityMinCostFor` | the owner, 2026-10-12 (decisions); per currency: the owner asked 2026-10-24 (history, the fixes of that day, item 3), the 20 Claude's, at build (commit `159572b`) |
| A plug-in's priority, none set       | 100                | set in `byPriority` and `marketsOf`       | Claude, at build, 2026-10-13 (commit `8db852b`)                                                                                                                    |
| A compared market's prices           | fetched in 14 days | set in `foreignPrices`                    | Claude, at build, 2026-10-12 (commit `d48e094`)                                                                                                                    |
| Rates: first fetch                   | 400 days back      | `HISTORY_DAYS`                            | Claude, at build, 2026-10-12 (history: "the first run fills ~400 days")                                                                                            |
| A stale rate                         | over 7 days        | `STALE_RATE_DAYS`                         | Claude, at build, 2026-10-31 (commit `4038eed`)                                                                                                                    |
