# Collectibles Tracker: Requirements (v1)

## How to use this file (Claude Code: read first)

- This file is split into **Core** (sections 1-7) and **Sessions** (S1-S25).
- Finished phases with long chapters keep a short spec here; their full chapters (design, what was built, how it was checked) are in [docs/history.md](docs/history.md). Add new "Built" detail of a finished phase there, not here.
- The owner's own setup, sources and to-dos are in private notes (`collectors/ops/notes.md`, in the private submodule).
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
| S8 | Visual redesign + wide-screen layout, portfolio revamp (tracking groups, speed), Actions page, sources with roles | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S11 | Primary and secondary markets: roles and identity sources per market, one secondary price per item | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S16 | Make Tora work anywhere: admin-defined categories (kinds, fields, price condition), markets, languages and base currency; ground rules for running many collectors | in progress: parts 1-3 (currency, languages, categories) live 2026-10-14; part 4 (markets, heavy-user rules) live 2026-10-15; part 5 (the app's time zone) built 2026-10-15, awaiting user check; left: the EUR + French end-to-end check (with S10) and measuring on S14's large data; parts 1-5 accepted (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S12 | Documentation for others: clone and run, build collectors, choose identity and reference sources, set up markets | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S6 | Backups, download my data, spreadsheet import, import log | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10); loading the JSON into an empty account is tested in S15 |
| S17 | Notifications and activity log: alerts outside the app (Telegram, Discord), what triggers them, a log of what happened | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10); CRON_SECRET and the Telegram bot after the switch back to Turso |
| S9 | Watchlist and buy timing: track items not owned yet, find good prices to buy at | designed 2026-10-16; part 1 (watchlist) built 2026-10-16 (migration 0028); part 2 (for sale now) built 2026-10-16 (migration 0029); part 3 (release dates and similar items) built 2026-10-16; part 4 (signals, buy strategies) built 2026-10-17 (migration 0030); next: part 5 (alerts, rule tests); parts 1-4 accepted (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10). the new-release wait learned per group, set lines and the fixed strategy examples built 2026-10-18 (migration 0041; branch `new-release-90d` superseded, can be deleted); part 5 (alerts, rule tests) built 2026-10-18 (migration 0042), awaiting user check |
| S19 | Database reads within Turso's free plan, reliably and with leeway; then the switch back to Turso | built 2026-10-18 (about 50M rows read a month measured, 10 % of the free plan; counter and alert in Settings > Admin preferences > Database); part 2 built 2026-10-18 (10 users within half the free plan: about 14 % measured on a simulated 10-user database); Tora is self-hosted for now, the hosted numbers to check in use after any move back to Turso |
| S22 | Item page as sub pages: Market, Buy timing (redesigned from the card), Lots & details | built 2026-10-18, awaiting user check |
| S23 | Pokemon Center Online purchase import from its order emails | built 2026-10-18 (private importer plug-in) |
| S24 | Japanese TCG shops as sources (private plug-ins): three shops first (asks, stock, 買取); more later | built 2026-10-19, awaiting the user's check |
| S20 | Box opening value: at what box price opening is worth it (pull rates, hit card prices) | built 2026-10-19, awaiting migration 0043, the first nightly reads and the user's check |
| S25 | Store notices: posts about cards on sale in physical stores (community boards, fed by the person's own browser), store codes mapped to stores, notices for the stores in the person's area (picked stores or a distance from where they are, travel mode), each store on or off; a new Stores page | built 2026-10-19 to 10-21, accepted by the user for now (2026-10-20); store labels per language 2026-10-23 |
| S20 part 2 | Pull rates as a plug-in kind (suggested rates come from plug-ins, the built-in list moves to the public plug-in package) | built 2026-10-20 (no migration; suggestions appear after the next collect or `pnpm plugins`) |
| S21 | Admin account tasks in the app (create users, reset password or 2FA, devices, disable) | built 2026-10-20 (migration 0050), awaiting the user's check |
| S13 | Opportunities and buy suggestions: signals that find opportunities within a category (from current data, then ranking plugins), then what to buy and when within a budget and a target date | built 2026-10-21 (parts 1-4: signals and their tests, MCP, the Opportunities page, ranking plug-ins and candidates, budget and date), awaiting the user's check; later: rank changes as signals, a Claude digest if an API key comes |
| S10 | Reliability, consistency, efficacy and function review, incl. cloning the repo and doing a full setup from start to finish in another market (Spain + Brazil) | done (2026-10-24, the user's check passed: "I love how it works" for Now): A data checks done; C the Spain + Brazil setup, the two-category test and their fixes done (2026-10-24); the status page and the page crawler done (2026-10-24, the pages crawled clean); B done (2026-10-24: pages on a scrubbed copy of the owner's data and every chapter against the code, 11 fixes, see Part B); D done (2026-10-24: risks and efficiency, its four follow-ups built) |
| S14 | Speed at any size: measure every page, data at three sizes, fix the slowest, keep a speed check; revisit infinite scroll for the app's long lists (the Items page first; built on the Stores pages, S25) | in progress (2026-10-24): `pnpm perf` and `pnpm stress-data` built; baseline within targets at today's size; fixes measured on medium and large (nav badge, Portfolio insights, nightly snapshot memory, Items and Opportunities load as you scroll, no page skeleton); every page within the targets on the owner's data and on large (2026-10-25); next the user's check (phone and PC) |
| S15 | Stress test and bug hunting: automated crawl and checks, edge cases, bug log | in progress (2026-10-25): server actions called by the wrong person and the rules on random cases tested (nothing found); account download loading built and round-tripped; load runs, collector faults, edge cases (input, imports) and layout at 7 views done (seven bugs fixed); `pnpm check:all` added; next the review of the bug log and Open issues with the user |
| S18 | Documentation pass: bring every guide in `docs/` and the README up to date with what was built since S12 | todo, the last phase (user, 2026-10-16) |

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
- 2026-10-10: Lot sizes a source does not report (found on SNKRDUNK's paged sales history: a 10-card lot looked like one card at 10x the price): such card trades are flagged `quantity_inferred` and their lot size is estimated (`inferLotSizes`: about k times the median of the same card and condition within 3 days, k 2-10, within 12 %). The app says so wherever such sales feed a number (price chart note and hover, valuation note, portfolio chart note and hover).
- 2026-10-10: Value over time is rebuilt on every run from each holding's acquisition date (only changed days written); cost is everything held, holdings without a market price count at cost.
- 2026-10-10: Look-alike products: a pull typed with the same name and card number as a registered card (same franchise / region) is logged on that card, not a new product. A product without a price source is offered the listing of a linked look-alike right away (same card number plus same name or set code; same name and kind for sealed items), when it is created and at the start of each collector run; the site search waits while such a suggestion is pending and runs again once it is dismissed.
- 2026-10-10: Collector runs still `running` after 3 hours are closed as failed (interrupted) when the next run of that source starts.
- 2026-10-10: Registering a new item or a pull suggests matching items already registered while typing (name, set code, card number; linked ones first, marked "linked"). Picking one registers the purchase or pull under that item instead of creating a duplicate (user request: search-first, like asset tools).
- 2026-10-10: Duplicate products can be merged: the product edit page suggests registered look-alikes; picking one opens a confirmation, and merging moves the duplicate's lots, sales data, manual prices and listings to the kept product and deletes the duplicate (same category and kind only).
- 2026-10-10: Cost basis of pulls (user decision): an opened (consumed) item keeps its full cost in the totals, the P/L base and the value-over-time cost line, at no market value; the pulls logged from it cost nothing and carry the market value. Unlogged cards are thus not guessed at. Each pull shows an estimated cost for reference only (the opened item's cost split across all its logged pulls by market value, equal shares where unknown), never counted in totals. Previously an opened item's cost dropped out of the totals, which overstated P/L.
- 2026-10-10: Search-based sources filter by rules, transparently: every rejected item is kept with its reason and can be included by hand (hosted scrapers stop at sold-only, dedupe and percentiles; nobody filters bundles or parts).
- 2026-10-11: Add item: typed product details survive switching category / kind; "acquired on release day" fills the date from a known full release date; "Unknown" is the first shop suggestion and the other lists are alphabetical; total cost may be left blank when a retail price is known (retail price x quantity is used, and the form says so).
- 2026-10-11: Valuation fallback for rare items: a source needs 3 sales; steps are the holding's condition over 30 / 90 / 180 days, then a year, then similar conditions pooled (an item's conditions, a card's raw grades, intact boxes with or without shrink; never graded slabs or opened boxes) over 180 days, then a year. A source reaching 3 sales wins over an earlier source with fewer; otherwise the first source with any sale is used. Year-long or pooled values are low confidence and labeled "similar conditions pooled".
- 2026-10-11: Plan: S5d Imports hub next (user: failed links were not findable once the review page was closed; all import actions should start from and return to one Imports menu); stopgap shipped: failed-links banner and list, Imports link in Settings.
- 2026-10-11: Plan (user + Claude): S4d automated data review first (Haiku on the flagged data only, after a trial against Sonnet; suggestions the user accepts in the app; later Sonnet may make the final call), then S4c import from any shop (Haiku extracts and matches, Sonnet reviews rows flagged by code-computed checks, not by the model's self-rated confidence). Earlier the same day: S4c import purchases through Claude via MCP write tools (any format the user shares, same import rules, everything lands in Review import; the first MCP writes, add-only, approved in the chat); S8 gets per-lot "count in cost" / "count in value" switches with separate portfolio groups, and portfolio page speed (stream the slow parts).
- 2026-10-11: Purchase import by link, for shops that send buyers no purchase email: the person pastes links in the app (Review import > Add purchases by link), read by the collecting machine on the next collect (never with the person's login on the shop). Each link is read once; the purchase date is the listing's last update (approximate, editable in the review); a lot that looks like an entry added by hand gets the item ID instead of a second lot; the bought item becomes a reference sale on the product's search.
- 2026-10-11: S4d built as a script, not MCP write tools: `pnpm review` builds the cases itself (odd sales with their titles and the bucket's other sales; searches keeping under 30%), asks `claude -p` (Haiku, no tools, JSON schema), sends cases under 0.7 confidence or "unsure" to Sonnet, and files suggestions (exclude_sale, exclude_word, fix_product) plus remembered verdicts (sale_ok, search_ok; searches looked at again after 14 days). The MCP server stays read-only. One exclude_word covers the sales it explains (no separate sale suggestions). First real run: 21 cases, 11 to Sonnet, 8 suggestions, $0.08.
- 2026-10-11: Suggestions (user requests): each links to the listings behind it (SNKRDUNK: the product page, it has no per-trade page); a word to skip shows every collected listing with it, counted or left out. The user can leave a note when accepting or dismissing; notes are stored on the suggestion, listed under Suggestions (deletable), given to the models on every later review (they follow them over their own judgment) and shown in the MCP data checks so recurring ones can become filter rules. First such rule: Elite Trainer Box / ETB (English-only line) counts as another region for Japanese products.
- 2026-10-11: S4c (user: folder + command; Mercari and Amazon order screenshots first): `pnpm import-ai <folder>` like `pnpm review`, no MCP write tools. Haiku reads the files with only the Read tool, confined to the folder, and matches rows to the user's products (list given) or describes a new one; code checks (no price/date, odd quantity, unknown product, title not supporting the match, a new product named like one held, price over 3x / under 1/3 of the latest unit value, model unsure) send whole files to Sonnet with the first reading and the flags, plus a 10 % random sample. Rows without an order ID are imported without one (no made-up IDs) and recognised again by product, price and date; several items in one order get `<order>#n`. Readings cached per file hash in the folder. Import run method `claude`, with what Sonnet re-read in its note; failed Mercari links whose item ID was imported are resolved. Matching improvement for every import: a likely match also counts when the receipt resolves to the entry's product (not only by title words).
- 2026-10-12: import-ai, several files per purchase (user: share data in whatever form, e.g. a Mercari listing page plus its transaction page): the model lists each file's view as its own row and tags rows it thinks are one purchase with a confidence; the code joins them only when the model is at least 0.8 sure and nothing disagrees (shop, price, order ID, date). Otherwise, and for look-alikes the code finds (same shop and price, one title the other cut short), both lots are imported and flagged `maybe_same`; Review import offers "Same purchase as" to merge two lots (the chosen one stays and takes the other's order ID, price or order date where it lacks them; links move over). Lots without an order ID can be removed in review. Mercari cost = 商品代金 minus coupons (メルペイ / points are payment, not discounts).
- 2026-10-12: import-ai fixes after the user's first real run (39 Mercari screenshots, all listings first and then all transaction pages, so no pair shared a batch: 38 lots for 20 purchases; merged by Claude at the user's request with the new lot merge, failed links resolved): look-alike pairs of different batches are asked about as text only (Haiku, cached), joined when sure; a guessed date (a listing's age, 半年以上前) never counts against a pair and is not a purchase date; the folder's own cache file and other dotfiles are never inputs; rows whose order ID is already registered are not checked (no Sonnet re-reads on re-runs); the random Sonnet check is drawn once per file; an item made only for a merged-away lot is deleted.
- 2026-10-12: Plan (user): cards not linked to SNKRDUNK get a warning; non-card items get a stable product-page source (駿河屋 product pages, not Mercari) with the same warning; both in S7. Mixed bundles in one listing noted as an undecided future idea.
- 2026-10-12: Plan (user): S6 moved after S8. The user wants imports handled from the app rather than terminal commands; to revisit with S6 (in-app file upload, Gmail auto-import, where the model runs). Next: S7.
- 2026-10-12: S7 scope (user): TCGCSV and eBay for US prices; a store source for non-card items; the "not linked" warning for non-card items only above an amount (¥3,000, later the admin's). US prices never feed the valuation (JP market value); they are shown side by side.
- 2026-10-12: S7 build: US prices are stored as `listing` observations in dollars and loaded nowhere in the valuation (which now takes yen prices only); 駿河屋 asking prices became the valuation's last market fallback (`store` method) as section 6 planned; first matching run: 36 TCGplayer and 36 駿河屋 suggestions (a first 駿河屋 pass made 74, mostly related goods, and was redone with a tighter rule before the user saw it).
- 2026-10-12: New phase S9 at the user's request: a watchlist of items not owned yet, with help finding a good price to buy at from price behaviour (the reason Tora v1 was started). After S6; starts with a design session. First ideas written down in S9, all open. "Price alerts" (future ideas) folds into it.
- 2026-10-12: Card sleeves named デッキシールド were imported as a deck (sealed, so SNKRDUNK was asked for); the Mercari importer and the import-ai prompt now file sleeves, deck shields, deck cases, playmats and loaders as `supply`. Fixed in production for the one such item (デッキシールド ピカチュウの贈り物: kind supply, its lot's sealed packaging carried over as condition new/unused).
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

- 2026-10-15: S16 part 4 (user's choices): other categories compare markets in the lot's own condition (TCG keeps its rule); the night window for collectors is the admin's (6 hours by default), a run over twice its usual time is flagged; taking turns waits for S14's large data; the identity-link amount (¥3,000) is the admin's, in the base currency, on the Identity page.
- 2026-10-15: S12 direction (user): the guides go in a `docs/` folder, one per topic, with the README kept short and linking to them; building a collector is taught with a runnable template plug-in (made-up site, saved responses as fixtures, a passing test) to copy; the Commands page from Open issues is part of S12 (admin only: the home-PC commands, what each does, a copy button, links to the guides; doing account tasks in the app stays an open issue). The guides are in English; some Japanese documentation is wanted for the user's portfolio, without keeping every guide in two languages (to decide later, see Open issues).
- 2026-10-15: Collect once a day, once per site (user, after a manual run and the hourly retry ran SNKRDUNK side by side): `pnpm collect` takes a lock per site (a file per source on the home PC with the running process's ID; a lock left by a stopped process is taken over), skips a site another collect is running (not counted as the day's run, so the schedule retries), and closes out that site's runs still marked running. Listings already collected today are left out (`--refresh` or `--product` collect anyway), so a retry does only what is left. "Today" is the home PC's date, not a fixed Tokyo (user: use the admin's local time).
- 2026-10-15: The app's time zone (S16 part 5, user): set by the admin in Settings > Admin preferences > Time zone, one for the whole app (not per user), picked at setup next to the base currency; existing data stays Asia/Tokyo until changed. Stored times keep their text form (ISO with the zone's offset at that instant, so a day is still the first 10 characters and nothing else changes); changing the zone later rewrites every stored time as the same instant in the new zone (every `*_at` column and times inside JSON), then values and daily snapshots are rebuilt; dates without a time (snapshots, exchange rates, release dates) stay. The collect's "today" and the schedule's daily stamp follow the app's zone (replacing the home PC's date above). Reason: one definition of a day everywhere; storing UTC instead would have changed every day calculation in the app.
- 2026-10-16: S6 rethought (user): automatic backups of the whole database on the home PC (a synced folder can take them off the PC; 30 daily + 12 monthly kept; restore only into an empty database), a per-account download (lots spreadsheet, JSON of the account's own data, no collected prices) and a spreadsheet import in the download's layout that skips rows already in Tora. Dropped: per-table CSV zip, whole-database JSON, the purchases file upload. Gmail auto-import moved to Open issues. Loading the JSON into an empty account is optional, later. Reason: accounts, Claude-read uploads and admin settings came after the first plan; what cannot be collected again is what needs protecting.
- 2026-10-16: Import log and alerts (user): every import keeps each row's outcome (a row left out must never be only a number); a spreadsheet row matching a lot only loosely can be added anyway from the preview. Alerts outside the app and an activity log become their own phase, S17, after S6 and before S9 (S9's price alerts use its channels). Plan order: S6 > S17 > S9 > S13 > S10 > S14 > S15.
- 2026-10-16: S17 design (user): Telegram and Discord first (email and phone push to Open issues); failures at once from the home PC, a daily check in the app for runs that did not happen, everything else in one daily summary; one Activity page that also serves as the admin audit log.
- 2026-10-16: A documentation pass is the last phase, S18 (user): it builds nothing, so it comes after S15. Plan order: S17 > S9 > S13 > S10 > S14 > S15 > S18.
- 2026-10-16: S9 design (user): watch items (not sets), with a condition and an optional target; the lowest ask and listing count once a day in the nightly collect; rules first, Claude later; signals saved daily; the buy zone from the item's own history plus the new-set pattern pooled from every user's items of the same kind, franchise and language (release dates from the set catalog, else the item's own, else its first sale); zone and target alerts at once; signals on owned items' pages too; rule tests shown as a short results card.
- 2026-10-16: S9 part 2, what is for sale: an ask is per unit (a lot's price divided by its size, the lot named); a plug-in leaves out asks it takes for lots or other items (its own rules); a search source's asks pass the same filters as its sales; auction sites are left out (bids, not asks).
- 2026-10-16: S9 part 3: catalog links only when sure (code and name agree, or one names a single set), the rest confirmed on Actions; a link never changes the item's own set name or code (searches stay as they are); games are grouped by a normalized platform.
- 2026-10-16: S9 part 4 design (user): buy strategies per person and item type, five of them, preset to Tora's suggestion, tried on a fixed sample before choosing; chosen on the Watchlist as a setup step, not in Settings; limited data is shown with a warning, never hidden.
- 2026-10-16: S9 part 4: the new-set pattern uses only real release dates (the set catalog's or the item's own), never a first collected sale: a dry run on the real data gave games a 12-day age because collecting started then. The first sale is still shown as such.
- 2026-10-17: Alerts for a collect that stopped early say why (the reason read from that run's part of collect.log, e.g. a migration not run yet), that it retries next hour, and how to read the log (`pnpm collect:log`, new); Settings > Activity shows the reason (user: the old message was not self-explanatory).
- 2026-10-17: Strategy examples (user): fixed, the same for everyone and independent of anyone's items: three anonymous scenarios (rescaled real price series, no product names) that show where strategies differ: a steady market with dips, a long fall, a new set's hype, dip and recovery. Built before the database work.
- 2026-10-17: Plan from here (user): S19 (database reads within the free plan, then the switch back to Turso) > fixed strategy examples > S9 part 5 > S20 box opening value > S21 admin account tasks in the app > S13 > S10 (with a deep-dive review of every built phase) > S14 > S15 (with loading an account download into an empty account) > S18. S8, S11, S12, S16, S6 and S17 accepted (no major issues seen in use). Dropped: alerts by email and phone push (Discord and Telegram do the same). Gmail auto-import becomes an optional feature; partial items and bundles need further analysis before any plan.
- 2026-10-18: Rows read measured exactly (a local libsql-server on a copy reports rows read per statement as Turso bills them): the collect's closing steps 2.8M per run (buy timing 1.0M, values 0.65M, lot sizes 0.36M, quality 0.31M, snapshots 0.30M, trade counts 0.22M), the backup 0.3M, the Portfolio 128k per view (chart), an item page up to 189k (its sales re-read by about six queries), Settings > Collectors 240k; other pages 1-2k. Normal use came to about 10M a day (300M a month) and grows with the sales; most of October's 612M was analysis queries and the old trade counts. The earlier figures (VM steps) overstated the collect about threefold.
- 2026-10-18: S19 approach (user): (1) the home PC reads Turso embedded replicas (revised the same day, see below); (2) pages read numbers saved at collect time in small tables (Portfolio chart totals per person and day, daily prices per item, source quality), not scans of the sales and not a Next.js cache; (3) the app counts the rows read Turso reports per day and origin, shows the month so far and alerts admins past a budget. Incremental closing steps only for speed.
- 2026-10-18: Embedded replicas re-evaluated with numbers (user): a replica costs sync data (3 GB a month on the free plan, a limit like the reads): replaying a real night's 9,322 sales as the collect writes them made the next sync 30 MB (0.9 GB a month if synced daily, 30 % of the allowance), so a replica pays off only where it replaces more than about 5M rows read per day of changes. The collect's closing steps (2.8M) and the backup (0.3M) do not; Claude's analysis (1M-250M per analysis) does, and last night's backup already is a free local copy. Revised S19 (user): Claude's heavy queries on last night's backup copy (a replica synced on demand only if a day-old copy is not enough), the collect stays on Turso with incremental closing steps, page numbers saved at collect, the in-app rows-read count with a budget alert. Expected: about 30M rows read a month, no syncs.
- 2026-10-18: A hard stop on Claude Code reading Turso (user: rules in notes can be forgotten between sessions): (a) Tora's database code refuses a hosted database to programs Claude Code starts (CLAUDECODE=1) unless the user sets TORA_ALLOW_TURSO=1 (the MCP server excepted: light tools, query_sql on the analysis copy); (b) a Claude Code hook (local settings, not in the repo) blocks Claude's shell commands that set the override, read the Turso settings or name a Turso address; (c) Claude Code's sandbox (local settings) refuses connections to Turso's domains for every shell command, with no unsandboxed fallback (needs bubblewrap and socat). Turso itself offers no per-token read limit.
- 2026-10-18: New-release wait (user): a fixed 90 days is arbitrary (e.g. a second lottery or made-to-order run announced within weeks). A backtest on the 16 items with a real release date and early prices: with no rule, calls at 30-89 days were higher 90 days later 3 % of the time; a "price has settled" rule (no fall over 2 and 4 weeks, 14+ sale days) still made 43 such calls, none higher (pauses in a falling price fooled it); the lows came at about day 119 (Battle Partners box), past day 63 (Storm Emerald box) and day 112-357 for singles. Decision: the wait lasts until the age at which similar items usually hit their low (3+ similar items with a full first year), else 90 days; the new-set pattern and Catch the dip as before. Plus a line marker on sets (main expansion, sub-expansion, high class pack, special or anniversary; set automatically from Pokemon box names, by hand otherwise by the item's creator or an admin; the list an admin setting): group studies use the marked group when it has enough items, else the whole group, and say which; Tora suggests marking items whose prices behave unlike their group. Built after S19, with the fixed strategy examples.
- 2026-10-18: Set lines (user): the four lines stay. Pokemon titles in the official catalog: 拡張パック (main expansions, e.g. バトルパートナーズ, ストームエメラルダ), 強化拡張パック (sub-expansions, e.g. ポケモンカード151, 熱風のアリーナ), ハイクラスパック (e.g. シャイニートレジャーex, テラスタルフェスex); anniversary and concept packs are special (30th CELEBRATION: the official list calls it 拡張パック, the anniversary rule makes it special; any item's line can be changed by hand). Cards take their set's line through the catalog link.
- 2026-10-18: Item page and new ideas (user): the item page has too much at once; it becomes sub pages with their own address (Market, the default: price history, key numbers, Japan vs US; Buy timing: the card redesigned as a page, with the price history too, since the chart lets one check the verdict in seconds; Lots & details: lots, item details, price sources setup, least visited once registered). Ideas: (1) opportunities within a category, e.g. from ranking pages (SNKRDUNK's sealed box ranking) compared across items: ranking sources become a plugin kind documented like collectors; signals from data already collected come first (strength against its line, demand against supply, ask against sales, shop buy prices, Japan vs US, stock running out); all tested on past data before trusted; S13 becomes Opportunities and buy suggestions. (2) More Japanese TCG shops as sources: each is a collector plugin (code, private), not only a registration; asks and stock into for sale now, 買取 as buy prices; about 7k rows written a day at 10 users with 8 shops (2 % of the free writes). (3) A Pokemon Center Online purchase importer from its order emails (exact parser, no model). Plan from here: S22 item page > S9 part 5 > S23 Pokemon Center import > S24 shops > S20 > S21 > S13 > S10 > S14 > S15 > S18; the switch back to Turso after 2026-11-01 whenever it falls.
- 2026-10-18: S9 part 5 alerts and rule tests (user, all Recommended, after measuring 77 owned and watched items): a buy zone alert when a watch's verdict turns Good price (not during a wait, not for an ask alone; Steady enters its zone about 1.5-2 times a year per item); the zone alert and the ask-under-target alert repeat only after 14 days out (a third of zone entries were re-entries within 14 days); sharp drops in the daily summary = market value down 15 % or more in 7 days, owned and watched items, at most once per item per 14 days (about 10 a month across the 77 items, 16-22 in the 2026 fall; the falling-fast rule would give about 40). Rule tests: an honest card now, per signal (the first day of each stretch in the zone) over the whole history, higher after 90 days X of Y and the typical change, always next to buying on any day, hidden under 10 signals. Measured first: over the whole history Steady signals did worse than any day (sealed boxes 25 % higher after 90 days, median -12 %, against 67 %, +9 %; PSA 10 33 % against 58 %; PSA 9 60 % against 63 %): the zone pays less than average but is no sign of a rise; a rule waiting for the 2-week trend to turn up did better (boxes 47 %, PSA 10 45 %) but still under any day. Rethinking the strategies goes to S13.
- 2026-10-19: Item pictures (user): an item's picture is shared by every account, so it is always a standard product photo: a confirmed listing's from the item type's identity source first (SNKRDUNK for cards and sealed, 駿河屋 for games and items), variant listings (SNKRDUNK's 【シュリンクなし】 boxes, declared by the collector) last, whatever was linked first; a seller's photo from a purchase import only as the last resort, until a listing is linked. Shared listings and who may change them (condition listings kept while someone holds or watches that condition, the main listing changed only by its sole holder or an admin): proposed, not decided.
- 2026-10-19: S20 box opening value (user): on a booster box's own sub page (Opening) and in a list of the person's boxes side by side (Watchlist > Box opening); each card at its lowest ask on SNKRDUNK, and for the ten cards carrying most of a set's value at its recent condition A sales (asks run far under sales for the top cards, e.g. リザードンex SAR ¥41,000 ask, ¥65,000 sold); pull rates suggested by Claude from community sites and corrected by the admin; cards below the hit rarities count as nothing.
- 2026-10-20: Infinite scroll (user): long lists show a first batch and load more as they are scrolled, instead of everything at once or pages with numbers; built on the Stores pages (posts 20 at a time, read from the database as needed; the store list 20 at a time); to revisit for the whole app (the Items page first), with S14.
- 2026-10-20: S21 account tasks (user): a new account or a reset gives a one-time setup link the person opens on their own device to set their own password and authenticator (the admin never knows the password); creating, resetting and disabling ask for the admin's own authenticator code, signing devices out only an "are you sure"; collecting stays on the home PC, the app shows its status and leaves a "collect now" request the home PC takes on its hourly check.
- 2026-10-20: Self-hosting (user): Tora also runs on one always-on machine at home (the app, a local database, the nightly collect and the browser with a store feed userscript), reached from anywhere through a tunnel address, with daily backups copied off the box. Vercel + Turso stay possible (the code supports both). The owner's setup is in the private notes.
- 2026-10-21: S13 design (user, all Recommended, after a test of signals on the real history): candidates are the items anyone tracks plus a SNKRDUNK sealed-box ranking plug-in whose items nobody tracks become candidates, created and collected like watched items (the top 30); an Opportunities page in the menu after Watchlist (tabs per item type, the signals, their reasons and past records, Watch), the budget plan there too; only signals proven on past data rank items (a higher price 90 days later more often than on any day, by 5 points or more, over 10 or more checks), others show as not tested yet; with a budget and a date Tora ranks with a suggested buy day and price, the person ticks the items and Tora checks they fit.
- 2026-10-21: Message style and schedule (user): every message Tora sends becomes a heading, cards and a link (feed status and unknown stores were still plain text); a "Message style" page (Settings > Alerts) shows every kind with example data as Discord and Telegram show it and lets each person change, per kind, cards or plain text, Discord colors, the parts shown and the wording (user: wording too; per person); previews follow each change, an example can be sent to one's channels. A Schedule page (Settings > Collectors) shows the server's checks (recorded at each check), the next daily collect, each collector's likely start from last night's run, the collect's steps and the other timers. Found: since the move to the home server nothing ran the morning check (a Vercel cron job): the app now runs it itself from 08:00. Opportunities page wide, items as cards in 2-3 columns.
- 2026-10-22: Node security release of 2026-10-21 (user): the repo names its Node version in `.nvmrc` (24.22.1), so a server's update can install it; packages already follow the lockfile on every update.
- 2026-10-22: Store feed silence after a night off (user): the server was off all night, so the morning's silence alert was about that, and the feed then stayed silent all day with no further word (told once). Silence now counts from the app's start when later than the feed's last push (the message says "since the server started at ..., its last push: ..."), and a feed or board still silent is told again every 2 hours within the person's hours.
- 2026-10-23: Personal code split (user): what serves only the user's own setup leaves the public repo for the private one (the `collectors/` submodule, folder `ops/`): the home server guide, its self-update, the Funnel check and the backup copy to the PC. Public code keeps generic hooks (`pnpm alerts server <title> [--text] [--level] [--tell]` replaces the Funnel alerts) and says "server" rather than "home server". Kept public when it can serve as a template for similar cases (store notices, rankings: plug-in kinds), with neutral names in examples and tests (no real boards, chains, store names or posters' codes). The public `scripts/update-server.sh`, `funnel-check.sh` and `copy-backups.sh` were one-line stubs until the server's timers and the PC's task pointed to `collectors/ops/` (done 2026-10-23), then removed. Then this file was split (2026-10-23): the owner's setup, sources and their quirks, personal findings and to-dos moved to private notes in the collectors repo (`collectors/ops/notes.md`).
- 2026-10-23: S10 plan (user): (A) data checks on the analysis copy, (C) a fresh setup for another market, (B) the deep dive of every built phase (Claude checks chapters against code and data, the user confirms what only they can see), (D) a write-up of risks and efficiency. The other-market setup is Spain (EUR, primary; real Cardmarket prices from a free public card API, its terms checked first) and Brazil (BRL, secondary; a made-up plug-in from the template), app in Spanish and English (es.json drafted by Claude, said to be unchecked by a native speaker), on a separate local database. Replaces France + China: the user reads Spanish and Portuguese, and Japanese already tests a non-Latin script.
- 2026-10-23: Before S10 part B (user): a read-only server status page (collect and update logs, services, timers, disk, the running version) behind its own read-only token, so Claude checks the server without the owner pasting command output; generic, for any self-hosted Tora. And S15's page crawler built first (every page at phone and wide widths, failing on server and console errors, raw text keys, sideways scrolling), so Claude checks pages itself during the deep dive.
- 2026-10-23: S10 part C (user): Cardmarket through TCGdex is a public plug-in, switched on per install (`ENABLE_CARDMARKET=1`) so other setups are not searched by it; a site's daily market price counts as one sale a day (`priceKinds: ['market']`), no new price type; the made-up Brazil plug-in stays in the test copy only.
- 2026-10-24: Alert history (user): every alert delivery is recorded (one row per message and channel: kind, Telegram or Discord, the channel's name, the message as plain text in the person's style, sent or failed and why), and Settings > Alerts > History lists the person's own, newest first, filtered by kind, channel, outcome and dates. Separate from Actions (what waits) and Activity (what ran). Rows are kept 180 days (pruned by the morning check); a removed channel's rows stay. Alerts sent before this have no record.
- 2026-10-24: Server status page (the first item before S10 part B): Settings > Admin > Server shows the version, uptime, memory, disk, the `tora-*` systemd services and timers, the last collect and backup, and the end of each log in the state folder; read-only. A read-only token made there (shown once, only its keyed hash kept, replace or remove) gives the same JSON at `/api/server/status`; `scripts/server-status.mjs` reads it from another machine. Values of secret settings and lines naming a noAi source are left out. Settings groups (Alerts, Collectors) show their tabs on the group's own page too.
- 2026-10-24: Page crawler (S15's, built before S10 part B): `pnpm crawl` signs in (CRAWL_USER, CRAWL_PASSWORD, CRAWL_TOTP_KEY or _FILE; the session is kept between runs, since each sign-in is a device), follows every in-app link from the home page (2 pages per address shape, e.g. items), opens each at 390 and 1280 px and reports HTTP errors, console and page errors, the dev tools' issues, raw text keys, unfilled {placeholders} (text shown as code excepted) and sideways scrolling. Opens pages only. First run on the test copy: 60 pages; found Admin > Commands' info text not parsing (fixed, and a test now parses every message). A dev server runs no background checks unless `TORA_DEV_ALERTS=1` (a dev server on the analysis copy sent the owner a real alert).
- 2026-10-24: A site that blocked a run (HTTP 403 / 429, a captcha) is left alone by the day's later retries (S10 part B, user): a blocked source made the run fail, so the hourly retry ran again all day and asked the blocking shop again each time, against section 7. `--source` or `--refresh` still tries it; admins were already told after the first run.
- 2026-10-24: The store feed at a glance on every Stores page (user: to be sure while reading notices that it still runs): a pill in the bottom-right corner (above the phone's bar) with the board read last, when and how many posts, and the next read counting down; moving dots while a read is due, amber when it is late or a watched board gave no posts for 10 minutes, red when the feed is silent; it opens the Feed page. Feeds say their next read in each push (`next`, docs/store-feeds.md; migration 0061).
- 2026-10-25: Loading an account download (user, S15; S6 had it as later): an empty account can load a "Download my data" JSON file (Settings > Your data, shown only while the account is empty). The person's rows get new ids (the same install may still hold the originals), items the install lacks are added with their listings, amounts must be in the install's base currency, all or nothing. Through its own route (`/import/account`, JSON body only): a big account's file (12 MB at 4,219 lots) is over the server actions' 5 MB.
- 2026-10-25: Long lists and the page skeleton (user, S14): Items and Opportunities draw their first cards with the page and more as the end of the list comes near (load as you scroll), with counts and totals for the whole list. The grey page skeleton (`loading.tsx`) is gone: React reveals a streamed page in timed batches, so it held every first paint back about 350 ms; the tapped menu link now shows a small loading mark at once instead, and the old page stays until the new one arrives. Saved insight lists keep only what a panel can show (market movers: 3 up and 3 down per period; most traded: 6).
- 2026-10-21: Store notice replies and product names (user, detour from S13): replies under board posts are read (by the feed, e.g. a userscript pressing the page's own button in the person's browser) and sent at once as comments to their post; notices name the store and the products the codes stand for (decoding only, no translation or model: the original when nothing decodes), with bold and quotes on Discord and Telegram; product codes from the board's list plus the admins' own.
- 2026-10-19: Plug-ins first (user): as much as possible built into Tora while keeping it usable anywhere; what is specific to a place, shop or site is a plug-in. Pull rates (S20) become a plug-in kind (S20 part 2, after S25). Store notices (S25, user): community boards where people post when cards go on sale in stores, mostly in store codes. A site's bot check is never got around, nor read around (no use of the site's other feeds): posts reach Tora from the person's own browser (a userscript on the open board, private) through a feed endpoint with a personal token; X (Twitter) left out (its API is paid, scraping it is against its rules). Area (user): both, the person picks stores by hand, or sets where they are (the browser's location, kept rounded, no address stored) and a distance; travel mode until a date. Store notices first, then the pull rate plug-in.
- 2026-10-18: Target: 10 users free (user): at most 50 % of the free plan's reads for 10 users (25M rows a month per user, about 0.8M a day), with room for heavier users and more data to come. At 10 users like the admin (about 90 items and 140 lots each, half the items shared) the S19 design would read about 300M a month (60 %): the nightly steps rebuild results from the raw sales (snapshots re-read three years of sales and every saved snapshot), and the snapshot rows (one per lot and day) would also pass the free 10M writes a month. Decided (user): store results and redo them only when their inputs change, Turso staying the only database (no local copy in the loop: the user's worry, two copies drifting apart unnoticed): (1) one row per item with its kept sales, asks and buy prices packed (exact time, price, estimated lot) in place of `price_days`, since Turso bills rows scanned, not bytes, so an item's whole history costs one row read; values, buy timing, quality, trade counts and the item pages read it, with the same results as the raw sales (exact times kept: the whole-day windows the user allowed are not needed); (2) the value history packed per lot (one row with its daily values) in place of a row per lot and day; (3) a nightly self-check that recomputes a few random items from the raw sales, compares, rebuilds and alerts admins on any difference, and one command to rebuild every saved result; (4) the daily backup leaves out what can be rebuilt (rebuilt after a restore). Expected about 65M a month at 10 users (13 %).
- 2026-10-17: Highest priority next (user): Tora must keep working on Turso's free plan, reliably and with leeway. Before switching back on Nov 1: the collect's closing steps (values, snapshots, buy timing, lot sizes, quality) redo only items with new sales, page data is saved until the next collect, rows read are measured per collect and per page view, and a monthly budget well under the 500M quota is set. This part of S14 comes first; S9 part 5 after.
- 2026-10-17: Market-wide check (user): a backtest on all collected prices (84 items, two years, local copy) gave Steady's calls 86 % higher 90 days later (+34 % on average) against 71 % (+23 %) for any day, and a per-item 12-week guard did not help; but the market's median 12-week change has fallen four months running (cards -29 %, sealed -21 % in October 2026), longer than any dip in the data (earlier ones were -5 % for a month). So a price in the zone waits while its group of similar items (5+) is down over 15 % in 12 weeks (Catch the dip warns instead). On the real data: 30 good-price calls became 4 (groups too small for a market trend).
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
- Built into Tora, usable anywhere (user, 2026-10-19): what is specific to a country, a shop, a site or a market is a plug-in (collectors, purchase importers, rate sources, set card sources, pull rate sources, store directories, feeds...), and Tora's core stays general; a plug-in kind is documented (docs/) so others can write their own, without the private reading code.

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
- The search panel shows what the valuation computes from the source per condition: median, sales used and window, latest sale.

Acceptance:
- Scenario items 1-3 (CE, amiibo, controllers) get Mercari sold observations with sensible buckets.
- Data gate repeated for 3 non-card items.
- Mercari purchase importer (private plug-in): import the user's Mercari collectible purchases through the same `PurchaseImporter` interface and import flow as SNKRDUNK. This proves the "bring your own sources" design works for more than one shop (without it, that claim does not hold). Can come after the user's own SNKRDUNK flow is settled.
- Built (2026-10-11) as purchase import by link: `PurchaseImporter` gained `matchesLink` / `readLink` (email methods became optional) and receipts carry the category path, a reference listing, a photo and "date approximate". Table `purchase_links` (status pending / imported / matched / duplicate / skipped / failed, message, holding). `pnpm collect` reads pending links first (so new products are searched in the same run), plans and applies them like an email import without questions (likely matches get the ID, conflicts keep the registered data), and stops reading when the site blocks (the rest stay pending). Products are made from the listing title (singles, sealed kinds, games from the category); a raw card's grade is set in the review. Review shows "date read from the listing" and "new item made from the listing title", with a date field.

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
  - Receipts: the shop's purchase mails (accepted offers count too) and cancellation mails, read by the private importer; cancelled IDs are never imported. Cost = the amount paid (item + shipping + fees, after coupons).
  - Duplicates: same ID + same data -> reported, skipped. Same ID + different data (price, item, date) -> the user chooses which is correct (existing entries change only on request, logged as an edit). No ID but a likely match (same listing or name, same price, dates within 3 days) -> the user confirms; "same" attaches the ID.
  - Summary and confirmation before writing. Existing entries are never removed (a cancelled ID that is registered is reported, not deleted).
  - Receipts carry no listing link. A receipt's item title is the listing title, so it is matched to a product already linked to a listing with that title; otherwise a product is created from the title (cards read like listing titles; sealed kind from 拡張パック…ボックス / 構築デッキ / 特別セット…; sealed product as shrink-wrapped unless the title says シュリンクなし) and matched to its listing on the next collect (confirmed under Matches). A product bought several times is created once. Listings SNKRDUNK renamed (e.g. 30周年 セレブレーション -> 30th CELEBRATION) map to the current title.
- Receipts do not state a card's grade or cert. Imported holdings are flagged `review_pending` (migration 0006); "Review import" in the app (`/imports`, portfolio banner) lists them one row per transaction: cards get a grade (raw S-D or grader + grade) and an optional cert number, sealed items shrink / no shrink. Save confirms filled-in rows; cards without a grade stay until graded or confirmed without one. "Card grades" (`/holdings/grades`) sets one grade on many ticked cards at once. Changes are logged as edits.
- Email parsing and sample emails live in the private collectors repo.

- Orders can be marked cancelled in the app ("Order cancelled" on a lot with an order ID, or the checkbox in Review import): all lots of that order are removed and the ID is kept in `cancelled_orders`, so imports skip it. The import flags lots for review with a reason (`holdings.review_reason`: a missed shipping deadline, no delivery mail); a reason the user already confirmed does not flag the lot again.

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

Backups, the person's own data, and spreadsheet import. `pnpm backup` writes a dated, compressed SQLite copy of the whole database after each night's collect (kept: the last 30 days and the first of each month for a year; `BACKUP_DIR`); `pnpm restore` loads one into an empty database only. Settings > Your data downloads the lots as a spreadsheet and the account's data as JSON, never collected sale prices; an empty account can load such a JSON file (S15). Imports > Spreadsheet adds lots from a CSV in that layout after a preview (rows already in Tora skipped; a loose match can be added anyway). Every import keeps each row's outcome (the import log).

Acceptance: scenario 8 (the lots spreadsheet rebuilds the collection without the app); the backup and restore test passes.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s6).

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
- Valuation loads yen prices only; `store` method: the newest shop asking price of the exact condition (30 days) when no source has a sale, before the retail price, low confidence.
- Item page: Japan vs US card (Japanese value of the condition TCGplayer quotes: the user's raw / sealed condition, else raw A / shrink-wrapped; a note for graded lots); suggestions open per source; 駿河屋 / TCGplayer links can be pasted for any item.
- Missing stable sources: `missingPriceSources` (cards and sealed TCG product without SNKRDUNK, other items over ¥3,000 without 駿河屋, lots under import review left out) in Imports > Needs you, a portfolio banner, Imports > Price sources to link (`/imports/sources`) and the MCP data checks. Pending matches are counted per source, so a Mercari search no longer hides a 駿河屋 suggestion.

Acceptance:
- At least one card and one non-card item show JP vs US side by side.

---

## S8: Visual redesign + wide-screen layout

Layouts and the screens built on them. Three sizes: phone (under 768 px, bottom bar), an icon rail (768-1279 px), a labelled sidebar (1280 px and up); wide pages use the full width, forms keep a reading width. Portfolio as Summary (chart, by kind, category tiles, a rotating insights card) and Items (category and kind chips, groups, cards). Per-lot switches "count in cost" and "count in value" (P/L only over lots in both). One Actions page with everything waiting for the person, solved in place, sorted and coloured by notice levels the person sets. Sources with roles per item type (reference, supporting, comparison, off) in the admin's order; a quality gate drops a supporting source to comparison when its sales differ from the reference's by over 15 % on 10 or more items; identity links are separate from price roles. Settings and Admin preferences as sub pages.

Acceptance: user review on phone and on a wide screen.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s8).

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

## S16: Make Tora work anywhere: categories, markets, languages, currency

The admin's choices, mostly made once at setup: the base currency (every amount stored in it; a later change converts each amount at its own day's rate) and the exchange rate of each other currency (a rate plug-in or a typed rate); the app's two languages, from the installed translation files; categories, kinds, fields and condition lists (TCG and games are built-in templates in the same format); markets (from the plug-ins' sources) and what item pages compare; the time zone (a change rewrites stored times). Collector run times are recorded and shown against the admin's night window.

Acceptance: a category made from scratch is valued; a third market shows everywhere; another base currency and language work end to end (S10 part C, Spain + Brazil).

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s16).

## S12: Documentation for others

Guides in `docs/` for a person, or their coding assistant, running their own Tora: clone and run, building collectors (the plug-in contract and a template), what makes a good identity page and price reference, setting up markets and roles, the commands. Brought up to date in S18.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s12).

## S10: Reliability, consistency, efficacy and function review

Added at the user's request (2026-10-13). A review of the whole app before buy timing builds on its data. Pain points are two-fold: reliability (the data is right) and usability (a clear path to reliable data).

- Concepts and requirements: is the app achieving what it intended to?
- Efficacy: is the app doing so in an efficient way?
- Challenges, risks, potential blockers
- Data: no duplicated data (sales stored twice across sources or runs, lots imported twice, products registered twice), each value uses the best data available (sources, windows, conditions), the numbers on every screen agree.
- Function: every flow from setup to daily use works and is practical (setup, adding and importing, matching, collecting, valuing, actions, review).
- Deep-dive review of every built phase (user, 2026-10-17: accepted in use without a thorough check): S8, S11, S12, S16, S6, S17, S9 and later ones, flow by flow against their chapters, with the user.
- A full setup in another market: rebuild the app from scratch for Spain as the main market and Brazil as the second (instead of Japan + US; decision log 2026-10-23), with the sources and roles system, and see whether a user would get reliable data and a clear path to it. Findings decide what the README and the setup flow need.


### Part A: data checks (2026-10-23)

On the analysis copy (2026-10-23 morning), read only. No lot imported twice (same-day lots of one item all have their own order IDs, or come from a split); no other item registered twice. Found and fixed (user: all four):

1. The nightly request cap starved held items: of 101 SNKRDUNK listings only 8 got that night's sales, 9 were 4 days old. The 17 ranking candidates (S13 part 3) were filling in their sales history (about 1,190 old sales each a night) and listings take turns by last success. Now collectors may declare `historyPhase`: every listing first gets its new sales, what is for sale and its last sale (`ctx.phase` `fresh`), items someone holds or watches before candidates, then the older history with the requests left (`history`); running out there is normal, not a partial run. SNKRDUNK declares it. docs/collectors.md.
2. One item twice: ブラッキーVMAX HR registered twice and both linked to one SNKRDUNK listing; a sale is stored once per site, so the held item had 15 sales and its empty twin 2,224. The look-alike check compared only the person's own items. Now it compares every item (shown when one is the person's), a new check lists listings linked to several items (MCP `shared_listings`), and picking or pasting a listing already linked to another item opens the merge page instead (with why). The user merges the pair in the app.
3. Dead links: SNKRDUNK pages answering 404, 駿河屋 items and TCGplayer products not found made three sources "partial" every night, hiding new failures. A listing reported gone (HTTP 404 / 410, or `ListingGoneError` from the plug-in; other errors never count) 3 nights in a row is set aside (`product_sources.failure`, migration 0055): no longer collected, the run is not partial for it, and its item gets an Actions card saying since when and why, until a new link is picked or pasted (linking resets it).
4. Small mismatches: the Portfolio total and the chart's point for today differed by about ¥20k (0.7 %): today's point counted a window up to the end of the day, the total one up to the collect; today's point is now valued as of the run. 4 PSA 10 sales stored twice on 2026-10-12 and 10-14 under SNKRDUNK's two sales lists (probably from merging two items that each had the listing): excluded by a one-off command on the server. Buy timing's listing in the zone: see S13 part 1's note.

### Part B: the deep dive (started 2026-10-24)

A copy of the analysis database with eBay rows, alert channels and devices removed, run in the test copy and crawled at both widths (71 pages, none with problems), screenshots read for numbers that disagree. Found and fixed (user):
1. The hourly retry kept asking a shop that answered 429 all day (a blocked source failed the run): a source blocked today is left until tomorrow.
2. The crawler crashed on an empty code element (split the page text into characters); it now shows amounts too.
3. Portfolio category tiles left out opened lots' cost, so their P/L summed ¥11k off the header's.
4. Price chart lines shared colours (three colours by position among all sources): the palette's eight colours.
5. Conditions shown as codes (sealed:shrink, cond:good) on item, lot, Buy timing, Opportunities and source pages: shown by name.
6. A corrected purchase date left the lot's Acquired history entry on the day it was entered (19 lots): it moves now; migration 0058 moves the old ones.
7. The Opportunities card's price (30-day median) read like the market value: labelled.
8. Small display: axis years, the P/L arrow wrapping on phones, the Top movers title cut, the 180-day position text.
9. Changing the base currency (S16) left amounts of tables added later in the old currency: watch targets, shops' asks, imported rows, the saved daily numbers (the sharp-drop alert would have compared old with new), buy plan budgets and data review evidence. Now converted too.
10. The backup read 2,000 rows per request from every table, the store post pictures too (up to 8 MB each): tables holding files are read 10 rows at a time.
11. The store directory's admin changes (stores added or removed, store codes, code meanings; S25) were missing from the Activity log: recorded now.
Chapters checked against the code (2026-10-24): S8, S11, S16, S6, S17, S9, S19, S22-S25, S20, S21, S13; what they say is built matches the code and its numbers, apart from fixes 9-11. D below.
Noted for later: Opportunities numbers come from the last collect while other pages are live, so they drift within a day.

### Part C: the Spain + Brazil setup (2026-10-23)

A clone of the public repo (no private plug-ins) with its own local database, set up in the order of docs/setup.md: admin account, base currency EUR, time zone Europe/Madrid, languages Spanish + English, plug-ins, primary market Europe (Cardmarket), secondary Brazil (a made-up plug-in copied from the template, "Mercado Cartas", answers made up in reais), five English cards and one PSA 10 added by hand, two collects. Every card found its Cardmarket and Mercado Cartas listing (scores 0.9 and 1.0); a duplicate item was caught by part A's merge-page check; values came out in euros from Cardmarket's price (low confidence on day one: one price a day reaches high after 5 days); the Brazilian sales were converted from reais with the ECB rate. Not checked: the pages (Claude's sandbox cannot run the app, see the last finding).

Built (user):
- Cardmarket prices through TCGdex (`collectors-public/src/tcgdex.ts`): free, keyless, MIT licensed, daily Cardmarket price guide in euros, single cards of the international prints (no sealed). Public and opt-in (`ENABLE_CARDMARKET=1`): loaded, a plug-in searches every item it supports each night. pokemontcg.io was the other candidate: deprecated (new keys closed).
- A daily market price can be a market's reference: a source declaring `priceKinds: ['market']` saves its daily price as one sale a day, valued like sales and labelled "daily market price" in Settings (before, such a price counted as an asking price, so a market with only that source got weak values, against what docs/sources.md said). TCGCSV still saves TCGplayer's as an asking price (fine for comparing).
- Spanish (`es.json`, 1,856 texts) drafted by Claude, not yet checked by a native speaker.

Found, to decide:
1. The Pokemon set catalog has Japanese sets only: English cards get their set typed by hand (the set code is what Cardmarket matching needs). TCGdex lists the English sets with their codes.
2. Card regions have no European print languages: a Spanish card is filed under "English".
3. A fresh install starts in JPY and Asia/Tokyo; the identity cost threshold (3000) is in the base currency's smallest unit and is not converted when the base changes (¥3,000 becomes €30); changing the time zone on a database with no items rewrote 103 times while the page says nothing is stored.
4. Every loaded plug-in searches and collects every item it supports, whatever markets the admin chose: TCGCSV searched the Spanish setup's cards for the US, a market nobody picked. The public package also registers Japanese shops (Amazon JP order IDs, Yodobashi, Bic Camera, Pokemon Center, Yahoo) and eBay's source without its keys.
5. The public repo's `.gitmodules` points `collectors/` at the owner's private repo, so the `git submodule add` in docs/collectors.md fails for a newcomer until `git rm collectors`.
6. Texts and examples assume Japan: the pulls hint (Japanese names), identity pages (SNKRDUNK, Mercari, Yahoo), the suggested-role note (Japan collectibles preset), set lines (Japanese set titles), the template's search price (yen only).
7. Two Tora installs on one machine share `~/.local/state/tora` (locks, time zone file, collect log).
8. A graded card has no value in a market whose reference prices ungraded cards only (Cardmarket); the secondary market's graded sales never count. As designed; docs/markets.md could say so.
9. Claude's sandbox cannot install packages in a clone (pnpm's store lock), nor run the app (Next.js refuses its compiler cache: the sandbox makes the parent folders look writable by others), nor fetch card images. So the planned page crawler would not run in Claude's sandbox either.

Two-category test (user, 2026-10-24: instead of more card checks, prove Tora works for anything): in the same test copy, the admin's categories Watches (wristwatch, pocket watch; brand, reference number, year, box and papers; condition unworn / excellent / very good / worn, the middle two pooled) and Vinyl records (LP, 7" single; artist, label, catalogue number, pressing year, country as a choice, first pressing; grades M / NM / VG+ / VG / G, VG+ and VG pooled), in Spanish and English. Three made-up plug-ins from the template: Tiempo (Europe, watches) and Surco (Europe, vinyl) as references and identity pages, Feira (Brazil, both). Each found its items by their own field (reference, catalogue number); TCGCSV and Cardmarket left them alone; values came out per custom condition (Caetano Veloso's Transa in NM: median of 5 sales, high confidence; the Omega in "excellent" had none and was valued from the pooled "very good" sales; the Longines in "worn" had none and stays unvalued, as designed). An item missing the field its plug-in matches on gets no suggestion and waits under Actions. Found:
10. A required custom field is only checked by the browser form: the server, the spreadsheet import and Claude's imports accept an item without it.
11. The lot spreadsheet (download and import) has no columns for custom fields, so a watch's reference or a record's catalogue number is lost in a round trip.
12. The built-in Region list (TCG print languages, game regions) cannot be extended in Settings, and the admin's own categories have none (a custom choice field works for people, not for plug-ins). To fix (user, 2026-10-24): each category's region list editable in Settings, built-in keys kept.

Fixed (2026-10-24, user: 1 and 3-12; 2 not needed, 9 is Claude's sandbox):
- 1: the Pokemon catalog has TCGdex's international sets (197, with printed codes); `pnpm catalog:fetch` keeps both.
- 3: a new install's admin gets an Actions card until the base currency and time zone are chosen (keeping the defaults stores them); the identity cost threshold defaults per base currency (¥3,000, else 20) and a typed one is converted with the base; the time zone's setup text says what it rewrites.
- 4: the collect gathers only the markets in use (primary and secondary, or all when item pages compare all; a market or source named on the command line still runs); Actions leaves out other markets' suggestions; eBay's source registers only with its keys; the Japanese shops moved to the private package.
- 5, 8: docs (replace the repo's `collectors/` entry before adding your own; graded cards need a source that prices them).
- 6: texts and the template no longer assume Japan.
- 7: `TORA_STATE_DIR` for a second install on one PC.
- 10: required fields are checked by the server (Add, item edit, spreadsheet import); purchase imports stay lenient.
- 11: the lot spreadsheet carries the admin's own fields both ways.
- 12: region lists per category in Settings > Categories (migration 0056 drops the fixed region checks; tested on a copy of the analysis database: counts and links unchanged); Claude's imports fall back to the category's first region.

Follow-ups (user, 2026-10-24):
- Set catalogs are plug-ins: the TCG set lists moved from the core (`packages/catalog`) to the public plug-in package (`collectors-public/catalog`, `catalogs` in a plug-in module); only the regions a set category lists are loaded (a watches-only setup loads none; the Spain test copy with English and Spanish prints kept 539 of 1,962 sets), and the collect loads them when they or the categories change (`pnpm catalog:sync` only to do it at once). Why (user): nothing particular to one setup in the core; a person tracking other things in Spain and Brazil needs no Pokemon sets.
- Pages gone: SNKRDUNK deleted the nine 30th CELEBRATION カードセット(御三家) pages (HTTP 404 from 2026-10-20). Part A's set-aside covers it (3 nights gone, an Actions card); now admins are told too: one alert after the run (item, site, error), a line in their morning summary while any wait, and the Actions card even for items they do not hold.

### Part D: risks and efficiency (2026-10-24)

Measured on the analysis copy (2026-10-23) and the server's status page.

Efficiency:
- Database: 271 MB for 180 items, 213 lots and 365k sales; the sales are 92 % of it (159 MB of rows, 88 MB of indexes, about 0.7 KB a sale; their raw JSON 35 MB). The compressed backup was 18 MB at 283k rows (2026-10-16).
- Growth: 10k-25k new sales a day this month, mostly older history filled in for new and ranked items; it should slow once histories are complete. At today's pace about 5 GB a year: nothing for a home server's disk, a limit for a hosted free database plan.
- Collect: about 65 minutes of collector time a night (SNKRDUNK about 29, Mercari 13, the rest under 6 each), well inside the 6-hour window. Closing steps and pages read little since S19 (about 16k rows a night, 1-3k a page).
- Gone pages: until a listing is set aside (3 nights), the hourly retries of a partial run ask for it again every hour (today 9 SNKRDUNK and 6 駿河屋 pages answering "gone", about 15 requests an hour). Fixed (user): a page that answered gone is asked again the next night only, and the retry is not partial over it.
- Development: requirements.md was 254 KB (roughly 70k tokens), mostly detail of finished phases; reading it whole was the largest fixed cost of a Claude session. Done (user): the ten longest finished chapters moved to docs/history.md, each leaving a short spec (153 KB now).

Risks (with what covers them today):
1. One site carries most values: 81 % of sales are SNKRDUNK's, the reference for cards and sealed. A block or a redesign stops most new prices. Covered: blocked sources are left alone for the day and reported, partial runs alert, values fall back to supporting sources by role, set-aside of gone pages. Not covered: no second reference with enough sales for cards (Mercari disagrees by about 15 % and stays comparison only).
2. A self-hosted install is one machine: the app, the database, the collect, the store feed browser and the daily "nothing ran" check. When the machine or its network is down, nothing can say so, since the check runs on it too. Backups are copied off the box by another computer when it is on; that computer's copy task now also tells when the server has not answered for a day (the owner's setup, private).
3. Unattended deploys: a push updates the server and runs its migrations (add-only rule, a failed update goes back). A migration that changes data (like 0058) runs with nobody watching; the nightly backup before it is the way back.
4. Internet exposure: the app is reachable from anywhere. Covered: password and authenticator, two devices per person, lockout, hashed tokens (feed, setup links, status), pictures behind sign-in, security releases followed through `.nvmrc` and the lockfile.
5. Cross-cutting lists: features added after a phase can miss that phase's lists. Part B found three (base currency amounts, backup paging, the audit log). Guard tests now (user): every `*_base` column is converted on a base change, every admin action writes to Activity (amounts inside JSON still need care).
6. Store feed: depends on a board's page and its access check, read by a userscript in a browser; a change there breaks it. Covered: silence and per-board alerts, the page-turn and stale-copy fixes (userscript 1.11, 1.12).
7. Data quality: listing matches on search sources (Mercari asks at 34-55 % of SNKRDUNK's are often other things: kept to the same site's asks), thin data (warned, never hidden), items registered twice (look-alike check, shared-listing check, merge).
8. Texts: Spanish and Japanese drafted by Claude, not checked by native speakers.

### The user's check (2026-10-24)

1. The Portfolio chart's last point was last night's while the header is worked out when the page opens (a sale dropping out of its 30-day window in between moved the two apart): today's point is summed from the header's values now. The chart's value still counts lots without a market price at cost, which its legend says.
2. Opportunities linked to item pages that answered "not found" for items the person neither holds nor watches: an item page opens for any item now (back link to Opportunities, the condition with the most sales as its main one, `?condition=` from the link honoured on Market and Buy timing).
3. Store codes from the store list could not be changed in the app, only added to: an admin edits every code of a store; the list's codes left out stay removed when it lists them again (migration 0060), and the chain's posts are matched again after a change (also when the list's own codes change).
4. Stores pages were hard to read (user: which posts belong to which store; sales rarely last, so where, how fresh and which store must show at a glance): tabs Now (the default: today's posts from 5:00 by location, an area and the stores within 1.5 km of it, one closed row each with the latest message's time, how long ago in colour (under 30 min, under 2 h, older), the count, the distance and the latest message, replies included; opened, each store's posts; posts naming no store Tora knows in a row of their own, so none is missed; yesterday's folded), By store (a chain's board as posted, or one of its stores), By location (a location's posts, those with posts since yesterday first, nearest first), All posts (the raw timeline), Area, Codes (what codes stand for; admins change each store's codes and add stores), Feed. Every post shows its codes spelled out. Item merges are logged in Activity.
5. Now: a row with several new messages looked the same as one with one until opened (user): each row shows how many messages came since the person last opened it, kept on the account so every device agrees; opening it clears the count.
6. Now: opened, the new messages were hard to find among replies (user): those new since the last opening are tinted for a moment (amber, fading out over 3 s; a plain edge mark with reduced motion), and replies holding one are unfolded. A row open when a message comes in stays open, takes the message as read and tints it as it appears.
7. Now while open (designed with the user): opening a row scrolls to its newest new message. A message for an open row closes it when the reader has left it (no scroll, tap or key for a minute; the count shows again, nothing missed); while they read, the row stays as it is and a banner at its top ("2 new messages: show") brings them in, tinted. While a row is open the others keep their order (rows new since then go on top); they catch up once all are closed.
8. Now: posts naming no store were one row (user: a post on a chain's board is known to be at that chain): two rows now, "Area not recognised" (a chain's board, one section per chain) and "Store and area not recognised" (boards mixing chains).
9. Now: a row's stores could not be folded and all opened (user): each store folds on its own and opens by itself only when it holds a new message (none new: the newest store); a tap on an open row's empty space (not on text, a link or a picture) folds what it is in (a store, a post's replies, or the row).

## S17: Notifications and activity log

Alerts outside the app on Telegram (one bot per install; each person connects with a one-time code) and Discord (a webhook link per person), stored encrypted: the collect or the backup failed (at once, to admins), nothing ran for over a day, and a daily summary per person (imports with rows left out, what waits on Actions); each kind can be switched off, in the person's language. Settings > Activity lists collects, backups, imports and every admin change, newest first; members see their own imports.

Acceptance: a failed collect reaches the admin within minutes; a server off for a day brings a "nothing ran" alert; an import with rows left out shows in the next summary; Activity shows each with links.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s17).

## S9: Watchlist and buy timing

Items a person does not own can be watched (a condition, an optional target) and are collected like owned ones. Each night saves what is for sale (lowest ask and listing count per source and condition) and each held or watched item's numbers for the day (fair value, 180 and 365-day quarters, trends over 2 / 4 / 12 weeks, sales, release age, the new-set pattern and the usual first-year low of similar items). Buy timing judges today's price by the person's strategy per item type (Steady, Bargain hunter, Margin, Catch the dip, Own target only; tried on fixed examples before choosing): Good price, Falling: wait, New release: wait, Fair or High, with its reasons and limited-data warnings, never advice. Alerts go out at once when a watched item enters its zone or an ask goes under the target; sharp drops go in the daily summary.

Acceptance: a watched item not owned shows its history, where today's price sits, a buy zone with reasons, and a target that triggers an alert.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s9).

## S13: Buy suggestions

Opportunities within an item type: signals on every tracked item and ranked candidate (its line rising or falling, leader or laggard in its line, sales up or down, strong or weak for its age), each tested per group of similar items on the past and again after every collect; a signal ranks items only when proven (a higher price 90 days later at least 5 points more often than on any day, over 10 or more checks). Ranking plug-ins (e.g. a site's sealed-box ranking) bring candidates, collected while in the top 30. Budget and date: Tora suggests when and at what price to buy each ticked item and checks the plan against the budget. Never advice.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s13).

## S14: Speed at any size

Added at the user's request (2026-10-14): the app feels sluggish again. Make it fast now and keep it fast as data grows: more items, users, markets and sources, without dropping below common UX thresholds.

Where we are (production, 2026-10-14): 2 users, 96 items, 139 lots, 350 linked sources, 178,681 price rows (one box alone has ~9,000 SNKRDUNK sales), 61,738 daily value rows. S8 already moved the valuation to saved `bucket_values` (2,100 ms -> 25-100 ms); the rest of each page was never measured.

Targets (phone on 4G and a PC; warm means the database has answered in the last minutes, cold means Turso wakes up):
- A tap or click shows a reaction within 100 ms (pressed state, loading placeholder), and nothing freezes the screen (INP under 200 ms).
- A page's main content is shown within 1 s warm and 2.5 s cold (LCP under 2.5 s); slower cards (charts, notices) stream in after, without moving the page (CLS under 0.1).
- A save (edit, role, toggle) answers within 300 ms; heavy follow-ups (rebuilding values) run after the answer, as today.
- The nightly collect finishes within its window as sources and items grow.

Steps:
1. Measure first. Time every main page (Portfolio, Items, an item, a lot, Actions, Imports, Settings) warm and cold, server and browser: database round trips and their time per request, bytes of HTML and JavaScript sent, Web Vitals. A script (`pnpm perf`) repeats it and writes a baseline table into this chapter.
2. Data at scale: a generator (`pnpm stress-data <size>`) fills a local or test database (never production) with realistic data in three sizes, then the same measurements run on each:
   - today: as production;
   - medium: 5 users, 1,000 items, 2,000 lots, 1 million price rows, 2 markets, 6 sources, a year of daily values;
   - large: 20 users, 5,000 items, 10,000 lots, 5 million price rows, 3 markets (Japan, US, one more), 10 sources, two years of daily values.
3. Fix the slowest first, each change measured before and after. Suspects to check (not decided until measured):
   - Every page sends all texts of the app (about 43 KB per language) to the browser; send each page only its own.
   - Shared reads (source registry, markets, FX) are cached only 5 s per connection; nothing is cached across requests. Cache with tags cleared by the writes that change them.
   - Daily value rows grow per lot per day (10,000 lots x 2 years = 7 million rows): chart totals per user per day instead of per lot.
   - Pages that read all of an item's sales (price sources card, charts): read summaries, page the lists.
   - The Actions page and the nav badge work out every notice on each load: save the counts when the data changes.
   - Repeated queries per row (one per lot or item) and missing indexes: check the slow queries' plans.
   - Long lists (Items, Actions, observations): page or load as you scroll.
   - Client JavaScript size per page, image sizes, and the distance between the Vercel and Turso regions.
   - A role or market change clears every saved value and rebuilds them (about 10 s today); at large size, rebuild only what changed.
   - Collector writes: batch inserts and per-source timings at large size.
4. Guard: `pnpm perf` runs before each release; a page more than 30 % slower than the baseline, or over a target, is reported.

Progress:
- 2026-10-24, step 1's tool: `pnpm perf` (scripts/perf.mjs; sign-in shared with the crawler in scripts/session.mjs) opens Portfolio, Items, an item, a lot, Actions, Imports, Opportunities, Watchlist, Stores and Settings at phone width (Chrome's Fast 4G, a 4x slower CPU) and wide width, once with an empty browser cache ("first") and then 3 more times ("warm", the median), and prints when the HTML finished streaming, LCP, CLS, HTML and JavaScript sizes, and database round trips and their time per page (counted when the server runs with `TORA_PERF=1`, read from `/api/perf`). `--out` saves a run; `--baseline` marks pages over 30 % slower (step 4's guard); a page over a target fails the run. Tora is self-hosted since this chapter was written: "cold" now means an empty browser cache, not the hosted database waking up.
- Baseline (2026-10-24, production build on the WSL PC, a copy of the owner's data: 2 users, about 170 items; over localhost, so without the network to the server). Every page within the targets at today's size; the database time is summed over queries run side by side, so it can exceed the HTML time.

| Page | Width | HTML ms (first / warm) | LCP ms (first / warm) | HTML KB | JS KB | DB trips | DB ms |
|---|---|---|---|---|---|---|---|
| Portfolio | phone | 203 / 189 | 784 / 776 | 75 | 227 | 89 | 85 |
| Portfolio | wide | 127 / 117 | 228 / 516 | 75 | 227 | 89 | 83 |
| Items | phone | 136 / 137 | 888 / 876 | 70 | 173 | 66 | 150 |
| Items | wide | 91 / 81 | 536 / 248 | 70 | 173 | 126 | 160 |
| Item | phone | 110 / 109 | 668 / 676 | 49 | 228 | 31 | 41 |
| Item | wide | 45 / 45 | 412 / 416 | 49 | 228 | 31 | 42 |
| Lot | phone | 114 / 108 | 700 / 648 | 47 | 176 | 24 | 45 |
| Lot | wide | 48 / 45 | 420 / 420 | 47 | 176 | 24 | 37 |
| Actions | phone | 112 / 111 | 692 / 688 | 51 | 180 | 51 | 162 |
| Actions | wide | 48 / 43 | 408 / 412 | 51 | 180 | 51 | 145 |
| Imports | phone | 110 / 112 | 688 / 648 | 50 | 177 | 18 | 32 |
| Imports | wide | 44 / 36 | 396 / 396 | 50 | 177 | 18 | 32 |
| Opportunities | phone | 123 / 120 | 768 / 732 | 61 | 176 | 36 | 43 |
| Opportunities | wide | 61 / 57 | 456 / 436 | 61 | 176 | 48 | 47 |
| Watchlist | phone | 105 / 107 | 640 / 668 | 44 | 172 | 23 | 33 |
| Watchlist | wide | 37 / 37 | 388 / 408 | 44 | 172 | 23 | 33 |
| Stores | phone | 105 / 104 | 556 / 648 | 42 | 176 | 25 | 42 |
| Stores | wide | 36 / 38 | 380 / 392 | 42 | 176 | 25 | 40 |
| Settings | phone | 107 / 107 | 640 / 632 | 46 | 175 | 16 | 29 |
| Settings | wide | 40 / 32 | 384 / 376 | 46 | 175 | 16 | 28 |

  CLS 0.00 everywhere. Most round trips: Portfolio 89, Items 66 to 126, Actions 51; these are where growth will show first (step 2).
- 2026-10-24, step 2: `pnpm stress-data <medium|large> --out <new.db> [--from <db>]` copies a local database (never a hosted one) and grows it: items cloned with their sources and sales (prices shifted per copy), lots cloned onto them, members added, and for large a third market (a made-up euro source with its sales and rates); the person with the most lots keeps 40 % of the new ones. Made from the owner's data copy: medium (5 users, 1,000 items, 2,000 lots, 1.03 million prices) and large (20 users, 5,000 items, 10,000 lots, 5.48 million prices; 4,100 lots and 1,680 items for the owner). A full `pnpm rebuild`: 3 min 12 s on medium, 18 min 22 s on large.
- 2026-10-24, step 3 (each measured before and after; `pnpm perf --sql N` lists each page's costliest statements, and the LCP candidates are printed per page). Found and fixed:
  - The nav badge works out every notice on each page: it read every owned item whole and every listing twice. Now only what the identity check needs, whole items only for cards, listings once; two indexes (migration 0062) for listings set aside and for listing pictures. Every page 10 to 20 ms faster on medium, about 50 ms on large.
  - Portfolio's movers parsed every lot's value history (25 KB of JSON per lot) to compare five days. The nightly snapshot now saves those days' values per person (migration 0063); before its first run, only those days are read out of the histories. Medium: Portfolio HTML 426 -> 225 ms wide.
  - The nightly snapshot ran out of memory on large (4 GB): it kept every item's daily values and loaded every saved history at once. It now keeps one item at a time and compares saved histories 500 lots at a time: 6 min 21 s on large, same values (checked on medium: nothing to rewrite).
  - Items drew every item card with the page (2,000 on large: 3.6 s before the list showed on a phone). It now draws 60 cards and more as the end of the list comes near (the user's choice); the group headers' counts and values stay for the whole list. The default view reads the lots once (it read them twice).
  - Valuation read lots joined to their items (each item's columns once per lot): read apart.

  Large, warm (HTML / LCP ms), before -> after:

| Page | Phone | Wide |
|---|---|---|
| Portfolio | 933 / 1,432 -> 607 / 1,180 | 821 / 1,204 -> 557 / 952 |
| Items | 1,322 / 3,632 -> 466 / 1,044 | 980 / 1,744 -> 364 / 780 |
| Opportunities | 911 / 840 -> 796 / 720 | 817 / 1,364 -> 602 / 1,112 |
| Actions | 380 / 500 -> 279 / 396 | 263 / 744 -> 193 / 664 |
| Other pages | about 200 / 750 -> 155 / 680 | about 145 / 500 -> 120 / 480 |

  Still over the 1 s warm LCP on large: Portfolio on a phone, Items on a phone (just), Opportunities on a PC (714 items listed on large, all drawn with the page; 9 on the owner's data).
- 2026-10-25, step 3 continued (user: fix all three): Opportunities loads as you scroll like Items (714 items on large); saved market movers keep the 3 up and 3 down per period a panel shows (5.2 MB read on every Portfolio visit -> 16 KB) and trade counts read only the items a panel shows; the Portfolio chart comes with the page (a saved series, quick to read). The page skeleton held every first paint back about 350 ms (React reveals a streamed page in timed batches): removed, the tapped menu link shows a loading mark instead (user's choice).
- After (2026-10-25, warm HTML / LCP ms; the same machine and copies as the baseline). Every page within the targets on both; CLS 0.02 at most.

| Page | Owner data, phone | Owner data, wide | Large, phone | Large, wide |
|---|---|---|---|---|
| Portfolio | 147 / 300 | 85 / 140 | 491 / 628 | 397 / 452 |
| Items | 119 / 400 | 49 / 200 | 468 / 692 | 374 / 520 |
| Item | 110 / 288 | 45 / 120 | 162 / 340 | 144 / 204 |
| Lot | 109 / 296 | 34 / 96 | 179 / 384 | 118 / 184 |
| Actions | 111 / 308 | 37 / 96 | 281 / 768 | 196 / 316 |
| Imports | 112 / 284 | 33 / 96 | 160 / 328 | 114 / 168 |
| Opportunities | 118 / 384 | 49 / 136 | 455 / 980 | 384 / 512 |
| Watchlist | 105 / 288 | 39 / 96 | 157 / 332 | 141 / 192 |
| Stores | 103 / 264 | 35 / 88 | 161 / 312 | 116 / 160 |
| Settings | 107 / 276 | 42 / 92 | 161 / 312 | 114 / 156 |

  Not measured by `pnpm perf`: INP and the save times (step 1's other targets), and cold starts on the server; for S15 and the user's check.

Acceptance:
- Targets met on production and on the large dataset; the baseline and after tables recorded here.
- User check on phone and PC: it feels fast.

## S15: Stress test and bug hunting

Added at the user's request (2026-10-14): try every edge case we can think of that could break the app fully or partially, and fix what breaks. S10 reviews whether the app works as designed in normal use (including a France + China setup); S15 tries to break it on purpose. It reuses S14's data generator.

Also (user, 2026-10-17): load an account download (S6's JSON) into an empty account and check every item, lot, event and watch came back.

Rules:
- Never on production: runs use local or test databases; production only gets read-only checks (the MCP data checks).
- Every bug found gets a test that fails first, then the fix. Bugs are logged in a table in this chapter: what, how found, severity, commit.
- Severity: 1 wrong or lost data (values, costs, lots) or another user's data shown; 2 crash or blocked flow; 3 wrong display (raw text keys, overflow, wrong number formatting); 4 cosmetic. 1 and 2 are fixed in S15; 3 and 4 fixed or moved to Open issues with the user.

Automated checks (kept and run before each release, one command `pnpm check:all`; the crawler is built first, before S10 part B, decision log 2026-10-23):
- A crawler (Playwright, demo data, phone, half-screen and wide widths, light and dark): opens every page and link, and fails on a server error, a console error, a raw message key (like today's `actions.cancelOrderConfirm`), text missing in Japanese, or the page scrolling sideways.
- The message scan: every text the code asks for exists in English and Japanese.
- Rules that must always hold, tried on thousands of random cases (property-based tests): splitting or partly selling a lot keeps the total cost; the costs of an order's lots add up to what was paid; values never use excluded sales; FX conversion back and forth stays within rounding; a market change rebuilds the same values as a full valuation.
- Every server action called directly with bad or missing input, as a logged-out user, as a member on admin actions, and as user A on user B's lots, items and imports.
- Load: many users at once on the large dataset (requests per second, errors, slowest times), and a collect running while users edit.
- Collector faults: saved pages with broken HTML, timeouts, 403s, rate limits, a source's site changed; the run reports partial and keeps what it got.

Edge cases to try by hand or by script:
- Input: empty and very long names, emoji, full-width digits and spaces, mixed scripts, HTML or SQL in names and notes, zero, negative, decimal and huge quantities and prices, dates in the future or long ago, around midnight in Tokyo and UTC, daylight saving time for other markets' sources.
- Items and lots: no sales, one sale, all sales excluded, outliers only; an item with no source; selling more than held; splitting down to zero; pulls from a box that is then deleted; cancelling an order with some lots already sold or split; grading sent and never returned; merging look-alike items that both have lots.
- Markets and sources: switching the primary market back and forth; a market with no reference source; a plug-in removed or renamed; a source with no market or currency; a day with no FX rate; a currency with no FX at all.
- Imports: the same file twice, a huge file, wrong formats, screenshots that are not receipts, an order that changes after import.
- Accounts: an expired session, a revoked device, a third device, lockout after failed logins, a reused 2FA code, two tabs editing the same lot, double submits, going offline mid-save.
- Layout: 320 px to 2560 px wide, browser zoom at 200 %, very long numbers and names, dark mode.
- Database: Turso slow, down or timing out; a page should say so instead of breaking.

Acceptance:
- `pnpm check:all` passes, and `pnpm crawl --views all` on a test install; no severity 1 or 2 bug left open; the bug log and what is left for Open issues reviewed with the user.

### Progress

1. Server actions called by the wrong person (2026-10-25): `apps/web/src/app/actions-access.test.ts` calls every server action (sign-in and setup aside) as a member with every id of another person's data, learning each form from the fields it names back. It fails when the other person's rows change or are deleted, when a new row points at their private rows, or when their text comes back; a member's admin calls may add nothing, and a signed-out caller is only sent to sign in or refused before anything is read. As a control the owner, calling the same way, changes data through 39 actions; the others take inputs too specific to guess and were read by hand (each signs in, then checks ownership in its database function, the item's holders, or the admin role). Nothing found. The web tests now load the app's `@/` paths (`apps/web/vitest.config.ts`).
2. Rules on random cases (2026-10-25, fast-check; `packages/core/src/properties.test.ts`, `packages/db/src/properties.test.ts`): a split keeps the units and the cost; random chains of splits, sales, grading (fees added) and condition changes keep every unit and yen across the lots; excluded sales never move a value; an amount converted there and back stays within one rounding each way; the saved sales updated step by step (new sales, exclusions, refreshes) equal a full rebuild. Nothing found (the update lists an item's groups in arrival order, a rebuild by source; nothing reads them in order). The order rule does not apply: imports take each item's own price, nothing spreads an order's total over its lots.
3. The account download loaded into an empty account (2026-10-25): built first (decision log), then `packages/db/src/account-data.test.ts` downloads an account with lots, splits, a sale, grading, pulls from an opened box, a manual price, a watch, an import and a listing, loads it into an empty account on the same install and on a new one, and compares the downloads (ids aside): everything came back; files from elsewhere, of another version or base currency, and accounts with data are refused. On the owner's data copy: 172 lots in 61 ms, cost and value the same; the large copy's biggest account into a new install: 4,219 lots, 5,414 history entries in 1.4 s.
4. Load (2026-10-25, `pnpm perf --load <people> [--seconds 60]` from a test install, `scripts/load.mjs`): signs in that many accounts on the install's local copy (a device each, the session signed as a sign-in would) and has each open its pages one after another with no pause, then prints pages a second, failures and median / p95 / slowest per page. On the large copy, production build on the dev PC:
   - 2 people: about 5 pages a second, medians 110-360 ms.
   - 10 people: about 13 pages a second, medians 650-1,050 ms, slowest 1.6 s, nothing failed.
   - 20 people: about 10 pages a second, medians 1.3-2.1 s, slowest 10.7 s; the one Node process is the limit (a household opening a page every few seconds is far below it).
   - While writing: the nightly snapshot, a full rewrite of every item's saved sales (45 s) and an edit saved every 2 s, with 10 people browsing: no page or save failed, saves at most 0.65 s; pages stayed as fast except while all saved values were cleared and refilled (slowest 9-10 s, bug 1). WAL journal mode tried on the copy: no change (the waits were not locks), so the database keeps its default.
   - One request in about 5,000 had its connection reset by the test's client (nothing in the server's log): an idle kept-alive connection closed as it was reused, which browsers retry on their own.
5. Collector faults (2026-10-25): the framework's tests already covered server errors retried with backoff, 403 / 429 and challenge pages stopping the run at once (blocked), the request cap, one item failing (the run partial, the rest kept), a run interrupted and continued, and a listing set aside only after an explicit "gone" (404 / 410 or the plug-in saying so) 3 nights in a row, so a changed site never unlinks listings. Added: a site that takes the connection and never answers (bug 2). Not covered by a check: a changed site whose page still parses but yields nothing looks like a quiet night (Open issues).
6. Edge cases (2026-10-25, `packages/db/src/edge-cases.test.ts` and earlier tests):
   - Markets: switching the primary market away and back gives the same values, totals and chart; a primary market no source belongs to, and sales of a plug-in no longer installed, value nothing without failing (pages name an unknown source by its key); a currency with no rate is not converted (the collect says which), a base currency change needs today's rate.
   - Accounts: a third device refused, a revoked device's session gone and its slot free, another person cannot revoke yours; replayed 2FA codes, expired or tampered sessions and lockouts were already tested; every form's button waits while it saves (double submits).
   - Items and lots: merges move lots, keep one watch per condition and one link per listing; cancelling an order with pulls taken from it is refused; selling or splitting more than a lot has is refused (the property tests).
   - A failed page (database or server not answering, a save cut off) showed the framework's English error screen with no way back (bug 3).
   - Typed input (`edge-cases.test.ts`, `apps/web/src/lib/form.test.ts`): names and notes with markup, quotes, SQL, LIKE wildcards, emoji and 1,000 characters are kept as typed and found by search as plain text (pages escape them; no page writes raw HTML from data); quantities refuse 0, negatives, decimals and over 100,000, and now take full-width digits ("３"); amounts refuse negatives, over 10^11 and unreadable text; the import review's date can no longer be set in the future (the other date fields already stopped at today). A search for "mega" missed a name typed in full-width letters (bug 4).
   - Imports: an order cancelled after import is reported, never removed, and skipped on the next import (already tested); the same file twice adds nothing (already tested). A sheet saved by Excel in Spanish and other languages (semicolons), as "Unicode text" (UTF-16, tabs) or copied cells (tabs) was refused as having no column names; the first row's separator is now used. A binary file named .csv finds no columns and is refused. A 5,000-row sheet (the limit, 1.2 MB) took 211 s to import and 370 s to preview again (bug 5); now 21 s and 0.4 s.
7. Layout (2026-10-25, `pnpm crawl --views all`): besides phone and wide, the crawler opens each page at 320 px, a 768 px tablet, 2560 px, 200 % zoom (a 1280 px window lays out like 640 px) and dark mode, and now also fails on text below WCAG AA contrast with its background (4.5:1, 3:1 when large; disabled controls and previews drawn in another app's colors left out) and names text that runs out of its box. First run on the Spanish test copy: 12 of 64 pages with problems (bugs 6 and 7); after the fixes none at any of the 7 views.
8. `pnpm check:all` (2026-10-25): typecheck, lint, format check and tests in one command. The crawler and load runs need a running test install, so they stay separate (`pnpm crawl --views all`, `pnpm perf --load`). Lint had three old errors (two unused values, a state set straight from an effect) and read the local test installs; both fixed.

### Bug log

| # | What | How found | Severity | Commit |
|---|---|---|---|---|
| 1 | After an admin changed markets, source order, base currency or categories (and after a collect that changed a source's quality), every saved value was cleared and refilled only after the snapshots (6 min on large): meanwhile every page worked values out from the sales (9-10 s under load). Values are now refilled first (as the time zone change did); the window is the refill (22 s on large, about 1 s on the owner's data). | Load run while writing | 3 | 1310eee |
| 2 | A site that took the connection and never answered held each request for Node's default (about 5 minutes), with no retry: a collect, and its lock (the server's updates wait for it), could run for hours. Requests now give up after 30 s, are tried again like a server error, then fail that item. | Collector faults | 2 | a49f1af |
| 3 | No error pages: a database or server that did not answer, or a save cut off (offline), showed the framework's "Application error" screen in English, with no way back but reloading. Now a page says so in the person's language with Try again and a way home (the menu stays); if even the app's frame fails, a short page in the browser's language (English, Japanese, Spanish). | Edge cases (database down, offline) | 3 | 6ac242e |
| 4 | A search for "mega" did not find a name typed in full-width letters ("ＭＥＧＡ", common in Japanese input): the database lowercases plain letters only and the stored name is kept as typed. The search now also tries each term's full-width forms. | Input edge-case test | 4 | 6a321b3 |
| 5 | A sheet import looked each new row's item up by reading every item of that kind (and card number), so time grew with the square of the rows: 5,000 rows took 211 s to import and 370 s to preview a second time, past the browser's patience. Each group of items is now read once per file and found by name. | 5,000-row sheet test | 3 | fdbbeb3 |
| 6 | At 320 px the page scrolled sideways: the portfolio summary's amounts did not fit two tiles side by side, and two long Spanish buttons did not wrap. The bottom bar's longer labels ("Seguimiento", "ポートフォリオ") overlapped their neighbours on every phone. Now the tiles stack below 360 px, the buttons wrap, and the bar has short labels and cuts what still does not fit. | Crawler at 320 px | 3 | (this commit) |
| 7 | Text below the readable contrast: the selected reference tab on an item's details (3.7:1), red buttons in dark mode (2.9:1), the missing-backup warning (4.4:1). | Crawler's contrast check | 4 | (this commit) |

---

## S19: Database reads within the free plan

A hosted install stays well inside a free database plan: nightly steps and pages read packed rows per item and per lot (`item_sales`, `holding_values`, saved charts) instead of every sale; a nightly self-check compares a few items with their raw sales; rows read are counted per day and origin (Settings > Admin > Database) with an alert past the admin's budget; heavy analysis runs on a backup copy, never on the live database. Measured: about a tenth of the free plan at one user, under half at 10 users.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s19).

## S22: Item page as sub pages

Decided 2026-10-18 (user): the item page shows too much at once. One header on every sub page (picture, name, line and release, value and P/L), then Market / Buy timing / Lots & details, each its own address (`/products/[id]`, `/products/[id]/buy`, `/products/[id]/details`), each loading only its own data; the Watchlist and alerts open Buy timing directly.
- Market (default): the price history chart, large; key numbers (market value, sales in 30 days, 4 and 12 week change, 180-day range); Japan vs US.
- Buy timing: the verdict first (zone, strategy and Change, the new-release wait, falling, limited data); the price history with the buy zone band, the 180-day quarters and the lowest ask; the reasons in three groups (where it sits; trend and market; new release and pattern, each saying line or all); for sale now against the zone, and the person's watches and targets; S9 part 5's rule test card goes here; not advice.
- Lots & details: the lots with P/L, item details, edit and merge, the price sources setup.

Built 2026-10-18:
- Routes in a route group (`products/[id]/(item)/`) so the header layout stays off the edit and merge pages. The header shows units, market value and P/L (not held: the market value); any item has a page, also one the person neither holds nor watches (S10 check); the item's kind, franchise and set moved to Lots & details.
- `item-data.ts`: the item, lots, watches and main condition, the signal and the lot values, each cached per request, so the layout and the page read them once; moving between sub pages re-renders only the page.
- Market: five key numbers in the main condition (market value, sales in 30 days, 4 and 12 week change, 180-day range = lower to upper quarter of daily prices), the price history (taller), Japan vs US.
- Buy timing: condition chips when the person watches or owns more than one condition (`?condition=`, the Watchlist links with the watched one); the verdict card; the chart with the buy zone shaded under its top, the 180-day quarters dotted and the lowest ask dashed (the scale stretches to show them); the reasons in three groups, the third saying the release age, when similar items bottom out (or the 90 days used) and the pattern; for sale now with "in the buy zone" or "N % above" on the condition's lowest ask; watches and "Bought it"; a marked place for S9 part 5's rule test card; not advice.
- Lots & details: the lots with P/L and the total spent, an item details list with "Edit or merge", the price sources (links to `#sources` now open `/products/[id]/details#sources`).

## S23: Pokemon Center Online purchase import

Built 2026-10-18 as a private importer plug-in (`pnpm purchases <file.mbox> --user <name> --source pokemoncenter`): order and payment mails through Review import; 0-yen bonuses imported at 0 cost with a note; several items of one order are lots keyed `<order>#n`; sets traded one by one split into their parts (the importer's list); a shared product of the same loose name is reused across importers. The mail layouts are in the private notes.

## S24: Japanese TCG shops as sources

Decided 2026-10-18 (user): more Japanese TCG shops to compare prices: magi, Card Rush, 遊々亭, カードラボ (suggested earlier), also 晴れる屋2, トレカキャンプ, ドラゴンスター, カーナベル; for sealed retail prices Pokemon Center Online, Amazon, 楽天. Each is a collector plugin in the private collectors repo (its own search and page reading). They bring asks and stock (for sale now), 買取 as buy prices (already a type in the packed sales), and, for shops with a page per card, identity links. Reads and writes measured per shop with the meter (estimate: about 7k rows written a day at 10 users with 8 shops). Which shops first: with the user.

### Built (2026-10-19)

Three shop collectors in the private plug-ins (their search, page reading and rules in the private notes); no app change: everything reads the source registry. Shop stock is raw A; a sold-out card's last price is not an ask.

## S20: Box opening value

For a booster box: the break-even box price from pull rates (per set: the admin's, else a plug-in's suggestion, with its source) and its hit cards' prices after the selling fee; the spread from simulated boxes (the share paying back the box price, the median box); the cards carrying the value; the sealed premium (box price against contents). Hit cards are read weekly per set by a set-card plug-in. Item page > Opening and Watchlist > Box opening.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s20).

## S25: Store notices

Posts on community boards about cards on sale in physical stores, pushed by a feed (e.g. a userscript in the person's own browser) to `POST /api/feed/posts` with a personal token, are matched to stores by the codes and names posters use (store directory plug-ins, admins' additions, places), and sent on Discord or Telegram to the people whose area holds the store (picked stores or a distance; travel mode): one notice per store every 30 minutes, replies at once, pictures after the text (kept a week). The feed itself is watched: silence, boards giving nothing, unknown stores, a page turned over. Stores pages: Posts, Feed, Area.

The full chapter (design, what was built and how it was checked): [docs/history.md](docs/history.md#s25).

## S21: Admin account tasks in the app

From Open issues (user, 2026-10-14; planned 2026-10-17). Admin preferences so the admin does not need the terminal for everyday account tasks: creating a user (with the authenticator enrollment shown in the app), resetting a password or 2FA, listing and revoking devices, disabling an account (today `pnpm user ...`). Anything that scrapes, like `pnpm collect`, stays on the home PC (the app could queue a run or show its status). Each task is confirmed and lands in S17's Activity log.

### Built (2026-10-20)

- Settings > Admin > Accounts: every account with its role, state (disabled, not set up, a link waiting until when) and devices. A new account (username, admin or not) is made without credentials, with a one-time setup link (`account_setups`, migration 0050: only the token's hash kept, 24 hours, a new link stops the old one, stoppable). Per account: a new password link, a new authenticator link, a full reset link; disable or enable (never one's own); sign a device out. The link and backup codes are shown once.
- The setup page (`/login/setup/<token>`, no sign-in needed): a new password (12+ characters) and/or a new authenticator (QR code and key, the same on every visit of the link, confirmed with a code); a new password asks for the current authenticator code or a backup code, a new authenticator for the current password, a full reset for neither. Saving signs every device out and shows new backup codes. Failures count toward the login lockout.
- The admin's own authenticator code before creating, resetting, disabling and enabling (each code once; failures count toward the lockout); signing out devices and stopping a link ask only for a confirmation. All in the activity log (link made, stopped, used; collect requested).
- Collect now (Settings > Collectors, admins): a request the home PC takes on its hourly check (`pnpm collect:request` in `scripts/collect-cron.sh`, which now runs every hour around the clock: re-run `scripts/install-windows-task.sh` once); the page shows it waiting, then when the home PC started it.
- `pnpm user` still works from the terminal (the first account is made there).

## S18: Documentation pass

The last phase (user, 2026-10-16): nothing to build, so it comes after everything else. Each phase keeps its guide current as it goes; this pass reads `docs/` and the README from start to finish against the app as it is then (S17, S9, S13, S10's France + China setup, S14, S15 all change what a newcomer sees), fixes what drifted, fills gaps, and checks every command and link. To consider then: the Japanese documentation for the portfolio (Open issues).

## Open issues (to plan later)

Logged at the user's request (2026-10-13): known gaps to come back to with a plan of their own. Not scheduled yet.

- Japanese documentation for the portfolio (user, 2026-10-15): Tora is also part of the user's personal portfolio, so some documentation in Japanese is wanted, without keeping every guide in two languages. To decide: what form (e.g. one Japanese overview of the project and its design, or the README's introduction) and how it stays current.
- Setup path for other people (user, 2026-10-13): today the public repo has the app, the framework, every command (`pnpm collect`, `import-ai`, `import-uploads`, `demo`, `valuate`...) and the public plug-ins (TCGplayer via TCGCSV, eBay API, exchange rates); the scrapers for SNKRDUNK, Mercari, 駿河屋 and Yahoo Auctions are private (`collectors/`). Collecting needs a machine with a residential IP running `pnpm collect` daily. Accounts on an existing deployment need nothing (the owner's PC collects for every account); someone wanting their own deployment needs Vercel + Turso + a PC running collectors with their own source plug-ins, which only a developer can do. Options to weigh in S10: a packaged collector app (installer / tray app running the daily collect and uploads on a home PC, no repo), API-only sources run by a scheduled job in the cloud (no residential IP needed, e.g. TCGCSV, eBay), a hosted multi-account deployment where people just sign up (the owner collects for all; terms and load to consider), a guided setup in the app.
  - Direction chosen by the user (2026-10-13): documentation first, now chapter S12. The repo ships no scrapers for others; it ships a complete guide to building a collector (what data it must return: listings, candidates and scores, sales and asking prices with buckets, currencies and times, searches and their state; how it describes itself: roles, links, aliases) and to connecting it (package layout, `pnpm collect`, scheduling, the database, Vercel), plus a template plug-in, clear enough for a user (or their coding assistant) to write their own collector for the shops they use. Others' collectors are their responsibility.

- Git history rewrite (user, 2026-10-23): moving personal files out does not remove them from the public history (nor the board codes leaked earlier); rewrite it once, close to the finish line (needs a force-push and a fresh clone on the server).

### Need further analysis

The user does not know yet what to do with these (2026-10-17): analyse before any plan.

- Partial items: the user owns only part of an item, but the item's price sources track the whole package. Example: ゼルダの伝説 ムジュラの仮面 (N64), cartridge only (箱・説明書なし), valued as a complete boxed copy, so the value is clearly too high. Editing the item by hand to "cartridge only" is easy; the hard part is recognising a partial item during the import (Mercari / 駿河屋 / SNKRDUNK titles and receipts: ソフトのみ, 箱なし, 箱説なし, 本体のみ, カードのみ...) without AI interpretation, and then matching and valuing it as that partial item (its own product or a "completeness" attribute of the lot, with buckets / search words to match, e.g. 駿河屋 lists 箱説なし copies separately). To decide: product vs lot attribute, which words mark completeness per category, how the import review shows it.
- Bundles: one purchase of several items in one listing (see "Mixed bundles" below for the idea so far). Needs a plan: how an import recognises a bundle, splitting into one lot per item, how the cost is divided, and what happens to the items' price sources.

### Optional features

- A source gone quiet (S15, 2026-10-25): a site that changed so its pages still load but yield nothing looks like a night with no sales; nothing tells the admin. Idea: after a few nights in which a source brought nothing from any of its listings while it usually does, an admin notice ("the site may have changed").
- Automatic purchase import from Gmail (from S6, user 2026-10-16): the daily job on the home PC checks Gmail for new SNKRDUNK receipts (and cancellations) and imports them with the S5b rules. Needs a read-only Gmail token kept on the home PC only; until then, a Google Takeout export and `pnpm purchases` do it.

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
