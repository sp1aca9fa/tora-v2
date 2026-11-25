# Buy timing

Tora helps decide when to buy an item you watch (or more of one you own): it judges today's price
against the item's own history with fixed rules, and every number is shown in the app. It works
from past prices only and is never a sure thing.

## Where it shows

- **Wishlist**: each wished item and condition gets a verdict (Good price, Falling: wait, New release: wait, Fair price, High) and the price under which it is a good buy; a game shows its prices and level instead, with no verdict. Until a person has chosen a buy strategy, the Wishlist asks them to (top of the page).
- **Item pages, Buy timing** (`/products/<id>/buy`; the Wishlist opens it, games aside): the verdict, the price
  history with the buy zone shaded, the 180-day quarters and the lowest ask, the reasons in three
  groups (where it sits; trend and market; new release and pattern), what is for sale now against
  the zone, and the person's watches. One condition at a time: the main one, or another the person
  watches or owns.
- **Wishlist > Strategy** (the Buy strategy page): the strategies per item type, tried on three fixed examples ([the rules](rules/buy-timing.md#trying-and-testing-the-strategies)).
- **Alerts** (Telegram or Discord, see [Alerts](alerts.md)): a Wishlist item other than a game turning Good price, or a source's lowest ask of the night at or under the watch's own target (a source whose lowest ask is under half the fair value left out: [the rules](rules/alerts.md#watch-alerts)), right after the nightly collect; sharp drops in the
  morning summary.
- MCP tool `watchlist`: the verdict, the zone and the numbers, for a Claude chat.

## The rules

The numbers saved each day, the strategies and their buy zones, the verdict, the new-release wait
and the tests of the strategies are stated once, with every number, in
[Buy timing rules](rules/buy-timing.md). What the tests on past prices found is kept as a record
in [the history](history.md#buy-timing-record).
