# The data model

What Tora stores, what it works out again, what is one person's and what is shared, and the rules
every table follows. This file is the one home of these rules. The columns themselves are in
`packages/db/src/schema.ts`, which is the source of truth for them; the migrations are in
`packages/db/drizzle`.

Not here: how a value is made ([Values](values.md)); roles, rates and the base currency
([Sources and markets](sources-markets.md)); what a collect reads and keeps
([Collecting](collectors.md)); sign-in, devices and who may see what (requirements section 3).

## General rules

- **Store facts, work out the rest.** Totals, profit and current values are computed from the
  facts and are never the source of truth. What is computed may be saved to keep pages fast (the
  tables marked "derived" below); every such table can be rebuilt from the kept data.
- **IDs** are ULID strings. A table that holds one row per item, per person or per setting is
  keyed by that instead.
- **Money** is an integer in the base currency's smallest unit, in columns named `*_base`. An
  amount collected in another currency also keeps its original amount, its currency and the rate
  used.
- **Times** are ISO 8601 with an offset, in the app's time zone (an admin setting, Asia/Tokyo
  unless changed). A "day" is a calendar day in that zone; only the counts of database reads are
  kept per UTC day.
- **`created_at` and `updated_at`** are on the tables people or admins edit. Logs, packed and
  derived tables carry only the time that matters to them.
- **Lists** (categories, kinds, regions, item types, conditions beyond the built-in ones) are
  admin settings, not fixed values in the schema. An item's type (card, sealed, game, or an
  admin's type) decides its condition list and how it is valued.
- **Migrations are add-only.** A column or table is dropped only in a later migration, so the
  version before can still run after a rollback.
- **The database** is SQLite (libSQL), a local file or a hosted one. It uses features only SQLite
  has (triggers, JSON functions). The early goal of staying portable to another database is
  therefore not kept; whether to drop it is the owner's to decide.

## One person's, or shared

- **One person's**: lots and their history, manual prices, watches and wishes with their
  estimates, imports, alert channels and what was sent, marks on lottery posts, and their
  preferences. A person sees and changes only their own.
- **Shared by everyone**: items and sets, sources and listings, every collected price, the daily
  numbers worked out from them, the rules and facts of an item, stores and their posts, and the
  admin's settings.
- **Accounts are never deleted**, only turned off; a turned-off account keeps its data.
- **The account download** holds a person's lots, their history, manual prices, watches,
  estimates, imports and marks, with the items and sets they use. It leaves out the collected
  prices (each lot carries its current value) and everything used to sign in.

## Collected prices

- A collected price is never deleted or changed to put a value right. A wrong one is marked:
  `excluded` with a reason (outlier, by hand, mismatch), a rule's mark for games, or a "not the
  item" mark on a listing. A mark can be taken back.
- The same source and reference is saved once.
- A price leaves the database in two cases only: with its item, when an item nobody holds or
  watches is deleted; and when the search that found it is changed, since the new search reads
  that source again (prices excluded by hand are kept). Sales the new search no longer reaches
  are then gone.
- Three things change a stored row without changing what was collected: a lot size the source did
  not report is estimated and the price per unit worked out from the original amount, which
  stays; a merge of two items moves the rows to the kept item; a source's listing details are
  dropped after its `detailsDays`.

## Lots

- Identical units bought together at one price and in one condition are one lot with a quantity.
- When some units change (graded, sold, opened, another condition), they are **split** into a
  new lot first. The cost moves in proportion, rounded down, so the remainder stays on the
  original lot. Both lots get a `split` event.
- Cards pulled from a box are lots with a cost of 0 that point to the box; the box keeps its
  cost, and the box's profit is worked out at box level.
- A grading fee is added to the lot's cost with the grading event.
- Selling: split if needed, then a `sold` event with the price and the fees; the lot's status
  becomes sold.
- A lot's events are only ever added. They go only with a lot deleted as a mistake, which is
  refused when the lot has pulls or splits.

## The tables

Kinds: **kept** (facts and the collected record), **derived** (worked out, can be rebuilt),
**state** (settings and what a process remembers), **log**.

Accounts and alerts:

| Table            | A row is                                      | Kind  |
| ---------------- | --------------------------------------------- | ----- |
| `users`          | an account, with its role and preferences     | state |
| `user_devices`   | a device signed in to an account              | state |
| `account_setups` | a one-time link to set up or reset an account | state |
| `login_attempts` | a sign-in attempt (hashed; pruned)            | log   |
| `alert_channels` | a person's Telegram or Discord target         | state |
| `alert_log`      | one delivery of a message (pruned)            | log   |

