# Collectibles Tracker: Requirements (v1)

## How to use this file (Claude Code: read first)

- This file is split into **Core** (sections 1-7) and **Sessions** (S1-S9).
- Every session: read **Core** fully, then read **only the current session** (first one not marked done in the Status table).
- Do **not** read or start the next session until the current one meets its acceptance criteria and the user confirms.
- At the end of a session: update the Status table, note any decisions or deviations under "Decision log", commit.
- If something in Core turns out wrong or ambiguous, ask the user, then fix Core rather than working around it.

### Status

| Session | Topic | Status |
|---|---|---|
| S1 | Foundation: monorepo, schema, i18n, access | done |
| S2 | Registration UI (products, lots, pulls, events) | done (reworked by S2b) |
| S2b | Accounts + 2FA + devices, TCG/Game taxonomy, region, TCG set catalog | done |
| S3 | Collector framework + SNKRDUNK + source matching | built; awaiting data gate with user |
| S4 | Mercari sold collector + purchase import by link | built; awaiting user check |
| S4b | MCP server: Claude reads the data (sanity checks, analysis, dev feedback) | built; awaiting user setup |
| S5 | Valuation engine, Portfolio, Item detail, charts | built; awaiting user check |
| S5b | SNKRDUNK purchase import (Gmail Takeout) + order IDs | built; awaiting user import |
| S5c | Portfolio as a per-product summary + product images | built; awaiting user check |
| S5d | Imports hub: one Imports menu for every import, its results and follow-ups | built; awaiting user check |
| S4d | Automated data review: cheap model checks flagged data, suggestions queue | built; awaiting user check |
| S4c | Import purchases from any shop through Claude (Haiku, Sonnet for flagged rows) | built; first real import done (39 Mercari screenshots) |
| S7 | US data (TCGCSV, eBay), 駿河屋, FX, JP vs US spread | built; eBay asks collector ready, waiting on the user's eBay developer account review |
| S8 | Visual redesign + wide-screen layout, portfolio revamp (tracking groups, speed), Actions page, sources with roles | in progress |
| S11 | Primary and secondary markets: roles and identity sources per market, one secondary price per item | built 2026-10-14; awaiting user check |
| S12 | Documentation for others: clone and run, build collectors, choose identity and reference sources, set up markets | todo (after S11; user, 2026-10-13) |
| S6 | Export / import (JSON, CSV) + backups; imports started from the app | todo (moved after S8 at the user's request) |
| S10 | Reliability, consistency, efficacy and function review, incl. a full setup in another market (e.g. France + China) | todo (after S6, before S9; user, 2026-10-13) |
| S9 | Watchlist and buy timing: track items not owned yet, find good prices to buy at | idea; design session first (user, 2026-10-12) |
| S13 | Buy suggestions: Tora proposes what to buy and when, within a budget and a target date | idea; after S9 (user, 2026-10-12) |

### Decision log

- (append here: date, decision, reason)
- 2026-10-09: Web app hosted on Vercel, DB on Turso; only collectors run locally in WSL. Reason: user wants the app online for free; scraping still needs the residential IP. Replaces Tailscale.
- 2026-10-09: Single-user password + signed cookie auth with DB-backed lockout. Reason: app is now public; simplest option with no third-party service.
- 2026-10-09: Node 24 LTS instead of 22 (installed version, current LTS; 22 still supported).
- 2026-10-09: TypeScript 6.0 (not 7: typescript-eslint does not support 7 yet); ESLint 9 (eslint-config-next plugins do not support 10 yet).
- 2026-10-09: Added `running` to collector_runs.status (a run in progress) and `manual` to sources. Source columns are free text (no CHECK) so new sources need no migration.
- 2026-10-09: Enum columns enforced with CHECK constraints (portable to Postgres).
- 2026-10-09: Locale lives in a cookie (no /en, /ja URL prefixes); default from Accept-Language.
- 2026-10-09: Collector packages are loaded by path (`collectors-public/`, `collectors/`), so the public repo works without the submodule.
- 2026-10-09: The `acquired` event payload snapshots the state as received (packaging, condition, grade); the box view's "value as received" bucket comes from it.
- 2026-10-09: Migrations run from the home PC (`pnpm db:migrate` against Turso), not during Vercel builds. Seed refuses remote DBs.
- 2026-10-09: App display name "Tora" (from the repo name); easy to change in messages/*.json and manifest.ts.
- 2026-10-09: S1 accepted (login works on the phone via Vercel).
- 2026-10-09: English is the default locale regardless of browser language; an EN/JP toggle is always visible (mobile header, desktop sidebar, login page). Reason: user is the main reader; visitors can switch.
- 2026-10-09: Edits to recorded facts are logged as `note` events with `payload.kind = 'edit'` and before/after values (no new event type).
- 2026-10-09: Add flow offers purchase / gift / trade only; pulls are entered through "Log pulls" on a sealed TCG holding. A new pull product inherits set, franchise and language from the box; the pull inherits `acquired_from`.
- 2026-10-09: Pull entry uses one name box; Japanese text goes to `name_ja`, anything else to `name_en`.
- 2026-10-09: Marking a sealed TCG holding opened/empty sets status `consumed`; other types keep their status and only change packaging.
- 2026-10-09: Grading return accepts an optional extra fee (upcharge, return shipping), added to the cost basis like the submission fee.
- 2026-10-09: "Delete entry" exists for mistakes only: refused once pulls or splits depend on the holding; removes its events.
- 2026-10-09: Product details are edited separately (applies to every holding of that product).
- 2026-10-09: S2b added at the user's request before S3: accounts for family use (own collection each; catalog and prices shared), TOTP 2FA, max 2 active devices per account (revoke frees a slot), sessions that renew on use, TCG/Game taxonomy with region, single product name.
- 2026-10-09: Authenticator secrets are encrypted with a key derived from AUTH_SECRET, so local `.env` and Vercel must share AUTH_SECRET. Signing everyone out is `pnpm user revoke <u> all`, not rotating the secret.
- 2026-10-09: Accounts are created only via CLI (`pnpm user create`), which shows the QR code in the terminal and requires one valid code before saving (a bad scan cannot lock the user out). 8 one-time backup codes per account.
- 2026-10-09: Migration 0001 assigns pre-account data to a placeholder `owner` account (no password); the first `pnpm user create` claims it. Verified by a migration upgrade test.
- 2026-10-09: TCG catalog = sets (with release date and type) for Pokemon, One Piece, Yu-Gi-Oh! OCG (Japanese) and Magic (region-less). Sealed products are generated on first use per set + kind + variant + region, named in the set name's language (e.g. "バトルパートナーズ BOX"). Singles stay manual until SNKRDUNK search (S3).
- 2026-10-09: Products are shared: only their creator or an admin can edit them; catalog-generated products only by an admin.
- 2026-10-09: Portfolio header shows total spent and item counts now; market value arrives in S5.
- 2026-10-09: Pokemon catalog switched from TCGdex to the official pokemon-card.com product list (TCGdex lagged behind new releases and had wrong names/duplicates). Set codes are copied from TCGdex only when name and release date match. `catalog:sync` now removes sets that left the catalog, re-pointing products that used them.
- 2026-10-09: S3 matching runs on the home PC, not in the add flow (SNKRDUNK must not be queried from Vercel). Candidates are confirmed on the item page or a SNKRDUNK link is pasted. Owned and opened (consumed) products are matched: opened boxes still need a value "as received".
- 2026-10-09: SNKRDUNK sales history has no transaction ids and shows the last ~3 days as relative times. Trades are saved per finished day (older than 5 days) with refs `<listing>|<day>|<price>|<lot>|<condition>|<label>#n`; the history sweep only saves a day once all its entries are seen and resumes across runs (60 pages per item per run). Lot trades ("10個") are stored per unit with the original lot price kept.
- 2026-10-09: SNKRDUNK lists no-shrink boxes as separate products, so a product may have several active listings per source; the no-shrink listing's trades go to `sealed:no_shrink`, other sealed trades to `sealed:shrink`.
- 2026-10-10: `collectors/` is not a pnpm workspace member: Vercel cannot fetch the private submodule and a frozen install failed when the lockfile listed it. The root links `@tora/collector-sdk`, `@tora/core` and `@tora/db` so the private code resolves them; `pnpm typecheck` checks it when present.
- 2026-10-10: Once an item has an active listing, its remaining suggestions and the paste-link box collapse under "Add another listing" (kept for the no-shrink variant) and it no longer counts as "to confirm".
- 2026-10-10: Collection is event-triggered (logon + daily catch-up) with a once-per-day guard instead of a fixed 04:00 cron, since the PC is often off.
- 2026-10-10: A confirmed (or pasted) listing is the source of truth for product details: on the next run its title rewrites the product once (cards: name, rarity, set, set code, number; sealed: name, set). Variant listings (【シュリンクなし】) do not rewrite; catalog products keep their catalog set; later user edits are kept (`product_sources.details_synced_at`).
- 2026-10-10: S5 valuation: per-source fallback picks the first source with any sold sample in the 180-day window (in order SNKRDUNK, Mercari, 駿河屋, others), then retail price. Confidence counts samples of that source. Manual prices are per user and per product + bucket. Unrealized P/L compares value with the cost of valued holdings only (unvalued ones are listed as "N of M valued").
- 2026-10-10: Snapshots run at the end of `pnpm collect` (also `pnpm valuate`): today, the last 7 days (trades arrive late) and any missing day of the last 90, so the chart has history immediately. A holding counts on a day from its acquisition until its sold / consumed event; it is valued with its current condition.
- 2026-10-10: An opened (consumed) box has no current value card; its value "as received" (bucket from the acquired event) is in the box view, with its own manual price since such boxes rarely have market data.
- 2026-10-10: Charts use the validated reference palette slots 1-3 (light and dark steps); every chart has a legend with values on hover, and the item page keeps a table of medians per source + bucket as the table view.
- 2026-10-10: User request: show the last real sale and per-source prices next to the median. The median stays the value used for totals and P/L; the last sale (with trend vs median) and per-source cards are shown on the item page, with the last sale in the portfolio list.
- 2026-10-09: Health check for "median moved > 50 %" compares the last 7 days with the 30 before (day-over-day medians are too noisy at a few trades per day). The item page shows plain 30-day medians per bucket until S5 adds valuation.
- 2026-10-10: S5b purchase import reads a Google Takeout mbox on the home PC instead of connecting the app to Gmail (no Gmail credentials anywhere online). Accepted SNKRDUNK offers count as purchases. Receipts have no listing link, so products are matched by listing title. Order IDs are normalized per marketplace (`order_source`) and unique per user only for one-item-per-transaction marketplaces (SNKRDUNK, Mercari, Yahoo); Amazon orders can hold several items.
- 2026-10-10: The import command is `pnpm purchases` because `pnpm import` is a pnpm built-in.
- 2026-10-10: Product images are stored as small WebP thumbnails in the database (downloaded once by the home PC, served with long-lived cache), not hot-linked: the app should not depend on external image URLs, and per-product thumbnails are small. Object storage is the fallback if it grows.
- 2026-10-10: New phases at the user's request: S5c (portfolio as a per-product summary + images) next, before S4; S8 (visual redesign + wide-screen layout) after S7.
- 2026-10-10: CLI scripts (collect, purchases, valuate) check for pending migrations at startup, after `pnpm collect` failed mid-run on a missing column (migration 0006 not applied yet).
- 2026-10-10: Positioning: "bring your own sources". The public repo ships the app and the plug-in framework, not scrapers for any site; plug-ins live in `collectors-public/` (publishable) or a private package. A setting to switch on a built-in scraper would not change much, since publishing the code is what matters, so shop-specific code stays private. Validated later by a second shop (Mercari purchase importer, S4).
- 2026-10-10: The SNKRDUNK email reader stays private; the in-app import (S6) takes a generic purchases file that the private plug-in produces locally.
- 2026-10-10: License: PolyForm Noncommercial 1.0.0 for the public repo (source-available; noncommercial use only). The private plug-in repo stays all rights reserved.
- 2026-10-10: SNKRDUNK card lot sizes: the paged sales history never reports how many cards a trade covered (a 10-card lot looked like one card at 10x the price), while the newer trading-history endpoint reports lot size and exact time but only the latest 20 trades (per condition filter), without paging. Each listing now uses trading-history from the day it first ran (`tradesSince`, plus one request per condition users own) and the sales history only for the days before. Card trades from the sales history are flagged `quantity_inferred` and their lot size is estimated (`inferLotSizes`: about k times the median of the same card and condition within 3 days, k 2-10, within 12 %). The app says so wherever such sales feed a number (price chart note and hover, valuation note, portfolio chart note and hover). Stored data was flagged once (12,049 trades, 384 found to be lots).
- 2026-10-10: Value over time is rebuilt on every run from each holding's acquisition date (only changed days written); cost is everything held, holdings without a market price count at cost.
- 2026-10-10: Look-alike products: a pull typed with the same name and card number as a registered card (same franchise / region) is logged on that card, not a new product. A product without a price source is offered the listing of a linked look-alike right away (same card number plus same name or set code; same name and kind for sealed items), when it is created and at the start of each collector run; the site search waits while such a suggestion is pending and runs again once it is dismissed.
- 2026-10-10: Collector runs still `running` after 3 hours are closed as failed (interrupted) when the next run of that source starts.
- 2026-10-10: Registering a new item or a pull suggests matching items already registered while typing (name, set code, card number; linked ones first, marked "linked"). Picking one registers the purchase or pull under that item instead of creating a duplicate (user request: search-first, like asset tools).
- 2026-10-10: Duplicate products can be merged: the product edit page suggests registered look-alikes; picking one opens a confirmation, and merging moves the duplicate's lots, sales data, manual prices and listings to the kept product and deletes the duplicate (same category and kind only).
- 2026-10-10: Cost basis of pulls (user decision): an opened (consumed) item keeps its full cost in the totals, the P/L base and the value-over-time cost line, at no market value; the pulls logged from it cost nothing and carry the market value. Unlogged cards are thus not guessed at. Each pull shows an estimated cost for reference only (the opened item's cost split across all its logged pulls by market value, equal shares where unknown), never counted in totals. Previously an opened item's cost dropped out of the totals, which overstated P/L.
- 2026-10-10: Mercari is searched for every product (user: try everything, maybe turn cards off later). No public project filters Mercari bundles or parts; hosted scrapers stop at sold-only + dedupe + median/percentiles, and Japanese price sites mostly use partner store prices (e.g. ポケカチ with Card Rush). So filtering is rule-based and transparent: every rejected item is kept with its reason and can be included by hand.
- 2026-10-11: Add item: typed product details survive switching category / kind; "acquired on release day" fills the date from a known full release date; "Unknown" is the first shop suggestion and the other lists are alphabetical; total cost may be left blank when a retail price is known (retail price x quantity is used, and the form says so).
- 2026-10-11: Valuation fallback for rare items: a source needs 3 sales; steps are the holding's condition over 30 / 90 / 180 days, then a year, then similar conditions pooled (an item's conditions, a card's raw grades, intact boxes with or without shrink; never graded slabs or opened boxes) over 180 days, then a year. A source reaching 3 sales wins over an earlier source with fewer; otherwise the first source with any sale is used. Year-long or pooled values are low confidence and labeled "similar conditions pooled".
- 2026-10-11: Mercari purchase importer keeps purchases whose Mercari category is a collectible one (top category ゲーム・おもちゃ・グッズ: cards, toys / hobby, games, figures), read from the listing; other purchases are skipped with the reason shown, not imported. Kept ones still go through the in-app review.
- 2026-10-11: Plan: S5d Imports hub next (user: failed links were not findable once the review page was closed; all import actions should start from and return to one Imports menu); stopgap shipped: failed-links banner and list, Imports link in Settings.
- 2026-10-11: Plan (user + Claude): S4d automated data review first (Haiku on the flagged data only, after a trial against Sonnet; suggestions the user accepts in the app; later Sonnet may make the final call), then S4c import from any shop (Haiku extracts and matches, Sonnet reviews rows flagged by code-computed checks, not by the model's self-rated confidence). Earlier the same day: S4c import purchases through Claude via MCP write tools (any format the user shares, same import rules, everything lands in Review import; the first MCP writes, add-only, approved in the chat); S8 gets per-lot "count in cost" / "count in value" switches with separate portfolio groups, and portfolio page speed (stream the slow parts).
- 2026-10-11: Mercari sends buyers no purchase email (the user's export held only sales, cancellations and Merpay bills; the monthly Merpay payment mail lists deferred-payment items without date or ID). So Mercari purchases come from links the user pastes in the app (Review import > Add purchases by link), read by the home PC on the next collect; reading the purchase history with the user's login was rejected (token on the PC, fragile, account risk). Each link is read once; the purchase date is the listing's last update (approximate, editable in the review); a lot that looks like an entry added by hand gets the item ID instead of a second lot; the bought item becomes a reference sale on the product's Mercari search. Mercari Shops product links are read too (no reference: a shop's page is not one sale).
- 2026-10-11: S4d trial (26 odd sales after a full collect): Haiku and Sonnet each agreed with Claude's verdicts on 23 of 26; both took "X様" (reserved listing) as suspect because the trial prompt suggested it, so the prompt now says it is an ordinary sale. Most value was in fixes, not per-sale verdicts: 15 of the 26 came from one search also catching the "30th CELEBRATION FUTURISTIC BOX" (applied: excluded word), and ピカチュウ 長場雄 kept almost no raw sales for lack of card details (applied: 208 / S-P / P / YU NAGABA set).
- 2026-10-11: S4d built as a script, not MCP write tools: `pnpm review` builds the cases itself (odd sales with their titles and the bucket's other sales; searches keeping under 30%), asks `claude -p` (Haiku, no tools, JSON schema), sends cases under 0.7 confidence or "unsure" to Sonnet, and files suggestions (exclude_sale, exclude_word, fix_product) plus remembered verdicts (sale_ok, search_ok; searches looked at again after 14 days). The MCP server stays read-only. One exclude_word covers the sales it explains (no separate sale suggestions). First real run: 21 cases, 11 to Sonnet, 8 suggestions, $0.08.
- 2026-10-11: Suggestions (user requests): each links to the listings behind it (SNKRDUNK: the product page, it has no per-trade page); a word to skip shows every collected listing with it, counted or left out. The user can leave a note when accepting or dismissing; notes are stored on the suggestion, listed under Suggestions (deletable), given to the models on every later review (they follow them over their own judgment) and shown in the MCP data checks so recurring ones can become filter rules. First such rule: Elite Trainer Box / ETB (English-only line) counts as another region for Japanese products.
- 2026-10-11: S4c (user: folder + command; Mercari and Amazon order screenshots first): `pnpm import-ai <folder>` like `pnpm review`, no MCP write tools. Haiku reads the files with only the Read tool, confined to the folder, and matches rows to the user's products (list given) or describes a new one; code checks (no price/date, odd quantity, unknown product, title not supporting the match, a new product named like one held, price over 3x / under 1/3 of the latest unit value, model unsure) send whole files to Sonnet with the first reading and the flags, plus a 10 % random sample. Rows without an order ID are imported without one (no made-up IDs) and recognised again by product, price and date; several items in one order get `<order>#n`. Readings cached per file hash in the folder. Import run method `claude`, with what Sonnet re-read in its note; failed Mercari links whose item ID was imported are resolved. Matching improvement for every import: a likely match also counts when the receipt resolves to the entry's product (not only by title words).
- 2026-10-12: import-ai, several files per purchase (user: share data in whatever form, e.g. a Mercari listing page plus its transaction page): the model lists each file's view as its own row and tags rows it thinks are one purchase with a confidence; the code joins them only when the model is at least 0.8 sure and nothing disagrees (shop, price, order ID, date). Otherwise, and for look-alikes the code finds (same shop and price, one title the other cut short), both lots are imported and flagged `maybe_same`; Review import offers "Same purchase as" to merge two lots (the chosen one stays and takes the other's order ID, price or order date where it lacks them; links move over). Lots without an order ID can be removed in review. Mercari cost = 商品代金 minus coupons (メルペイ / points are payment, not discounts).
- 2026-10-12: import-ai fixes after the user's first real run (39 Mercari screenshots, all listings first and then all transaction pages, so no pair shared a batch: 38 lots for 20 purchases; merged by Claude at the user's request with the new lot merge, failed links resolved): look-alike pairs of different batches are asked about as text only (Haiku, cached), joined when sure; a guessed date (a listing's age, 半年以上前) never counts against a pair and is not a purchase date; the folder's own cache file and other dotfiles are never inputs; rows whose order ID is already registered are not checked (no Sonnet re-reads on re-runs); the random Sonnet check is drawn once per file; an item made only for a merged-away lot is deleted.
- 2026-10-12: Plan (user): cards not linked to SNKRDUNK get a warning; non-card items get a stable product-page source (駿河屋 product pages, not Mercari) with the same warning; both in S7. Mixed bundles in one listing noted as an undecided future idea.
- 2026-10-12: Plan (user): S6 moved after S8. The user wants imports handled from the app rather than terminal commands; to revisit with S6 (in-app file upload, Gmail auto-import, where the model runs). Next: S7.
- 2026-10-12: S7 scope (user): TCGCSV and eBay sold for US prices; 駿河屋 for non-card items only (games, consoles, controllers, supplies, boxes, decks; cards stay on SNKRDUNK + Mercari); the "not linked to 駿河屋" warning only for non-card items costing more than ¥3,000 (changeable later). eBay answered 403 to every request from the home PC (search, home and item pages, plain fetch and headless Chrome) and PriceCharting / 130point sit behind Cloudflare challenges, so eBay is deferred (user): S7 ships without it and PSA cards have no US price yet. US prices never feed the valuation (JP market value); they are shown side by side.
- 2026-10-12: S7 build: US prices are stored as `listing` observations in dollars and loaded nowhere in the valuation (which now takes yen prices only); 駿河屋 asking prices became the valuation's last market fallback (`store` method) as section 6 planned; first matching run: 36 TCGplayer and 36 駿河屋 suggestions (a first 駿河屋 pass made 74, mostly related goods, and was redone with a tighter rule before the user saw it).
- 2026-10-12: SNKRDUNK matching treated "206" and "206/165" as different cards, so cards typed without the set size (e.g. エリカの招待 SV2a 206, from an import) never got a SNKRDUNK suggestion while TCGplayer (which compares the leading number) did. Numbers now match when one side leaves out the set size. Home market and currency per user noted as a future idea (user).
- 2026-10-12: New phase S9 at the user's request: a watchlist of items not owned yet, with help finding a good price to buy at from price behaviour (the reason Tora v1 was started). After S6; starts with a design session. First ideas written down in S9, all open. "Price alerts" (future ideas) folds into it.
- 2026-10-12: SNKRDUNK is also the main source for sealed TCG product (boxes, packs, decks, special sets; user); 駿河屋 stays a second source for them and the main one for games, consoles, supplies and other items over ¥3,000. The 駿河屋 results parser looked for an item's link only 400 characters before its title and skipped items with longer markup (the regular 30th CELEBRATION box was missed, leaving only the FUTURISTIC BOX); it now looks back to the previous item.
- 2026-10-12: Card sleeves named デッキシールド were imported as a deck (sealed, so SNKRDUNK was asked for); the Mercari importer and the import-ai prompt now file sleeves, deck shields, deck cases, playmats and loaders as `supply`. Fixed in production for the one such item (デッキシールド ピカチュウの贈り物: kind supply, its lot's sealed packaging carried over as condition new/unused).
- 2026-10-12: 駿河屋 game search: its search wants every word and its titles carry one script, so a name like "ライブアライブ LIVE A LIVE" found only merch. Software is now searched by its Japanese part plus the platform as 駿河屋 writes it (スイッチ, PS5, 3DS, ...; its search matches the item's kind), then the full name; titles are scored against the Japanese part and without spaces; platforms stored as display names ("PlayStation 5", "Nintendo Switch") are recognised. Games whose 駿河屋 title is not reachable from the saved name (テイルズ オブ アライズ, 超探偵事件簿 レインコード) need a pasted link. Follow-up the same day: games are searched within 駿河屋's ゲーム category (category=2), which keeps goods and books out and whose search knows readings a word match cannot (テイルズオブアライズ finds "Tales of ARISE"); there, its top 3 results that fit the kind and platform get at least 0.5 (confirm by eye); a site-wide search by name is the last try (things filed elsewhere). Tales of ARISE, 超探偵事件簿 レインコード and CAPCOM RETROSTATION are found now.
- 2026-10-12: "Don't warn" for items without their main source (user: items no shop lists, e.g. the TAG Heuer × Mario watch): per user and item (`source_warning_dismissals`, migration 0015), on Imports > Price sources to link and on the item page; dismissed items are listed there with "Warn again". Web research by a model was tried before building it (see future ideas: Yahoo Auctions collector, Ask Claude to look).
- 2026-10-12: TCGplayer suggestions for sealed items (user: a box was offered its single pack too): only the set's products of the same kind are suggested (a box: Booster Box, not packs or cases; a pack: not boxes; a deck: not sleeves; a special set: not booster boxes or decks), across all candidate sets; the others only when none fits.
- 2026-10-12: eBay (user: TCGplayer has far fewer listings than eBay, e.g. one vs many for the YU NAGABA Pikachu). Retried scraping: a full browser engine loads eBay's home page but every search returns an error page (bot protection on search; a visible window could not be tested from the sandbox). Official sold data is closed (Marketplace Insights not open to new developers; Finding API retired Feb 2025); paid sold-data APIs and hosted scrapers exist (some with ~100 free requests a month) and were set aside by the user. Chosen (user): eBay's official Browse API, free, active listings only. Collector `ebay` (public; skipped without EBAY_CLIENT_ID / EBAY_CLIENT_SECRET): one search per TCG product per collect (keywords from the TCGplayer title, else set code + number, plus "japanese"; editable; collectors can now fill in their own search), single-item listings of the same card only (number in the title, no lots / proxies, Japanese or not by region), grouped by grade read from the title; per group and day one `listing` observation (median ask after outliers, in dollars and yen) with count, lowest, the 10 cheapest and every listing ID (to infer probable sales later from listings that vanish early). Japan vs US compares a graded ask with the same grade in Japan. Production use of eBay's Buy APIs may need eBay's approval: waiting on the user's developer account review.
- 2026-10-12: Plan (user): notice levels in S8: each warning / notice / action type is assigned by the user (Settings) to one of ~5 designed levels (colour, order); defaults red for what makes TCG values wrong (missing SNKRDUNK, card without grade), blue for game equivalents and secondary gaps.
- 2026-10-12: Plan (user): in S8 the Actions page solves actions in place: dense, expandable cards per pending action with what is needed to confirm it (e.g. item vs suggested listing side by side, Confirm / Reject on the card), filters and search; the item page only for what a card cannot settle.
- 2026-10-12: S8 speed, measured on production: the portfolio spent ~2 s (20 s on a cold database) downloading ~90,000 sales to value 96 lots (the 30th CELEBRATION box alone had ~8,900 SNKRDUNK sales in its first month). Now each held product + condition's value (median, last sale, per-source summaries) is saved in `bucket_values` at the end of each collect (and `pnpm valuate`); pages read those rows and apply manual prices on top. Anything that changes a product's sales or details clears its rows; a missing or 3-day-old row is valued live from only the sales its windows can reach, and saved. Verified identical to the full valuation for all 96 lots; portfolio valuation 2,100 ms -> 25-100 ms. The nav badge and the portfolio chart no longer hold the page; a loading placeholder shows at once on navigation.
- 2026-10-12: Actions page (user choices): a 5th nav tab (Portfolio, Actions, Add, Imports, Settings) with the count badge; Imports' badge counts only import review and failed links. Cards are side by side (your item vs the suggested listing) with Confirm / Reject / paste a link / Don't warn, grade buttons (Raw S-D, PSA 10 / 9) and condition buttons on the card; red cards open by default, the rest collapsed, each viewer's choice kept in the browser. First version covers matches and missing main sources, card grades, game conditions (new: a game lot without a condition gets no value), and count cards linking to import review, failed links and data review. Notice types and default levels live in code (`@tora/core` notices); the Settings page to change them comes later in S8. The portfolio's banners became one line to Actions; /matches and /imports/sources now open Actions (the "not warned" list moved there).
- 2026-10-12: Notice levels in Settings: five levels (Urgent red, High orange, Medium yellow, Low blue, Quiet grey), one per notice type; only the user's differences from the defaults are stored (users.notice_levels, migration 0017). Quiet notices stay on the Actions page but are not counted in the badges. A Sign out button is now in the nav (side bar on desktop, header on phone).
- 2026-10-12: Actions page, second pass (user): the filters are the notice levels, each in its colour; the list is grouped in a section per notice type ("31 TCG items without their main price source"), open by default, collapsed with a tap (remembered per viewer). Import review lots, failed purchase links and data review suggestions are now cards settled in place too (the review controls and Confirm; Retry / Add by hand / Remove; Accept / Dismiss with a note), sharing their components with the full pages, which stay for what a card cannot do (e.g. merging two imported lots).
- 2026-10-13: Hide amounts (user), like banking apps: amounts are blurred until the eye button (portfolio title, nav) is pressed; the choice lasts for the browser session (a session cookie, so pages render already hidden, no flash). Settings can make amounts always shown, the eye button then hides them for the session. Money is marked by `tabular-nums` / `amount`; charts keep their lines but drop the yen axis and labels.
- 2026-10-13: Summary insights (user): movers and trade panels switch between 7 days, 30 days, 90 days and a year; two market-wide panels (market movers by %, most traded in the market) cover every item any user holds (product names and prices only, no one's lots), tagged "All tracked items".
- 2026-10-13: eBay keys working (production keyset, Marketplace Account Deletion exemption: no eBay user data stored). eBay's API terms (2025): no eBay data into generative AI tools, copies only while needed. So the eBay source is `noAi` (left out of the data review and the MCP tools; query_sql reads sales without it; Claude does not read eBay results, the user checks them in the app) and stores daily aggregates plus listing IDs for 14 days, no titles or links. First collect: 51 searches, 289 daily aggregates.

---

# CORE

## 1. Goal

A personal, single-user app to track collectibles (Pokemon and other TCG singles and sealed products, game collector's editions, amiibo, special controllers, other game-related items):
- what I own, quantity, condition, when/where/how much I paid
- what it is worth now, per condition, from accumulated Japanese second-hand market data (and US data for comparison)
- for sealed TCG products: which cards I pulled, and box-level profit/loss
- price trends from data accumulated in our own DB

Priority right now: **start registering items and accumulating price data as early as possible.**

Personal use: a handful of accounts (the owner, possibly family). **Each user sees only their own collection**; the product catalog, TCG set catalog and market data are shared. Data is never published or served to anyone else (the hosted app sits behind a login).

## 2. Example scenarios (acceptance reference for the whole project)

1. Register a Fire Emblem Switch 2 collector's edition with its condition.
2. Register several amiibo, including 3 identical ones bought at the same price and condition in one entry (qty 3).
3. Register special edition controllers.
4. Register a Pokemon 30th anniversary BOX bought new at Yodobashi, where the clerk opened the box in front of me (packaging state: box opened, packs sealed). Its value must be judged as an opened box, not as a shrink-wrapped one.
5. Register the cards pulled from that box, linked to it, and see: price paid for the box, what the box would be worth now in the state I received it, current value of the pulls, and net result.
6. Later, send a raw grade A pull to PSA, record the grading fee, and update it to PSA 10 when it returns, keeping history.
7. See total inventory: amount spent, current value, unrealized P/L, value over time.
8. Export everything and be able to reconstruct the full collection without the app.

## 3. Stack and environment

- Node 24 LTS (>= 22), pnpm workspaces, TypeScript strict everywhere.
- `apps/web`: Next.js (App Router), Tailwind, shadcn/ui, next-intl, zod.
- Charts: lightweight-charts (TradingView).
- DB: SQLite dialect via Drizzle ORM with the libSQL client (`@libsql/client`). Production: **Turso** (hosted libSQL, free tier). Local dev and tests: a plain SQLite file / in-memory DB through the same client. Must stay portable to Postgres later (avoid SQLite-only features).
- Tests: vitest.
- **Hosting split:**
  - Web app: **Vercel** (Hobby, free), connected to the public GitHub repo. Talks to Turso over HTTPS.
  - Collectors: run only on the user's home Windows PC inside **WSL2** (residential IP is required for scraping; never run collectors on Vercel/cloud/CI). They write directly to Turso using a DB token from `.env`.
  - Jobs that do not scrape (valuation snapshots) also run locally right after collectors, so all scheduling lives in one place.
- **Auth** (app is on the public internet):
  - Accounts have a username, a password (scrypt hash) and a TOTP authenticator secret (encrypted at rest), plus one-time backup codes. No public sign-up: accounts are created and managed with a CLI on the home PC (`pnpm user ...`).
  - Login = username + password, then a 6-digit authenticator code (or a backup code). Every new device login needs both steps.
  - **At most 2 active devices per user.** Each successful login registers a device; a third login is refused. Revoking a device (Settings, or CLI) frees its slot. Signing out revokes the current device.
  - Sessions do not expire: the cookie (signed, httpOnly, Secure, SameSite=Lax) is renewed automatically on use (browsers cap cookie lifetime at ~400 days). A revoked device, password change or 2FA reset ends its sessions.
  - Failed attempts are counted in the DB per IP and per username, with temporary lockout. Every page and API route requires a session except the login pages and static assets.
- Phone use is first-class: registration flows must be mobile-first. Add a PWA manifest so it can be added to the home screen.
- Scheduling: the PC is not always on, so Windows Task Scheduler starts `scripts/collect-cron.sh` in WSL at logon (+5 min) and daily with catch-up; the script runs at most once per day (stamp file), with jitter. cron is the fallback when WSL stays running.

## 4. Repo layout and public/private split

The main repo is **public** (portfolio piece). Scrapers live in a **private** repo.

```
apps/web                 Next.js app (UI + API routes / server actions)
packages/db              Drizzle schema, migrations, queries
packages/core            Domain logic: lots/splits, valuation, buckets, export/import
packages/collector-sdk   Collector interface, runner, HTTP utils (rate limit, retry), run logging
collectors/              PRIVATE git submodule (private GitHub repo): SNKRDUNK, Mercari, eBay, 駿河屋 collectors
collectors-public/       Collectors safe to publish (TCGCSV, FX)
```

- The public repo must install, build, test and run **without** the private submodule (collectors simply not registered; show a notice in Settings).
- No scraping code, tokens, endpoints or fixtures from private sources in the public repo.
- Secrets/config in `.env` (gitignored), with `.env.example`.

## 5. Data model

General rules:
- **Store facts, derive everything else.** Totals, P/L, current values are computed, never the source of truth.
- IDs: ULID strings. Money: integer JPY (`*_jpy`); foreign amounts as integer minor units + currency + fx rate.
- Timestamps: ISO 8601 with offset, user timezone Asia/Tokyo.
- Every table has `created_at`, `updated_at`.

### users
- `username` (unique, lowercase), `password_hash`, `totp_secret_enc`, `totp_last_step` (replay protection), `backup_code_hashes` (JSON), `role`: admin | member, `disabled_at`

### user_devices (login slots; max 2 active per user)
- `user_id`, `label` (browser / OS), `last_seen_at`, `revoked_at`

### tcg_sets (pre-registered TCG catalog, shared)
- `franchise` (pokemon | one_piece | yugioh | mtg), `region` (null = all regions, e.g. Magic), `code`, `name`, `name_alias` (search only), `set_type`: expansion | deck | special, `release_date`, `source` + `source_key` (unique; for idempotent re-sync)
- Built from public sources by `pnpm catalog:fetch` (Pokemon official product list, One Piece official site, Yugipedia, Scryfall) into JSON files in the repo, loaded with `pnpm catalog:sync`.

### products (catalog entry, one per distinct item; shared by all users)
- `category`: tcg | game
- `kind`: tcg: single | booster_box | booster_pack | deck | special_set | supply | other; game: software | collectors_edition | amiibo | controller | figure | console | other
- `name` (one name, in whatever language it is sold under), `name_alias` (optional, search only)
- `franchise` (TCG: pokemon | one_piece | yugioh | mtg | free text; games: free text), `region` (TCG: jp | en | zh_cn | zh_tw | kr | th | id | other; games: jp | na | eu | asia | kr | other), `platform` (games)
- `set_id` (tcg_sets, nullable), `set_name`, `set_code` (free text when the set is not in the catalog), `variant` (e.g. Magic "Collector" vs "Play" booster), `card_number`, `rarity`, `release_date`, `retail_price_jpy`, `image_url`, `notes`, `created_by` (null for catalog-generated products)
- Sealed products for a catalog set are created on first use (find-or-create by set + kind + variant), named from the set.
- Product class drives condition and valuation: tcg single = card; tcg booster_box / booster_pack / deck / special_set = sealed; everything else = item.

### product_sources (how to fetch prices for a product)
- `product_id`, `source` (snkrdunk | mercari | surugaya | tcgcsv | ebay | ...), `external_id` (nullable), `query` (JSON: keywords, exclude_keywords, category_id, price_min, price_max, extra), `active`, `last_success_at`
- A product can have several sources. Sources are created automatically when a product is created from a source search (S3), or edited manually.

### holdings (a lot of identical units I own)
- `user_id` (owner), `product_id`, `quantity` (>= 1), `cost_total_jpy` (total paid for the lot, incl. what I choose to include like shipping)
- `acquired_at`, `acquired_from` (free text with suggestions: Yodobashi, Mercari, ...), `acquisition_type`: purchase | pull | gift | trade
- `parent_holding_id` (nullable): set for pulls, pointing to the sealed product they came from
- `condition`: Mercari scale: new_unused | like_new | no_noticeable_damage | minor_damage | damaged | poor
- `packaging_state` (sealed products and boxed items): sealed_shrink | sealed_no_shrink | box_opened_contents_sealed | opened | empty | n/a
- Cards: `grading`: raw | graded; `raw_grade`: S | A | B | C | D (SNKRDUNK-style); `grader`: PSA | BGS | CGC | ARS | other; `grade` (text, e.g. "10", "9.5"); `cert_number`
- `status`: owned | sold | consumed (e.g. box fully opened) | lost
- `notes`

Lot rules:
- Identical units bought together at the same price and condition = one holding with quantity N.
- When some units change (graded, sold, opened, condition change), **split** them into a new holding first. Cost is allocated proportionally (integer yen; remainder stays on the original). A `split` event is recorded on both.
- Pulls have `cost_total_jpy = 0` by default; the parent box keeps its cost. Box P/L is computed at box level.
- Grading fees are added to the holding's cost basis via the grading event.

### holding_events (history; append-only)
- `holding_id`, `type`: acquired | split | opened | grading_submitted | grading_returned | condition_changed | sold | note
- `occurred_at`, `amount_jpy` (fee or sale price), `fees_jpy` (platform fees, shipping), `payload` (JSON: before/after values, platform, split target, etc.)
- Selling: split if needed, then `sold` event with price and fees; holding status -> sold. Realized P/L is derivable.

### price_observations (raw market data; never deleted)
- `product_id`, `source`, `observation_type`: sold | listing | buylist | retail
- `bucket` (normalized valuation bucket, see 6), `price_jpy`, `price_original`, `currency`, `fx_rate`
- `observed_at` (sale/listing time; best available proxy), `fetched_at`
- `external_ref` (listing/transaction id; unique per source for dedupe), `title`, `url`, `raw` (JSON)
- `excluded` (bool) + `excluded_reason` (outlier | manual | mismatch)

### manual_prices
- `user_id`, `product_id`, `bucket`, `price_jpy`, `set_at`, `note`. Always wins over computed values (for that user).

### valuation_snapshots (daily, for portfolio-over-time chart)
- `date`, `holding_id`, `value_jpy`, `method`, `source`, `sample_size`, `confidence`

### fx_rates
- `date`, `pair` (USDJPY), `rate`

### collector_runs (health)
- `source`, `started_at`, `finished_at`, `status` (ok | partial | failed | blocked), `requests`, `observations_added`, `error`

### login_attempts (auth lockout)
- `ip_hash`, `username_hash`, `attempted_at`, `success`. Old rows may be pruned (not domain data; excluded from export).

## 6. Valuation rules

**Buckets** (the condition dimension prices are compared on):
- Raw cards: `raw:S`, `raw:A`, `raw:B`, `raw:C`, `raw:D`
- Graded cards: `graded:<GRADER>:<grade>` e.g. `graded:PSA:10`
- Sealed (TCG sealed kinds): by packaging_state, e.g. `sealed:shrink`, `sealed:no_shrink`, `sealed:box_opened_contents_sealed`
- Items (everything else): `cond:new` (new_unused), `cond:like_new`, `cond:good` (no_noticeable_damage), `cond:fair` (minor_damage, damaged, poor)
- Each collector maps its source's condition labels to these buckets (mapping table in the collector, unit-tested).

**Value of a holding** = value of one unit in its bucket x quantity:
1. Manual price for that product+bucket, if set.
2. Else median of `sold` observations in the bucket over the last 30 days; widen to 90, then 180 days if fewer than 3 samples. Drop outliers with IQR before the median.
3. Fallback chain by source: SNKRDUNK -> Mercari -> 駿河屋 (used/new store price) -> retail price -> none.
4. Every value carries: source, sample size, age of newest sample, confidence (high: >= 5 samples within 30 days; medium: >= 3 within 180; low: otherwise).
5. Next to the value, always show the **last real sale** in the bucket (price, source, time, trend vs the median) and a per-source summary (last sale, median, sample count), so sources can be compared and direction judged. Totals and P/L use the median (robust to one odd sale). Collectors also store each listing's newest trades as seen on the site (`product_sources.recent_sales`, refreshed every run, times may be approximate) so the last sale is at most ~1 day old.
- Buylist (買取) prices are shown separately as "instant sell floor", never used as market value.

**Box view**: paid (cost) | value as received (bucket from the box's packaging_state at acquisition) | current value of pulls | net = pulls value - cost.

## 7. Collector rules (all sources)

- Only fetch for products with active `product_sources`. Never crawl whole sites.
- Runs from the home PC only. Polite: 2-5 s random delay between requests, per-run request cap, daily schedule with jitter, normal browser headers, retry with backoff on 5xx.
- On 403/429 or captcha: stop that source for the run, mark run `blocked`, do not retry aggressively.
- Dedupe by `source` + `external_ref`.
- Store raw payloads so matching logic can be improved and re-applied later.
- Parsing must be covered by fixture tests (saved responses) so site changes show up as test failures.
- Health: a run returning 0 observations for products that previously had data, or medians moving > 50 % day over day, is flagged in Settings.
- A failing collector must never corrupt data; it only makes values stale.

UI principles (all screens):
- Calm by default: few numbers, details on demand. Show data freshness and confidence wherever a market value appears.
- Mobile-first for registration, desktop-friendly for analysis.
- EN/JA via next-intl. Product names show in the current locale with fallback to the other.

---

# SESSIONS

## S1: Foundation

Build:
- pnpm monorepo per section 4 (submodule path present but optional), TS strict, lint/format, vitest.
- Drizzle schema for all tables in section 5, migrations, a seed script with the scenario items from section 2 (scenario 4 and 5 data included).
- `packages/core`: lot split logic with cost allocation, bucket derivation from a holding. Unit tests.
- Next.js app shell: bottom tab nav on mobile (Portfolio, Add, Settings), side nav on desktop, EN/JA switcher, PWA manifest.
- Password login + session cookie + lockout (section 3).
- README: local setup in WSL, Turso + Vercel deployment, cron example.

Acceptance:
- `pnpm i && pnpm build && pnpm test` passes without the private submodule.
- App opens on the phone through the Vercel URL, behind the login.
- Seed data visible as a plain list.

## S2: Registration UI

Build:
- **Add flow** (stepper, mobile-first):
  1. What: create product manually (type-specific fields) or pick an existing product. (Source search comes in S3; leave a slot.)
  2. How I got it: date (default today), from where (suggestions from history), acquisition type, quantity, total cost.
  3. Type-specific: condition; packaging state for sealed/boxed items; grading fields for cards.
- **Log pulls mode** on a sealed TCG holding: rapid entry (search/create card, raw grade defaults to A, qty, next). Pulls link via `parent_holding_id`.
- **Holding actions**: edit, split, mark opened, grading submitted (fee) / returned (new grade), sell (price, fees, platform), condition change, note. All write `holding_events`.
- Simple inventory list (filter by type, status; search by name).

Acceptance:
- Scenarios 1-6 from section 2 can be entered on the phone.
- Event history visible per holding; cost basis updates correctly after grading fee and after splits.

## S2b: Accounts, 2FA, taxonomy, TCG catalog

Build:
- users / user_devices tables, per-user holdings and manual prices; existing holdings move to a placeholder account that the first created account claims.
- Login: username + password, then TOTP or backup code; 2-device limit; device list with revoke in Settings; sign out revokes the device. CLI: `pnpm user create | reset-password | reset-2fa | devices | revoke | disable`.
- Products: category / kind / franchise / region / platform / variant, single name; migration maps old types.
- TCG set catalog for Pokemon, One Piece, Yu-Gi-Oh! (Japanese) and Magic: fetch script, JSON in repo, sync command.
- Add flow: TCG or Game first; TCG -> franchise -> region -> kind -> set picker (release date shown) or manual entry; Game -> kind -> name, platform, region.
- Portfolio header shows total spent (market value comes in S5).

Acceptance:
- Logging in on a 3rd device is refused until one is revoked; every new device asks for the authenticator code.
- A second user cannot see the first user's holdings.
- A Pokemon booster box from a recent set can be registered by picking the set; its release date comes from the catalog.

## S3: Collector framework + SNKRDUNK + source matching

Build:
- `collector-sdk`: Collector interface (`search(keywords)`, `fetchObservations(productSource)`, condition-to-bucket mapping), polite HTTP (2-5 s random delay, per-run request cap, retry with backoff on 5xx, stop on 403/429/captcha), resumable history sweeps, runner CLI `pnpm collect [--source x] [--product id] [--match-only] [--no-jitter]`, `collector_runs` logging.
- **SNKRDUNK collector** (private submodule `collectors/`, repo `sp1aca9fa/tora-collectors`): product search and sales history (trades with condition labels, graded and sealed). Backfill all available history on first mapping, resumable across runs.
- **Matching** (SNKRDUNK can only be queried from the home PC, never from Vercel): each run searches SNKRDUNK for owned TCG products that have no SNKRDUNK source and stores the best candidates. The item page shows them under "Price sources": confirm or reject, or paste a SNKRDUNK product URL. A confirmed match becomes an active `product_source`; history backfills on the next run.
- Item page: recent SNKRDUNK trades and a simple median per bucket (full valuation is S5), so the data gate can be checked.
- Settings: collector status, last runs, flagged health issues.
- Cron setup documented and working.

Acceptance:
- Register the 30th anniversary box and 3 pulled cards, confirm their SNKRDUNK matches; history is backfilled into `price_observations` with correct buckets.
- **Data gate (with the user)**: for 5 real owned items, compare our medians against what the user sees on the site. Agree it is trustworthy before continuing.

## S4: Mercari sold collector

Build:
- Mercari JP collector (private submodule) using the same search API as jp.mercari.com (no login). Port the request token (DPoP-style ES256 JWT) generation from the open-source `mercari` PyPI package as a reference; verify current behavior by inspecting the site's network requests.
- Search with `status=sold_out` using each product's saved query (keywords, exclude keywords, category, price band). Map `item_condition_id` to buckets. Use the item's last-updated time as the sale-time proxy.
- Product source editor in UI: edit query, preview the latest matched results, exclude mismatches (sets `excluded` + reason). This is where matching quality is tuned.

Built (2026-10-10):
- Search-based sources in the framework: a collector may define `defaultQuery(product)`; every supported product then gets an active source with that query at once (`product_sources.external_id = 'search'`), created once (an unlinked search stays off). The product page shows the query with an editor (search words, excluded words, price range), the latest sold items found (kept and left out, with the reason) and Exclude / Include per item. Saving a query drops what the old one collected (except manual exclusions); the next collect searches again.
- Mercari (private): on for every product for now (the user will judge whether cards are worth it). Default query: franchise word + identifying words (card name + number; set name + BOX / パック / デッキ; the item's name) and default excluded words per class. Each sold item is checked: excluded words, bundles (まとめ, "3点", "×2"), parts of a sealed product sold alone (サプライ, ディスプレイ, …のみ), accessories / junk, other regions, a card's own number (not a denominator) and set, the box / pack / deck word and single-card titles for sealed products, and coverage of the product's words; prices outside 0.3x-3.5x of the batch median of their bucket are outliers. Every item is stored (rejected ones excluded, reason in `raw.filter`). Buckets: Mercari condition 1-6 on the item scale; cards: PSA/BGS/CGC/ARS grade from the title, else conditions 1-2 raw A, 3 B, 4 C, 5-6 D (approximate); sealed: シュリンクなし / シュリンク付・未開封 or new condition. Sale time = the item's last update. First run reads 3 pages (up to 360 items), then the newest page per run.
- Query version 2 (2026-10-11), tuned by searching Mercari for each of the user's 18 items: cards search name + rarity + set (promos: name + プロモ + number; One Piece: name + code like ST21-014; short names get the franchise word); boxes add BOX + シュリンク (Mercari also searches descriptions, and box listings mention the shrink, so single cards from the set drop out); decks / sets their 「」 name. Checks added: a card's number is only required when the title shows one (then it and the set size / code after the slash must match); otherwise the set, rarity, "promo" or a distinctive full name must show; version words (パラレル, 漫画, フラッグシップ, 優勝, エラー, …) must match the product; "no vinyl" cards drop sealed listings; cards sold inside another product (付き, 付録) drop; slabs without a stated grade get no bucket; sealed parts include loaders / cases and missing promos; the item's kind word (Joy-Con, amiibo) must show; amiibo cards and controller software are excluded; synonyms (ジョイコン/Joy-Con, アミーボ/amiibo, ボックス/BOX, 30周年/30th, ゼルダの伝説/ゼルダ). Auto-made queries carry `extra: {auto, v}` and are regenerated when the collector's query version rises; queries saved in the editor carry `extra.edited` and are never replaced.
- Reference listings (2026-10-11): on a product's search the user can paste links of listings of this exact item (sold or for sale). The next collect reads each once (title, price, sold or not, category, condition, photo): a sold one is stored as an included sale even if the filters had left it out ("vouched"), the titles' distinctive words (rare among the search results, so a brand every result carries does not count) become other accepted names of the product, their categories are searched in addition to the plain search, and the first photo becomes the listing's picture (the product's thumbnail when it has no other). Every stored sale keeps its Mercari category; each product learns its usual categories (references + categories at least 3 kept sales and 30 % share) and runs up to 2 extra in-category searches. Items also drop part-of-the-item listings (…のみ, 片方). Upgraded default queries keep what the user added (references). Rare items stay thin: e.g. the Retro Station has 5 sales this year (4 pasted, 1 found thanks to them: 「RETRO STATION CAPCON」).
- The search panel shows what the valuation computes from the source per condition: median, sales used and window, latest sale.
- Live check of v2 on the user's items: e.g. カスミのコダック 109 of 112 kept (v1: number required, many genuine listings dropped), Luffy 42 kept (v1: 0), Joy-Con 78 kept (HD software dropped), the error Zoroark keeps only error listings (~¥73k-143k, the plain UR at ~¥2k drops). The カプコンレトロステーション has no recent Mercari sales.
- Live check (4 products, one page each): FUTURISTIC BOX 47 of 104 kept (shrink median ¥59,800; 32 supply-only listings dropped), amiibo 81 of 112 kept (median ¥2,500 used / ¥2,980 new).

Acceptance:
- Scenario items 1-3 (CE, amiibo, controllers) get Mercari sold observations with sensible buckets.
- Data gate repeated for 3 non-card items.
- Mercari purchase importer (private plug-in): import the user's Mercari collectible purchases through the same `PurchaseImporter` interface and import flow as SNKRDUNK. This proves the "bring your own sources" design works for more than one shop (without it, that claim does not hold). Can come after the user's own SNKRDUNK flow is settled.
- Built (2026-10-11) as purchase import by link: `PurchaseImporter` gained `matchesLink` / `readLink` (email methods became optional) and receipts carry the category path, a reference listing, a photo and "date approximate". Table `purchase_links` (status pending / imported / matched / duplicate / skipped / failed, message, holding). `pnpm collect` reads pending links first (so new products are searched in the same run), plans and applies them like an email import without questions (likely matches get the ID, conflicts keep the registered data), and stops reading when Mercari blocks (the rest stay pending). Products are made from the listing title: singles (card number, card code, or rarity in the title) get name / rarity / set code / number / set name, also from card shops' "(SR) {103/100} [S9/スターバース]" titles; sealed kinds from BOX / パック / デッキ words; games from the category (controller, software, figure, console). Slab grades come from the title; a raw card's grade is set in the review. Review shows "date read from the listing" and "new item made from the listing title", with a date field. Live check: CAPCOM RETRO STATION (2026-01-29, ¥22,000, minor damage, reference added to a new search), a Shops PSA10 ピカチュウex (graded PSA 10), a dining chair skipped (家具・インテリア), a missing item reported.

## S4b: MCP server (Claude reads the data)

Added at the user's request (2026-10-11): connect Claude to the tool, to sanity-check the data, explain it (what goes up, what does not, why) and find what to build next.

Build:
- `packages/mcp`: a local MCP server (stdio), started by Claude Code / Claude Desktop on the home PC with the root `.env`. Never deployed; nothing exposed online. Read-only, scoped to one configured user.
- Tools (structured results, small by default, with limits):
  - `portfolio_summary` (totals, breakdown, P/L, value over time), `list_products` (filters: kind, franchise, owned / sold, unvalued), `product_detail` (lots, valuation and how it was computed, sources, queries, references).
  - `price_history` (daily medians per source and condition), `sales` (collected sales incl. excluded ones with the reason; filters by product, source, date, kept / excluded).
  - `collector_health` (runs, stale sources, request use), `review_queue` (imports to review, pending matches, ungraded cards).
  - `data_checks`: canned sanity checks with explanations: unvalued owned items, low-confidence / pooled values, look-alike products (duplicates), sales far from the median, sources with few kept sales or many exclusions, estimated lot sizes, missing set names / numbers / pictures, cancelled-looking orders.
  - `query_sql`: read-only `SELECT` for open questions (one statement, row limit, no writes).
- Later, opt-in: write tools behind explicit confirmation in the chat (exclude / include a sale, edit a search query, merge duplicates, set a manual price).
- A short guide in the README: registering the server in Claude Code / Claude Desktop.

Acceptance:
- From Claude: "does anything look off?" runs the checks and explains the findings; "which of my items gained the most since I bought them, and why?" is answered from the data.

## S5d: Imports hub

Added at the user's request (2026-10-11): imports grew piece by piece (email import from the terminal, Review import, pasted links, cancelled orders, card grades after import) without a home; once the review banner was gone there was no way back to the page (stopgap: Settings link and a banner for failed links). One Imports menu where every import starts, reports back and is followed up.

Build:
- An **Imports** entry in the main navigation (phone bottom bar and wide-screen nav), with a badge counting what needs the user (items to review, failed links, conflicts).
- The Imports page, sections:
  - Needs attention: items to review, links that could not be imported (to add by hand; open the listing, then "add an item" prefilled from what is known, which clears the link), conflicts and likely duplicates waiting for a decision, cancelled-looking orders.
  - Start an import: paste purchase links; upload a purchases file (S6); import through Claude (S4c, how to start it); email import (how to run it on the home PC, when it last ran).
  - History: every import run (method: email, links, file, Claude; when; counts new / matched / already registered / skipped / failed), each opening its own results.
- Import runs are recorded (`import_runs`: user, method, source, started / finished, counts, notes); imported lots and links point to their run. The terminal email import and the link import in `pnpm collect` record runs too, so they show in History.
- Everything import-related lives under the hub and returns to it: Review import becomes a sub-page; card grades for imported cards, "order cancelled", link results and the add-by-hand flow for a failed link link back; banners elsewhere (portfolio) point into the hub instead of separate pages.
- Later: conflicts and likely duplicates from the email import decided in the app instead of the terminal (the S6 in-app file import uses the same screens).

Built (2026-10-11): Imports in the main navigation with a badge (items to review + failed links + cards without grade); `/imports` hub with Needs you (review, card grades, links that could not be imported with "Add by hand"), Import purchases (paste links with the list of pasted links, order emails with the command and the last run) and History (each run with its counts, opening `/imports/runs/<id>` with its lots and links); Review import moved to `/imports/review` and links back to the hub; `import_runs` recorded by the email import and the link import (one run per user per collect), lots and links point to their run. "Add by hand" opens Add with the shop and the item ID (the link's last path part) filled in; saving marks the link as done and returns to the hub. The Settings stopgap was removed. Not yet: conflicts decided in the app (later, with S6).

Acceptance:
- From any screen, Imports is one tap away; after pasting links and collecting, the user finds what was imported, what to review and what failed (with what to do) in one place.

## S4d: Automated data review (cheap model, suggestions queue)

Added at the user's request (2026-10-11): automate the checking the user has been doing by hand (do these sales make sense, is this the right product), without paying for a model to read everything.

Layers (cost rule: a model only looks at what the code could not settle):
1. No model, always on: importers, collectors, filters, `data_checks`. A problem the model keeps finding becomes a code rule, so the model has less to read over time.
2. Cheap model on the exceptions (this phase): after `pnpm collect`, when `data_checks` has findings, the home PC runs Claude non-interactively (`claude -p`, Haiku) with the tora MCP. It looks at the flagged items only (odd sales, weak searches, look-alike products, ...), capped per run (e.g. 20), and files **suggestions** (exclude this sale because ..., these two products look the same, this query misses ...), each with its reason and evidence. It changes nothing itself.
3. The user accepts or dismisses each suggestion in the app (one tap); accepting runs the existing action (exclude a sale, merge, edit a query).

Build:
- Trial first, before any code: on real flagged data, compare Haiku's and Sonnet's verdicts with a careful review; measure agreement and how much a run uses. Build only if Haiku is reliable enough (else use Sonnet, or narrow what it judges).
- Table `suggestions` (kind, target, proposed action, reason, evidence, model, status open / accepted / dismissed); a Suggestions list in the app (badge like Review import). Built without an MCP write tool: the review script files them (see Decision log).
- `pnpm review` (and an option in the collect cron) runs the headless review when there are findings; skips when there are none; logs what it used.
- Dismissed suggestions are remembered so the same one is not filed again.

Later (user's idea, after the error rate is known): a stronger model (Sonnet) makes the final call on suggestions automatically, with the user's check reduced to spot checks.

Acceptance:
- After a collect with odd sales, sensible suggestions appear in the app; accepting one excludes the sale; nothing changes without the user.

## S4c: Import purchases from any shop through Claude

Added at the user's request (2026-10-11). The SNKRDUNK email import works well, but per-shop importers do not scale (Mercari sends no email, so it needs pasted links). Instead the user hands over their purchase history in whatever form they have (screenshots of a purchase list, a CSV, copied text, order pages or links) and Claude reads it and records it, through the same import rules. Works for any shop when the data says what the item is (title, link or photo), the price paid, the date (approximate is fine) and the shop; an order ID is optional but prevents duplicates (without one, the tools warn and rely on date + price matching).

Two steps, cheap model first:
1. Haiku extracts the purchases and matches each to a product (or proposes a new one), saving a draft.
2. The tools check every draft row with signals the code computes, not the model's own confidence (self-rated confidence is unreliable): weak or ambiguous product match, missing or implausible price / date / quantity, price far from what the product sells for, a likely duplicate of an entry added by hand, or Haiku marking the row unsure. Flagged rows go to Sonnet, which reviews and corrects them. During the trial period Sonnet also re-checks a random sample (e.g. 10 %) of the unflagged rows, to measure Haiku's error rate and tune the triggers.
3. The result goes to Review import (`review_pending`), where the user confirms as with every import.

Build:
- MCP write tools (add-only, scoped to one user; never delete or overwrite): `find_products` (match score + candidates), `plan_purchases` (the S5b plan for a batch, no writes, with the check signals per row), `save_import_draft` / `import_purchases` (write the approved rows; an entry confirmed as the same purchase only gets the order ID).
- `pnpm import-ai <files or folder>` on the home PC runs both steps headless (`claude -p`, Haiku then Sonnet for the flagged rows) and prints a summary; the same tools also work from a chat.
- Imported lots note that they came through Claude (event), with the shop as "acquired from".

Open when we get there:
- Whether S6's in-app purchase file upload is still needed (this may replace it), and whether the Mercari link import stays (it can coexist).

Acceptance:
- A Mercari purchase history shared as screenshots or text ends up in Review import with sensible products, non-collectibles left out, nothing already registered duplicated; the summary shows which rows Sonnet reviewed and why.

## S5: Valuation, Portfolio, Item detail

Build:
- `packages/core` valuation per section 6, with unit tests (IQR, window widening, fallback chain, manual override, confidence).
- Daily `valuation_snapshots` job (runs after collectors).
- **Portfolio screen**: spent / current value / unrealized P/L, value-over-time chart, breakdown by type, holdings list with value, confidence and freshness indicators, filters.
- **Item detail screen**: header with my holdings of this product; price chart per bucket with source toggles and bucket chips; recent observations table; buylist floor; manual price override.
- **Box tab** on sealed TCG holdings: paid | value as received | pulls value | net, plus the pull list.

Acceptance:
- Scenario 5 and 7 visible and correct; values show source, sample size, age and confidence.

## S5b: SNKRDUNK purchase import (Gmail Takeout)

Added at the user's request (88+ SNKRDUNK purchases to register).

Build:
- Holdings get `order_source` + `order_id` (e.g. snkrdunk / 取引ID). Optional when registering by hand (add flow, edit); required for imports. A SNKRDUNK 取引ID can only be registered once per user (one item per transaction); split lots keep the ID.
- `pnpm purchases <file.mbox> --user <username> [--source snkrdunk]` on the home PC, reading a Google Takeout export of the SNKRDUNK emails (`pnpm import` is a pnpm built-in, hence the name). No app access to Gmail.
  - Purchase emails: subject `【SNKRDUNK】ご購入ありがとうございます。(取引ID：N)`; accepted offers are purchases too (`【SNKRDUNK】オファーが成立しました。(取引ID：N)`). Cost = the amount paid (item + shipping + fees, after coupons). Cancellations: subject `【SNKRDUNK】取引がキャンセルとなりました。`, ID in the body (`取引ID:N`); cancelled IDs are never imported.
  - Duplicates: same ID + same data -> reported, skipped. Same ID + different data (price, item, date) -> the user chooses which is correct (existing entries change only on request, logged as an edit). No ID but a likely match (same listing or name, same price, dates within 3 days) -> the user confirms; "same" attaches the ID.
  - Summary and confirmation before writing. Existing entries are never removed (a cancelled ID that is registered is reported, not deleted).
  - Receipts carry no listing link. A receipt's item title is the listing title, so it is matched to a product already linked to a listing with that title; otherwise a product is created from the title (cards read like listing titles; sealed kind from 拡張パック…ボックス / 構築デッキ / 特別セット…; sealed product as shrink-wrapped unless the title says シュリンクなし) and matched to its listing on the next collect (confirmed under Matches). A product bought several times is created once. Listings SNKRDUNK renamed (e.g. 30周年 セレブレーション -> 30th CELEBRATION) map to the current title.
- Receipts do not state a card's grade or cert. Imported holdings are flagged `review_pending` (migration 0006); "Review import" in the app (`/imports`, portfolio banner) lists them one row per transaction: cards get a grade (raw S-D or grader + grade) and an optional cert number, sealed items shrink / no shrink. Save confirms filled-in rows; cards without a grade stay until graded or confirmed without one. "Card grades" (`/holdings/grades`) sets one grade on many ticked cards at once. Changes are logged as edits.
- Email parsing and sample emails live in the private collectors repo.

- Cancellations by the buyer send no email (found on 5 FUTURISTIC BOX orders), and SNKRDUNK's progress mails (shipped, authenticated, delivered) name the item but not the order. So:
  - Orders can be marked cancelled in the app ("Order cancelled" on a lot with an order ID, or the checkbox in Review import): all lots of that order are removed and the ID is kept in `cancelled_orders`, so imports skip it.
  - The import flags lots for review with a reason (`holdings.review_reason`): `deadline_missed` (a 「発送期限切れ…キャンセルが可能です」 mail for that order) and `no_delivery` (an item with fewer delivery mails than older purchases; purchases from the 21 days before the export's newest mail may still be on the way). Every older purchase of such an item is flagged, since the mails do not say which order arrived. Lots already in the app are flagged too; a reason the user already confirmed does not flag the lot again.

Acceptance:
- Re-running the import on the same file adds nothing; cancelled purchases are not imported; conflicts are asked, not guessed.

## S5c: Portfolio by product + product images

Added at the user's request (2026-10-10).

Build:
- The portfolio is a summary, not a transaction list: one row per product owned, all of its lots combined (units, total spent, market value, P/L), with the totals at the top as now. Tapping a row opens the product page: image, details, valuation and charts, and every lot registered (cost, date, where from, order ID, condition / grade, status), each linking to the lot page (events, actions). Sold / consumed lots and event history live on the product and lot pages, not on the portfolio.
- Product images, stored once as small thumbnails so the app never loads images from external sites:
  - The home PC (collector run) downloads the picture of a product's linked listing once, resizes it to about 400 px WebP (roughly 20-40 KB) and stores it in a `product_images` table (product, bytes, content type, source URL, fetched at). Products that already have an image URL get theirs on the next collect.
  - The web serves them from its own image route (`/img/products/{id}?v=…`, behind sign-in) with long-lived private cache headers, so each browser fetches an image once. Nothing on Vercel fetches external images.
  - The picture comes from the listing's main product image (SNKRDUNK `primaryMedia`, not the generated share card), read from the product page the collector fetches once per listing.
  - Each listing keeps its own picture (`product_sources.image_url`: the suggestion's picture when confirmed, else the listing page's main image); the product's thumbnail is its first active listing's picture, else the product's own image URL. Relinking a product to another listing therefore replaces the thumbnail on the next collect.
  - Exception to "no external images": match suggestions show the listing's picture straight from the site, because that is how near-identical listings are told apart.
  - Size: images are per product, not per sale, so a few MB per hundred products, far inside the Turso free tier. If that ever changes, the bytes move to object storage (e.g. Vercel Blob or Cloudflare R2) without UI changes.
  - Products without a stored image show a placeholder; the user can paste or upload one later (optional).

Built: portfolio rows per product (thumbnail, lots and units, units per condition, value, P/L, spent); product page `/products/{id}` (image, units / spent / value / P/L, every lot with condition, date, shop, order ID, value, status, review flag; price chart starting on the condition most units are in; price sources moved here from the lot page); the lot page keeps its own value, actions and history and links to the product.

Acceptance:
- The portfolio shows one row per product with units, spent, value; the product page lists each lot with its own cost and condition.
- Images appear on the portfolio and product page without the browser requesting SNKRDUNK (or other external) URLs.

## S6: Export / import

Build:
- **JSON export** (canonical, lossless): `schema_version`, exported_at, all products, product_sources, holdings, holding_events, manual_prices, price_observations (option to exclude raw payloads), fx_rates.
- **CSV export**: one file per table with stable IDs, zipped. Must be enough to rebuild the collection in Excel/pandas.
- **JSON import** into an empty DB.
- Round-trip test: seed -> export -> import into empty DB -> identical computed totals and row counts.
- Scheduled local backup of the Turso DB to the home PC (dated SQL dump or JSON export, keep last 30).
- **Purchase file import in the app**: upload a generic purchases file (CSV/JSON: shop, order ID, date, item title, quantity, amount paid, optional item price / listing link / cancelled flag) and go through the S5b flow in the browser: summary (new, already registered, cancelled, unclassified), choices for conflicts and likely duplicates, confirm, then Review import. Shop-specific email reading stays in private plug-ins: `pnpm purchases <export.mbox> --out purchases.json` writes this file on the home PC; anyone can also make it by hand or from another shop's export. The 11 MB+ mail export never leaves the PC.
- Imports from the app (user, 2026-10-12): every import (order emails, screenshots / files through Claude, purchase files) started and followed in the app, not by typing commands on the home PC. Open: where the model runs. Either the app keeps the request and the uploaded files and the home PC's next collect (or a frequent job) runs it with the Claude Code login, results shown in Imports; or model calls from the server with an Anthropic API key on Vercel (pay per use, separate from the Claude plan). Revisit together with the in-app purchase file upload and the Gmail item below.
- Automatic purchase import: the daily job on the home PC checks Gmail for new SNKRDUNK receipts (and cancellations) and imports them with the S5b rules, asking about conflicts in the app. Gmail access is read-only, its token stored only on the home PC (never on Vercel or in the database).

Acceptance:
- Scenario 8; round-trip test passes in CI-like `pnpm test`.

## S7: US data, 駿河屋, FX, JP vs US spread

Build:
- FX collector (public): daily USDJPY from a free source (e.g. Frankfurter) into `fx_rates`.
- TCGCSV collector (public): daily TCGplayer prices incl. the Pokemon Japan category; map tcgplayer product IDs via source search.
- eBay sold collector (private): sold/completed search results for the product's query; lower default confidence. Playwright only if plain fetch fails. Deferred (2026-10-12): eBay blocks the home PC; retry later, e.g. a visible browser on Windows. Replaced (2026-10-12, user) by eBay asks through the official Browse API (public collector), see Decision log.
- 駿河屋 collector (private): new/used store prices and 買取 (buylist) prices for mapped products.
- Item detail: JP vs US comparison (JPY converted, with fx date), spread %.
- Price source coverage (user, 2026-10-12): a warning (data check, Imports "Needs you" and the portfolio) for every card not linked to a SNKRDUNK listing: SNKRDUNK is the stable, product-level source for cards; Mercari searches are a plus. For non-card items the equivalent is a stable product page with store prices, which Mercari does not have (its item pages are single listings that disappear): 駿河屋 product pages (used / new store price and 買取 price) are the candidate, linked like SNKRDUNK listings (suggested, confirmed or pasted), with the same "not linked yet" warning. Open: whether every game needs one or only items worth more than a threshold.

Built (2026-10-12):
- Rate sources are a plug-in type (`rates` next to `collectors`); `pnpm collect` stores the missing days of USD/JPY first (Frankfurter, ECB working days; the first run fills ~400 days). `fxRateOn` uses the last rate on or before a date.
- TCGCSV (`collectors-public`): cards matched by set code (own or from the catalog set) and the card number's leading digits; sealed product by the set's code, else the sets released within 3 days, ranked by kind words. The listing link carries the set (URL slug), so pasted links work. One observation per printing per day: `listing` type, no bucket, dollars in `price_original` (cents) with the rate used.
- 駿河屋 (private): product pages are behind a Cloudflare challenge, the search and 買取 search are not; searching an item number returns the item with used / new / list / time-sale / marketplace prices, so collecting needs two requests per item. Matching by name coverage, the item's 駿河屋 kind and platform; only suggestions close to the best one (at most 4). Used stock of a game is `cond:good`, new `cond:new`; new boxes `sealed:shrink`, used boxes no bucket; 買取 as `buylist`.
- Valuation loads yen prices only; `store` method: the newest shop asking price of the exact condition (30 days) when no source has a sale, before the retail price, low confidence.
- Item page: Japan vs US card (Japanese value of the condition TCGplayer quotes: the user's raw / sealed condition, else raw A / shrink-wrapped; a note for graded lots); suggestions open per source; 駿河屋 / TCGplayer links can be pasted for any item.
- Missing stable sources: `missingPriceSources` (cards and sealed TCG product without SNKRDUNK, other items over ¥3,000 without 駿河屋, lots under import review left out) in Imports > Needs you, a portfolio banner, Imports > Price sources to link (`/imports/sources`) and the MCP data checks. Pending matches are counted per source, so a Mercari search no longer hides a 駿河屋 suggestion.

Acceptance:
- At least one card and one non-card item show JP vs US side by side.

---

## S8: Visual redesign + wide-screen layout

Added at the user's request (2026-10-10). Until now the focus is on making things work; this phase makes them pleasant.

Build:
- Rework screens once the features have settled: fewer unrelated panels per screen. Crowded screens (e.g. the item page with valuation, sources, matching, events and actions) are split into tabs, sub-pages or collapsible sections, each with one purpose.
- A real wide-screen layout instead of one centered column: on large screens, panels are arranged in columns (e.g. list and detail side by side, charts beside their tables, navigation always visible), so more screen space means clearer organization and easier navigation. The phone layout stays single-column.
- A consistent visual language across screens (spacing, typography, cards, badges, charts).
- Portfolio revamp (user, 2026-10-11):
  - Per-lot tracking switches: "count in cost" and "count in value". For things bought to use (consoles, games to play) that are not investments but may still gain value. On by default for every kind (user, 2026-10-11); set on the lot (add form, lot page), with "apply to all lots of this item".
  - Totals: cost sums the lots counted in cost, value the lots counted in value; unrealized P/L only covers lots counted in both (otherwise it is meaningless).
  - The portfolio lists them in separate groups so the numbers stay readable: investments (both), value only (bought to use, value still shown), not tracked (neither), and cost only if anyone uses it.
- Actions page (user, 2026-10-12): one "Needs your attention" page in the main navigation, with a count badge, listing everything waiting for the user (import review, failed purchase links, grades missing, data review suggestions, matches to confirm, price sources to link, lots without a condition). Imports keeps only import things (ways to import, runs, review of imported lots) and links to Actions for the rest; the portfolio's stacked banners become one line pointing there.
- Actions are solved in place (user, 2026-10-12): the app does the heavy lifting, the user confirms. The Actions page lists pending actions by category (matches to confirm, price sources to link, grades / conditions, import review, data review suggestions, failed links), with filters, search and the notice levels. Each action is a dense card (about 2-3 times a portfolio row) showing what is needed to judge it without leaving the page, e.g. for a match: the item's picture and details next to the suggested listing's picture, title, price and score, with Confirm / Reject (and paste a link) on the card; for a grade: the lot and the grade buttons. Cards expand and collapse one by one (collapsed ones stay as a single line, the choice remembered per viewer); the item page stays one tap away for anything the card cannot settle. Confirming removes the card without a page reload.
- Notice levels set by the user (user, 2026-10-12): every warning, notice and action the app shows gets a type (e.g. TCG missing main price source, game missing main price source, TCG missing second source, card without a grade, game without a condition, import review, failed purchase link, data review suggestion, matches to confirm). A few pre-designed levels (about 5, e.g. red / orange / yellow / blue / grey, each with its colour, icon and order) and, in Settings, the user assigns each type to a level. Defaults follow what moves value: things that make TCG values wrong or missing are red (TCG missing main source, TCG card without a grade), game equivalents blue (games rarely gain value), secondary gaps blue (TCG missing a second source). The Actions page and the badges sort and colour by level; the count badge may count only the top levels. Defaults stored in code, the user's choices per user.
- Speed across the app, not only the portfolio (user, 2026-10-12: "super slow to load"): measure each main page (portfolio, item, Imports, Actions); the layout's attention count runs on every page and now includes the price-source check, so it must be cheap (one query, or cached and refreshed at the end of a collect).
- Built (2026-10-12): saved bucket values, nav badge and portfolio chart streamed, loading placeholder; Actions page first version with default notice levels (see Decision log). Notice levels in Settings and a nav Sign out built. Next: per-lot cost/value switches, then the wide-screen layout and visual pass.
- Speed: the portfolio page shows nothing until every number is loaded. Measure where the time goes, then show the page at once and let the slow parts (chart, per-product list) fill in as they load (streaming with placeholders), and precompute what can be (e.g. at the end of a collect).
- Sources with roles ("bring your own sources"; user + Claude, 2026-10-13; replaces "source names out of the public code"). Two kinds of store: price sources (collectors: they decide values) and purchase shops (imports: they only create lots, checked in the import review). Steps, all in S8:
  1. (Built 2026-10-13: `sources` table, migration 0020; values checked identical on production for all 133 lots, main sources too; Settings > Price sources shows the roles, admins change them.) Registry: each plug-in package declares its sources and shops (key, label, badge, colour, market, currency, price kinds, a suggested role per item class: reference / supporting / comparison, a priority, listing URL patterns, shop aliases, one item per order). Collectors save them to the database on each run; the app reads them there (it cannot load private plug-ins). Valuation: sales of reference then supporting sources (by priority), then shops' asking prices, then retail; comparison sources are shown, never valued. The main-source warning asks for the class's reference source. The suggested roles of our sources are the "Japan collectibles" preset (SNKRDUNK reference for cards and sealed, Mercari supporting, 駿河屋 reference for other items, TCGplayer and eBay comparison). Roles are deployment-wide (admin, Settings), not per user. Built-in lists naming shops in the public code go away. Values must stay identical (checked on production before / after).
  2. (Built 2026-10-13. First run on production: Mercari sales are 14.6% below SNKRDUNK's on 91 cards, so Mercari is comparison only for cards; it agrees for sealed (5% below, 12 items); games cannot be compared (駿河屋 has no sales), unverified. No current value used Mercari for cards. Admins get a "source quality" notice; Settings shows each check.) Quality gates: a source's trust is earned from data. Sales of a supporting source are compared with the reference's on the same items and conditions (like for like: sold vs sold); a source that disagrees (e.g. median gap over 15% on 10+ items) drops to comparison until it agrees again, with a notice. A source that cannot be compared (e.g. no reference sales for that class) shows as unverified and keeps its role.
  3. README: sources and roles, the Japan preset, how to write a plug-in; no responsibility for others' sources and imports.
  4. (Built 2026-10-13: supporting for every class, searched like Mercari with its filters; first run kept ~95% of sales on popular cards.) Yahoo Auctions closed listings (落札相場) as the first new source through the registry (supporting, for rare and event-only items no shop lists).
  5. (Built 2026-10-13, user: both ways: uploads in the app are read right away by the app when Vercel has an ANTHROPIC_API_KEY (Claude API), else by the home PC on its next run with its Claude login (`pnpm collect`, or `pnpm import-uploads` every few minutes); migration 0021.) The AI import from the app (S6 overlap): the suggested way to import purchases from any shop.

Design plan (user + Claude, 2026-10-12; the revamp of S8):
- Three sizes, each designed: phone (under 768 px: bottom tab bar, one column), half screen (768-1279 px, e.g. half of a 1920 monitor: a slim icon rail with badges, content full width), full screen (1280 px and up: sidebar with labels, content full width, no centred column). Forms (Add, Edit, Settings) keep a reading width at every size.
- Portfolio: one header everywhere (Market value, Unrealized P/L, Spent, the Actions line) and two tabs, Summary (default) and Items.
  - Summary: value-over-time chart, "by kind" as visible bars (beside the chart on wide screens), a tile per category (value, P/L, count; opens Items filtered), top movers (items whose value rose or fell most over the last 30 days).
  - Items: category chips (All / TCG / Games, with count and value) and kind chips filter in one tap; the list is grouped under slim sticky headers per kind (count, value). Phone: row cards of today's size with bigger pictures (about 72 px) and names on up to two lines in a slightly larger font. Half and full screen: vertical cards (about 200 px wide: big picture on top, name up to 3 lines, kind, value and P/L), as many columns as fit (about 4 at half screen, 7 at full).
- Item page next: Overview (value, lots) / Market (chart, Japan vs US, sources) / History; two columns on wide screens. Actions: two columns of cards on wide screens. Then the rest in the same visual language (spacing and type scale, cards, badges, level colours).
- Order: layout shell, Portfolio, item page, the other screens.
- Built (2026-10-12): layout shell (icon rail at 768-1279 px, labelled sidebar from 1280 px, wide pages use the full width: Portfolio, Items, Actions) and the Portfolio split (Summary at /, Items at /items, top movers from the daily snapshots). Then (user review, 2026-10-13): the chart and "by kind" share a height (the list scrolls inside); top movers became an insights card cycling every few seconds through movers by % / by ¥ / sealed only, most traded, gains and losses since purchase and most valuable items, with previous / next / pause; Settings picks rotation, speed and panels (side by side when rotation is off; users.preferences, migration 0018).. Item page (2026-10-13): two columns from 1024 px (item, stats and lots left; price chart, Japan vs US and price sources right, all shown); below that the header and Overview / Market / Sources tabs, the tab in the URL hash (#sources links open it). Actions cards in two columns from 1280 px. Per-lot tracking switches built (2026-10-13; holdings.count_in_cost / count_in_value, migration 0019): totals, chart, category tiles, by kind and insights count each lot by its switches (P/L only lots in both); Items shows Investments / Value only / Cost only / Not tracked groups when there is more than investments; the lot page has a "Counts in the portfolio" card (with "apply to every lot of this item"), the Add form the same two boxes under its details. Remaining screens (2026-10-13): the lot page in two columns on wide screens (the lot, actions, tracking left; value, box view, history right), Settings cards in two columns, Imports' ways to import beside its history; Add and the other forms keep the reading width. Next: source names out of the public code (plan to discuss with the user first).

Next (user, 2026-10-13, after testing roles with Yahoo Auctions as the cards' reference; to build next, in this order):
1. (Built) Identity link, a new entity separate from price roles. Sources declare `identity` (the item classes they have one stable page per item for); SNKRDUNK for cards and sealed, 駿河屋 for sealed and other items. An item is asked for one only when no accepted identity source is linked (best first by priority); notices and the item page say "no identity link". Other Japanese TCG shops as identity sources: not needed for now (user, 2026-10-13). Setting Yahoo Auctions (a search source, like Mercari) as the cards' reference made every card ask for "a linked product page from the reference source", which a search source does not have. An item's identity link is one stable product page that says exactly what the item is (name, set, number, picture), used to search for the same item across shops; it need not be a price source, nor the price reference. Sources declare whether they can be identity links (product pages: SNKRDUNK, 駿河屋, and Japanese TCG shops with one page per card, e.g. magi, Card Rush, 遊々亭, カードラボ: to check which the user means). The "main source missing" notice becomes "no identity link" (per item class: TCG via SNKRDUNK-like pages, games via 駿河屋), independent of which source is the price reference. Price roles stay as they are.
2. (Built: `foreignEstimates`, ungraded prices only, the middle one when a source has several printings or listings) Japan vs US: one estimated price per foreign source (eBay's median ask for the compared condition, TCGplayer's market price), not a list of listings or rows.
3. (Built: market tabs, then a tab per source that applies to the item's class or has something for it, each with its search, links, suggestions, paste box, 30-day medians and recent trades; the identity-link warning stays above the tabs; counts show suggestions waiting) The item page's Price sources card is too cluttered: tabs per market (primary market, e.g. Japan; secondary, e.g. US), and inside each a tab per source the user has (Japan: SNKRDUNK, Mercari, Yahoo Auctions, 駿河屋; US: TCGplayer, eBay), each with its own links, suggestions, search and sales. Markets come from the sources' `market`.
4. (Built 2026-10-14: /settings menu, /settings/account, display, notices, sources, collectors; the menu beside the section from 1024 px, a way back on phones) Settings in sub-pages (user, 2026-10-13): one long Settings page is too much on a phone. Settings becomes a short menu of sections (Account and devices, Display: amounts and summary, Notices, Price sources and markets, Collectors), each its own page; on wide screens the menu stays beside the open section.
Settings review (user, 2026-10-14, built; revised the same day): phones keep the menu pages (Settings, Admin preferences) and a way back; from half-screen widths there is no menu page (Settings shows Account, Admin preferences shows Markets) and the sections are a row of links on top, full screens included; settings pages are about 1.4 reading columns wide (68rem); Admin preferences (admins only, others get a 404) holds Markets, Price sources and Identity pages, each its own page, the identity page explained in its own card; the roles form stacks per source on phones. Phone overflow fixed app-wide: grids without a base column grew to the longest name (insights card, Actions cards), widening the page and the bottom tab bar.
Asking prices labelled as such (user, 2026-10-14): the eBay search panel used the sold-search wording ("sold items", "Sales used", "Last sale"); eBay gives only asking prices of active listings (a day's median per condition), and Tora never infers a sale from a listing that ends. Sources without sold prices now say "asking prices" with a warning, hide the listings-you-added box (Mercari only), and Settings notes "asking or store prices, not sales" next to a reference or supporting role. eBay can be a market's price reference; it cannot be an identity page (no product page per item), which the Identity pages page explains.
To do next session (user, 2026-10-14):
- Identity pages and search sources: eBay, Mercari and Yahoo Auctions have no product page per item, so they are not offered as identity pages today. Confirm with the user: keep them out (current), or offer them with a recommendation against it.
- Admin preferences navigation on half and full screens: opening Admin preferences replaces the row of settings links with its own row (Markets, Price sources, Identity pages) in the same style, so it is unclear the user is one level deeper. Keep the settings row on top (Admin preferences highlighted) and add a second, visually distinct row under it for the admin pages.
5. (Built 2026-10-14) Settings > Collectors: each collector starts collapsed, its status on the right (OK, or Partial in red); expanding shows the details (why a run was partial).

Then S11 (primary and secondary markets), then S12 (documentation).

Acceptance:
- User review on phone and on a wide desktop screen.

## S11: Primary and secondary markets

Added at the user's request (2026-10-13), to close the loop on shops and markets before the documentation (S12) describes it. Today the value counts Japanese sources only, Japan vs US lists every US source, and roles and identity sources are set once for all markets.

- Two markets for the whole app, set by the admin like the roles: primary (default Japan) and secondary (default US). Each source belongs to one market (its `market`); sources of other markets are not used.
- Settings > Price sources: two tabs, Primary market and Secondary market. Each lists that market's sources with a role per item class (reference / supporting / comparison / off) and, per item class, the identity source: which shop's product page identifies the item in that market (e.g. SNKRDUNK for Japanese cards, TCGplayer for US cards).
- Value: the portfolio counts the primary market only, as today. The secondary market gets one price per item by the same roles: the reference source's price, else a supporting one's; comparison sources are shown on their own tab of the item's Price sources card, not in the comparison.
- The Japan vs US card becomes "primary vs secondary": the primary value beside the one secondary price, with its source and the spread. Market names follow the setting (no fixed "Japan" / "US").
- Identity links per market: an item without one in the primary market gets today's notice; without one in the secondary market, its own notice type (default blue).
- The quality gate compares sources within a market.
- Not here: a home currency other than yen (see Out of scope).

Built (2026-10-14): `app_settings` table (migration 0022, key `markets`: primary, secondary, identity per market and class); `valuationOrder`, `referenceSource` and `identitySources` take a market (default the primary); the quality gate compares within a market; TCGplayer suggested as the US reference (identity page for cards and sealed), eBay as supporting; the `secondary_identity` notice type (blue); Settings > Markets and price sources (market pickers, a tab per market with roles and an identity page row); the item page's market tabs and the compare card follow the setting. Production: 6 cards without a TCGplayer link for the user.

Acceptance: switch a US source between reference and comparison in Settings and see the item page's secondary price follow; set an identity source per market and see the notices follow; the portfolio value unchanged by any secondary-market setting.

## S12: Documentation for others

Added at the user's request (2026-10-13); replaces "documentation first" under Open issues > Setup path. After S11, so it documents the finished market setup. Very robust documentation for someone cloning the repo to run their own Tora, written for a person or their coding assistant:

- Clone and run: accounts needed (Vercel, Turso, a home PC with WSL or Linux), environment variables, migrations, the first user, deploying, the daily collect and uploads on the home PC.
- Build a collector: the plug-in contract (what it returns: listings, candidates and scores, sales and asking prices with buckets, currencies and times, searches and their state; how it describes itself: market, currency, price kinds, roles, identity classes, links, aliases, order IDs, noAi and detailsDays), package layout, `pnpm collect`, polite fetching, testing with fixtures, a template plug-in to copy.
- A good identity link page: one stable page per item, the item's name, set, number and picture, a durable URL with an ID the plug-in can read, findable by search.
- A good price reference: real sales (not asks) with dates and conditions, enough volume, stable access, terms that allow it; when a source is supporting or comparison instead; what the quality gate checks.
- Primary and secondary markets: choosing them, roles and identity per market, what the value counts.
- Terms and responsibility: each site's terms are the builder's responsibility; sources whose terms forbid AI use are marked noAi.
- Checked in S10 by the France + China setup.

## S10: Reliability, consistency, efficacy and function review

Added at the user's request (2026-10-13). A review of the whole app before buy timing builds on its data. Pain points are two-fold: reliability (the data is right) and usability (a clear path to reliable data).

- Concepts and requirements: is the app achieving what it intended to?
- Efficacy: is the app doing so in an efficient way?
- Challenges, risks, potential blockers
- Data: no duplicated data (sales stored twice across sources or runs, lots imported twice, products registered twice), each value uses the best data available (sources, windows, conditions), the numbers on every screen agree.
- Function: every flow from setup to daily use works and is practical (setup, adding and importing, matching, collecting, valuing, actions, review).
- A full setup in another market: rebuild the app from scratch for e.g. France as the main market and China as the second (instead of Japan + US), with the sources and roles system, and see whether a user would get reliable data and a clear path to it. Findings decide what the README and the setup flow need.

## S9: Watchlist and buy timing

Added at the user's request (2026-10-12): the reason Tora v1 was started. Today the user asks Claude in a browser chat what to buy and at what price; Tora should do this with its own data. Add items (cards and games) the user does not own yet to a watchlist, collect their prices like owned items, and help find a good moment and price to buy. Everything below is first ideas, to be reconsidered in a design session (strategy, which signals, automatic vs Claude); new ideas welcome then.

Foundations (needed whatever the strategy):
- Watchlist: products followed without a lot (per user, with an optional target price and condition, e.g. raw A or PSA 10, sealed). Collectors match and collect watched products like owned ones (today they only look at owned or opened items).
- More market data than sales: today's lowest ask and number of active listings (supply), SNKRDUNK asks / bids if readable, trades per week (liquidity), 駿河屋 store and 買取 prices (S7), Japan vs US (S7).
- History long enough to judge: backfill sales on adding to the watchlist (the SNKRDUNK sweep already does this).

Signal ideas (deterministic, computed daily at the end of a collect, every number explained in the app):
- Where today's price sits in the item's own history: percentile over 90 / 180 / 365 days, distance from the rolling median (z-score on log prices), recent low.
- Trend and momentum: slope of log price over 2 / 4 / 12 weeks, moving average crossings; "falling knife" guard (do not call a falling price a buy until the slope flattens).
- Lifecycle of sealed product and new-set singles: prices indexed to the release date, compared with earlier sets of the same kind (typical pattern to verify on data: release hype, a dip in the following weeks or months, recovery once out of print). "Day N after release vs similar sets at day N".
- Supply and liquidity: listings count rising = more sellers = pressure down; few trades = signals are noisy, lower confidence.
- Spreads: lowest ask vs recent sales (a listing well under the market is a deal right now), Japan vs US, raw vs PSA 10 premium (grading worth it?), 駿河屋 買取 as a floor.
- Calendar: new set release weeks (people sell to fund the next set), year-end and bonus seasons, reprint announcements (the last only via news, see below).
- A fair value with a band, and a buy zone under it (e.g. "fair ¥26,000, buy under ¥22,000"), adjusted for fees and shipping. Target price set by the user wins.
- Alerts: price entered the buy zone, a listing under the target appeared (needs active-listing checks a few times a day, not only the daily collect), a sharp drop.

Buy suggestions on items not followed yet: see S13.

Automatic, Claude, or both (to decide; first thought: both, layered):
- Rules and statistics first: cheap, repeatable, explainable, testable. Backtest each rule on the collected history before trusting it ("had we bought when it said buy, how did prices move after 30 / 90 days?").
- A model on top, like S4d: Haiku / Sonnet via `claude -p` reads the signals plus things rules cannot (news, reprint rumours, tournament results, anime / game releases), writes a short weekly digest per watched item, and flags when the rules look wrong. Suggestions only, the user decides.
- MCP tools (read-only) so a Claude chat can discuss the watchlist with the real numbers (e.g. "watchlist_signals", "compare_to_similar_sets"), replacing the browser conversations.

Open questions: how much to trust thin data (a card with 3 sales a month); one strategy for all or per kind (sealed vs singles vs games); whether to store signals daily (for backtests) or compute on view; notifications (push, email) and how often; how to avoid looking like financial advice (show reasons and uncertainty, never a sure thing).

Acceptance (draft): add an item not owned to the watchlist; after the next collects it shows its price history, where today's price sits, a buy zone with the reasons, and the user can set a target price that triggers an alert.

## S13: Buy suggestions

Added at the user's request (2026-10-12; own chapter 2026-10-13). After S9, on its signals. The user's words: automatic suggestions on items to buy, with a target date and a target budget (e.g. "¥50,000 by the end of December"); like the browser conversations with Claude about what to buy and at what price, which is why Tora v1 was started.

- Tora proposes items to buy on its own, not only from the watchlist: items in their buy zone, expected moves before the date, liquidity to sell later.
- The user sets a budget and a target date; Tora suggests what to buy and when within them.
- Open: where candidates come from (items similar to what the user holds or watches, sets the user follows, top movers on the sources), how to split a budget across items, how to show the reasoning and the uncertainty (never financial advice, never a sure thing), rules first and a model on top (as in S9).

---

## Open issues (to plan later)

Logged at the user's request (2026-10-13): known gaps to come back to with a plan of their own. Not scheduled yet.

- Partial items: the user owns only part of an item, but the item's price sources track the whole package. Example: ゼルダの伝説 ムジュラの仮面 (N64), cartridge only (箱・説明書なし), valued as a complete boxed copy, so the value is clearly too high. Editing the item by hand to "cartridge only" is easy; the hard part is recognising a partial item during the import (Mercari / 駿河屋 / SNKRDUNK titles and receipts: ソフトのみ, 箱なし, 箱説なし, 本体のみ, カードのみ...) without AI interpretation, and then matching and valuing it as that partial item (its own product or a "completeness" attribute of the lot, with buckets / search words to match, e.g. 駿河屋 lists 箱説なし copies separately). To decide: product vs lot attribute, which words mark completeness per category, how the import review shows it.
- Bundles: one purchase of several items in one listing (see "Mixed bundles" below for the idea so far). Needs a plan: how an import recognises a bundle, splitting into one lot per item, how the cost is divided, and what happens to the items' price sources.
- Admin page with the terminal commands (user, 2026-10-14): revisit Admin preferences so the admin does not need the terminal for everyday tasks, e.g. creating a user (with the authenticator enrollment shown in the app), resetting a password or 2FA, listing and revoking devices, disabling an account (today `pnpm user ...`). To decide: which commands fit (account tasks yes; anything that scrapes, like `pnpm collect`, stays on the home PC, though the app could queue a run or show its status), how each is confirmed, and an audit log of admin actions.
- Setup path for other people (user, 2026-10-13): today the public repo has the app, the framework, every command (`pnpm collect`, `import-ai`, `import-uploads`, `demo`, `valuate`...) and the public plug-ins (TCGplayer via TCGCSV, eBay API, exchange rates); the scrapers for SNKRDUNK, Mercari, 駿河屋 and Yahoo Auctions are private (`collectors/`). Collecting needs a machine with a residential IP running `pnpm collect` daily. Accounts on an existing deployment need nothing (the owner's PC collects for every account); someone wanting their own deployment needs Vercel + Turso + a PC running collectors with their own source plug-ins, which only a developer can do. Options to weigh in S10: a packaged collector app (installer / tray app running the daily collect and uploads on a home PC, no repo), API-only sources run by a scheduled job in the cloud (no residential IP needed, e.g. TCGCSV, eBay), a hosted multi-account deployment where people just sign up (the owner collects for all; terms and load to consider), a guided setup in the app.
  - Direction chosen by the user (2026-10-13): documentation first, now chapter S12. The repo ships no scrapers for others; it ships a complete guide to building a collector (what data it must return: listings, candidates and scores, sales and asking prices with buckets, currencies and times, searches and their state; how it describes itself: roles, links, aliases) and to connecting it (package layout, `pnpm collect`, scheduling, the database, Vercel), plus a template plug-in, clear enough for a user (or their coding assistant) to write their own collector for the shops they use. Others' collectors are their responsibility.

## Out of scope for v1 (future ideas, do not build)

- Markets screen: JP vs US arbitrage table after fees and shipping
- Yahoo auctions / Yahoo flea market collectors
- Photos and receipt attachments
- JAN barcode scan when registering
- Realized gains report per year (tax)
- Price alerts (now part of S9)
- Home market and currency per user (user, 2026-10-12; status 2026-10-13: the primary and secondary market part is chapter S11; the home currency stays here. Sources now declare their market and currency and the admin sets each source's role, so the value can already come from any market's sources; still to do: a primary market setting that the Japan vs US card, the market labels and the default roles follow (the comparison card names "Japan" and "US" today), per user or per deployment, and the home currency). A card's language (the product's region) is not the market it is priced in: a Japanese card has a Japan price (SNKRDUNK, Mercari, 駿河屋) and a US price (TCGplayer's Pokemon Japan category, eBay). Today Japan is the fixed home market: the value counts yen prices only, other markets are shown beside it. Cheap step: each source declares its market, the user picks a home market, the value uses that market's sources, the others are secondary, and missing-source warnings follow the home market (SNKRDUNK for Japan, TCGplayer for the US). Expensive step: a home currency other than yen (costs, totals and P/L in dollars), since every amount is stored in yen today; purchases would keep the currency paid and convert everywhere.
- Yahoo Auctions closed listings (落札相場) collector (user + Claude, 2026-10-12): where rare and odd items trade in Japan (limited watches, event-only goods, 非売品). The closed-listings search loaded fine from the home PC in the web-research trial. Would cover items no shop lists, daily and without model cost. Candidate for the next source after S8.
- "Ask Claude to look" for items no source covers (user, 2026-10-12): a button queues the item; the home PC runs a model with web search and page fetches only, and its finds (link, price, date, sold / listing, how sure) come back as suggestions; accepted ones become reference sales or a manual price. Trial (Haiku, 2 items: the TAG Heuer × Mario watch and the WCS2023 Hokusai deck shields): about $0.07 per item, no prices invented, but almost nothing usable (one eBay.de listing, a launch price, a search-snippet Amazon price). Worth it only after the Yahoo collector, for what that still misses.
- Mixed bundles split into their items (user, 2026-10-12, undecided: maybe later, maybe never). A purchase of several different items in one listing (e.g. Mercari "ポケカWCS2023 ヨコハマ限定 デッキシールド、デッキケース" and "ピカチュウ ポケカ 公式 デッキシールド 4個セット" of different designs) is imported as one lot of one item, so it cannot be valued per item. Ideal: one lot per item, cost divided. Hard part: listing titles rarely name each item; the listing's photos and description would have to be read (a model could list the items it sees, the user confirms), and the cost split is a guess (equal, or by each item's market value). A cheap step first: a "split this lot" action in the app where the user names the items and the cost is divided.
