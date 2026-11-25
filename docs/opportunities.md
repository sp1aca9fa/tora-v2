# Opportunities

Tora looks for items worth a look to buy within each group of similar items (cards and sealed products by kind, franchise and language; games by kind and platform), from the prices
it already collects. Items count whoever added them, owned, watched or neither (the few left out are in the rules). It works from
past prices only and is never a sure thing.

## Where it shows

- **Opportunities** (menu, after Wishlist), four sub pages with their own address:
  - **Worth a look** (`/opportunities`): chips per item type and per signal proven in it,
    warnings too (tap one or more: the list keeps the items with all of them on, and each one's
    record per group shows), then every item of the type best
    first: those whose proven signals outweigh their warnings (by score), then an admin's picks,
    then apart the rest (by their signals not proven yet). 20 items come from the server at a time
    as the list is scrolled. A card shows the picture, the name, owned / watching / suggested, its
    ranks and signals as tags (a tap opens why a signal is on and its record), the price now
    against a target (the top of the person's buy zone from [Buy timing](buy-timing.md), else
    their watch's target) and how far, a listing well under the price, a shop buy price near it,
    and Watch (an icon by the name). The price bar's color says how near the target the price is, or, with a warning that says wait, the wait price. With a proven warning
    on (the market's too) after which prices fell, the card says **Wait, or under** a price: the target (else the price now) lowered by the largest typical fall 90 days later among those warnings on the group's past prices, never under the price it sold at or under on 1 day in 10 of the past year (a tap says why, and when it stops there: [the rule](rules/opportunities.md#the-target-on-a-card)). A tap on the target says how it is worked out (the buy zone's
    basis, or the watch), and the bar and "to go" measure against it, or against the wait price when a warning says wait. A signal tag links to its row on
    Signals. Only the conditions the person wants suggested for each type show (Wishlist > Strategy, "Conditions to suggest"; every condition until chosen); the Buy plan follows it,
    and the person's watches and plan show whatever their condition.
  - **Popular** (`/opportunities/popular`): per item type, ranked by one of: **Site rankings**
    (each ranking site's own list, read nightly, the first 10 shown, the rest on demand; sites
    don't publish how they rank), **Most traded** (trades in the last 30 days, summed over every site Tora reads), **Trending** (trades well above their usual rate, only on sites where the item has sold long enough ([the rule](rules/opportunities.md#popular-and-rankings)), so an item followed lately doesn't look like a jump) and **Most traded this year**; the last three cover the items Tora
    follows, load as the list is scrolled, and are worked out after each collect. Under each item,
    Tora's view (worth a look, wait or under a price, good price, or the target and how far) and
    its proven signals and warnings, and Tora's price next to the site's. A rank tag on a card
    opens its ranking with the item marked.
  - **Signals** (`/opportunities/signals`): the three signals that beat buying on any day by most,
    links to each item type, then each group's signals and their record against buying on any
    day; groups with nothing proven are folded ("few checks"), rows under 10 checks greyed.
  - **Buy plan** (`/opportunities/plan`): a budget and a date, and what to buy by then and at what price ([the rules](rules/opportunities.md#buy-plan)).
- **MCP** (`opportunities`): the list for a Claude chat, in an order of its own.

## The rules

The signals and warnings with their thresholds, how each is tested and when it counts as proven,
the order of the lists, the target and the bar's colors, the ways of spotting a deal, potential,
what counts as trending, candidates from rankings, the buy plan and its mix, the spread check and
the box opening value are stated once, with every number, in
[Opportunities rules](rules/opportunities.md). The text this guide held before is kept as a
record in [the history](history.md#opportunities-record).
