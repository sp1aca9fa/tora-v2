# The data model

What Tora stores, what it works out again, what is one person's and what is shared, and the rules
every table follows. This file is the one home of these rules. The columns themselves are in
`packages/db/src/schema.ts`, which is the source of truth for them; the migrations are in
`packages/db/drizzle`.

Not here: how a value is made ([Values](values.md)); roles, rates and the base currency
([Sources and markets](sources-markets.md)); what a collect reads and keeps
([Collecting](collectors.md)); sign-in, devices and who may see what
([Accounts and access](accounts.md)).

## General rules

- **Store facts, work out the rest.** Totals, profit and current values are computed from the
  facts and are never the source of truth. What is computed may be saved to keep pages fast (the
  tables marked "derived" below); every such table can be rebuilt from the kept data.
- **IDs** are ULID strings. A table that holds one row per thing (an item, a lot, a person, a source, a setting and the like) or per pair of things is keyed by that instead.
- **Money** in the base currency is an integer in its smallest unit, in columns named `*_base` (the unit, the conversion and a change of base: [Sources and markets](sources-markets.md#currency-and-rates)). A collected price in another currency also keeps its original amount, its currency and the rate used. Three amounts stay in the currency they were read or entered in, and a change of base leaves them as they are: a set's hit cards (`opening_cards`), a ranking's price (`rankings`) and a wish's estimate (`wish_estimates`).
- **Times** are ISO 8601 with an offset and three fraction digits (`2026-10-09T20:15:00.000+09:00`), in the app's time zone (an admin setting, Asia/Tokyo unless changed). A "day" is a calendar day in that zone: a time's first 10 characters (in SQL `substr(<column>, 1, 10)`, never `date()`, which turns the time into UTC first). Stored times compare as text, in time order except during the hour a summer time ends; a time compared with them is written the same way (`toLocalIso`). A change of zone rewrites every stored time (columns named `*_at`, which is how the change finds them, and times inside JSON) as the same instant in the new zone; a column holding only a day or a date keeps it, and a time compared only as an instant (`market_state.wait_until`) is left. The rows read and written are counted per UTC day. The windows and ages of values ([Values](values.md), "Words") and the ages after which rows are pruned count 24-hour days.
- **`created_at` and `updated_at`** are on the tables people or admins edit. Logs, packed and
  derived tables carry only the time that matters to them.
- **Lists** (categories, kinds, regions, item types, conditions beyond the built-in ones) are
  admin settings, not fixed values in the schema. An item's type (card, sealed, item, game, or an admin's type) decides its condition list and how it is valued.
- **Migrations are add-only.** A column or table is dropped only in a later migration, so the version before can still run after a rollback. A table rebuilt to change a check (SQLite's ALTER TABLE cannot change one) keeps every column and only loosens checks; a stricter check waits like a drop.
- **The database** is SQLite (libSQL), a local file or a hosted one. It uses SQLite's own forms of triggers (a body of SQL statements) and of the JSON functions (`json_extract` and the like), so the early goal of staying portable to another database is not kept; whether to drop it is the owner's to decide. Most fixed-value columns are enforced with CHECK constraints (`packages/db/src/schema.ts`; Decision log, 2026-10-09); some are checked only in code (`market_jobs` kind and status, `suggestions` kind and status, `purchase_links` and `import_uploads` status, `item_checks` outcome and by, `sale_spans` how), and free-text source columns have none.

## One person's, or shared

- **One person's**: every table under "A person's collection" below, a lot's daily values and the value chart (`holding_values`, `portfolio_charts`), their devices, alert channels and what was sent, feed tokens and store notices, their entries in the activity log, and their preferences. A person sees and changes only their own, besides an admin's exceptions in [Accounts and access](accounts.md#roles-and-what-each-may-do).
- **Shared by everyone**: items and sets, sources and listings, every collected price, the daily numbers per item worked out from them, the rules and facts of an item, stores and their posts, the other tables under "Collected" and "Collecting and the app" below (one person's activity entries aside), and the admin's settings.
- **Accounts are never deleted**, only turned off; a turned-off account keeps its data.
- **The account download** holds part of a person's own rows, with the items they use, never the collected prices nor a password, authenticator, backup code or token: the list is in [Accounts and access](accounts.md#the-account-download).

## Collected prices

- A collected price is never deleted or changed to put a value right. A wrong one is marked:
  `excluded` with a reason (outlier, by hand, mismatch), a rule's mark for games, or a "not the
  item" mark on a listing. A mark can be taken back.
- A source and reference is one row in the whole database, on the item that first read it; which reads are saved, and which replace a stored one (a day's ask), is in [Collecting](collectors.md#what-is-kept).
- A price leaves the database in two cases only: with its item, when an item that no lot (of any status, in any account) and no watch refers to is deleted, every person's manual prices on it going too; and when one of an item's searches on a source is saved again (changed by a person, replaced by a plug-in's newer default search, or, for every search of the item, when a fix of the item's details is accepted): every price of that item from that source goes, whichever of its links found it, except those excluded by hand, and the source is read again. Sales that no link of the item on that source still reaches are then gone.
- These change a stored row without changing what was collected: a lot size the source did not report is estimated and the price per unit worked out from the original amount, which stays; a merge of two items moves the rows to the kept item; a source's listing details are dropped after its `detailsDays` ([Sources and markets](sources-markets.md#what-a-plug-ins-declarations-do)); a pasted reference of a stored sale sets its condition and clears its exclusion; a change of the base currency converts its amount ([Sources and markets](sources-markets.md#currency-and-rates)); a change of the time zone rewrites its times ("Times" above).

## Lots

- Identical units bought together at one price and in one condition are one lot with a quantity.
- When some units change (graded, sold, opened, another condition), they are **split** into a new lot first; when all of them change, the lot itself changes, with no split. The cost moves in proportion, rounded down, so the remainder stays on the
  original lot. Both lots get a `split` event.
- Cards pulled from a box are lots with a cost of 0 that point to the box (a grading fee later adds to it); the box keeps its cost, and the box's profit is worked out at box level ([Values](values.md#box-view)).
- A grading fee is added to the lot's cost with the grading event.
- Selling: split if needed, then a `sold` event with the price and the fees of the whole lot sold; the lot's status
  becomes sold.
- A lot's events are only added, except that a corrected purchase date moves its `acquired` event and a change of the base currency or the time zone converts the amounts and times in them. A correction of a lot (quantity, cost, date) edits the lot and adds a `note` event with the values before and after. Events go only with their lot: when it is deleted as a mistake (refused when it has pulls or a `split` event, on either side of a split), or when its order is marked canceled, which removes every lot of that person with the same order (its shop and ID), split and sold ones included (refused when one has pulls).

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

| Table            | A row is                                            | Kind  |
| ---------------- | --------------------------------------------------- | ----- |
| `tcg_sets`       | a card set from the public catalogs                 | kept  |
| `products`       | an item                                             | kept  |
| `product_images` | an item's picture, downloaded once from its listing | state |
| `consoles`       | a console and its words, edited by admins           | state |
| `item_rules`     | a game's words for telling its sales apart          | state |
| `item_facts`     | a dated fact about an item                          | kept  |
| `tracked_games`  | a game read before anyone wishes for it             | state |
| `opening_sets`   | a set's pull rates                                  | state |

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
| `suggestions`               | a fix proposed by the data review                | state |
| `source_warning_dismissals` | a person's "no source expected" for an item      | state |
| `lottery_marks`             | a person's mark on a lottery post (goes with it) | kept  |

Collected:

| Table                | A row is                                                          | Kind  |
| -------------------- | ----------------------------------------------------------------- | ----- |
| `product_sources`    | an item's listing or search on a source                           | state |
| `source_candidates`  | a possible listing waiting for a person                           | state |
| `price_observations` | one collected price (a sale, an ask, a buy price, a retail price) | kept  |
| `supply`             | the lowest ask and the listings of an item on a day               | kept  |
| `rankings`           | an item's place in a site's ranking on a day                      | kept  |
| `opening_cards`      | a set's hit card with its latest prices                           | state |
| `fx_rates`           | a day's exchange rate                                             | kept  |
| `not_item_marks`     | a listing marked as not the item                                  | kept  |
| `item_checks`        | a check of an item's sales or listings                            | log   |

Derived:

| Table              | A row is                                                 |
| ------------------ | -------------------------------------------------------- |
| `item_sales`       | an item's kept prices, packed for reading                |
| `price_days_dirty` | an item, source and day changed since the packing        |
| `bucket_values`    | the market value of an item and condition                |
| `holding_values`   | a lot's value on every day it was held (one row per lot) |
| `portfolio_charts` | a person's value over time                               |
| `signals`          | the buy timing numbers of an item and condition a day    |
| `wish_levels`      | a game's daily levels                                    |
| `item_rule_state`  | the rules last applied to a game's sales                 |

Collecting and the app:

| Table            | A row is                                           | Kind  |
| ---------------- | -------------------------------------------------- | ----- |
| `sources`        | a source with its roles and its last quality check | state |
| `collector_runs` | one source's run                                   | log   |
| `sale_spans`     | the days a deeper read covered                     | log   |
| `sale_coverage`  | the nights a source was read for a game            | log   |
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
| `store_notices`     | the last notice a person got about a store | state |
| `notice_messages`   | the message that carried a post (pruned)   | log   |
