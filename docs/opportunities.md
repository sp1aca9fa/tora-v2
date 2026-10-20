# Opportunities

Tora looks for items worth a look to buy within each group of similar items (S9's groups: cards
and sealed products by kind, franchise and language; games by kind and platform), from the prices
it already collects. Every item counts, whoever added it, owned, watched or neither. It works from
past prices only and is never a sure thing.

## Where it shows

- **Opportunities** (menu, after Watchlist): tabs per item type. "Worth a look" lists the items
  with a proven signal today, best first, each with its signals, why they are on, their record,
  the recent price, a listing well under it and a shop buy price near it, and Watch. Under it,
  each group's signals and their record against buying on any day.
- **MCP** (`opportunities`): the same list for a Claude chat.

## Signals

Worked out after each collect, per item, on its prices with the most days of sales (one source and
condition):

| Signal                               | On when                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line rising / falling (warning)      | The median 12-week change of the item's set line (5+ items; else the whole group) is +10 % or more / -10 % or less                                       |
| Leads its line                       | The item's 12-week change is 15 points or more above its line's                                                                                          |
| Lags a rising line                   | The line is rising and the item is 15 points or more under it                                                                                            |
| Sales picking up / slowing (warning) | Sales in the last 30 days are 1.5x or more / 0.6x or less the monthly rate of the 90 days before (10+ sales)                                             |
| Strong / weak for its age            | The item's last 90 days are 20 points above / under similar items' at the same age since release (3+ items; day 120 to 3 years; real release dates only) |

Facts, not tested: the lowest ask on the same site as the prices, 15-50 % under the recent price
(another site's cheapest listing, or one under half the price, is too often something else), and
a shop buy price (買取, last 30 days) at 80 % of the recent price or more.

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
