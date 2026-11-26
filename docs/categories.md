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
- **Regions** (optional): what the region field offers (TCG print languages, game regions, a
  record's pressing country), in order; the first is the default when an import cannot tell.
  Built-in values keep their keys (TCG: `jp`, `en`, `zh_cn`, `zh_tw`, `kr`, `th`, `id`, `other`; games: `jp`, `na`, `eu`, `asia`, `kr`, `other`); add your own with names in the app's languages, keyed from the English name like any key (below). Plug-ins read the keys (`product.region`), so a plug-in for Spanish prints first saved as "Spanish" checks `region === 'spanish'`.

Keys are made when something is first saved, from its English name (the first name filled in, when there is no English one), and never change, even when the name changes later (stored data uses them): accented letters are first split into letter and accent (Unicode NFKD, which also turns full-width letters into plain ones), then lowercased; each run of anything other than the letters a to z and the digits made a `_` (the split-off accent counts as such a character: "Pokémon" gives `poke_mon`); `_` at the ends dropped; an `x` put before a leading digit; cut to 30 characters; then `_2`, `_3`, ... added while the key is taken (a value among its list's values, a kind or a field among its category's, a list among all lists and the keys the app keeps for its own lists (`raw`, `graded`, ...), a category among all categories, a region among its category's regions and every built-in region key, so "JP" added to another category gets `jp_2`; a key saved before the edit stays taken even when the edit removes what had it, so a removed key is never given to something new in the same save; known limit: a key removed in an earlier save can be given again later, and a follow-up task will keep removed keys retired). "Fine Watches" gives `fine_watches`, "Watch condition" `watch_condition`. A name with no Latin letter or digit gets a made-up key: the thing's word (`value`, `region`, `list`, `category`, `kind`, `field` or `choice`) and the number of its siblings in its list when it was added plus 1 (for a list, the admin's own lists only; `value2`, `region3`), then `_2`, `_3`, ... while taken. A change
that touches registered items (a removed field or value, a kind's list) says how many and asks
first; a category or kind with items can only be hidden (no longer offered for new items; its registered items keep it). A save is refused when the categories were saved elsewhere (another tab or admin) since the page was loaded, since its new keys were chosen against the older ones: reload and make the change again.

## Condition lists and buckets

A lot records one condition; its value comes from prices in the same condition, called its
**bucket**.

| List                          | Values (best first)                                                                         | Buckets                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Card grades (ready-made)      | raw S, A, B, C, D; graded: grader (PSA, BGS, CGC, ARS, other) and grade                     | `raw:S` to `raw:D`; `graded:{GRADER}:{grade}`, e.g. `graded:PSA:10`, `graded:BGS:9.5`, `graded:OTHER:9`                 |
| Sealed packaging (ready-made) | sealed (shrink), sealed (no shrink), box opened with contents sealed, opened, empty; or n/a | `sealed:shrink`, `sealed:no_shrink`, `sealed:box_opened_contents_sealed`, `sealed:opened`, `sealed:empty`; n/a has none |
| Item condition (ready-made)   | new (unused), like new, no noticeable damage, minor damage, damaged, poor                   | `cond:new`, `cond:like_new`, `cond:good` (no noticeable damage), `cond:fair` (minor damage, damaged and poor)           |
| Your own list                 | the values you write, best first                                                            | `{list}:{value}`, e.g. `watch_condition:unworn`                                                                         |

A graded key has the grader in capitals and the grade as typed, with a point followed only by zeros dropped at the end (`10.0` and `10.00` are `10`; `9.50` stays `9.50`). A lot that lacks what its list needs (a raw card with no grade, a slab with no grader or grade, no value chosen) has no bucket.

Your own lists can have **pool groups**: values that may be valued together when an item has too
few sales in its own value (e.g. "excellent" and "very good"; [how](rules/values.md#similar-conditions)). The Categories settings show each list's key ("Key: watch_condition"); a value's key, and so its bucket, is made by the rule above from the name it had when first saved.

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
those categories' item types. Its prices carry the bucket of the condition they are for, from the list's keys (none only for a plain price as sold new: [Building a collector](collectors.md#collectlink-product-ctx-heldbuckets)).
