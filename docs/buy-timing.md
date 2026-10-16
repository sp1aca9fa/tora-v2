# Buy timing

Tora helps decide when to buy an item you watch (or more of one you own): it judges today's price
against the item's own history with fixed rules, and every number is shown in the app. It works
from past prices only and is never a sure thing.

## Where it shows

- **Watchlist**: each watched item and condition gets a verdict (Good price, Falling: wait, Fair
  price, High) and the price under which it is a good buy. Until a person has chosen a buy
  strategy, the Watchlist asks them to (top of the page).
- **Item pages**: a Buy timing card for the item's main condition, with the zone and the reasons.
- **Watchlist > Buy strategy**: the strategies per item type, tried on an example (below).
- MCP tool `watchlist`: the verdict, the zone and the numbers, for a Claude chat.

## The numbers (saved daily)

At the end of each `pnpm collect`, for every item and condition someone owns or watches (table
`signals`, one row per day):

- **Fair value**: the item's market value (the same as everywhere in the app).
- **Daily prices**: the median of each day's sales from the source the value comes from.
- **Ranges**: the lower and upper quarter of the last 180 days' daily prices (10+ days with sales
  needed), the lowest tenth of the last year (20+ days), the usual price (the 180-day median).
- **Trends**: the fitted change over 2, 4 and 12 weeks. Falling fast: over 5 % down in 2 weeks and
  still down over 4.
- **Lowest ask** now (from the nightly collect's "for sale now").
- **Release and the new-set pattern**: days since release (the set catalog's date or the item's
  own; a first collected sale is shown but not used here). In an item's first year, similar items
  (same kind, franchise and language; games: kind and platform) with prices at this age and 90
  days later give the typical change; 3 or more items are needed.

## Strategies

Each person picks one per item type; until then Tora's suggestion is used. A target price on a
watch always counts too.

| Strategy        | Good price when                                               | Suggested for |
| --------------- | ------------------------------------------------------------- | ------------- |
| Steady          | today's value is in the cheapest quarter of the last 180 days | sealed, cards |
| Bargain hunter  | in the cheapest tenth of the last year                        |               |
| Margin          | X % under the usual price (X chosen, 10 by default)           | games, others |
| Catch the dip   | like Steady, and still while falling fast (with a warning)    |               |
| Own target only | never: only the watch's target price                          |               |

All but Catch the dip say "Falling: wait" while the price falls fast. Without enough history for
a range, the zone is 10 % under the usual price (with almost none, under today's value, so only a
listing can be in it), and the app says the data is limited. In the first year, the new-set
pattern lowers the zone when similar items kept falling at that age.

The strategy page tries each strategy on a fixed example per item type (the item with the most
days of sales, picked once by the collect; app setting `strategySamples`): its last year with the
days each strategy would have called a buy, the average price paid against the year's average,
and how often the price was higher 90 days later. Each past day is judged only on the prices
before it.
