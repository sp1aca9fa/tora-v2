# Categories

The admin defines what kinds of things Tora tracks in **Settings > Admin preferences >
Categories**. TCG and games are ready-made templates; anything else (watches, figures, sneakers,
...) is made from scratch there. Whoever adds a category also needs collectors that price it
([Building a collector](collectors.md)).

## What a category has

- **Names** in the app's two languages.
- **Kinds**: the sub-categories (TCG: single, booster box, booster pack, ...; a watch category might
  have wristwatch and pocket watch).
- **Fields per kind**:
  - standard fields any kind can switch on, each with its own label: franchise, platform, set
    name, set code, variant, card number, rarity, release date, retail price. Collectors and
    search read these;
  - custom fields: text, number, date, choice list or yes/no; required or not; shown on the item
    page or not. Saved per item (`products.fields`).
- **A condition list per kind**: what condition a lot can be in, which decides which prices value
  it.

Keys are made from the English name when saved and never change (stored data uses them). A change
that touches registered items (a removed field or value, a kind's list) says how many and asks
first; a category or kind with items can only be hidden.

## Condition lists and buckets

A lot records one condition; its value comes from prices in the same condition, called its
**bucket**.

| List                          | Values (best first)                             | Buckets                                               |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| Card grades (ready-made)      | raw S, A, B, C, D; graded (grader + grade)      | `raw:A`, `graded:PSA:10`, `graded:BGS:9.5`            |
| Sealed packaging (ready-made) | with shrink, without, box opened, opened, empty | `sealed:shrink`, `sealed:no_shrink`, ...              |
| Item condition (ready-made)   | new, like new, good, fair                       | `cond:new`, `cond:like_new`, `cond:good`, `cond:fair` |
| Your own list                 | the values you write, best first                | `{list}:{value}`, e.g. `watch_condition:unworn`       |

Your own lists can have **pool groups**: values that may be valued together when an item has too
few sales in its own value (e.g. "excellent" and "very good"). The bucket keys show in the
Categories settings, where a plug-in author can copy them.

## Item types

Roles, the source order, identity pages and the quality gate are set per **item type**: a
category's kinds that share a condition list.

| Item type           | What                                |
| ------------------- | ----------------------------------- |
| `card`              | TCG singles                         |
| `sealed`            | TCG sealed product                  |
| `item`              | Other TCG items                     |
| `game`              | Games (software, consoles, goods)   |
| `{category}/{list}` | Yours, e.g. `watch/watch_condition` |

Each item stores its item type (`products.item_type`). In a plug-in, `productClass(product)`
from `@tora/core` gives it, and `supports(product)` can also read `product.category`,
`product.kind` and custom fields in `product.fields`.

## Plug-ins and categories

A plug-in declares the categories it collects (`categories: ['watch']` in its `SourceInfo`; none
means the built-in TCG and games) and its suggested role per item type
(`roles: { 'watch/watch_condition': 'comparison' }`). Price sources lists a source only under
those categories' item types. Its prices carry the bucket of the condition they are for, from the
list's keys.