Catalog (shared):

| Table            | A row is                                   | Kind    |
| ---------------- | ------------------------------------------ | ------- |
| `tcg_sets`       | a card set from the public catalogs        | kept    |
| `products`       | an item                                    | kept    |
| `product_images` | an item's picture                          | derived |
| `consoles`       | a console and its words, edited by admins  | state   |
| `item_rules`     | a game's words for telling its sales apart | state   |
| `item_facts`     | a dated fact about an item                 | kept    |
| `tracked_games`  | a game read before anyone wishes for it    | state   |
| `opening_sets`   | a set's pull rates                         | state   |

A person's collection:

| Table                       | A row is                                         | Kind  |
| --------------------------- | ------------------------------------------------ | ----- |
| `holdings`                  | a lot                                            | kept  |
| `holding_events`            | an event in a lot's history                      | kept  |
| `manual_prices`             | a person's own price for an item and condition   | kept  |
| `watches`                   | a watch or wish on an item and condition         | kept  |
| `wish_estimates`            | a person's estimate on a wish                    | kept  |
| `canceled_orders`           | an order the person canceled, so imports skip it | kept  |
| `purchase_links`            | a pasted purchase link                           | kept  |
| `import_runs`               | one import                                       | log   |
| `import_rows`               | what happened to one row of an import            | log   |
| `import_uploads`            | an uploaded purchase file, emptied once read     | state |
| `suggestions`               | a fix proposed by the data review                | log   |
| `source_warning_dismissals` | a person's "no source expected" for an item      | state |
| `lottery_marks`             | a person's mark on a lottery post                | kept  |

Collected:

| Table                | A row is                                            | Kind  |
| -------------------- | --------------------------------------------------- | ----- |
| `product_sources`    | an item's listing or search on a source             | state |
| `source_candidates`  | a possible listing waiting for a person             | state |
| `price_observations` | one collected price (a sale, an ask, a buy price)   | kept  |
| `supply`             | the lowest ask and the listings of an item on a day | kept  |
| `rankings`           | an item's place in a site's ranking on a day        | kept  |
| `opening_cards`      | a set's hit card with its prices                    | kept  |
| `fx_rates`           | a day's exchange rate                               | kept  |
| `not_item_marks`     | a listing marked as not the item                    | kept  |
| `item_checks`        | a check of an item's sales or listings              | log   |

Derived:

| Table              | A row is                                              |
| ------------------ | ----------------------------------------------------- |
| `item_sales`       | an item's kept prices, packed for reading             |
| `price_days_dirty` | an item and day changed since the packing             |
| `bucket_values`    | the market value of an item and condition             |
| `holding_values`   | a lot's value per day                                 |
| `portfolio_charts` | a person's value over time                            |
| `signals`          | the buy timing numbers of an item and condition a day |
| `wish_levels`      | a game's daily levels                                 |
| `item_rule_state`  | the rules last applied to a game's sales              |
| `sale_coverage`    | the nights a source was read for a game               |

Collecting and the app:

| Table            | A row is                                           | Kind  |
| ---------------- | -------------------------------------------------- | ----- |
| `sources`        | a source with its roles and its last quality check | state |
| `collector_runs` | one source's run                                   | log   |
| `sale_spans`     | the days a deeper read covered                     | log   |
| `market_jobs`    | a daytime read waiting or done                     | state |
| `market_days`    | the daytime requests used on a day                 | log   |
| `market_state`   | a marketplace's number a day and its refusals      | state |
| `activity`       | an entry of the activity log                       | log   |
| `db_usage`       | the rows read and written on a day                 | log   |
| `app_settings`   | an admin setting                                   | state |

Stores (shared, except the last three):

| Table               | A row is                                   | Kind  |
| ------------------- | ------------------------------------------ | ----- |
| `stores`            | a physical store                           | state |
| `store_posts`       | a post from a feed (pruned)                | kept  |
| `store_post_images` | a post's picture (pruned)                  | kept  |
| `feed_tokens`       | a person's token for sending a feed        | state |
| `store_notices`     | the last notice a person got about a store | log   |
| `notice_messages`   | the message that carried a post            | log   |
