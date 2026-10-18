# Buy timing

Tora helps decide when to buy an item you watch (or more of one you own): it judges today's price
against the item's own history with fixed rules, and every number is shown in the app. It works
from past prices only and is never a sure thing.

## Where it shows

- **Watchlist**: each watched item and condition gets a verdict (Good price, Falling: wait, New
  release: wait, Fair price, High) and the price under which it is a good buy. Until a person has
  chosen a buy strategy, the Watchlist asks them to (top of the page).
- **Item pages, Buy timing** (`/products/<id>/buy`; the Watchlist opens it): the verdict, the price
  history with the buy zone shaded, the 180-day quarters and the lowest ask, the reasons in three
  groups (where it sits; trend and market; new release and pattern), what is for sale now against
  the zone, and the person's watches. One condition at a time: the main one, or another the person
  watches or owns.
- **Watchlist > Buy strategy**: the strategies per item type, tried on three fixed examples (below).
- **Alerts** (Telegram or Discord, see [Alerts](alerts.md)): a watched item turning Good price, or
  its lowest ask going under the target, right after the nightly collect; sharp drops in the
  morning summary.
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
- **The new-release wait**: the age at which similar items usually hit their first-year low (the
  median over items with a full first year: prices from their first month to past day 300, released
  a year ago or more; 3 or more needed).
- **Set lines**: a set's place in its franchise's releases (main expansion, sub-expansion, high
  class pack, special or anniversary; the list is an admin setting under Settings > Admin
  preferences > Categories). Pokemon items get theirs from the official set title (拡張パック,
  強化拡張パック, ハイクラスパック, anniversary or concept packs); others are set by hand on the
  item's edit page, by the person who made it or an admin. The new-set pattern, the new-release
  wait and the market use the item's line when it has 3 or more items (5 for the market), else the
  whole group, and the app says which ("Similar items (4, Sub-expansion only)"). Tora suggests a
  line on Actions for an item without one whose first 3 months moved 20 points or more unlike its
  group and within 10 points of a line's items.

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

All but Catch the dip say "Falling: wait" while the price falls fast, or while its market does: the median 12-week change of similar items (5 or more, any person's) is under -15 %. Over the two years of collected prices up to October 2026 the market-wide check never triggered (dips were short); it was added for the broad fall from July 2026 (cards' median -29 % in 12 weeks), longer than any before it. Without enough history for
a range, the zone is 10 % under the usual price (with almost none, under today's value, so only a
listing can be in it), and the app says the data is limited. In the first year, the new-set
pattern lowers the zone when similar items kept falling at that age.

A new release (a real release date, not a first collected sale) says "New release: wait" until
the age at which similar items usually hit their first-year low, or 90 days when fewer than 3
similar items have a full first year (Catch the dip warns instead). Why learned and not fixed: a
backtest on the 16 items with a real release date and early prices (October 2026) found the lows
at about day 119 for one box, past day 63 for another and day 112-357 for singles; a fixed 90 days
is arbitrary, and a "price has settled" rule was fooled by pauses in a falling price.

The strategy page tries each strategy on three fixed examples, the same for everyone and
independent of anyone's items (`packages/core/src/strategy-examples.ts`): real SNKRDUNK price
series with the item hidden, the dates moved and the prices rescaled. Steady with dips (a PSA 10
card over a year), a long fall (a box falling for months, then flat, then recovering) and a new set
(a box from its release: hype, a dip, a recovery; strategies other than Catch the dip wait 90 days
after release). Per example: the days each strategy would have called a buy, the average price
paid against the period's average, and how often the price was higher 90 days later. Each past day
is judged only on the prices before it.

## Rule tests

The Buy timing page shows how the person's strategy did on the whole price history of similar
items (the item's line when it has 3 or more items and enough signals, else the whole group),
worked out after each collect: each past signal (the first day of each stretch at Good price, each
day judged only on the prices before it, without the market check or the new-set pattern) is
checked against the typical price 90 days later, next to buying on any day. Shown from 10 checked
signals. On the data up to October 2026 the zones paid less than average but were no sign of a
rise: Steady signals were followed by a higher price 90 days later less often than any day (sealed
boxes 25 % against 67 %, PSA 10 cards 33 % against 58 %), because a fall into the cheapest quarter
usually went on for a while. Rethinking the strategies is planned with S13.
