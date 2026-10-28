# Opportunities

Tora looks for items worth a look to buy within each group of similar items (S9's groups: cards
and sealed products by kind, franchise and language; games by kind and platform), from the prices
it already collects. Every item counts, whoever added it, owned, watched or neither. It works from
past prices only and is never a sure thing.

## Where it shows

- **Opportunities** (menu, after Watchlist), four sub pages with their own address:
  - **Worth a look** (`/opportunities`): chips per item type and per signal proven in it,
    warnings too (tap one or more: the list keeps the items with all of them on, and each one's
    record per group shows), then every item of the type best
    first: those whose proven signals outweigh their warnings (by score), then an admin's picks,
    then apart the rest (by their signals not proven yet); equal scores nearest their target
    first. 20 items come from the server at a time
    as the list is scrolled. A card shows the picture, the name, owned / watching / suggested, its
    ranks and signals as tags (a tap opens why a signal is on and its record), the price now
    against a target (the top of the person's buy zone from [Buy timing](buy-timing.md), else
    their watch's target) and how far, a listing well under the price, a shop buy price near it,
    and Watch (an icon by the name). The price bar's color: green at or under the target, blue
    within 10 %, red 30 % or more over it, amber while a warning says wait. With a proven warning
    on (the market's too) after which prices fell, the card says **Wait, or under** a price: the
    target (else the price now) lowered by the warning's typical change 90 days later on the
    group's past prices (a tap says why, and whether the item sold that low in the past year: on 1
    day in 10, or not even then). A tap on the target says how it is worked out (the buy zone's
    basis, or the watch), and the bar and "to go" measure against it. A signal tag links to its row on
    Signals. Only the conditions the person wants suggested for each type show (Watchlist >
    Strategy, "Conditions to suggest"; every condition until chosen); the Buy plan follows it,
    and the person's watches and plan show whatever their condition.
  - **Popular** (`/opportunities/popular`): per item type, ranked by one of: **Site rankings**
    (each ranking site's own list, read nightly, the first 10 shown, the rest on demand; sites
    don't publish how they rank), **Most traded** (trades in the last 30 days on every site Tora
    reads, per site), **Trending** (30 days at 1.5x the monthly rate of the 90 days before or
    more, only on sites read for 120+ days and with 10+ trades before, so an item followed lately
    doesn't look like a jump) and **Most traded this year**; the last three cover the items Tora
    follows, load as the list is scrolled, and are worked out after each collect. Under each item,
    Tora's view (worth a look, wait or under a price, good price, or the target and how far) and
    its proven signals and warnings, and Tora's price next to the site's. A rank tag on a card
    opens its ranking with the item marked.
  - **Signals** (`/opportunities/signals`): the three signals that beat buying on any day by most,
    links to each item type, then each group's signals and their record against buying on any
    day; groups with nothing proven are folded ("few checks"), rows under 10 checks greyed.
  - **Buy plan** (`/opportunities/plan`): the budget and date below.
- **MCP** (`opportunities`): the same list for a Claude chat.

## Budget and date

On the Buy plan sub page: a budget, and a date when there is one, and the items to choose from
(those worth a look, the person's watches, and what their plan already holds). Each says when to
buy and at what price, from its buy timing ([Buy timing](buy-timing.md)) and the person's
strategy for its type: buy now (a good price; a listing in the zone when cheaper), from a day (a
new release waits until similar items' usual first-year low), or once under a price (falling,
its market falling, or above its buy zone: the zone's top). The person ticks items; the card adds
their prices and says what is left of the budget, which come after the date and which wait for a
price (no day). Saved in the person's preferences (`buyPlan`). Buy timing numbers are saved each
night for these items too (besides those owned or watched), and for every item with signal
numbers (their cards' target).

**Suggest a mix** (S27) ticks a varied set within the budget: the best item of each item type
first (so more than one type when the budget allows), then the next best of any type; never two
items of one set, nor one item over 40 % of the budget. Only items with a reason to buy come in
(worth a look, or watched; a good price alone is not one), best first: worth a look, buyable now,
then by score. Items to wait for count at their buy zone's top. Each pick can be swapped for the
next best that fits (of the same type first). When few items qualify, the rest of the budget is
left free and the page says so, rather than filling it with items nothing points to.

## Rankings

Ranking plug-ins ([Collectors](collectors.md#ranking-sources)) read a site's popularity ranking
once a day (the private package reads SNKRDUNK's Pokemon rankings sorted by popularity: boxes
from the sealed category, singles from all of Pokemon, pages until 60 of each). Each ranked item
is matched to an item Tora knows; the top 60 nobody tracks become candidates ("suggested" in the
app), created and collected like
watched items while they stay in the top 60 (within 30 days). Popular now shows each ranking
(rank, the change in a week, price, listings, favorites, owned / watching / suggested), and a
ranked item's card its rank; MCP `opportunities` gives the ranks too. Candidates
join the signals once their prices are collected. Rank changes as a signal are tested once enough
days are saved (ranks partly follow price moves).

## Signals

Worked out after each collect, per item, on its steadiest prices (one source and condition): a
reference source's condition with the most days of sales (30 or more), else the one with the most
days on any source. A single's line is its own set when 5 or more of the set's singles have
prices, else its set line, else the whole group.

A warning on for 80 % or more of an item type's items (5 or more) is the market's: Worth a look
says it once above the list, with its record, and leaves it out of the order, so items are ranked
by what sets them apart; each card still says how much lower to buy for it (Wait, or under).

| Signal                                  | On when                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line rising / falling (warning)         | The median 12-week change of the item's line (5+ items; else the whole group) is +10 % or more / -10 % or less                                           |
| Leads its line                          | The item's 12-week change is 15 points or more above its line's                                                                                          |
| Lags a rising line                      | The line is rising and the item is 15 points or more under it                                                                                            |
| Sales picking up / slowing (warning)    | Sales in the last 30 days are 1.5x or more / 0.6x or less the monthly rate of the 90 days before (10+ sales; sales collected for 120+ days)              |
| Quick rise                              | The last 14 days' price is 20 % or more above the 60 days before                                                                                         |
| Out of print / Reprint coming (warning) | An admin marked the item not to be made again / a reprint expected, from the day given (none: always); unmarked, a plug-in may guess (`reprintHints`)    |
| Strong / weak for its age               | The item's last 90 days are 20 points above / under similar items' at the same age since release (3+ items; day 120 to 3 years; real release dates only) |

Facts, not tested: the lowest ask on the same site as the prices, 15-50 % under the recent price
(another site's cheapest listing, or one under half the price, is too often something else), and
a shop buy price (買取, last 30 days) at 80 % of the recent price or more.

Signal plug-ins add an admin's own strategies (e.g. a PSA 10 under twice the raw price), tested
the same way ([Collectors](collectors.md#signal-plug-ins)). An unproven one an admin picks shows
as the admin's pick: its items come after the proven ones, under their own heading, tagged so. We
recommend sticking to proven signals.

## Tests

Each signal is tested on its group's whole history after every collect: every week from 120 days
after an item's first sale, the numbers from the prices up to that day; a signal counts on the
first day of each stretch it is on and is checked against the typical price 90 days later. Buying
on any of those days is the comparison. A signal is proven with 10 or more checks and a share
higher 90 days later 5 points or more above any day's (a warning: 5 points or more under). Only
proven signals rank items (the sum of their edges, warnings counting against); the others are
shown as not proven.

A long rise in the history flatters signals that follow a rise (line rising, leads its line):
re-testing after every collect lets a signal that stops working stop ranking items.

Saved in the app setting `opportunities` (today's numbers per item and every group's tests).
