<a id="top"></a>

# Build history

The full chapters of finished phases, moved out of [requirements.md](../requirements.md) on 2026-10-24 so the spec stays short to read: their design, what was built step by step and how it was checked. Section numbers (section 5, section 7) and "Decision log" refer to requirements.md.

<a id="s6"></a>

## S6: Export / import

Design (user, 2026-10-16): rethought since the first plan (written for one user, before accounts, uploads read by Claude and admin settings). Three parts now, one optional later:

1. **Automatic backups** (the main reason for S6: what was paid, when, and the lot history cannot be collected again). After the daily collect, the home PC saves a dated, compressed copy of the whole database (`tora-YYYY-MM-DD.db.gz`, a SQLite file any SQLite tool opens) in a folder: `~/.local/share/tora/backups` by default; `BACKUP_DIR` in `.env` can point at a synced folder (OneDrive, Google Drive) so copies also leave the PC with nothing more to run. Kept: the last 30 days plus the first copy of each month for 12 months. `pnpm backup` makes one by hand. `pnpm restore <file>` loads a copy into an empty database only (it refuses one with data); `docs/backups.md` shows making a new Turso database, restoring into it and switching Vercel and the PC to it, so a broken database stays untouched until deleted. A test backs up a database, restores it into an empty one and compares every table.
2. **Download my data**, per account (Settings > Your data): a spreadsheet (CSV, opens in Excel) of the lots (item, category, kind, condition, quantity, cost, date, shop, order ID, status, current value, profit; sold lots with their sale) and a JSON file of the account's own data (items, lots, history, manual prices, linked listings, import history). Neither carries collected sale prices (other sites' terms, eBay's among them): only the current values.
3. **Spreadsheet import** (Imports > Spreadsheet): a CSV in the download's layout (headers in either of the app's languages, UTF-8 or Excel's Japanese encoding). A preview lists each row as new, already in Tora (its lot ID is in the account, or the same shop and order ID is) or a problem; confirming adds the new rows as lots that wait in Imports > Review, as one import in the history. Rows already in Tora are skipped (user: editing lots stays in the app). Other layouts go through the Claude upload.
4. Optional, later: loading the JSON file into an empty account (moving between two installs); worth it once others run their own Tora.
5. **Import log** (user, 2026-10-16, after seeing that rows left out were only counted): every import (spreadsheet, uploads read by Claude, order emails; purchase links already list each link) keeps each row with its outcome: imported (its lot), already in Tora (the lot it matched, to check), corrected or matched to an entry added by hand, skipped (why) or a problem (what). The import's page lists them, what was not imported first. A spreadsheet row matching a lot only loosely (same item, date, quantity and cost, no lot or order ID) is shown with that lot in the preview and can be ticked "add anyway" (user: a real second purchase must not vanish); exact matches stay skipped. The app also shows when the last backup ran (Settings > Collectors, admins).

Dropped from the first plan (user, 2026-10-16): the zip of one CSV per table and the whole-database JSON (the backup does this better), the `pnpm purchases --out` purchases file and its upload (the Claude upload covers it), the automatic Gmail import (moved to Open issues).

Acceptance:
- Scenario 8 (the lots spreadsheet rebuilds the collection without the app); the backup and restore test passes in `pnpm test`.

Built (2026-10-16):
- Backups: `pnpm backup` copies every table, then its indexes, into a local SQLite file (2,000 rows per request; each table's row count checked, then an integrity check), compresses it and moves it into place whole; one a day (`--force`: again), then deletes copies no longer kept. `scripts/collect-cron.sh` runs it after the collect whatever the collect did; the day counts as done only when both succeeded. `pnpm restore <file>` refuses a database with any table, then copies parents before the tables pointing at them, with references checked per page (Turso enforces them). First real run: 283,410 rows, 18.4 MB, 38 s; restored into an empty file in 28 s. Guide `docs/backups.md`; Commands page group; `BACKUP_DIR` in `.env.example`.
- Settings > Your data: the lots spreadsheet (`/export/lots`, CSV with a byte order mark so Excel opens Japanese right; `?template`: headers only) and the account's JSON (`/export/account`: items, lots with their value now, history, manual prices, linked listings without collected sales, imports, links, canceled orders; no sign-in secrets, no collected prices). Headers and names in the person's language, amounts in the base currency; cells that a spreadsheet would run as a formula get a leading `'`.
- Imports > Spreadsheet: a CSV (UTF-8 or Shift_JIS) checked first, row by row (new lot, new lot of a new item, already in Tora, skipped, or the problem); headers and names read in any installed language or as keys. Already in Tora: the lot ID is in the account, the same order is (one-item shops: the order alone; others: the order and the item), or a lot of the same item with the same date, quantity and cost (each lot matches one row). Not owned (sold, opened, lost) rows are skipped; an unknown status is a problem, not a skip. New lots wait in Review (reasons: new item, no date), as one import "Spreadsheet" in the history. Up to 5,000 rows, 2 MB.
- Import log (part 5): table `import_rows` (migration 0026): each row of an import with its outcome (imported, existing, matched, updated, skipped, problem), the reason code, the lot it created or matched, quantity, cost and day. Written by the spreadsheet import (every line), the shared purchase import used by order emails, links and uploads read by Claude (every receipt, plus emails that could not be read and rows Claude left out: not a purchase, not a collectible, canceled). The import's page lists rows not imported first, then rows already in Tora with a link to the lot each matched; imported rows are its lots as before. The spreadsheet preview links the lot each row matched; a loose match (same item, day, quantity and cost) is "Maybe already in Tora" with an "Add anyway" tick, counted apart in the summary, and logged as added anyway. `pnpm backup` records its last copy in the app; Settings > Collectors shows it to admins (red when none or older than two days).

<a id="s8"></a>

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
- (Decided 2026-10-14) Identity pages and search sources: eBay, Mercari and Yahoo Auctions have no product page per item, so they are not offered as identity pages today. Confirm with the user: keep them out (current), or offer them with a recommendation against it. Decided: Tora cannot judge a random site, so it keeps following the plug-in's declaration (a per-item link pattern); search-only plug-ins declare none and stay out. S12 explains the requirements for each role.
- (Built 2026-10-14) Admin preferences navigation on half and full screens: opening Admin preferences replaces the row of settings links with its own row (Markets, Price sources, Identity pages) in the same style, so it is unclear the user is one level deeper. Keep the settings row on top (Admin preferences highlighted) and add a second, visually distinct row under it for the admin pages. Built: the settings row stays, and the admin pages are a row of underlined tabs under it.
- (Built 2026-10-14, user) Source order, per kind of item: Settings > Price sources shows a market's sources for one kind of item at a time (Cards, Sealed TCG, Games & other), grouped by their role for it (reference, supporting, comparison only, off), with one role menu per source; arrows move a source within its group. A first version kept one order for every kind, which could not say e.g. that 駿河屋 is the reference for games but last for sealed TCG (user). The order is the admin's per kind (`sourceOrder` in app settings; default the plug-ins' priority) and is also the order values try sources sharing a role (with two references the first is the main one) and the quality gate's reference. Item pages list a market's sources in the order its value uses them, the main reference first in its own colour (green, with a tooltip). Chart colours stay by the plug-ins' priority. The tab rows lost a stray scrollbar.
- (Decided 2026-10-14, user) S14 speed stays second to last (after everything is built) and S15 bug hunting last.
- (Fixed 2026-10-14, user report) Lot pages: the order ID shows in the lot details (it showed only in Edit); the lot form texts (cancel order, delete, split, sell hints) were lost when the Actions page reused their name and showed as raw keys, now restored under their own name. A scan of the code for texts missing from the message files finds none.
5. (Built 2026-10-14) Settings > Collectors: each collector starts collapsed, its status on the right (OK, or Partial in red); expanding shows the details (why a run was partial).

Then S11 (primary and secondary markets), then S12 (documentation).

Acceptance:
- User review on phone and on a wide desktop screen.

<a id="s16"></a>

## S16: Make Tora work anywhere: categories, markets, languages, currency

Added at the user's request (2026-10-14): anyone should be able to run Tora in any setup. The admin creates product categories from scratch in Settings, adds markets, and chooses the languages and the currency; whoever adds a complex category builds collectors to match (S12 explains how). Planned for up to 10 categories across 5 markets. These are choices made at setup, not switches to flip at any time. Before S12, so the documentation covers it; done together because they touch the same files.

Today, categories are code: 2 categories (TCG, games and other), 13 kinds, and 3 behaviours (cards, sealed TCG, games and other). A behaviour decides the condition fields, grades or shrink, the price buckets, which conditions may be pooled for rare items, and the source roles. About 38 files depend on it. Markets come from plug-ins: a market exists when a collector for it is installed.

Categories (Settings > Admin preferences > Categories):
- The admin writes everything: the category's name (English and Japanese), its sub-categories (kinds, e.g. booster box, single), and the information its items have: fields with a type (text, number, date, choice list, yes/no), required or not, shown on the item page or not.
- The price condition: one condition list per kind (design session, 2026-10-14): its values best first, and which values may be pooled when an item has too few sales. The admin picks a ready list (card grades with slabs, sealed packaging, item condition) or writes a new one. This is what lets the valuation work for a category it has never seen.
- TCG and games become two built-in templates written in this same format (one way of doing things, not two); existing items keep their data through a migration.
- Roles and store order are set per category in Settings > Price sources (the item type switch lists the categories).
- A category can be edited later; removing a field or a value already used by items asks first and says how many items it touches; a category with items cannot be deleted, only hidden.
- Plug-ins say which categories they collect (by key), like they declare classes today.

Markets:
- A market appears when a collector for it is installed and describes itself (S11). The admin gives it a display name, checks its currency has exchange rates, and picks primary and secondary.
- What item pages compare is the admin's choice (design session, 2026-10-14): primary against secondary (default, as today) or every market, each converted to the base currency.

Languages:
- A language is a translation file (about 950 texts today, English and Japanese). Adding one means translating that file (Claude can draft it); S12 explains how and how to check it (the message scan finds missing texts).
- Settings > Admin preferences: the admin sets the app's primary and secondary language, picked from the installed ones (user, 2026-10-14: languages are the admin's, like markets and currency); each user switches between those two with the toggle, as with English / Japanese today (user, 2026-10-14).
- Item names follow the markets, not the app's languages (user, 2026-10-14): the name is as sold in the primary market (Japanese here, so collectors match it on that market's sites), the second name is the secondary market's (e.g. English); both editable, both searched, the second shown under the name on item pages. The app's language does not change which name is shown.
- Dates and numbers follow each language's formats.
- Speed: each page loads one language (lighter still once S14 sends a page only its own texts).

Currency:
- Today every amount is stored in yen (costs, sales, saved values, value history): about 1,050 references in 83 files, and columns named `_jpy`.
- The admin sets the base currency for the whole app, mainly once at setup (user, 2026-10-14: currency is the admin's, like markets; users do not choose one; picked before adding anything, usually the primary market's currency). Usually two currencies: the base and the secondary market's, whose rate comes from a rate plug-in the admin builds or reuses from their own sources (as the USD one today); one currency only: no exchange rates at all. A later change (e.g. after years, a new secondary market) is rare but supported; every amount is stored in it (columns renamed to a neutral name; existing data is yen and stays as is). Changing it in Settings converts every stored amount, after a confirmation.
- Each market's currency is converted to the base with daily exchange rates, set by the admin (design session, 2026-10-14): per currency, either a rate source plug-in (today's USD to JPY one, from the European Central Bank's rates via Frankfurter, becomes one for any pair it covers) or a rate typed by hand. A market whose currency has no rate is flagged in Settings and its prices are not converted.
- Speed: a multiplication per amount; saved values stay in the base currency.

Ground rules for heavy users (collectors on the home PC):
- Measure first: Settings > Collectors shows each collector's run time and the night's total; a run longer than its window gets a warning.
- Up to about 3 markets and 10 collectors: one nightly `pnpm collect`, as today.
- More than that: run one market or one collector at a time (`pnpm collect --market us`, `--source x`), spread across the night by the scheduler, with an example schedule in the docs.
- Too many items for one night: refresh each item every few days in turns, items you hold first, then watched ones.
- Collectors for different sites may run side by side; never several requests at once to the same site; each site's rate limit is set in its plug-in.
- These rules go into S12's documentation with a table (markets, collectors, items) and the suggested way to run them.

Build order (design session, 2026-10-14), each part usable on its own: 1. base currency and exchange rates (touches every amount, best done before more code is added); 2. languages; 3. categories; 4. markets and the heavy-user rules.

Part 1 design (2026-10-14):
- Amounts are whole numbers in the base currency's smallest unit (yen: 1 yen, euro: 1 cent), so today's data stays as is.
- Migration 0023 renames the 9 `_jpy` columns to `_base` (e.g. `price_base`, `cost_total_base`); code names follow (`priceBase`). Applied to production when the user pushes (the live site errors for about a minute until the deploy finishes; the home PC needs `git pull` before the next collect).
- Plug-ins report prices in their own currency only; the collect converts them to the base with the stored rate of the sale's day and keeps the rate used. Rate plug-ins declare the currencies they cover and fetch any pair.
- app_settings `currency`: the base, per other currency its rate plug-in or a typed rate, and currencies the admin added. Settings > Markets > Currencies: the base menu (any currency while nothing is stored; later only another market's currency, with rates) and each market's currency with its rate (flagged when it has none).
- Money shown through one formatter per request (server) or per page (client), in the base; amount inputs accept the base's decimals.
- Changing the base (Settings, admins, after a confirmation naming how many amounts): every stored amount is converted with the rate of its own date (the last on or before it, else the first after), amounts inside lot history and recent sales too, and rates are moved to the new base; saved values are rebuilt. At setup (nothing stored) any currency can be chosen without a rate; later only currencies with stored rates.

Part 1 built (2026-10-14): migration 0023 (columns renamed; old `Jpy` keys inside saved JSON renamed too: recent sales, lot history, saved values, suggestions), plug-in contract in own currencies with the conversion at the collect's boundary, `frankfurter` rate plug-in for every ECB currency, Settings > Markets > Currencies (base menu: free choice at setup, conversion with confirmation later; rate source or typed rate per currency), one money formatter, decimal amount inputs. Values use the primary market's currency instead of yen. Checked on the demo data: typed USD rate, base switched to USD and back (¥33,300 -> $222.00 -> ¥33,300). Applied to production 2026-10-14.

Part 2 built (2026-10-14): Settings > Admin preferences > Languages (primary and secondary picked from the installed translation files; secondary can be none, then no toggle); the toggle shows the admin's two; whoever has not chosen, and the sign-in page, gets the primary; a choice outside the two falls back to it. Installed languages are listed in `apps/web/src/i18n/locale.ts` (one line and one `messages/{code}.json` each); a test fails when a file misses a text of en.json or the code asks for a text en.json lacks. Dates, numbers and charts follow the page's language. Item forms have an editable second name. Checked on the demo data: Japanese only (no toggle), back to English and Japanese, toggle, sign-in page, second name shown and found by search.

Part 3 design (2026-10-14, user's choices):
- Categories, kinds and condition lists are data the admin edits (app_settings `categories`), with stable keys. TCG and games are built-in templates that keep today's keys (`tcg`, `single`, `booster_box`, `software`...) and buckets (`raw:A`, `graded:PSA:10`, `sealed:shrink`, `cond:new`), so collectors and stored prices do not change.
- Fields: standard + custom (user). Today's fields (franchise, platform, set name, set code, variant, card number, rarity, release date, retail price) are a standard set any category switches on, per kind, with its own label; collectors and search keep reading them. Custom fields (text, number, date, choice list, yes/no; required or not; shown on the item page or not) are saved per item in one JSON column.
- Condition lists: one per kind. Ready lists: card grades (raw S-D and slabs), sealed packaging, item condition. A new list: its values best first, and groups of values that may be pooled when an item has too few sales; a lot records one value, valued in bucket `{list}:{value}`.
- Item types: roles, source order, identity pages and the quality gate are set per category and condition list (user): TCG singles (`card`), TCG sealed (`sealed`), TCG other (`item`), Games (`game`, today's `item` roles copied), then e.g. `watch/condition`. A category with one list shows just its name. Each item stores its item type, so pages and collectors need no lookup.
- Full editor (user): Settings > Admin preferences > Categories creates and edits categories, kinds, fields and condition lists; names per language (primary and secondary); a change that touches items (a removed field or value, a kind's list) says how many and asks first; a category with items is hidden, not deleted.
- Plug-ins declare the categories they collect (`categories`, by key; none: TCG and games, as today) and roles per item type.
- Migration 0024: products get `item_type` and `fields`; holdings get `condition_value`; the category and kind checks go (they become data); `item` roles, order, quality and identity choices are copied to `game`.

Part 3 built (2026-10-14): Settings > Admin preferences > Categories (categories, kinds with their condition list, standard and custom fields per kind, the admin's condition lists with pool groups; names in the app's two languages; keys made from the English name on save; a change touching items lists them and asks; categories and kinds with items can only be hidden). Items store their item type (`item_type`) and custom field values (`fields`); lots store the admin's condition value (`condition_value`); buckets `{list}:{value}`. Add, edit, lot actions, item and lot pages, the items list, Price sources and Identity pages follow the categories; the admin's names join each page's texts. Games have their own item type (`game`); today's `item` roles, order, quality and identity choices are copied by migration 0024, and the plug-ins declare `game` too. Checked on the demo data: watches made from scratch (list with a pool group, a required text field, a choice field), a watch added and valued in its own condition, condition changed, Japanese names, a used value removed after the confirmation; TCG and games add as before. Tests: a watch valued with pooling, saving that touches items, the migration, a collector run for watches. Not covered yet: screenshot and email imports read only the built-in kinds; the identity-link threshold (¥3,000) is in yen; the market comparison is TCG only (part 4).

Part 4 design (2026-10-15, user's choices):
- What item pages compare: Settings > Markets, primary against secondary (default) or every market; each other market shows its reference source's price (else a supporting one's), converted to the base, next to the primary market's value. Markets are told apart by their sources' market, not by currency (two markets may share one).
- The compared condition (user): TCG keeps today's rule (ungraded cards in their grade, graded ones at ungraded A; sealed with shrink unless the lot has none). Other categories compare in the lot's own condition (the one most units are in): another market's price counts when it prices that condition, or when it is the plain "as sold new" price and the lot is in the list's best value.
- Run time (user): each collector run records its working time (time the PC slept is not counted). Settings > Collectors shows each collector's last run time and its usual time, and the last night's total against a night window the admin sets (default 6 hours); a total over the window and a run much longer than usual (over twice the median of its last runs) are flagged.
- `pnpm collect --market us` runs one market's collectors (`--source x` exists already).
- Taking turns (refreshing each item every few days when one night is too short) waits for S14's large data (user).
- The amount above which items outside cards and sealed TCG are expected to have a store link (¥3,000 today) is the admin's, in the base currency, on the Identity page (user).
- Screenshot and email imports read the admin's categories and kinds.

Part 4 built (2026-10-15): Settings > Markets chooses what item pages compare (primary and secondary, or every market; shown with three or more markets); item pages compare any category, in the lot's own condition (TCG as before), each other market's price converted with its rate and source. Markets are told apart by their sources' market. Price sources and Identity pages show every market (other markets after the primary and secondary; their items are not flagged). The identity-link amount is set on the Identity page (base currency, ¥3,000 by default). Collector runs record their working time (migration 0025, `active_ms`; a sleeping PC is not counted); Settings > Collectors shows each run's time, its usual time, the last night's total and the admin's night window, flagging a long run and a night over the window. `pnpm collect --market`, and `collect-cron.sh` / `install-windows-task.sh` take arguments (one task per market and hour). Screenshot and email imports offer the admin's categories and kinds. "Item without a condition" notices name items, not games; sorts follow the page language. Checked on local test data with a third market (EU, euros): Markets, Price sources, Identity, the card (Japan, US, EU), a game in its own condition, a watch, the identity amount, the night window, a long run. Tests: the compared condition, foreign prices per condition, a third market with the compare choice and amount, run times and the night, the import schema. Left for S14: taking turns when one night is too short, and measuring the rules on large data.

Part 5 (user 2026-10-15: part of making Tora work anywhere): the app's time zone. Not a fixed Tokyo, the admin's local time (user).

Part 5 design (user, 2026-10-15): set in Admin preferences (picked at setup, the device's zone suggested); one zone for the whole app; changing it later converts the stored times (like the base currency, rare and confirmed); the collect's "today" follows the app's zone.

Part 5 built (2026-10-15): `packages/core/src/time.ts` keeps the app's zone (`appTimeZone`, `setAppTimeZone`, loaded with the settings by every request and script) and writes times with its offset at each instant (`toLocalIso`, `localDate`, `localTime`; the `tokyo*` names are gone), summer time included. Plug-ins may give times with any offset (a site's own); the collect stores them in the app's zone. Settings > Admin preferences > Time zone (admin only): every zone with its offset, the time there now, the device's zone offered when it differs; a change (confirmed when anything is stored) rewrites every stored time (`changeTimeZone` in `packages/db/src/time-zone.ts`) and rebuilds values and snapshots. The collect writes the zone down for `scripts/collect-cron.sh`'s daily stamp. Checked: tests (summer time, conversion there and back), the page at full and phone widths in English and Japanese, a change from Tokyo to Paris on a copy of the test database (times rewritten, snapshots rebuilt). No migration.

Acceptance:
- An admin creates a new category from scratch (e.g. watches) with its own fields and price condition, registers items, and a test plug-in prices them; TCG and games work as before.
- A third market added by a test plug-in shows in Markets, Price sources and Identity pages.
- The ground rules are measured on S14's large data and written down.
- A test setup with another base currency and language (EUR, Spanish: S10) works end to end: registering, collecting with a test plug-in, values, charts; this setup is S10's Spain + Brazil check.

<a id="s12"></a>

## S12: Documentation for others

Added at the user's request (2026-10-13); replaces "documentation first" under Open issues > Setup path. After S11, so it documents the finished market setup. Very robust documentation for someone cloning the repo to run their own Tora, written for a person or their coding assistant:

- Clone and run: accounts needed (Vercel, Turso, a home PC with WSL or Linux), environment variables, migrations, the first user, deploying, the daily collect and uploads on the home PC.
- Build a collector: the plug-in contract (what it returns: listings, candidates and scores, sales and asking prices with buckets, currencies and times, searches and their state; how it describes itself: market, currency, price kinds, roles, identity classes, links, aliases, order IDs, noAi and detailsDays), package layout, `pnpm collect`, polite fetching, testing with fixtures, a template plug-in to copy.
- A good identity link page: one stable page per item, the item's name, set, number and picture, a durable URL with an ID the plug-in can read, findable by search.
- A good price reference: real sales (not asks) with dates and conditions, enough volume, stable access, terms that allow it; when a source is supporting or comparison instead; what the quality gate checks.
- Primary and secondary markets: choosing them, roles and identity per market, what the value counts.
- Currency at setup (user, 2026-10-14): pick the base currency first, before adding anything (Settings > Markets > Currencies). A secondary market in another currency needs a rate plug-in; rules for building one, with `collectors-public/src/fx.ts` (ECB via Frankfurter) as the template: daily rates (working days are enough), expressed as units of the base per unit of the other currency, a year of history on the first run, a free source whose terms allow it, the currencies it covers declared. One currency only: nothing to set up. Changing the base later is rare and converts every stored amount.
- Tora does not judge a site (user, 2026-10-14): it follows what each plug-in declares. A per-item link pattern (`links`) makes a source an identity choice; its price kinds decide the asking-price warnings; the only automatic check is the quality gate (a supporting source against its market's reference). The docs spell out the requirements for each role and what goes wrong when a plug-in declares them wrongly (for example a search page given as an item link).
- Adding a language (S16): translate `apps/web/messages/en.json` into `{code}.json` (Claude can draft it), add the code to `LANGUAGES` in `apps/web/src/i18n/locale.ts`, run the tests (missing or extra texts fail), then pick it in Settings > Admin preferences > Languages.
- Running many collectors (S16 ground rules), with Settings > Collectors to measure first:

  | Setup | How to run |
  | --- | --- |
  | Up to about 3 markets and 10 collectors, a few hundred items | One nightly `pnpm collect` (2026-10-15: 6 collectors, about 100 items, about an hour) |
  | More markets or collectors | One run per market at its own hour: `AT=01:00 scripts/install-windows-task.sh --market jp`, then `--market us` at 03:00 (`--source x` for one collector); remove the all-markets task |
  | Too many items for one night | Taking turns, held items first (S14) |

  Different sites may run side by side, never two runs for the same site; each site's pace and request cap are set in its plug-in.
- Terms and responsibility: each site's terms are the builder's responsibility; sources whose terms forbid AI use are marked noAi.
- Checked in S10 by the Spain + Brazil setup.

Design (user, 2026-10-15): `docs/` with one guide per topic (setup, building a collector, sources and roles, markets and currency, categories, languages, running collectors), the README a short entry that links to them; a template plug-in in `collectors-public/template/` (a made-up shop answering JSON, saved answers as fixtures, a test that passes, not loaded by `pnpm collect`) to copy and rename; Settings > Admin preferences > Commands (admin only): the home-PC commands grouped by task, what each does, a copy button and a link to its guide.

Built (2026-10-15): `docs/` (README index and words used, setup, markets and currency, categories, sources and roles, building a collector, running collectors, languages); the README is now a short entry with the quick start and links. Template plug-in `collectors-public/template/` (Example Market: search with scores, sales history read 5 pages per run and resumed, conditions as buckets, `SourceInfo`; saved answers as fixtures; test run by `pnpm test`, typechecked with collectors-public). Collectors can now set their own pace and request cap (`Collector.http`; only slower than 2-5 s), as the "Running many collectors" rule says. Settings > Admin preferences > Commands (admin only): the home-PC commands in five groups (collecting, schedule, imports, accounts, database and Claude), each with what it does in both languages, a copy button and a link to its guide on GitHub. Checked: the page at full and phone widths, English and Japanese, copying. Not covered: the France + China check of the guides (S10).

<a id="s17"></a>

## S17: Notifications and activity log

Idea (user, 2026-10-16): alerts that reach the user outside the app, and a log of what happened. The user first planned alerts by email, Telegram or Discord; "price alerts" went into S9 without a channel. Placed after S6 and before S9, so S9's price alerts have somewhere to go.

Design (user, 2026-10-16, all Recommended options):
- Channels: Telegram and Discord first. Email and phone push go to Open issues.
  - Discord: each person pastes a webhook link (a channel's Integrations > Webhooks).
  - Telegram: the admin creates one bot (BotFather) and pastes its token in Admin preferences. Each person connects with a link that opens the bot with a one-time code; Tora reads the code back from the bot to learn the chat (no webhook to host).
  - Webhook links and the bot token are stored encrypted with `AUTH_SECRET`, which the app and the home PC both have. A "Send a test" button per channel; a channel that fails shows its last error.
- What is sent, and when:
  - At once, to admins: the collect or the backup failed (sent by the home PC right after its run), or nothing ran for over a day (sent by a daily check in the app, a Vercel cron job, since a PC that is off can say nothing).
  - In one daily summary, to each person: their imports that did not add every row (already in Tora, left out, or a problem), and what is waiting on their Actions page (with a link). Sent by the app's morning check, not after the collect: the night window is a length, not a time, so the app cannot tell when night is, and a summary should not arrive at 3 am (changed from "after the collect" while building, 2026-10-16).
  - Each person switches each kind on or off and chooses the language of the messages (one of the admin's two). No quiet hours; a failure at night arrives at night (Telegram and Discord can mute a chat).
- Activity log: one page, Settings > Activity, newest first, each entry linked to its page: collects (per run of `pnpm collect`, with each source's result), backups, imports, and admin changes (markets, sources, roles, identity, categories, languages, time zone, currency, collect window, Telegram bot, users added or changed by `pnpm user`). Admins see everything; members see their own imports. This covers the admin audit log from Open issues. Alerts sent are listed on their entry.

Parts:
1. Activity log: an `activity` table (who it belongs to, who did it, kind, level ok / problem / failed, details to translate, link, when alerts went out); written by the collect, the backup, every import and every admin change; the Activity page.
2. Channels: Settings > Alerts (channels, what to send, language, test); the Telegram bot in Admin preferences.
3. Sending: failures at once from the home PC, the app's morning check (`vercel.json` cron, `CRON_SECRET`) with the daily summaries.

Built (2026-10-16, migration 0027):
- Tables `activity` (whose, who did it, kind collect / backup / import / admin / check, level ok / problem / failed, detail, link, when alerted) and `alert_channels` (Telegram chat or Discord webhook, encrypted with `AUTH_SECRET`, last sent and last error).
- Written by: `pnpm collect` (each source's result; failed when a source failed or was blocked), `pnpm backup` (ok, or the error), every import when it finishes (its rows' outcomes from the import log; problem when a row had one), each admin setting (sources' roles and order, markets and options, identity pages, categories, languages, rates, currency, time zone, night window, Telegram bot) and `pnpm user` (shown as done from the terminal).
- Settings > Activity: newest first, 50 a page, filters for admins, each entry linked; admins see all, members their imports. Settings > Alerts: channels (test, remove, last error), Connect Telegram (t.me link with a daily code tied to the person, read back with getUpdates, no webhook to host), Discord webhook (checked, then a test), what to send and the messages' language, and for admins the Telegram bot token (checked with getMe).
- `pnpm alerts after-run` (run by `scripts/collect-cron.sh` after the collect and backup): records a step that crashed from its exit code, sends failures to admins (once a day per kind). `/api/cron/daily` (Vercel cron, `0 23 * * *` UTC, `CRON_SECRET`): "no collect / no backup for over 26 hours" (once a day) and the daily summaries (at most one per person in 20 hours, only when there is something to say). `pnpm alerts check` runs the same from the PC. Messages use the app's `alertText` texts in each person's language.
- Guide `docs/alerts.md`; Commands page group; `CRON_SECRET` in setup.md and `.env.example`.
- Checked locally (en 1280, ja 390): both pages, the forms' errors, the cron route's secret, the CLI against a copy. Not tried: a real Telegram bot and Discord webhook (the user's own), the cron on Vercel.

Acceptance: a failed collect reaches the admin's Telegram and Discord within minutes; switching the PC off for a day brings a "nothing ran" alert; an import with rows left out shows in the next daily summary; the Activity page shows each of these with links, in English and Japanese.

<a id="s9"></a>

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

Design (user, 2026-10-16):
- Watch items only (not whole sets, which overlaps S13): a Watch button on any item page, or a new item added without a lot. Each watch has a condition (e.g. raw A, PSA 10, sealed) and an optional target price; watched items are matched and collected like owned ones.
- What is for sale now: once a day, in the nightly collect, the lowest ask and the number of listings for owned and watched items. No checks during the day.
- Rules now, Claude later: fixed rules and statistics, every number explained in the app; a weekly Claude summary comes in S13 or after.
- Signals saved daily (one row per item and condition), for rule tests, alerts and S13.
- Buy zone from the item's own history plus the new-set pattern, the latter from data already collected for every user's items (no extra collecting; user: "we dont need to limit ourselves to just one product if several users register different products in the same career"). Similar items: same kind, franchise and language (games: kind and platform); each card says how many items it is based on and hides under a minimum. Release dates: items are linked to the set catalog from the set code or name they have (confirmed on Actions where unsure) and take the set's date; without a set, the item's own date, else its earliest collected sale.
- Alerts through S17's channels, at once after the nightly collect: a watched item entered its buy zone, or its lowest ask went under the target. Sharp drops go in the daily summary.
- Owned items show the signals too, on the item page; the Watchlist page lists watched items.
- Rule tests visible: a short results card per group of similar items ("past buy signals: price 90 days later higher 7 times out of 10"), never a sure thing.

Parts:
1. Watchlist: a `watches` table (person, item, condition, target, note); Watch on item pages, a watch-only new item, the Watchlist page; the collectors match and collect watched items and their conditions; an MCP tool.
2. For sale now: plug-ins report the lowest ask and listing count per condition with each collect; a daily table; shown on item pages and the Watchlist.
3. Release dates and similar items: catalog links from set code or name (unsure ones on Actions), the release date rule above, the group of similar items.
4. Signals: computed daily after the collect for owned and watched items and saved: fair value and band, where today sits (90 / 180 / 365 days), trend (2 / 4 / 12 weeks) with the falling guard, how many sales (confidence), lowest ask against fair value, the new-set pattern (day N after release against similar items at day N); buy zone. A Buy timing card on item pages with the reasons, the Watchlist columns.
5. Alerts and rule tests: zone and target alerts at once, sharp drops in the summary; rule tests per group from the price history, a results card.

Part 4 design (user, 2026-10-16):
- Buy strategies, chosen by each person per item type (sealed, cards, games, ...), each preset to Tora's suggestion; a watch's own target always wins. Five strategies: Steady (zone: the cheapest quarter of the last 180 days' daily prices; suggested for sealed and cards), Bargain hunter (the cheapest tenth of the last 365 days), Margin (X % under the usual price, the median of the last 180 days, X set by the person, 10 by default; suggested for games and other types), Catch the dip (like Steady, but a fast fall still says "good price" with a warning), Own target only (no zone). In all but Catch the dip a fast fall (over 5 % in 2 weeks and down over 4 weeks) says "Falling: wait" even in the zone. In an item's first year the new-set pattern lowers the zone by the typical fall of similar items at that age, when it is based on 3 or more items.
- Why per type (user asked whether one zone fits all): sealed boxes follow a life cycle (release hype, a dip, a rise once out of print: バトルパートナーズ -27 % by month 3, back by month 12); singles are noisy and often thin; games are flat and mostly 駿河屋 listings, where a range zone sits just under fair value.
- Try before choosing: the strategies are tried on a fixed sample per item type (picked by Tora, the same for everyone): its last year's prices with the buy days each strategy would have called, how many, the average price paid against the year's average, and how often the price was higher 90 days later. Choosing is a setup step on the Watchlist (not in Settings, user): until a person has chosen, the Watchlist asks them to, prominently; afterwards it shows the strategy per type with a way to change it.
- Limited data (user): items are never hidden for a short history. The pattern only needs prices around the ages it compares (an item collected from month 6 counts from month 6). Signals with little data are shown with a "limited data" warning saying why; a zone without enough range falls back to 10 % under the usual price (with almost no history, under fair value, so only a listing can be in it) and says so. Watched items still alert with limited data (a switch per watch, on by default, part 5).

Built, part 1 (2026-10-16, migration 0028):
- Table `watches` (person, item, the condition in a lot's fields and as its bucket, target per unit in the base currency, note; one per person, item and condition).
- Watchlist page (menu, between Portfolio and Actions): each watched item and condition with today's market value in that condition, how far it is from the target (at or under it in green, first), or the last sale. "Watch an item" uses the Add steps (existing, new, or a catalog set's sealed product), then the condition and target instead of the purchase.
- Item pages open for watched items too (not only owned ones); a Watching card (owned or not) lists the person's watches of the item to change or remove and watches it in another condition; a watched item not owned links to registering the lot.
- Collectors match and collect watched items (with owned and opened ones) and cover watched conditions; their values are saved after each collect like owned ones. A merge moves watches; a watched item is never deleted as unused. Watches are in the account download (JSON). MCP tool `watchlist`.

Built, part 2 (2026-10-16, migration 0029):
- Table `supply`: per item, source, condition and day, the lowest ask per unit (base currency and the source's own) and how many listings (null when the source does not say). Plug-ins return it with each collect (`CollectResult.supply`, docs/collectors.md); a second collect the same day replaces that day. A source's last day within 3 days counts as "for sale now"; a condition missing that day had nothing listed. Merges move it; deleted items drop it.
- Item pages: a "For sale now" card per condition (the item's own first): the lowest ask, the listing count, each source's ask linked to its listing, lots named, a likely lot left out with the reason. The Watching card and the Watchlist show the lowest ask in the watched condition, green at or under the target; the Watchlist ranks by the value or the ask, whichever is nearer the target. MCP `watchlist` adds the lowest ask (sources Claude may not read left out).
- Checked live on one SNKRDUNK card and box, a Mercari box search and a 駿河屋 game (nothing saved), and in the browser (en 1280, ja 390).

Built, part 3 (2026-10-16, no migration):
- Catalog links: a card or sealed item without a set is matched to the set catalog by its set code and name, among its franchise's sets in its language and of the kinds it can come from (cards: expansions first; boxes and packs: expansions, then special sets; decks: decks; special sets: special sets). Names are compared without pack words, brackets or a reading in parentheses ("強化拡張パック「ポケモンカード151」" is "ポケモンカード151(イチゴーイチ)"). Sure: a code the catalog has once (preferring the kind above) with a name that does not disagree, or exactly one set's name with no other code. Unsure (a code and name that disagree, a code on several sets, a name only close) goes to Actions as "Link to a catalog set" for the person who made the item (else the admins), one card per possible set; linking one closes the others. A code the catalog does not have (promos like SV-P) is never guessed from a close name. Only the link is set: the item's own set name and code stay, so searches do not change.
- When: on every collect (after lot sizes) for all items, and right after an item is added, watched or edited in the app.
- Release date: the linked set's date, else the item's own, else its first kept sale. Item pages show it ("Released ..." or "First sale ..."); MCP `product_detail` adds it with where it came from.
- Similar items: cards and sealed by kind, franchise and language; games by kind and platform (written forms compared: "Nintendo Switch" is "switch", "PlayStation 5" is "ps5"); other categories by kind. From every person's items, owned, watched or not. MCP `product_detail` gives the group and its size; the cards that use it come in part 4.
- Dry run on the real items (read only): 31 would be linked (every SV / S code with a catalog set, the named boxes, the 30th CELEBRATION deck and special box), 2 asked (マリィ S1H against シールド S1; the ピカチュウex・カビゴンex deck against its スタートデッキGenerations), promos and supplies left alone. The first collect links them.

Built, part 4 (2026-10-17, migration 0030):
- Table `signals`: per item and condition held or watched, per day, the numbers in `SignalStats` (@tora/core `signals.ts`): fair value, sales in 30 days, days with sales in 180 / 365, the usual price (180-day median), the lower and upper quarter of 180 days and the lowest tenth of a year (only with 10 / 20 days with sales), where fair value sits in 180 days, fitted trends over 2 / 4 / 12 weeks, the lowest ask, days since release and where the date came from, the new-set pattern. Worked out after every collect (`refreshSignals`, after the values; a failure is logged and never stops the run); a merged or deleted item drops its rows.
- Strategies and verdicts are worked out when a page opens from the saved numbers and the person's choice (preferences `buyStrategy`, per item type, Tora's suggestion until chosen): Good price, Falling: wait, Fair price, High, No price yet; the zone, its basis, the pattern's effect, falling fast, a listing in the zone, limited data with the reasons.
- Watchlist: until a person has chosen, a prominent "Choose how Tora judges prices" box; afterwards a line with the strategy per type and Change. Each row: the verdict, "good under" the zone, limited data. Rows: at or under the target first, then good prices.
- Watchlist > Buy strategy (`/watchlist/strategy`): per item type the person watches or owns (tabs), the fixed sample (the item and condition with the most days of sales in two years, picked once by the collect, app setting `strategySamples`), a chart of its last year with the days the chosen strategy would have called a buy, and per strategy: buy days, the average price paid against the year's average, how often higher 90 days later (each day judged only on the prices before it, no pattern). Margin's percent can be set (1-50). "Use ... for ..." per type, "Use Tora's suggestions" for the types not chosen.
- Item pages: a Buy timing card (the main condition) before For sale now, with the verdict, the zone and the reasons. MCP `watchlist` adds `buyTiming` (sources Claude may not read left out).
- Guide docs/buy-timing.md.
- Checked on the real data, read only: 93 items and conditions in 15-36 s; the first dry run found the new-set pattern used games' first collected sale as a release (fixed: real release dates only) and Margin compared today's value with a margin under itself (fixed: under the usual price). Browser (en 1280, ja 390) on a local copy with a year of test prices.

Built, new-release wait, set lines, fixed examples (2026-10-18, migration 0041):
- New-release wait (@tora/core `typicalLowAge`, `judge`): an item with a real release date (set or its own, not a first collected sale) says "New release: wait" until the age at which similar items usually hit their first-year low (median over items with a full first year: prices from their first month to past day 300, released a year ago or more; 3 or more), else 90 days; Catch the dip warns instead. Saved daily in the numbers (`lowAge`); the Buy timing card says the day and the items behind it; MCP `watchlist` adds `newRelease` and `newReleaseWaitDays`.
- Set lines: `products.line` (by hand, by the item's creator or an admin, on the edit page; empty: automatic). Automatic for Pokemon from the catalog set's official title (else the item's own name): 拡張パック main, 強化拡張パック sub, ハイクラスパック high class, anniversary / concept packs special. The list is an admin setting (`setLines`, Settings > Admin preferences > Categories: the four built-in ones to keep and their own). The new-set pattern, the new-release wait and the market use the item's line when it has enough items (3; 5 for the market), else the whole group; the card says which ("Similar items (4, Sub-expansion only)", or "all lines"). Item pages show the line; MCP `product_detail` adds it.
- Line suggestions (`set_line` on Actions, to the item's creator else the admins): an item without a line whose change over its first 3 months (day 7 to 97) is 20 points or more from its group's typical one and within 10 points of a line's (3+ items); accepting sets the line. None on today's data (every Pokemon item has its line automatically).
- Measured on a copy of the local database: singles' first-year lows median day 193 over 9 items (sub-expansions about day 327 over 6, high class 193 over 3); boxes have only one item with a full first year (Battle Partners, day 116), so boxes wait 90 days for now.
- Fixed strategy examples (`packages/core/src/strategy-examples.ts`, replacing the per-type sample and its app settings `strategySamples` / `strategySamplesChecked`, removed by the migration): steady with dips (a PSA 10 card, a year), a long fall (a box, Dec 2023 to Oct 2024 shape: -45 % over 7 months, flat, a start of recovery) and a new set (a box from release over 455 days: -40 % by month 4, recovery; the 90-day wait applies). Real SNKRDUNK series, dates moved, prices rescaled (the period averages 10,000; the chart shows percent against the average), no names. The strategy page has the three as buttons above the chart; results per strategy on the chosen example. The weekly look for samples (a read of every item's sales) is gone.

Built, part 5 (2026-10-18, migration 0042):
- Watches gain `alert_limited` (Good price alerts with little data, on by default; a checkbox in the watch form) and `alert_state` (each alert's memory: in now, out since, last sent). Core `stepAlert`: sent on entering, again only after 14 days out; a new condition or target starts over.
- `sendWatchAlerts` in `pnpm alerts after-run` (after the collect and backup): for every watch, today's signal judged by its person's strategy (Good price only), and the lowest of today's asks against the target; one message per person with links to Buy timing (the asks' listing link for a target). Memories are updated for everyone, also without a channel or with the alerts off. Settings > Alerts: "Watched items" and "Sharp drops" switches, on by default.
- Sharp drops in the morning summary (`sharpDrops`): owned and watched items whose saved market value fell 15 % or more against 7 days before (a day either way), each at most once in 14 days (setting `alertDrops`). Needs a week of saved signals (from 2026-10-17).
- Rule tests (`refreshRuleTests` after `refreshSignals` in the collect; core `ruleTests`): per group of similar items and condition held or watched, the whole history, every strategy (each margin someone chose apart), saved in one setting (`ruleTests`, about 24 KB, 39 groups in 36 s on the local data). The Buy timing card: past signals checked, higher 90 days later X of Y and the typical change, next to any day, better / worse / about the same (5 points), shown from 10 checked signals; not for own target only.
- Tests: core (alert steps, rule tests), db (alerts with a fake Discord, rule tests saved and read).

<a id="s13"></a>

## S13: Buy suggestions

Added at the user's request (2026-10-12; own chapter 2026-10-13). After S9, on its signals. Widened 2026-10-18 (user) to opportunities within a category: first signals from data already collected (an item's strength against its line and age, laggards in a rising line, trades rising while listings fall, the lowest ask under recent sales or far above them, shop buy prices near market, the Japan vs US gap, shop stock running out), then ranking sources as a plugin kind documented like collectors (each admin writes the ones they want, e.g. SNKRDUNK's sealed box ranking: once a day the rank, the item's page on that site and any activity numbers it shows; matched to items, the ones not tracked yet becoming candidates); every signal tested on past data before it is trusted (rankings partly follow price moves); then the budget and target date. The user's words: automatic suggestions on items to buy, with a target date and a target budget (e.g. "¥50,000 by the end of December"); like the browser conversations with Claude about what to buy and at what price, which is why Tora v1 was started.

- Tora proposes items to buy on its own, not only from the watchlist: items in their buy zone, expected moves before the date, liquidity to sell later.
- The user sets a budget and a target date; Tora suggests what to buy and when within them.
- Open: where candidates come from (items similar to what the user holds or watches, sets the user follows, top movers on the sources), how to split a budget across items, how to show the reasoning and the uncertainty (never financial advice, never a sure thing), rules first and a model on top (as in S9).

Design (user, 2026-10-21):
- Candidates: every item anyone holds or watches, and items from ranking plug-ins (part 3). An item a ranking names that nobody tracks becomes a candidate: Tora creates it and collects it like a watched item (sales backfilled), the top 30 of each ranking only; it drops out of collecting when it leaves the ranking for 30 days and nobody tracks it.
- Opportunities page in the menu after Watchlist: tabs per item type; each row the item and condition, the signals on today with their reasons and past records, the warnings, a lowest ask under value, Watch.
- Trust: a signal ranks items only when proven on its group's past prices: followed by a higher price 90 days later more often than buying on any day, by 5 points or more, over 10 or more checks. Others are shown as "not tested yet" (e.g. listing-based ones until enough days are saved) without moving the ranking. Tested again after each collect, so a signal that stops working stops ranking.
- Budget and date (part 4): Tora ranks the candidates with a suggested buy day (now, or wait until a date, from the new-release wait and the buy zone) and price; the person ticks the items, Tora checks they fit the budget and the date.

Test on the real history (2026-10-21, read only; weekly checks, the first day of each stretch a signal is on): share higher 90 days later. Boxes (any day 80 %): sales up 1.5x 96 % of 46, line rising 94 % of 32, leader in its line 95 % of 20, laggard in a rising line 77 % of 13. Singles (any day 60 %): line rising 81 % of 96, laggard in a rising line 79 % of 76, sales up 73 % of 143, sales up with a flat price 75 % of 64, leader 66 % of 115; warnings: sales down 38 % of 117, line falling 44 % of 97. Strong or weak for its age (the last 90 days against similar items at the same age): too few checks (6-45), most box histories start long after release. Most of the history is the 2023-2025 Pokemon rise, which flatters momentum signals: hence the daily re-test.

Parts:
1. Signals and their tests (core and db): per item (the condition with the most days of sales), after each collect: the line's 12-week change (rising 10 % or more, falling 10 % or more), the item against its line (leader or laggard by 15 points), sales volume (last 30 days against the 90 before: up 1.5x with 10 or more sales, down to 0.6x), against similar items at its age; facts not tested: the lowest ask under fair value, shop buy prices near it. Each signal tested per group of similar items on the whole history; today's signals and the tests saved in one setting. MCP tool.
2. The Opportunities page.
3. Ranking sources as a plug-in kind (documented like collectors), a SNKRDUNK sealed-box ranking (private), candidates created and collected.
4. Budget and date.

Built, part 1 (2026-10-21, no migration):
- @tora/core `opportunities.ts`: `OpportunityGroup` (an item's numbers on a day from the prices up to it: fair price, its 12-week change and its line's, sales in 30 days against the 90 before, the last 90 days against similar items at the same age; the tests on the group's whole history, every 7th day, the first day of each stretch a signal is on, checked 90 days later against any day), `signalsOn`, `provenEdge`, `rankOpportunity`.
- @tora/db `refreshOpportunities` after the rule tests in the collect (and in `pnpm rebuild`): every item, any person's, on its series with the most days of sales; the lowest ask on that same source (another site's cheapest listing is too often something else: Mercari asks at 34-55 % of SNKRDUNK prices, likely other things) and the latest shop buy price (30 days); saved in the setting `opportunities` (57 KB for 119 items, 2 s). `loadOpportunities`: ranked (proven signals first, then the sum of edges, warnings counting against), an ask 15-50 % under the recent price flagged (under half is likely something else), a shop buy price at 80 % or more flagged.
- MCP tool `opportunities` (item type, limit; items priced from a source Claude may not read left out).
- On the real data (read only): 119 items, 18 with a proven signal. Boxes: leader 96 % of 26, line rising 95 % of 62, sales up 98 % of 41, weak for its age 92 % of 13, laggard 85 % of 20 (any day 80 %); sales down 63 % of 40 (a warning); the main line is falling 27 % over 12 weeks now (5 past checks, not proven). Singles (any day 60 %): line rising 78 % of 125, sales up 72 % of 147, laggard 70 % of 84; leader 62 % (not proven); warnings sales down 42 %, line falling 43 %.
- Noted for S10: Buy timing's "a listing in the zone" uses the cheapest ask of any site, so Mercari's mismatched listings reach it. Fixed in S10 part A (2026-10-23): the price source's own ask, as Opportunities.

Built, part 2 (2026-10-21, no migration):
- Opportunities page (`/opportunities`, menu after Watchlist; "Ideas" / 狙い目 in the phone bar): tabs per item type (the type with the most items worth a look first). "Worth a look": items with a proven signal, ranked; each with its condition, Owned / Watching, the recent price, a same-site listing 15-50 % under it, a shop buy price at 80 % or more, every signal on today (proven, warning, not proven) with why it is on (the numbers) and its record (higher 90 days later X of Y, any day Z), Watch (the watch steps with the item picked). A line counts the items with only unproven signals or warnings. "Signals and their record" per group of the type: any day and each signal (checked, higher 90 days later, typical change), proven and warnings marked, with the caveat on a rising market. Rows open the item page in the studied condition.
- Guide docs/opportunities.md.
- Not seen in a browser: the sandbox cannot build the app (SWC cache check); typecheck only.

Built, part 3 (2026-10-21, migration 0053):
- Ranking sources as a plug-in kind (`RankingSource` in the SDK, `rankings` in a package's entry point, docs/collectors.md): once a day with the nightly collect, before the collectors. Table `rankings` (ranking, day, rank, the source's id, the item, title, page, price, numbers); a second read the same day replaces it; merges move it. Matching: the source's id (product links), else an item of the same kind from the same catalog set (the set named in 「」 or after the pack word) or with the same name; never a new link to a known item (matching stays the collectors'). The top 30 matching nothing become candidates (a product with no creator, linked to the source, its catalog set linked at once), collected like watched items while in the top 30 within 30 days.
- Opportunities page: per ranking a "Popular now" table in its item type's tab (rank, change in a week, price, listings, favorites, owned / watching / candidate), a ranked item's rank on its row, candidates marked. MCP `opportunities` adds ranks and candidates.
- Not yet: rank changes as signals (tested once enough days are saved).

Built, part 4 (2026-10-21, no migration):
- @tora/core `plan.ts`: `planStep` (from an item's saved buy timing numbers and the person's strategy: buy now at a good price, the zone's listing when cheaper; from a day for a new release, the release plus the usual low age; under a price when falling, its market falling or above the zone, the zone's top; none without a price) and `checkPlan` (the ticked items' total against the budget, those after the date, those waiting for a price).
- Buy timing numbers are saved each night also for items with a proven opportunity signal, ranked candidates and items in anyone's plan (`refreshSignals`).
- Opportunities page, top: "Budget and date" (budget, date, the items offered: proven opportunities, the person's watches, the plan's items, each with when, the price and why; ticks; the total and what is left, late or waiting), saved in preferences `buyPlan`. docs/opportunities.md.
- On the real data (copy): 19 items offered, none a good price today (9 wait for their market's fall, 9 above their zone, 1 new release until 2027-02-18), consistent with the main line's 27 % fall.

<a id="s19"></a>

## S19: Database reads within the free plan

Added at the user's request (2026-10-17), highest priority. On 2026-10-17 Turso blocked the database for the rest of October (past the free plan's 500M rows read; one analysis query run on Turso caused the last jump, and the Portfolio and the collect read far more than needed). Tora must work on Turso's free plan reliably and with leeway (user: "it's supposed to be used for free with enough leeway").

- Measure: rows read per collect and per page view, on a local copy (replaying each statement with a scan counter; one full pass over the 228k sales is about 0.9M VM steps). Measured so far per collect: values ~2.3M, buy timing ~2.5M, snapshots ~1.7M, lot sizes ~0.75M, quality ~0.6M rows; the Portfolio chart ~0.3M per view (trade counts, 1.7M per view, now saved per collect).
- The collect's closing steps redo only items with new sales (values, snapshots, buy timing, lot sizes, quality): the collect stays on Turso (decision log 2026-10-18).
- Page data saved until the next collect (Portfolio chart, item pages), never scans of every sale on a page view.
- A monthly budget well under the 500M (rows per collect x 31 plus page views with room to spare), written down, and a check that warns before it is near.
- Never heavy analysis on Turso: on the local file or a backup copy.
- Measured exactly on 2026-10-18 (decision log): closing steps 2.8M per run, backup 0.3M, Portfolio 128k per view, item page up to 189k, Settings > Collectors 240k.
- Claude Code's heavy queries (the MCP `query_sql` tool, analysis scripts) read last night's backup, unpacked after each backup to a fixed local file; the other MCP tools stay live (a few hundred rows each). No embedded replicas by default (decision log 2026-10-18).
- The app counts the rows read Turso reports (per day and origin: pages, collect, backup, MCP), shows the month so far in Settings, and alerts admins past a budget (well under 500M).
- Where the page reads go (2026-10-18, measured per function): the item page runs about six queries that each read all of the item's sales (busiest item 14.5k sales: priceHistory 14k, foreignPrices 14k, bucketStats 14k, listProductSources' per-source counts 29k, recentObservations 29k; search-based sources add sourceObservations and keptObservations per source); saved values (bucket_values) do work. Settings > Collectors: sourceHealth's price-jump check reads every sale of each source (37 days filtered after reading). Portfolio: portfolioSeries joins every valuation snapshot (62k) with holdings.
- Build list, in order (2026-10-18; done items marked):
  1. Analysis copy for Claude (done, 7ee7cc3) and the hard stop on Claude reading Turso (done, 927868d plus local settings).
  2. `price_days`: per item, source, condition and day, the kept sold prices (sorted list, base currency) and how many were estimated lots; refreshed for items with changed sales (new sales, exclusions, lot sizes, merges) plus a weekly full rebuild. Read by the item chart (priceHistory), bucketStats, the per-source counts, the buy timing step (dailySeries) and the strategy page, instead of the raw sales. Done (migration 0031): per item, source, condition, currency and day; triggers on the sales mark the changed days (`price_days_dirty`, whatever made the change: collect, app, a fix by hand), rebuilt after each collector run, in the collect's closing steps, after exclusions, merges, deletions and search changes in the app, and fully once a week, after a time zone or base currency change and on `pnpm db:migrate` the first time. Same results as the raw sales on every item of the 2026-10-18 backup. Measured: the busiest item's chart, condition stats and source counts 602, 602 and 613 rows (were 14k, 14k, 29k), the buy timing step 219k (was ~2.5M), a full build 247k read and 112k written, a simulated night 47k read and 23k written. The MCP `query_sql` guard also covers `price_days`, and `price_history` no longer returns sources kept from AI.
  3. One new index `price_observations (product_id, source, observed_at)`: latest-sales lists per source with a LIMIT (recentObservations merges the per-source lists), foreignPrices, sourceObservations, keptObservations. Done (index in 0031, 41e11f0; latest sales per source merged): busiest item latest sales 391 rows (was 29k), foreignPrices 28 (was 14k), sourceObservations 30 per source (before, the planner read the whole source through the source + reference index), keptObservations 139-404 per search source.
  4. Saved at collect: sourceHealth's price jumps (an app setting); the Portfolio chart per person (one saved row with the series, recomputed when the person's holdings fingerprint (ids, quantities, costs, tracking switches, status) or the snapshot run changes). Done (migration 0032): the price jumps read the sales per day through a (source, day) index instead (always current, no saved copy): Settings > Collectors 12.9k rows a view (was 240k), same jumps as before on the backup; the chart is saved per person by the snapshot run (summed from what it wrote, no extra read) in `portfolio_charts` with a fingerprint of the person's lots (ids, costs, tracking switches), summed again by the page when it differs: 99 rows a view (was 128k), 125k once after a lot changes, the same series as before on the backup.
  5. Incremental closing steps (values, snapshots, buy timing, lot sizes, quality: only items with new or changed sales). Partly done (2026-10-18), differently: values and snapshots also change as days pass (a sale leaving a window), so skipping items without new sales would leave wrong numbers; instead the steps read the sales per day where the result stays the same: value windows counted from `price_days` (whole days inside each window: never above the exact count, so a window is never too short) and shop prices read per named source, the quality gate, trade counts, first-sale dates and the lot-size item list. Values and the quality gate gave the same results as before on the backup. `insertObservations` rebuilds the days it adds, so the sales per day never lag behind the sales. Measured per collect: lot sizes 187k (was 377k), quality 37k (323k), values 166k (679k), trade counts 54k (230k), buy timing 144k (219k), snapshots 305k (unchanged): about 0.9M in all (was 2.8M on 2026-10-18 morning). Then lot sizes check only the last 14 days' estimated trades each night and all of them once a week (user, 2026-10-18; an older estimate changes only when a sale near it changes, so it may lag up to a week; `pnpm valuate` checks all): 16k a night (187k weekly). Snapshots stay a full nightly redo (user, 2026-10-18: one day's value looks back a year of sales, so recent days only would save about 0.1M while edits to lots, manual prices or source quality would reach past days only weekly).
  6. The rows-read counter and budget alert (rows_read from Turso's responses; check the client exposes it, or read the HTTP JSON protocol). Done (migration 0033): the client drops the counts, so `createDb` wraps its fetch and adds up each reply's `rows_read` and `rows_written` (the client always speaks the JSON protocol, version 2) per UTC day and origin (pages, collect, backup, mcp, or the script's name; `TORA_ORIGIN` to name one), saved to `db_usage` every 30 s and when a program ends; the backup's copying client is counted too. Settings > Admin preferences > Database shows the month so far, the pace, per origin and per day, and the budget (150M rows read by default); the daily check (`checkMissedRuns`, app cron and `pnpm alerts check`) alerts admins once a day past the budget or heading past it from the 5th. Checked against the local server's own count: 157,329 counted vs 157,243 (the difference: setup queries before the server's count started).
  7. Measure again (target about 1M rows a day in all), write the budget down, then the switch back after 2026-11-01. Measured 2026-10-18 on the local server with the backup copy (page data calls, as Turso counts them): Portfolio 2.9k rows a view (was 128k+), item page 2.9k-4.8k (was up to 189k), Watchlist 15, Actions 1k, Settings > Collectors 13k (was 240k); a night: closing steps about 0.77M (sales per day ~50k, lot sizes 16k, quality 37k, snapshots 305k, values 166k, trade counts 54k, buy timing 144k) and the backup 0.37M; weekly also the full sales-per-day build 0.36M and all lot sizes 0.19M. Budget written down: about 1.2M a night plus 0.08M a day of weekly work plus pages (100 views a day about 0.3M) is about 1.6M a day, about 50M a month (10 % of the free 500M), plus the collectors' own reads while collecting: last night (2026-10-18, 8,473 new SNKRDUNK sales, about 300 listings) replayed through the runner with a stand-in collector came to at most 0.2M read and 77k written (a source with nothing new about 14k; already-stored sales are skipped through the unique index, never by reading old sales). In all about 1.7M a day, about 53M a month (11 %). The schedule runs the collect once a day (hourly triggers stop at once after a successful day; the extra runs in the log were failed starts). Check the real numbers in Settings > Admin preferences > Database after the switch back. Once a day per item (user, 2026-10-18): a retry the same day already left out listings collected that day; now it also leaves out items searched that day with no match (`matchSearched:<source>` setting), and the closing steps when it fetched nothing (`closingStepsDay`; `--refresh` runs everything): a retry with nothing left reads about 22k rows (was about 0.8M). The alert budget defaults to 150M (3 times that). Done except the switch back.
- Part 2: 10 users within half the free plan (decision log 2026-10-18), in order (done items marked):
  1. `item_sales`: one row per item: its kept sales, shop asks and buy prices, grouped by source, condition, currency and type, each with its exact time, price and estimated-lot flag, plus per-source counts of every observation; replaces `price_days` (same triggers and marks; a marked day is replaced in the packed row from that day's raw sales). Read by values (`loadHoldingsMarketData`, `loadMarketData`), snapshots, buy timing, quality, trade counts, first-sale dates, the item chart, condition stats and source counts. Done (migrations 0034, 0035 drops `price_days`): values, snapshots, buy timing, quality, trade counts, first-sale dates, the lot-size item list, the item chart, condition stats and source counts read it (the quality gate, trade counts and condition stats exact again, no whole days); the odd-sales review and the MCP data checks keep the raw sales (they point at single sales); `query_sql` refuses `item_sales` (every source in one row). Checked on the 2026-10-18 backup: every value, the snapshots of all 1,099 days, the quality results (at the same moment) and every item's counts and condition stats identical to the raw sales (two lots' "last sale" differ only between two sales in the same second). Measured: values 1.3k rows (was 166k), buy timing 2.8k (144k), quality 235 (37k), trade counts 406 (54k), snapshots 64k (305k: what is left is reading every saved snapshot), lot sizes 9.5k a night, the busiest item page 1.1k (2.9k), Settings > Collectors 1.9k (13k); a full build 247k.
  2. The value history packed per lot (`holding_values`: one row per lot with its daily value, method, source, samples, confidence, estimated flag) in place of `valuation_snapshots` rows; the snapshot run reads one row per lot and writes only lots that changed; the Portfolio chart sums them. Done (migrations 0036, 0037 drops `valuation_snapshots`; `pnpm db:migrate` builds the history the first time): the market movers of the Portfolio insights are saved by the snapshot run (`marketMovers`), the user's own movers read their lots' rows; a base currency change rebuilds the history from the converted sales. Checked on the 2026-10-18 backup: the same 62,208 lot-days, both accounts' charts and every period's movers identical to the old table. Measured: snapshots 1.5k rows a night (was 64k, 305k before part 2), the Portfolio 1.1k a view (2.9k); all closing steps together about 16k a night (0.77M before part 2).
  3. The nightly self-check (a few random items recomputed from raw sales and compared; rebuilt and an admin alert on a difference) and `pnpm rebuild` (every saved result from the raw sales). Done (migration 0038): in the collect's closing steps, the items checked longest ago (`item_sales.checked_at`) up to about 20k raw sales a night are packed again from their raw sales and compared exactly; a difference is fixed at once and recorded as a failed check (alert to admins, Activity); items with changes still marked wait a night. With it, the full rebuild of the packed sales runs monthly instead of weekly. On the backup: all 95 items checked, no difference; `pnpm rebuild` on a copy changed no value history.
  4. The backup leaves out rebuildable tables; a restore rebuilds them. Not done (2026-10-18): once packed, those tables are a few hundred rows (one per item or lot), so leaving them out saved about 350 of the backup's 253k rows (the raw sales are the rest); not worth a restore step. The backup is the largest remaining cost (see 5).
  5. Measure at today's size and model 10 users. Done (2026-10-18), with a simulated 10-user database instead of multiplying (it caught costs that grow faster than the data): the backup with every item cloned 5 times with its sales and listings and 9 more people each holding half the admin's items and half of one clone set (11 people, 576 items, 1.48M sales, 1,011 lots, 2,112 listings, three years of value history). Measured there: closing steps about 85k a night (lot sizes 57k, snapshots 11k, buy timing 9k, values 4k, quality 1k, trade counts 2k) plus the self-check 20k; pages: Portfolio 1.5k, an item page 1.1k, Actions 1k, Settings > Collectors 7.8k (admins); the backup 1.5M a night; the monthly packed-sales rebuild 1.48M and the weekly all-lot-sizes check 0.79M. A night's collect replayed at that size read 0.77M after fixing what it exposed (items to match looked up one by one, look-alike listings re-read per item, and the planner reading whole tables through the status and source indexes; was 1.06M); that night was mostly a one-time history backfill (of last night's 8,841 new sales only about 450 were from the last two days), so a steady night reads far less and writes about 20k rows (0.6M a month of the free 10M). Model at 10 users, steady state: collect 0.1-0.2M (up to 0.7M on backfill nights), closing 0.1M, backup 1.5M, monthly and weekly checks 0.16M, pages 0.4M (11 people, 30 views a day): about 2.4M a day, 70M a month, 14 % of the free plan (about 1.4 % per user; the target was at most 50 %, 5 % per user). The backup is about 60 % of it. Kept as a full daily copy (user, 2026-10-18: simplest and safest; revisit if the in-app counter shows usage climbing).
- Measuring tool: a local libsql-server (sqld, github.com/tursodatabase/libsql releases, libsql-server v0.24.32) serving a copy of the database, started with `--max-response-size 500MB`; its admin endpoint `/v1/namespaces/default/stats` gives rows_read_count (Turso's own count). Pages are measured by running the app against it with a login that exists only in that copy.

<a id="s20"></a>

## S20: Box opening value

Added at the user's request (2026-10-17), after S9 part 5. At what box price opening a box is worth it: the expected value of its hit cards (pull rates x the cards' prices, after selling fees) against the box price, the break-even price, the chance of getting the box price back and the median box, and which cards carry the value. Also a "sealed premium" (box price / contents value), a signal for S13.

- Feasibility test (2026-10-17, read only, SNKRDUNK lowest asks, community pull rates): テラスタルフェスex worth opening under about ¥5,800 (box ¥18,963: 31 % back on average, 5 % of boxes return the box price; at retail ¥5,500 about break-even); バトルパートナーズ about ¥5,300 (box ¥10,509); 151 incomplete (search paging). Sealed boxes sell at 2-8 times their contents; most boxes lose even at break-even.
- Pull rates are not official and sources disagree: entered per set and rarity by the admin with the source (prefilled where known). Hit card prices: a weekly SNKRDUNK search per set and rarity (needs paging; leave out graded cards and error prints), lowest asks, saved. Per franchise, its own box structure.

### Built (2026-10-19)

- Pull rates per catalog set (`opening_sets`, migration 0043): the set code as SNKRDUNK titles its cards (古代の咆哮 and 未来の一閃 are SV4K and SV4M, the catalog has SV4 for both), packs a box, and per rarity how many a box holds on average, optionally only the cards whose name holds a text (テラスタルフェスex: Pokemon ex SAR one a box, the other SARs 0.4; VSTARユニバース likewise with V). Suggested rates for 20 Japanese Pokemon sets ship with Tora (`packages/core/src/pull-rates.ts`, each naming its source: price-base.com simulators, premium.gamepedia.jp's general table, altema.jp, magi.camp, snkrdunk.com, torecamap.co.jp); a set without a saved row uses them. 30th CELEBRATION: no estimates published yet. ホワイトフレア's BWR left out (unknown). Settings > Admin > Box opening: one form per set of a tracked booster box (code, packs, rarities, source; back to suggested) and the selling fee taken off every card (10 %).
- Hit cards (`opening_cards`): a new plug-in kind, `SetCardSource` (docs/collectors.md), run by the nightly collect: each set once a week and again after its code or rarities change, at most 5 sets a night (never read first, newest sets first, then the longest ago; about 45 requests a set). SNKRDUNK's (private collectors): searches "<set name> <rarity>" then "<code> <rarity>", cards then single listings until two pages bring nothing new; special arts (`SR:SA`) are rarity SA; slabs, error prints and 海外限定 left out. The ten cards carrying most of the value get the median of their last 10 single condition A trades within 60 days, else their last 5 within a year (the plain sales history is mostly slabs).
- The value (`openingValue` in core): the average of a box's hits (rate x the rarity's average card value after the fee) is the break-even box price; the spread from 20,000 simulated boxes (each pack has a hit of a rarity with the same chance, any card of it alike, seeded so every view agrees): the share of boxes paying back the box price, the median box, one box in ten below and above. Box price: the shrink-wrapped box's market value, else its lowest ask. Sealed premium: box price / break-even.
- Item page > Opening (booster boxes): the verdict at today's price, the numbers, the return at retail, the cards carrying the value (price from sales or ask, how often a box holds one, part of the value) and the rates used with their source. Watchlist > Box opening: the person's boxes, best average return first.
- Dry run (2026-10-19, a copy of the local database, all 20 sets, 0 failures): average return at today's prices from 25 % (ポケモンカード151, box ¥44,000, hits ¥10,900) to 82 % (未来の一閃); no box pays at today's price; boxes paying back from 2 % to 27 %. A few cards carry a set (ルギアV SA ¥125,000: 73 % of パラダイムトリガー; ブラッキーex SAR 31 % of テラスタルフェスex). Cards never traded keep their lowest ask, which can be high (メテノ AR ¥19,999 in レイジングサーフ).

### Built, part 2 (2026-10-20)

- Pull rates are a plug-in kind, `PullRateSource` (docs/collectors.md): a plug-in package exports `pullRates`, each giving `SuggestedRates` (franchise, region, a text of the set's name, code, packs a box, rarities, source). They are saved with the other plug-in data each time the plug-ins load (a collect, an import, `pnpm plugins`; written only when they changed, one settings row) and read from there by the app. The 20 Japanese Pokemon sets moved from Tora's core to the public plug-in package (`collectors-public/src/pull-rates.ts`); core keeps only the type and the matching. Checked on a copy of the local database: the same 20 of 21 box sets get suggested rates.

<a id="s25"></a>

## S25: Store notices

Added at the user's request (2026-10-19). People post on community boards when cards go on sale in a physical store, mostly in store codes instead of names; nobody can watch the page all day. Tora maps the posts to stores and sends a notice (Discord, Telegram: S17) for the stores in the person's area only.

- Stores (shared, filled by store directory plug-ins, corrected by the admin): chain, name, the codes and nicknames posters use, prefecture, coordinates.
- Feeds: posts are pushed to the app (`POST /api/feed/posts`, a personal token made in the Stores page): source, post id, time, text, link, the board's chain. The reading is a plug-in's business (e.g. a userscript in the person's own browser, kept private); the push format is documented for others. A heartbeat shows whether the feed is alive.
- Matching: a post's store from the codes and names of its chain's stores; posts without a store are kept and shown, not sent.
- Area: picked stores, or a point (the browser's location, rounded to about 100 m, no address) and a distance; travel mode: another point or stores until a date, then back. Each store on or off for notices. Several posts about one store close together make one notice.
- Stores page (main navigation): the area and travel mode, the stores of the area with their switches, recent posts (the area's first), the feed's status and token.

### Built (2026-10-19)

- General part (330f025, migration 0044): stores from store list plug-ins (`StoreDirectory`, saved by every collect or import and by `pnpm plugins`, only what changed is written; admins add codes on the Stores page), posts pushed to `POST /api/feed/posts` with a personal feed token (made on the Stores page, hash kept), the area in the person's preferences (picked stores, or a point from the browser's location rounded to about 100 m and a distance; travel mode until a date; muted stores), notices on Discord or Telegram for posts of the last 30 minutes naming a store of the area, one per store every 30 minutes, none for a feed's first push. Stores in the main navigation. docs/store-feeds.md documents both plug-in kinds and the push format.
- Posters' names (user: some name their store in it): posts carry an `author` (migration 0045), and stores are looked for in it as well as in the text. Emoji codes match with or without their variation mark.
- Follow-up (user, 2026-10-19): the feed always opens a board's newest page (an older comment page goes stale once full), and one tab can watch several boards in turn. Stores added or removed by hand on top of a distance (`added` next to `muted`). The Stores page (and the box opening pages, S20) use the wide layout; the Stores page says how many stores get notices and where they go.
- No silent failures (user, 2026-10-19, migration 0046): the feed's person is told when the feed has been silent longer than their limit (5-60 min, default 10) within their hours (default 08:00-23:00), once, and when it sends again; about recent posts naming no known store on a board whose chain has a store list (can be switched off); and when a push of 10+ posts is all new but one (the pinned post) on a board seen before (a page turned over: posts maybe missed). The silence check runs every 2 minutes inside the app's server on the home PC (instrumentation.ts); a hosted app needs an outside scheduler calling `GET /api/feed/check` with CRON_SECRET. Settings on the Stores page.
- Other chains (user, 2026-10-19: both lists and an in-app form): posters' codes can be area codes shared by every chain, and one board may mix dozens of chains. So besides stores there are places (chain `place`): an area's name or code with its location, matched when no store of the board's chain matches; a board mixing chains is matched to places only (a chain's codes count on its own board). Admins add a store (any chain, or a new one) or a place on the Stores page, with codes and a location (map coordinates or the browser's), and remove those they added. Unknown-store messages cover every board (questions and chat come too).
- Boards seen apart (user, 2026-10-20, migration 0047): the userscript (1.3) sends the board it read and every board it goes through; the Stores page lists each board's last visit, posts read and last posts (red when none for longer than the silence limit); a board giving no posts for that long while the feed runs is told once (an access check or a changed page), and again when it gives posts; "connected to the browser feed, tracking these boards: ..." is sent on the first push, after a silence and when the list changes. One tab can watch all four boards in turn; a tab on a board not in the list stays on it (1.2), so separate tabs work too. Stores page filters come from the lists (chains with counts, the chain's prefectures, notified only or all).
- Review (user, 2026-10-20): the feed's board list accepts commas of any kind, spaces and native names, and says what it understood. Stores page: a Codes card (each code that is more than a name, with what it stands for, from the lists) and other codes (a store list's `glossary`, and the admins'). Posters' codes stay in private plug-ins only. Reads cut for the hosted database: "posted before" checks read one row instead of counting every post, the store list is kept 5 minutes in memory, posts older than 30 days are dropped. General wording (region, "check the feed"), and a userscript skeleton in docs/store-feeds.md for other people's feeds.
- Stores as sub pages (user, 2026-10-20, migration 0048): Posts (the latest posts and the codes, the default; the Area page first until an area is set), Feed (state, each board, boards to watch, alerts, token) and Area (the area and the store list, set once, last); all wide, Posts and Feed refresh every 30 s (the page had shown one board only because it was drawn before the tab went round the others). Boards to watch chosen in the app too ("All", or each board; "let the feed decide"): the feed says which boards it can read (`offered`) and the answer to each push carries the choice (`watch`), which userscript 1.5 follows; its menu has "watch all boards".
- Reads measured (user, 2026-10-20: within 50 % of the free plan at 10 users; migration 0049), on a local libsql server counting rows read like Turso, with 10 users, 188 stores and a month of posts (6,000). Before: a push 48 rows (token 11, push 37), the silence check 246, a Posts page 438 and a Feed page 378, pages reloaded every 30 s: about 57M a month at 10 users (11 % of the plan). After: the feed token indexed (3); userscript 1.6 sends only the posts it did not send before, with `seen` and `gap` (a quiet push 3 rows, one with a new store post 36); the person and their feed read once per push, nothing else when there is nothing to say; the silence check 20 (its hourly prune ~230); pages read the store list from the 5-minute cache and sort it in code (the database counted every row twice for the sort), and reload only when the newest post or the feed changed (a 2-row check every 20 s): Posts 62, Feed 2. Estimate at 10 users, each with a feed tab 15 h a day and the Posts page open 2 h: about 6M rows read a month (about 1 % of the plan), and about 0.4M rows written (4 % of the free 10M), mostly the feed's state per push. One feed serves everyone (posts are shared), so fewer feeds read less.
- "Connected" after a restart (user, 2026-10-20): the notice came only on the first push, after a silence alert or when the boards changed, so a quick restart or a script update went unconfirmed. A push may now say `hello` (userscript 1.7: once per tab or browser session, and after each update), which is answered with "connected, tracking these boards". Not on Tora's own restarts: a hosted app's servers start and stop all the time.
- Fewer posts at once (user, 2026-10-20): the Posts page shows the 20 newest (all posts, or only the area's) and loads 20 more as the list is scrolled (one more row read than shown, to know whether more follow; no count); the Area page's store list shows 20 and more as it is scrolled.
- Replies and product names (user, 2026-10-21; migration 0051): replies under a post (a line forming, sold out) are often folded. The feed may send each reply with the post it answers (`replyTo`), and the board's list of product codes when it changes. Tora keeps each reply's thread, gives a reply naming no store its post's stores, and sends replies at once to the people whose area holds the store, as "Comment to <store>" (also within the store's 30-minute quiet time). Notices (user: no translation, just decoding, no cost; the original when nothing decodes): the time, the store in bold, the products its codes stand for (a reply without any takes its post's), then the post as written, quoted; Discord Markdown and Telegram HTML, the post's own text escaped. Product codes: the board's list and the admins' (Stores > Codes, a Product tick); an admin's and emoji codes count anywhere, the board's one- and two-letter codes only among other codes and common words. The Posts list marks comments and shows the products.
- Notices easier to read (user, 2026-10-21; migration 0052): the first layout was mostly bold. Now a small heading, then one card per post: on Discord an embed with a colored edge (orange a post, blue a comment), the store as its title (linked to the post), the products in italics, the post as written in a quote, the date and time ("10-21 18:00") under it; on Telegram the same in HTML without colors. Short English store labels (user: short names, not exact translations) for people reading another language than the stores' own, in notices and on the Posts list; stores added by hand show their names as written. Since 2026-10-23 a store list says the language its names are in and a store carries labels per language (`labels`, migration 0054), the English one for any language without its own.
- Pictures (user, 2026-10-24; migration 0059): posters often attach a photo of the shelf. The feed may send a post's pictures with it (`images`, base64, up to 4, 8 MB each; JPEG, PNG, WebP or GIF, told from the bytes, anything else left out). Tora keeps them a week (then deletes them, at most once an hour as pushes come; the post stays), sends them after the notice's text (Discord: one message with the files; Telegram: a photo or an album), and shows them under the post on the Posts page (served by the app, behind sign-in). A picture that does not go never fails the notice. The feed shrinks them first (the reference userscript: 1600 px, JPEG), since every backup holds the week's pictures.

<a id="core-6"></a>

## Core section 6: Valuation rules (as written 2026-10-09 to 2026-10-12)

A record, moved out of requirements.md on 2026-11-24 when [docs/rules/values.md](rules/values.md) became the home of these rules. It is not current: the year-long window, the pooling of similar conditions and the admin's source roles came later (Decision log, 2026-10-11 and after).

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

<a id="buy-timing-record"></a>

## Buy timing guide: the numbers, strategies and rule tests (as written 2026-10-17 to 2026-11-03)

A record, moved out of docs/buy-timing.md on 2026-11-24 when [docs/rules/buy-timing.md](rules/buy-timing.md) became the home of these rules. The measurements in it (the market-wide check, why the wait is learned, how the zones did) are of their dates; the rules in it are not kept current here.

### The numbers (saved daily)

At the end of each `pnpm collect`, for every item and condition someone owns or watches (table
`signals`, one row per day):

- **Fair value**: the item's market value (the same as everywhere in the app).
- **Daily prices**: the median of each day's sales from the source the value comes from.
- **Ranges**: the lower and upper quarter of the last 180 days' daily prices (10+ days with sales
  needed), the lowest tenth of the last year (20+ days), the usual price (the 180-day median).
- **Trends**: the fitted change over 2, 4 and 12 weeks. Falling fast: over 5 % down in 2 weeks and
  still down over 4.
- **Lowest ask** now (from the nightly collect's "for sale now").
- **Release and the new-set pattern**: days since release (the set catalog's date or the item's
  own; a first collected sale is shown but not used here). In an item's first year, similar items
  (same kind, franchise and language; games: kind and platform) with prices at this age and 90
  days later give the typical change; 3 or more items are needed.
- **The new-release wait**: the age at which similar items usually hit their first-year low (the
  median over items with a full first year: prices from their first month to past day 300, released
  a year ago or more; 3 or more needed).
- **Set lines**: a set's place in its franchise's releases (main expansion, sub-expansion, high
  class pack, special or anniversary; the list is an admin setting under Settings > Admin
  preferences > Categories). Pokemon items get theirs from the official set title (拡張パック,
  強化拡張パック, ハイクラスパック, anniversary or concept packs); others are set by hand on the
  item's edit page, by the person who made it or an admin. The new-set pattern, the new-release
  wait and the market use the item's line when it has 3 or more items (5 for the market), else the
  whole group, and the app says which ("Similar items (4, Sub-expansion only)"). Tora suggests a
  line on Actions for an item without one whose first 3 months moved 20 points or more unlike its
  group and within 10 points of a line's items.

### Strategies

Each person picks one per item type; until then Tora's suggestion is used. A target price on a
watch always counts too.

| Strategy        | Good price when                                               | Suggested for |
| --------------- | ------------------------------------------------------------- | ------------- |
| Steady          | today's value is in the cheapest quarter of the last 180 days | sealed, cards |
| Bargain hunter  | in the cheapest tenth of the last year                        |               |
| Margin          | X % under the usual price (X chosen, 10 by default)           | games, others |
| Catch the dip   | like Steady, and still while falling fast (with a warning)    |               |
| Own target only | never: only the watch's target price                          |               |

All but Catch the dip say "Falling: wait" while the price falls fast, or while its market does: the median 12-week change of similar items (5 or more, any person's) is under -15 %. Over the two years of collected prices up to October 2026 the market-wide check never triggered (dips were short); it was added for the broad fall from July 2026 (cards' median -29 % in 12 weeks), longer than any before it. Without enough history for
a range, the zone is 10 % under the usual price (with almost none, under today's value, so only a
listing can be in it), and the app says the data is limited. In the first year, the new-set
pattern lowers the zone when similar items kept falling at that age.

A new release (a real release date, not a first collected sale) says "New release: wait" until
the age at which similar items usually hit their first-year low, or 90 days when fewer than 3
similar items have a full first year (Catch the dip warns instead). Why learned and not fixed: a
backtest on the 16 items with a real release date and early prices (October 2026) found the lows
at about day 119 for one box, past day 63 for another and day 112-357 for singles; a fixed 90 days
is arbitrary, and a "price has settled" rule was fooled by pauses in a falling price.

The strategy page tries each strategy on three fixed examples, the same for everyone and
independent of anyone's items (`packages/core/src/strategy-examples.ts`): real SNKRDUNK price
series with the item hidden, the dates moved and the prices rescaled. Steady with dips (a PSA 10
card over a year), a long fall (a box falling for months, then flat, then recovering) and a new set
(a box from its release: hype, a dip, a recovery; strategies other than Catch the dip wait 90 days
after release). Per example: the days each strategy would have called a buy, the average price
paid against the period's average, and how often the price was higher 90 days later. Each past day
is judged only on the prices before it.

### Rule tests

The Buy timing page shows how the person's strategy did on the whole price history of similar
items (the item's line when it has 3 or more items and enough signals, else the whole group),
worked out after each collect: each past signal (the first day of each stretch at Good price, each
day judged only on the prices before it, without the market check or the new-set pattern) is
checked against the typical price 90 days later, next to buying on any day. Shown from 10 checked
signals. On the data up to October 2026 the zones paid less than average but were no sign of a
rise: Steady signals were followed by a higher price 90 days later less often than any day (sealed
boxes 25 % against 67 %, PSA 10 cards 33 % against 58 %), because a fall into the cheapest quarter
usually went on for a while. Rethinking the strategies is planned with S13.

<a id="opportunities-record"></a>

## Opportunities guide: ways, potential, budget, rankings, signals and tests (as written 2026-10-21 to 2026-11-07)

A record, moved out of docs/opportunities.md on 2026-11-24 when [docs/rules/opportunities.md](rules/opportunities.md) became the home of these rules. Not kept current here.

### Ways of spotting a deal

Worth a look has one more filter (`?way=`, S32), for the chosen item type. It is a view, not a
signal: no way has a record, so a way does not rank, count as proven, or feed alerts, the plan or
scores. Items today's numbers leave unknown are in no list. A chip shows only with items on.

| Way                        | On when                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falling hard               | the last 14 days 20 % or more under the 60 before (`quick_rise`'s mirror)                                                                                   |
| Cheap, fall paused         | the `cheap_steady` signal                                                                                                                                   |
| Sales picking up           | the `sales_up` signal                                                                                                                                       |
| Listings drying up         | the listings count 30 % or more under its count 14 days ago, from 5 or more: the item's price source and condition, the report at most 3 days from that day |
| A listing under the market | the lowest ask 15 % to 50 % under the recent price, as on the card                                                                                          |
| Rising fast                | the `quick_rise` signal                                                                                                                                     |

The rule is `dealWayStates` in `packages/core`, which the measure reads too. A list by way shows
one line with its record per item type from the measure of 2026-11-07 (`dealWayRecord`: "weak or
mixed" or "cannot be tested yet"), shows Buy timing's word on each row, and has no proven and rest
headings. Listing counts are saved with the opportunities, apart from `numbers`, so the MCP does
not pass them on; data saved before reads unknown.

### Potential

What a person looks for (Watchlist > Strategy, kept in their preferences): subjects (up to 10
words, matched inside the name and alias), rarities, marked out of print, has a current rank. Each
word and rarity is one criterion. A row meeting some says so, marked as a preference and not
proven; only a list by way is ordered by how many it meets, ahead of its usual order. None set:
no tags, order unchanged. Tested once on 2026-11-07, none proved out; a new one is not tested
until the measure is rerun.

A subject word matches anywhere inside a name, since Japanese names have no word breaks: "Cat" also matches "Catfish". A test that left the longer name out does not cover the word as the page reads it.

### Budget and date

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

### Rankings

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

### Signals

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

### Tests

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

<a id="alerts-record"></a>

## Alerts guide: what is sent, the self check and the buy alerts (as written 2026-10-16 to 2026-11-24)

A record. Today's rules: [docs/rules/alerts.md](rules/alerts.md). The text below is what
`docs/alerts.md` said until 2026-11-24; where it differs from the rules file, the rules file is
right (the target alert fires at or under the target and reads the day's asks only; a second
failure of one kind on the same day is not sent; the self check's minimums).

| Message                                                                   | To          | When                                                                         | Sent by                         |
| ------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------- |
| The collect or the backup failed                                          | Admins      | Right after the run (at most once a day per kind)                            | The home PC (`collect-cron.sh`) |
| No collect or no backup for over 26 hours (the PC is off)                 | Admins      | The morning check                                                            | The app's morning check         |
| Listings set aside (gone 3 nights), a quiet source, a self-check fix      | Admins      | Right after the run, or the morning check (a quiet source: once a day)       | Both                            |
| The database's month heading past its read budget (hosted database)       | Admins      | The morning check                                                            | The app's morning check         |
| Odd data, from Tora's self check (below), or the check itself failing     | Admins      | The morning check (each finding once while it lasts)                         | The app's morning check         |
| A server's update that failed and was rolled back                         | Admins      | At once                                                                      | The server's update script      |
| Imports that did not add every row (already in Tora, left out, a problem) | Each person | The morning summary (at most one a day, only when there is something to say) | The app's morning check         |
| How many things wait on Actions                                           | Each person | The morning summary                                                          | The app's morning check         |
| A watched item turned Good price, or its lowest ask went under the target | Each person | Right after the nightly collect (again only after 14 days out)               | The home PC (`collect-cron.sh`) |
| Sharp drops: owned or watched items down 15 % or more in a week           | Each person | The morning summary (each item at most once in 14 days)                      | The app's morning check         |
| Store posts and comments for your area (your choice below), a feed silent | Each person | At once ([Store notices](store-feeds.md))                                    | The app                         |

### Tora's self check

Each morning, once, Tora checks its own data and tells admins when something looks odd, with what,
how much and the usual level. It fixes nothing: the message is the cue to look into it. It says
nothing until it has about 14 nights of its own numbers. Settings > Collectors shows one row per
source with sold prices (watching, learning, not seen since a date, or too few sales to judge) and
what is open.

- Within a source, on its sales of the last 7 days: the share far from the item's median (over 2x or
  under half) at 1.5x its usual share, or 5 % whatever is usual; sales kept under 0.7x the level a
  week ago; the part of found sales it keeps under 0.7x usual; sales it can judge under half of usual
  (while kept sales are low too, only when they fell clearly harder than those: one fault, one line).
- Across sources of one market, on 30 days: an item and condition with medians over 2x apart with 5+
  sales each, told in one group at most once a week; a source reading high or low on 10 more items one
  way than the other. Markets are never compared with each other.

A finding is told once while it lasts and closes after 3 nights judged and fine; a night not judged
(the server off, too few sales) does not count. A re-check of stored sales restarts only the far
share's level. Sources kept from AI models are left out where it reads. Sales with a guessed lot size
are left out of prices, and so is a sale with no condition.

It does not catch slabs filed as raw cards: only a sudden leak of them through the far share.

After a real lasting change has been looked at, `pnpm alerts data-check-reset <source>` accepts the
numbers as they are: that source's levels start over and its findings close. A new or reset source
says nothing for its own 14 nights, so one still at 5 % or more is told again, once, after them.
`apart`, and a lean of a source that has already learned, can speak from a new source's first night:
in a market of two, a new source's prices can make the older one read high or low.

Buy alerts follow each person's buy strategy (see [Buy timing](buy-timing.md)) and use only that
night's numbers, so a failed collect sends none. A Good price with little data is sent unless the
watch's "Alert on Good price even with limited data" is off. Tora remembers each watch's state:
an item that slips out of its zone and back within 14 days does not alert twice; changing a
watch's condition or target starts over.

<a id="core-7"></a>

## Core section 7: Collector rules (as written 2026-10-09, the 30 seconds added 2026-11-24)

A record. Today's rules: [docs/rules/collectors.md](rules/collectors.md). Where the text below
differs, the rules file is right: searches, set-aside listings and rankings are read too, not only
active listings; the health flags compare 7 days with the 30 before and look at listings and
sources, not at items.

- Only fetch for products with active `product_sources`. Never crawl whole sites.
- Runs from the home PC only. Polite: 2-5 s random delay between requests (a plug-in may wait longer, never less; the identity shop for games waits the 30 s its robots file asks, S36 step A0), per-run request cap, daily schedule with jitter, normal browser headers, retry with backoff on 5xx.
- On 403/429 or captcha: stop that source for the run, mark run `blocked`, do not retry aggressively.
- Dedupe by `source` + `external_ref`.
- Store raw payloads so matching logic can be improved and re-applied later.
- Parsing must be covered by fixture tests (saved responses) so site changes show up as test failures.
- Health: a run returning 0 observations for products that previously had data, or medians moving > 50 % day over day, is flagged in Settings.
- A failing collector must never corrupt data; it only makes values stale.

<a id="core-3-5"></a>

## Core sections 3 to 5: stack, repo layout and data model (as written 2026-10-09)

A record. Today's: sections 3 and 4 of [requirements.md](../requirements.md) and
[docs/rules/data-model.md](rules/data-model.md). The text below is the first design: hosting moved to a
home server (2026-10-20), money columns became `*_base` (2026-10-14), lists became admin settings,
`valuation_snapshots` was replaced (2026-10-18), and 47 tables were added since. The sign-in lines of
section 3 are still in the requirements.

### 3. Stack and environment (the lines replaced)

- Node 24 LTS (>= 22), pnpm workspaces, TypeScript strict everywhere.
- `apps/web`: Next.js (App Router), Tailwind, shadcn/ui, next-intl, zod.
- Charts: lightweight-charts (TradingView).
- DB: SQLite dialect via Drizzle ORM with the libSQL client (`@libsql/client`). Production: **Turso** (hosted libSQL, free tier). Local dev and tests: a plain SQLite file / in-memory DB through the same client. Must stay portable to Postgres later (avoid SQLite-only features).
- Tests: vitest.
- **Hosting split:**
  - Web app: **Vercel** (Hobby, free), connected to the public GitHub repo. Talks to Turso over HTTPS.
  - Collectors: run only on the user's home Windows PC inside **WSL2** (residential IP is required for scraping; never run collectors on Vercel/cloud/CI). They write directly to Turso using a DB token from `.env`.
  - Jobs that do not scrape (valuation snapshots) also run locally right after collectors, so all scheduling lives in one place.
- Scheduling: the PC is not always on, so Windows Task Scheduler starts `scripts/collect-cron.sh` in WSL at logon (+5 min) and daily with catch-up; the script runs at most once per day (stamp file), with jitter. cron is the fallback when WSL stays running.

### 4. Repo layout and public/private split (the lines replaced)

The main repo is **public** (portfolio piece). Scrapers live in a **private** repo.

```
apps/web                 Next.js app (UI + API routes / server actions)
packages/db              Drizzle schema, migrations, queries
packages/core            Domain logic: lots/splits, valuation, buckets, export/import
packages/collector-sdk   Collector interface, runner, HTTP utils (rate limit, retry), run logging
collectors/              PRIVATE git submodule (private GitHub repo): SNKRDUNK, Mercari, eBay, 駿河屋 collectors
collectors-public/       Collectors safe to publish (TCGCSV, FX)
```

### 5. Data model

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
- `acquired_at`, `acquired_from` (free text with suggestions: a megastore, a marketplace, ...), `acquisition_type`: purchase | pull | gift | trade
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

<a id="core-3-auth"></a>

## Core section 3: the sign-in lines (as written 2026-10-09)

A record. Today's rules: [docs/rules/accounts.md](rules/accounts.md). Since these lines were written:
accounts are also made from one-time setup links in the app (2026-10-20); the page says only "Login
failed" (2026-10-30); three routes for machines take their own secret instead of a session; a session
ends after 400 days without use.

- **Auth** (app is on the public internet):
  - Accounts have a username, a password (scrypt hash) and a TOTP authenticator secret (encrypted at rest), plus one-time backup codes. No public sign-up: accounts are created and managed with a CLI on the home PC (`pnpm user ...`).
  - Login = username + password, then a 6-digit authenticator code (or a backup code). Every new device login needs both steps.
  - **At most 2 active devices per user.** Each successful login registers a device; a third login is refused. Revoking a device (Settings, or CLI) frees its slot. Signing out revokes the current device.
  - Sessions do not expire: the cookie (signed, httpOnly, Secure, SameSite=Lax) is renewed automatically on use (browsers cap cookie lifetime at ~400 days). A revoked device, password change or 2FA reset ends its sessions.
  - Failed attempts are counted in the DB per IP and per username, with temporary lockout. Every page and API route requires a session except the login pages and static assets.

---

# Chapters moved from the requirements on 2026-11-25

Until that day `requirements.md` held a chapter per phase (session), which is where a builder looked for rules. The rules now live in the rules files ([docs/rules](rules/)), each stated once and kept current; these chapters stay as the record of what was asked, designed and built, in the order the requirements had them. Do not build from them: where a chapter and a rules file differ, the rules file holds. Section numbers and "Decision log" refer to `requirements.md` as it was (the log is now [decisions.md](decisions.md)).

<a id="req-how-to"></a>

## How to use the requirements file (as written until 2026-11-25)

- This file is split into **Core** (sections 1-7) and **Sessions** (S1-S25).
- Finished phases with long chapters keep a short spec here; their full chapters (design, what was built, how it was checked) are in [docs/history.md](#top). Add new "Built" detail of a finished phase there, not here.
- The owner's own setup, sources and to-dos are in private notes (`collectors/ops/notes.md`, in the private submodule).
- Every session: read **Core** fully, then read **only the current session** (first one not marked done in the Status table).
- Do **not** read or start the next session until the current one meets its acceptance criteria and the user confirms.
- At the end of a session: update the Status table, note any decisions or deviations under "Decision log", commit.
- If something in Core turns out wrong or ambiguous, ask the user, then fix Core rather than working around it.

<a id="status-logs"></a>

## Status logs (the Status table's lines as they stood on 2026-11-25)

| Session | Status as written |
|---|---|
| S1 | done |
| S2 | done (reworked by S2b) |
| S2b | done |
| S3 | built; awaiting data gate with user |
| S4 | built; awaiting user check |
| S4b | built; awaiting user setup |
| S5 | built; awaiting user check |
| S5b | built; awaiting user import |
| S5c | built; awaiting user check |
| S5d | built; awaiting user check |
| S4d | built; awaiting user check |
| S4c | built; first real import done (39 Mercari screenshots) |
| S7 | built; eBay asks collector ready, waiting on the user's eBay developer account review |
| S8 | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S11 | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S16 | in progress: parts 1-3 (currency, languages, categories) live 2026-10-14; part 4 (markets, heavy-user rules) live 2026-10-15; part 5 (the app's time zone) built 2026-10-15, awaiting user check; left: the EUR + French end-to-end check (with S10) and measuring on S14's large data; parts 1-5 accepted (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S12 | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10) |
| S6 | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10); loading the JSON into an empty account is tested in S15 |
| S17 | done (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10); CRON_SECRET and the Telegram bot after the switch back to Turso |
| S9 | designed 2026-10-16; part 1 (watchlist) built 2026-10-16 (migration 0028); part 2 (for sale now) built 2026-10-16 (migration 0029); part 3 (release dates and similar items) built 2026-10-16; part 4 (signals, buy strategies) built 2026-10-17 (migration 0030); next: part 5 (alerts, rule tests); parts 1-4 accepted (user, 2026-10-17: accepted, no major issues seen; a deep-dive review in S10). the new-release wait learned per group, set lines and the fixed strategy examples built 2026-10-18 (migration 0041; branch `new-release-90d` superseded, can be deleted); part 5 (alerts, rule tests) built 2026-10-18 (migration 0042), awaiting user check |
| S19 | built 2026-10-18 (about 50M rows read a month measured, 10 % of the free plan; counter and alert in Settings > Admin preferences > Database); part 2 built 2026-10-18 (10 users within half the free plan: about 14 % measured on a simulated 10-user database); Tora is self-hosted for now, the hosted numbers to check in use after any move back to Turso |
| S22 | built 2026-10-18, awaiting user check |
| S23 | built 2026-10-18 (private importer plug-in) |
| S24 | built 2026-10-19, awaiting the user's check |
| S20 | built 2026-10-19, awaiting migration 0043, the first nightly reads and the user's check |
| S25 | built 2026-10-19 to 10-21, accepted by the user for now (2026-10-20); store labels per language 2026-10-23 |
| S20 part 2 | built 2026-10-20 (no migration; suggestions appear after the next collect or `pnpm plugins`) |
| S21 | built 2026-10-20 (migration 0050), awaiting the user's check |
| S13 | built 2026-10-21 (parts 1-4: signals and their tests, MCP, the Opportunities page, ranking plug-ins and candidates, budget and date), awaiting the user's check; later: rank changes as signals, a Claude digest if an API key comes |
| S10 | done (2026-10-24, the user's check passed: "I love how it works" for Now): A data checks done; C the Spain + Brazil setup, the two-category test and their fixes done (2026-10-24); the status page and the page crawler done (2026-10-24, the pages crawled clean); B done (2026-10-24: pages on a scrubbed copy of the owner's data and every chapter against the code, 11 fixes, see Part B); D done (2026-10-24: risks and efficiency, its four follow-ups built) |
| S14 | in progress (2026-10-24): `pnpm perf` and `pnpm stress-data` built; baseline within targets at today's size; fixes measured on medium and large (nav badge, Portfolio insights, nightly snapshot memory, Items and Opportunities load as you scroll, no page skeleton); every page within the targets on the owner's data and on large (2026-10-25); next the user's check (phone and PC) |
| S15 | in progress (2026-10-25): server actions called by the wrong person and the rules on random cases tested (nothing found); account download loading built and round-tripped; load runs, collector faults, edge cases (input, imports) and layout at 7 views done (seven bugs fixed, an eighth from the owner's use); `pnpm check:all` added; bug log reviewed with the user (quiet-source warning and two-tab protection built); next the user's check |
| S18 | in progress (2026-10-25): first pass done (every guide read against the app, links and commands checked); both gaps found moved to Open issues (user, 2026-10-26) |
| S26 | built 2026-10-27 (no migration; the singles ranking and the targets fill in with the next collect); crawled on the real-data test copy (10 pages, phone, wide and dark: no errors; the menu's Actions count was too faint, fixed); the user's check in progress (2026-10-28: first fixes built, the next round being planned) |
| S27 | steps 1-6 built (to 2026-10-31); the owner's check (2026-11-07) moved its follow-ups to S28, S31 and S32, step 7 to S33 |
| S28 | built 2026-11-07 (a shop's sold-out items read correctly, set-aside listings tried again weekly; old backup code form waits for the owner's new codes), awaiting the owner's check |
| S29 | built 2026-11-07, both per-person settings that change nothing until picked (replay of the busiest week: 436 messages to 55; 13 threads leave Now), awaiting the owner's check |
| S30 | in progress: rules, the re-check command and the self check built 2026-11-07; the run, and the measure of one listing under several items, to come |
| S31 | in progress: targets tested on past days 2026-11-07, no type earned a place; the owner decides what the card shows |
| S32 | built 2026-11-07: six lists and per-person criteria, each saying its past test found no record; the owner decides definitions and Buy plan. About 540 lines against a 400 limit (the form and the record table, no extra guards); kept since the owner named the lists |
| S33 | planned 2026-11-07, after the owner is happy with S31 |
| S34 | planned 2026-11-07, spec later; needs S31 and S32 |
| S35 | measured 2026-11-07, nothing built: a rhythm saves about a quarter on two sites, with costs the replay cannot count, on 28 nights; no store reads as noise; the owner decides |
| S36 | planned 2026-11-23 (the owner decided the proposal that day); steps A0 to D built 2026-11-23 to 11-24; next: the owner's steps on their install (consoles and the Game rules switch, the games, each game's check, the daytime reads, the shipping sample, the first tracked games), then step E as the owner chooses. Not built from step D: the catalog draft of the chosen set (its terms are the owner's to read first) and the replay's reruns at 3 and 6 months |

<a id="req-s1"></a>

## S1: Foundation (as in the requirements until 2026-11-25)

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

<a id="req-s2"></a>

## S2: Registration UI (as in the requirements until 2026-11-25)

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

<a id="req-s2b"></a>

## S2b: Accounts, 2FA, taxonomy, TCG catalog (as in the requirements until 2026-11-25)

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

<a id="req-s3"></a>

## S3: Collector framework + SNKRDUNK + source matching (as in the requirements until 2026-11-25)

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

<a id="req-s4"></a>

## S4: Mercari sold collector (as in the requirements until 2026-11-25)

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

<a id="req-s4b"></a>

## S4b: MCP server (Claude reads the data) (as in the requirements until 2026-11-25)

Added at the user's request (2026-10-11): connect Claude to the tool, to sanity-check the data, explain it (what goes up, what does not, why) and find what to build next.

Build:
- `packages/mcp`: a local MCP server (stdio), started by Claude Code / Claude Desktop on the home PC with the root `.env`. Never deployed; nothing exposed online. Read-only, scoped to one configured user.
- Tools (structured results, small by default, with limits):
  - `portfolio_summary` (totals, breakdown, P/L, value over time), `list_products` (filters: kind, franchise, owned / sold, unvalued), `product_detail` (lots, valuation and how it was computed, sources, queries, references).
  - `price_history` (daily medians per source and condition), `sales` (collected sales incl. excluded ones with the reason; filters by product, source, date, kept / excluded).
  - `collector_health` (runs, stale sources, request use), `review_queue` (imports to review, pending matches, ungraded cards).
  - `data_checks`: canned sanity checks with explanations: unvalued owned items, low-confidence / pooled values, look-alike products (duplicates), sales far from the median, sources with few kept sales or many exclusions, estimated lot sizes, missing set names / numbers / pictures, canceled-looking orders.
  - `query_sql`: read-only `SELECT` for open questions (one statement, row limit, no writes).
- Later, opt-in: write tools behind explicit confirmation in the chat (exclude / include a sale, edit a search query, merge duplicates, set a manual price).
- A short guide in the README: registering the server in Claude Code / Claude Desktop.

Acceptance:
- From Claude: "does anything look off?" runs the checks and explains the findings; "which of my items gained the most since I bought them, and why?" is answered from the data.

<a id="req-s5d"></a>

## S5d: Imports hub (as in the requirements until 2026-11-25)

Added at the user's request (2026-10-11): imports grew piece by piece (email import from the terminal, Review import, pasted links, canceled orders, card grades after import) without a home; once the review banner was gone there was no way back to the page (stopgap: Settings link and a banner for failed links). One Imports menu where every import starts, reports back and is followed up.

Build:
- An **Imports** entry in the main navigation (phone bottom bar and wide-screen nav), with a badge counting what needs the user (items to review, failed links, conflicts).
- The Imports page, sections:
  - Needs attention: items to review, links that could not be imported (to add by hand; open the listing, then "add an item" prefilled from what is known, which clears the link), conflicts and likely duplicates waiting for a decision, canceled-looking orders.
  - Start an import: paste purchase links; upload a purchases file (S6); import through Claude (S4c, how to start it); email import (how to run it on the home PC, when it last ran).
  - History: every import run (method: email, links, file, Claude; when; counts new / matched / already registered / skipped / failed), each opening its own results.
- Import runs are recorded (`import_runs`: user, method, source, started / finished, counts, notes); imported lots and links point to their run. The terminal email import and the link import in `pnpm collect` record runs too, so they show in History.
- Everything import-related lives under the hub and returns to it: Review import becomes a sub-page; card grades for imported cards, "order canceled", link results and the add-by-hand flow for a failed link link back; banners elsewhere (portfolio) point into the hub instead of separate pages.
- Later: conflicts and likely duplicates from the email import decided in the app instead of the terminal (the S6 in-app file import uses the same screens).

Built (2026-10-11): Imports in the main navigation with a badge (items to review + failed links + cards without grade); `/imports` hub with Needs you (review, card grades, links that could not be imported with "Add by hand"), Import purchases (paste links with the list of pasted links, order emails with the command and the last run) and History (each run with its counts, opening `/imports/runs/<id>` with its lots and links); Review import moved to `/imports/review` and links back to the hub; `import_runs` recorded by the email import and the link import (one run per user per collect), lots and links point to their run. "Add by hand" opens Add with the shop and the item ID (the link's last path part) filled in; saving marks the link as done and returns to the hub. The Settings stopgap was removed. Not yet: conflicts decided in the app (later, with S6).

Acceptance:
- From any screen, Imports is one tap away; after pasting links and collecting, the user finds what was imported, what to review and what failed (with what to do) in one place.

<a id="req-s4d"></a>

## S4d: Automated data review (cheap model, suggestions queue) (as in the requirements until 2026-11-25)

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

<a id="req-s4c"></a>

## S4c: Import purchases from any shop through Claude (as in the requirements until 2026-11-25)

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

<a id="req-s5"></a>

## S5: Valuation, Portfolio, Item detail (as in the requirements until 2026-11-25)

Build:
- `packages/core` valuation per section 6, with unit tests (IQR, window widening, fallback chain, manual override, confidence).
- Daily `valuation_snapshots` job (runs after collectors).
- **Portfolio screen**: spent / current value / unrealized P/L, value-over-time chart, breakdown by type, holdings list with value, confidence and freshness indicators, filters.
- **Item detail screen**: header with my holdings of this product; price chart per bucket with source toggles and bucket chips; recent observations table; buylist floor; manual price override.
- **Box tab** on sealed TCG holdings: paid | value as received | pulls value | net, plus the pull list.

Acceptance:
- Scenario 5 and 7 visible and correct; values show source, sample size, age and confidence.

<a id="req-s5b"></a>

## S5b: SNKRDUNK purchase import (Gmail Takeout) (as in the requirements until 2026-11-25)

Added at the user's request (88+ SNKRDUNK purchases to register).

Build:
- Holdings get `order_source` + `order_id` (e.g. snkrdunk / 取引ID). Optional when registering by hand (add flow, edit); required for imports. A SNKRDUNK 取引ID can only be registered once per user (one item per transaction); split lots keep the ID.
- `pnpm purchases <file.mbox> --user <username> [--source snkrdunk]` on the home PC, reading a Google Takeout export of the SNKRDUNK emails (`pnpm import` is a pnpm built-in, hence the name). No app access to Gmail.
  - Receipts: the shop's purchase mails (accepted offers count too) and cancellation mails, read by the private importer; canceled IDs are never imported. Cost = the amount paid (item + shipping + fees, after coupons).
  - Duplicates: same ID + same data -> reported, skipped. Same ID + different data (price, item, date) -> the user chooses which is correct (existing entries change only on request, logged as an edit). No ID but a likely match (same listing or name, same price, dates within 3 days) -> the user confirms; "same" attaches the ID.
  - Summary and confirmation before writing. Existing entries are never removed (a canceled ID that is registered is reported, not deleted).
  - Receipts carry no listing link. A receipt's item title is the listing title, so it is matched to a product already linked to a listing with that title; otherwise a product is created from the title (cards read like listing titles; sealed kind from 拡張パック…ボックス / 構築デッキ / 特別セット…; sealed product as shrink-wrapped unless the title says シュリンクなし) and matched to its listing on the next collect (confirmed under Matches). A product bought several times is created once. Listings SNKRDUNK renamed (e.g. 30周年 セレブレーション -> 30th CELEBRATION) map to the current title.
- Receipts do not state a card's grade or cert. Imported holdings are flagged `review_pending` (migration 0006); "Review import" in the app (`/imports`, portfolio banner) lists them one row per transaction: cards get a grade (raw S-D or grader + grade) and an optional cert number, sealed items shrink / no shrink. Save confirms filled-in rows; cards without a grade stay until graded or confirmed without one. "Card grades" (`/holdings/grades`) sets one grade on many ticked cards at once. Changes are logged as edits.
- Email parsing and sample emails live in the private collectors repo.

- Orders can be marked canceled in the app ("Order canceled" on a lot with an order ID, or the checkbox in Review import): all lots of that order are removed and the ID is kept in `canceled_orders`, so imports skip it. The import flags lots for review with a reason (`holdings.review_reason`: a missed shipping deadline, no delivery mail); a reason the user already confirmed does not flag the lot again.

Acceptance:
- Re-running the import on the same file adds nothing; canceled purchases are not imported; conflicts are asked, not guessed.

<a id="req-s5c"></a>

## S5c: Portfolio by product + product images (as in the requirements until 2026-11-25)

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

<a id="req-s6"></a>

## S6: Export / import (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s6).

Backups, the person's own data, and spreadsheet import. `pnpm backup` writes a dated, compressed SQLite copy of the whole database after each night's collect (kept: the last 30 days and the first of each month for a year; `BACKUP_DIR`); `pnpm restore` loads one into an empty database only. Settings > Your data downloads the lots as a spreadsheet and the account's data as JSON, never collected sale prices; an empty account can load such a JSON file (S15). Imports > Spreadsheet adds lots from a CSV in that layout after a preview (rows already in Tora skipped; a loose match can be added anyway). Every import keeps each row's outcome (the import log).

Acceptance: scenario 8 (the lots spreadsheet rebuilds the collection without the app); the backup and restore test passes.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s6).

<a id="req-s7"></a>

## S7: US data, 駿河屋, FX, JP vs US spread (as in the requirements until 2026-11-25)

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

<a id="req-s8"></a>

## S8: Visual redesign + wide-screen layout (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s8).

Layouts and the screens built on them. Three sizes: phone (under 768 px, bottom bar), an icon rail (768-1279 px), a labelled sidebar (1280 px and up); wide pages use the full width, forms keep a reading width. Portfolio as Summary (chart, by kind, category tiles, a rotating insights card) and Items (category and kind chips, groups, cards). Per-lot switches "count in cost" and "count in value" (P/L only over lots in both). One Actions page with everything waiting for the person, solved in place, sorted and coloured by notice levels the person sets. Sources with roles per item type (reference, supporting, comparison, off) in the admin's order; a quality gate drops a supporting source to comparison when its sales differ from the reference's by over 15 % on 10 or more items; identity links are separate from price roles. Settings and Admin preferences as sub pages.

Acceptance: user review on phone and on a wide screen.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s8).

<a id="req-s11"></a>

## S11: Primary and secondary markets (as in the requirements until 2026-11-25)

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

<a id="req-s16"></a>

## S16: Make Tora work anywhere: categories, markets, languages, currency (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s16).

The admin's choices, mostly made once at setup: the base currency (every amount stored in it; a later change converts each amount at its own day's rate) and the exchange rate of each other currency (a rate plug-in or a typed rate); the app's two languages, from the installed translation files; categories, kinds, fields and condition lists (TCG and games are built-in templates in the same format); markets (from the plug-ins' sources) and what item pages compare; the time zone (a change rewrites stored times). Collector run times are recorded and shown against the admin's night window.

Acceptance: a category made from scratch is valued; a third market shows everywhere; another base currency and language work end to end (S10 part C, Spain + Brazil).

The full chapter (design, what was built and how it was checked): [docs/history.md](#s16).

<a id="req-s12"></a>

## S12: Documentation for others (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s12).

Guides in `docs/` for a person, or their coding assistant, running their own Tora: clone and run, building collectors (the plug-in contract and a template), what makes a good identity page and price reference, setting up markets and roles, the commands. Brought up to date in S18.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s12).

<a id="req-s10"></a>

## S10: Reliability, consistency, efficacy and function review (as in the requirements until 2026-11-25)

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
3. Dead links: SNKRDUNK pages answering 404, 駿河屋 items and TCGplayer products not found made three sources "partial" every night, hiding new failures. A listing reported gone (HTTP 404 / 410, or `ListingGoneError` from the plug-in; other errors never count) 3 nights in a row is set aside (`product_sources.failure`, migration 0055): no longer collected, the run is not partial for it, and its item gets an Actions card saying since when and why, until a new link is picked or pasted (linking resets it). Or, when the site no longer has the item (2026-10-26), "Page gone, leave it unlinked" on the card: the listing stays unlinked, its waiting suggestions are rejected, it no longer asks unless the site, still searched, shows a new match (the page back); its picture stays.
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
4. Every loaded plug-in searches and collects every item it supports, whatever markets the admin chose: TCGCSV searched the Spanish setup's cards for the US, a market nobody picked. The public package also registers Japanese shops (Amazon JP order IDs, two electronics megastores, Pokemon Center, Yahoo) and eBay's source without its keys.
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
10. Now: no way to clear every count or close every row at once (user, 2026-10-26): "Mark all read" (every row's messages up to its latest, on the account) and "Fold all" (every open row, its stores and the earlier fold) above the rows, each on only when it has something to do.

<a id="req-s17"></a>

## S17: Notifications and activity log (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s17).

Alerts outside the app on Telegram (one bot per install; each person connects with a one-time code) and Discord (a webhook link per person), stored encrypted: the collect or the backup failed (at once, to admins), nothing ran for over a day, and a daily summary per person (imports with rows left out, what waits on Actions); each kind can be switched off, in the person's language. Settings > Activity lists collects, backups, imports and every admin change, newest first; members see their own imports.

Acceptance: a failed collect reaches the admin within minutes; a server off for a day brings a "nothing ran" alert; an import with rows left out shows in the next summary; Activity shows each with links.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s17).

<a id="req-s9"></a>

## S9: Watchlist and buy timing (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s9).

Items a person does not own can be watched (a condition, an optional target) and are collected like owned ones. Each night saves what is for sale (lowest ask and listing count per source and condition) and each held or watched item's numbers for the day (fair value, 180 and 365-day quarters, trends over 2 / 4 / 12 weeks, sales, release age, the new-set pattern and the usual first-year low of similar items). Buy timing judges today's price by the person's strategy per item type (Steady, Bargain hunter, Margin, Catch the dip, Own target only; tried on fixed examples before choosing): Good price, Falling: wait, New release: wait, Fair or High, with its reasons and limited-data warnings, never advice. Alerts go out at once when a watched item enters its zone or an ask goes under the target; sharp drops go in the daily summary.

Acceptance: a watched item not owned shows its history, where today's price sits, a buy zone with reasons, and a target that triggers an alert.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s9).

The Watchlist becomes the Wishlist in S36.

<a id="req-s13"></a>

## S13: Buy suggestions (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s13).

Opportunities within an item type: signals on every tracked item and ranked candidate (its line rising or falling, leader or laggard in its line, sales up or down, strong or weak for its age), each tested per group of similar items on the past and again after every collect; a signal ranks items only when proven (a higher price 90 days later at least 5 points more often than on any day, over 10 or more checks). Ranking plug-ins (e.g. a site's sealed-box ranking) bring candidates, collected while in the top 30. Budget and date: Tora suggests when and at what price to buy each ticked item and checks the plan against the budget. Never advice.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s13).

<a id="req-s14"></a>

## S14: Speed at any size (as in the requirements until 2026-11-25)

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

<a id="req-s15"></a>

## S15: Stress test and bug hunting (as in the requirements until 2026-11-25)

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
- Items and lots: no sales, one sale, all sales excluded, outliers only; an item with no source; selling more than held; splitting down to zero; pulls from a box that is then deleted; canceling an order with some lots already sold or split; grading sent and never returned; merging look-alike items that both have lots.
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
   - Items and lots: merges move lots, keep one watch per condition and one link per listing; canceling an order with pulls taken from it is refused; selling or splitting more than a lot has is refused (the property tests).
   - A failed page (database or server not answering, a save cut off) showed the framework's English error screen with no way back (bug 3).
   - Typed input (`edge-cases.test.ts`, `apps/web/src/lib/form.test.ts`): names and notes with markup, quotes, SQL, LIKE wildcards, emoji and 1,000 characters are kept as typed and found by search as plain text (pages escape them; no page writes raw HTML from data); quantities refuse 0, negatives, decimals and over 100,000, and now take full-width digits ("３"); amounts refuse negatives, over 10^11 and unreadable text; the import review's date can no longer be set in the future (the other date fields already stopped at today). A search for "mega" missed a name typed in full-width letters (bug 4).
   - Imports: an order canceled after import is reported, never removed, and skipped on the next import (already tested); the same file twice adds nothing (already tested). A sheet saved by Excel in Spanish and other languages (semicolons), as "Unicode text" (UTF-16, tabs) or copied cells (tabs) was refused as having no column names; the first row's separator is now used. A binary file named .csv finds no columns and is refused. A 5,000-row sheet (the limit, 1.2 MB) took 211 s to import and 370 s to preview again (bug 5); now 21 s and 0.4 s.
7. Layout (2026-10-25, `pnpm crawl --views all`): besides phone and wide, the crawler opens each page at 320 px, a 768 px tablet, 2560 px, 200 % zoom (a 1280 px window lays out like 640 px) and dark mode, and now also fails on text below WCAG AA contrast with its background (4.5:1, 3:1 when large; disabled controls and previews drawn in another app's colors left out) and names text that runs out of its box. First run on the Spanish test copy: 12 of 64 pages with problems (bugs 6 and 7); after the fixes none at any of the 7 views.
8. `pnpm check:all` (2026-10-25): typecheck, lint, format check and tests in one command. The crawler and load runs need a running test install, so they stay separate (`pnpm crawl --views all`, `pnpm perf --load`). Lint had three old errors (two unused values, a state set straight from an effect) and read the local test installs; both fixed.
9. Bug log and Open issues reviewed with the user (2026-10-25): all seven bugs fixed. Built from that review (decision log): the warning for a source gone quiet (`quietSources` in the daily check; test in `alerts.test.ts`; no false warning on the owner copy on 10-20, 10-22 or 10-24) and the refusal of a lot save from an older copy (`apps/web/src/app/(app)/holdings/[id]/actions.test.ts`).

### Bug log

| # | What | How found | Severity | Commit |
|---|---|---|---|---|
| 1 | After an admin changed markets, source order, base currency or categories (and after a collect that changed a source's quality), every saved value was cleared and refilled only after the snapshots (6 min on large): meanwhile every page worked values out from the sales (9-10 s under load). Values are now refilled first (as the time zone change did); the window is the refill (22 s on large, about 1 s on the owner's data). | Load run while writing | 3 | 1310eee |
| 2 | A site that took the connection and never answered held each request for Node's default (about 5 minutes), with no retry: a collect, and its lock (the server's updates wait for it), could run for hours. Requests now give up after 30 s, are tried again like a server error, then fail that item. | Collector faults | 2 | a49f1af |
| 3 | No error pages: a database or server that did not answer, or a save cut off (offline), showed the framework's "Application error" screen in English, with no way back but reloading. Now a page says so in the person's language with Try again and a way home (the menu stays); if even the app's frame fails, a short page in the browser's language (English, Japanese, Spanish). | Edge cases (database down, offline) | 3 | 6ac242e |
| 4 | A search for "mega" did not find a name typed in full-width letters ("ＭＥＧＡ", common in Japanese input): the database lowercases plain letters only and the stored name is kept as typed. The search now also tries each term's full-width forms. | Input edge-case test | 4 | 6a321b3 |
| 5 | A sheet import looked each new row's item up by reading every item of that kind (and card number), so time grew with the square of the rows: 5,000 rows took 211 s to import and 370 s to preview a second time, past the browser's patience. Each group of items is now read once per file and found by name. | 5,000-row sheet test | 3 | fdbbeb3 |
| 6 | At 320 px the page scrolled sideways: the portfolio summary's amounts did not fit two tiles side by side, and two long Spanish buttons did not wrap. The bottom bar's longer labels ("Seguimiento", "ポートフォリオ") overlapped their neighbours on every phone. Now the tiles stack below 360 px, the buttons wrap, and the bar has short labels and cuts what still does not fit. | Crawler at 320 px | 3 | b311992, b593076, 0f71488 |
| 7 | Text below the readable contrast: the selected reference tab on an item's details (3.7:1), red buttons in dark mode (2.9:1), the missing-backup warning (4.4:1). | Crawler's contrast check | 4 | b311992, b593076 |
| 8 | Store posts: the Now and All posts lists showed only a post's direct replies; answers to replies were stored and notified but never shown, so a busy thread (31 comments, most answering each other) showed 6. Every reply now sits under its thread's first post, oldest first. | The owner, following a thread live | 2 | 44e7b63 |

---

<a id="req-s19"></a>

## S19: Database reads within the free plan (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s19).

A hosted install stays well inside a free database plan: nightly steps and pages read packed rows per item and per lot (`item_sales`, `holding_values`, saved charts) instead of every sale; a nightly self-check compares a few items with their raw sales; rows read are counted per day and origin (Settings > Admin > Database) with an alert past the admin's budget; heavy analysis runs on a backup copy, never on the live database. Measured: about a tenth of the free plan at one user, under half at 10 users.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s19).

<a id="req-s22"></a>

## S22: Item page as sub pages (as in the requirements until 2026-11-25)

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

<a id="req-s23"></a>

## S23: Pokemon Center Online purchase import (as in the requirements until 2026-11-25)

Built 2026-10-18 as a private importer plug-in (`pnpm purchases <file.mbox> --user <name> --source pokemoncenter`): order and payment mails through Review import; 0-yen bonuses imported at 0 cost with a note; several items of one order are lots keyed `<order>#n`; sets traded one by one split into their parts (the importer's list); a shared product of the same loose name is reused across importers. The mail layouts are in the private notes.

<a id="req-s24"></a>

## S24: Japanese TCG shops as sources (as in the requirements until 2026-11-25)

Decided 2026-10-18 (user): more Japanese TCG shops to compare prices: magi, Card Rush, 遊々亭, カードラボ (suggested earlier), also 晴れる屋2, トレカキャンプ, ドラゴンスター, カーナベル; for sealed retail prices Pokemon Center Online, Amazon, 楽天. Each is a collector plugin in the private collectors repo (its own search and page reading). They bring asks and stock (for sale now), 買取 as buy prices (already a type in the packed sales), and, for shops with a page per card, identity links. Reads and writes measured per shop with the meter (estimate: about 7k rows written a day at 10 users with 8 shops). Which shops first: with the user.

### Built (2026-10-19)

Three shop collectors in the private plug-ins (their search, page reading and rules in the private notes); no app change: everything reads the source registry. Shop stock is raw A; a sold-out card's last price is not an ask.

<a id="req-s20"></a>

## S20: Box opening value (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s20).

For a booster box: the break-even box price from pull rates (per set: the admin's, else a plug-in's suggestion, with its source) and its hit cards' prices after the selling fee; the spread from simulated boxes (the share paying back the box price, the median box); the cards carrying the value; the sealed premium (box price against contents). Hit cards are read weekly per set by a set-card plug-in. Item page > Opening and Watchlist > Box opening.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s20).

<a id="req-s25"></a>

## S25: Store notices (as in the requirements until 2026-11-25)

The short version the requirements kept; the full chapter is [above](#s25).

Posts on community boards about cards on sale in physical stores, pushed by a feed (e.g. a userscript in the person's own browser) to `POST /api/feed/posts` with a personal token, are matched to stores by the codes and names posters use (store directory plug-ins, admins' additions, places), and sent on Discord or Telegram to the people whose area holds the store (picked stores or a distance; travel mode): one notice per store every 30 minutes, replies at once, pictures after the text (kept a week). The feed itself is watched: silence, boards giving nothing, unknown stores, a page turned over. Stores pages: Posts, Feed, Area.

The full chapter (design, what was built and how it was checked): [docs/history.md](#s25).

<a id="req-s21"></a>

## S21: Admin account tasks in the app (as in the requirements until 2026-11-25)

From Open issues (user, 2026-10-14; planned 2026-10-17). Admin preferences so the admin does not need the terminal for everyday account tasks: creating a user (with the authenticator enrollment shown in the app), resetting a password or 2FA, listing and revoking devices, disabling an account (today `pnpm user ...`). Anything that scrapes, like `pnpm collect`, stays on the home PC (the app could queue a run or show its status). Each task is confirmed and lands in S17's Activity log.

### Built (2026-10-20)

- Settings > Admin > Accounts: every account with its role, state (disabled, not set up, a link waiting until when) and devices. A new account (username, admin or not) is made without credentials, with a one-time setup link (`account_setups`, migration 0050: only the token's hash kept, 24 hours, a new link stops the old one, stoppable). Per account: a new password link, a new authenticator link, a full reset link; disable or enable (never one's own); sign a device out. The link and backup codes are shown once.
- The setup page (`/login/setup/<token>`, no sign-in needed): a new password (12+ characters) and/or a new authenticator (QR code and key, the same on every visit of the link, confirmed with a code); a new password asks for the current authenticator code or a backup code, a new authenticator for the current password, a full reset for neither. Saving signs every device out and shows new backup codes. Failures count toward the login lockout.
- The admin's own authenticator code before creating, resetting, disabling and enabling (each code once; failures count toward the lockout); signing out devices and stopping a link ask only for a confirmation. All in the activity log (link made, stopped, used; collect requested).
- Collect now (Settings > Collectors, admins): a request the home PC takes on its hourly check (`pnpm collect:request` in `scripts/collect-cron.sh`, which now runs every hour around the clock: re-run `scripts/install-windows-task.sh` once); the page shows it waiting, then when the home PC started it.
- `pnpm user` still works from the terminal (the first account is made there).

<a id="req-s26"></a>

## S26: Opportunities as sub pages (as in the requirements until 2026-11-25)

Decided 2026-10-27 (user, decision log). Built on S13 (signals, tests, rankings, the buy plan) and S22 (sub pages with their own address).

- `/opportunities` Worth a look: type chips (`?type=`), signal chips for the signals proven in the type's groups (`?signal=`, the record per group on the chip), the list best first (proven signals by score, then the rest; ties: nearest its target), a heading between items with and without a proven signal, 20 rows from the server per batch as the end of the list comes near.
- A card: picture, name, condition, owned / watching / suggested, rank; tags for its signals (proven, warning, not proven) whose why and record open on a tap; the price now, the target and how far (or "at target"); a listing well under the price, a shop buy price near it; Watch.
- `/opportunities/popular`: each ranking with pictures, links, the change in a week, price, listings, favorites; the first 10 shown, the rest on demand.
- `/opportunities/signals`: each group's signals and their record against any day (the tables from S13), per type.
- `/opportunities/plan`: the budget and date card (S13 part 4).
- Collect: buy timing numbers for every item with signal numbers (the target needs them); `CANDIDATE_TOP` 60; the private SNKRDUNK singles ranking.

Acceptance: the user's check on phone and PC.

### The user's check (2026-10-28)

First notes (more to come with the next round):

1. "Only 3 cards worth a look": on 10-28's numbers 43 cards have a proven signal. Every Pokemon single carries the proven warning "line falling" (singles' median 12 weeks: about -27 %), which outweighs their other signals. Also found: a suggested item collected for a few days showed "sales picking up" (151 sales in 30 days against none before); now the sales comparison needs 120 days of collected sales.
2. Cards in a row differed in height (a listing line, wrapped tags): rows now share their height, Watch at the bottom.
3. Several signals at once: the signal chips take one or more (`?signal=a,b`), warnings too; the list keeps the items with all of them on.
4. A board's own product list can be out of date (a code naming a product no longer sold): admins turn a list's or feed's code off on Stores > Codes, and back on (Activity logs it).
5. A UX review before the owner's check: `docs/ux-review.md`, given to a fresh reviewer with only screenshots and one line per page.

<a id="req-s27"></a>

## S27: Opportunities part 2 (as in the requirements until 2026-11-25)

Decided 2026-10-28 (user, decision log), from the S26 check. Steps, each built and checked before the next:

1. Chains in store posts: a glossary entry can be a chain (`chain: true`, its meaning the chain's name); a post naming a chain and only areas reads "chain · area" on the Stores pages and in notices, with no store "chain (branch not named)". Admins add chain codes on Stores > Codes. Built 2026-10-28 (on the owner's posts: 65 of 686 name a chain, 41 of them were "Unknown store").
2. Singles: the market note, the steadiest price series per item, the set as a single's line. Built 2026-10-28. On 10-28's numbers: line falling on 85 of 87 cards (the note), 19 singles compared with their set, 26 with their line, 40 with all singles; no item changed series (where a reference series has 30+ days it was already the longest; the singles on Mercari or Yahoo are new and have no SNKRDUNK trades yet). 3 cards have a proven signal: the 40 more before were mostly sales picking up on items collected for days.
3. Signal plug-ins: the plug-in kind, its tests, the admin's pick; PSA 10 vs raw A as the first plug-in, a quick rise as a built-in signal. Built 2026-10-28 (the PSA 10 rule in the public plug-ins, as the example). On the owner's history: quick rise proven (singles 110 of 128 higher 90 days later, 86 % against 60 % any day; boxes 92 % against 72 %), on for 5 items today; PSA 10 under 2x raw A not proven (65 of 119, 55 % against 60 %), on for 12 cards today.
4. Spend a budget well: a budget (and a date) gives a varied mix (types, sets, price levels; no item taking most of it), each pick with why and by when, any pick swapped for the next best. Built 2026-10-28 on the Buy plan (user's choice, Balanced): Suggest a mix, Swap, the total against the budget without a date, the date optional, each item's signals shown. On the owner's data the first version filled the budget with cheap items nothing pointed to (a used controller at ¥1,000); now only items worth a look or watched come in, and a thin mix says so. Also from the review's asks (user, all Recommended): owned items stay ranked, "Owned: buy another?"; warning chips keep showing the items with the warning, marked with an icon and "the warning" in the filter line. After the user's look at the cards (2026-10-28; user, all Recommended): the market's "Line falling" (86 of 88 cards) read as "buy nothing" next to green targets. Now a card with a proven warning after which prices fell says "Wait, or under" the target lowered by that fall (main-set boxes: -13 %; singles: -9 %), the price bar is colored (green at target, blue close, red far over, amber waiting), Watch is an icon. Each person picks the conditions suggested per type (Watchlist > Strategy; e.g. no raw B). Reprints: an admin marks an item out of print or a reprint coming (from a day), a plug-in may guess for unmarked items (a shop's own boxes, in the private collectors), both tested as signals ("Out of print", warning "Reprint coming"); migration 0068. Signals: the three best signals on top, links to each type, groups with nothing proven folded, card tags link to their row. The Hiroshima box had no signal at all (special sets: 25 checks, too few to prove anything), not a "don't buy". Then (user, 2026-10-28): a tap on the target or the wait price explains it, the wait price says whether the item sold that low on 1 day in 10 of the past year; Popular shows Tora's view under each SNKRDUNK rank and Tora's price next to the site's; the Buy strategy page uses the whole width, strategies before the example on phones, the margin inside its card, and each strategy says on how many of the person's watches it calls a good price today. No sealed item is worth a look: on booster boxes, Line falling (bought while on: higher 90 days later 22 % of the time against 72 %) outweighs Sales picking up (89 %); it is proven only for boxes, so it is not the sealed type's market warning. Then (user, 2026-10-28): plainer wait texts (the target's strategy named, Tora's suggestion or the person's; "a new low" instead of quantiles); Popular per item type with four measures (site rankings, most traded in 30 days on every site, trending, the year; nightly `popularity` setting), infinite scroll, and a card's rank tag opening its ranking with the item marked. Claude's own read of the prices against Tora's (2026-10-28, 121 cards and sealed items with a year of prices): judged on price level (where today's price sits in its own past year), whether the fall has stopped (the last 14 days against the 30 before), trading (40+ days with sales in 90) and reprint risk, about 14 items look like reasonable buys (older boxes near their year's low and turning up, several PSA 10s 25-70 % under their peak with prices flat or rising again). Tora calls almost none of them worth a look or a good price: its "worth a look" rests on signals of activity (sales picking up), not on price level, and its verdict says wait for nearly everything because similar items fell over 15 % in 12 weeks, a rule that holds as long as the market is down, even after an item stops falling. Suggested changes, waiting for the user's decision: test a "cheap and steadying" signal (bottom 30 % of the year, the fall paused) like the others; let a paused fall end the market's wait; never set a wait price under the year's cheapest tenth. Built (user, 2026-10-28, all three): signal "Cheap, fall paused" (price in the cheapest 30 % of its past year's daily prices, from 300+ days of prices; the last 14 days' median at least -2 % against the 30 days before), tested like the others; on the owner's data to 10-23 proven on booster boxes (15 of 19 higher 90 days later against 73 % any day) and Japanese singles (41 of 60 against 60 %), on for 13 items. The data narrowed the second change: a paused fall alone does not end a falling line (boxes: 8 of 38 higher; singles 49 % against 60 %), cheap and paused does (singles: 25 of 37 higher, median +6 %; boxes: 6 cases, too few). So Line falling is off and the market's fall no longer makes an item wait (buy verdict) when the item is cheap and its fall paused; most of the 13 now rank as worth a look. A wait price stops at the past year's cheapest tenth ("Tora asks no lower"). Also (user): a name search on Worth a look, Popular and Buy plan (`?q=`, kept across the tabs; every word in the name, alias or set name; romaji and hiragana find katakana, long vowels loose: "pikachu" finds ピカチュウ; English names that differ from the Japanese do not). Popular keeps each item's rank in the whole list; on Buy plan the search narrows the list and Suggest a mix, ticked items it hides still count.
5. Monthly plan (DCA): a monthly amount and the items aimed for; each month what to buy now and what to wait on; bought against the plan. Built 2026-10-31 on the Buy plan: an Every month switch makes the budget a monthly amount; the plan, Suggest a mix and Swap run to the month's last day on what is left once this month's purchases for the collection are counted (cost; not pulls, gifts, trades nor things bought to use; lots without a cost said); ticked items bought this month (same item and condition, or any condition for a plan item without one) say so and are not counted again nor offered to a mix; the list in Buy now / Wait / No price yet. No carry-over of an unspent amount (owner may change it).
6. Spread check: the holdings by type, franchise, set, era and price level; heavy concentration flagged; groups held little with proven signals pointed to. Built 2026-10-31 as Portfolio > Spread: the lots counted in value, at market value or at cost with no price (said); groups by item type, franchise (a name typed in any of the app's languages read as the same franchise), set (kept apart by franchise), release era (before 2016, 2016-2019, 2020-2022, then each year) and the price of one (powers of ten in the base currency's smallest unit); a group with 50 %+ of the value is heavy (not franchises, nor the only group there is), so is one item with 20 %+; item types and sets held under 5 % with items worth a look linked to Worth a look (a set by name search, which now also finds set codes). Thresholds are first guesses for the owner to tune.
7. Look-back test: what a mix would have done bought 6 or 12 months ago. Moved to S33 (the owner, 2026-11-07).

Acceptance: the user's check after each step that shows in the app; a UX review (`docs/ux-review.md`) before each.

First UX review (2026-10-28, steps 1-3, on the real-data test copy): fixed what it marked "fix": an item whose proven warning outweighs its proven signal was listed as worth a look (now with the rest; the type chips count the same way, "1 of 64"); a shorter intro on every tab; the four tabs fit a phone ("Popular"); the signal chips without a bare percent that read as a price change; "Prices as of"; the market note in plain words; a filter line with the count and Clear; "No signal today" on cards with no tag; the Signals tables with a "Vs any day" column in points; a plain empty Popular page. Left to the owner: owned items among the suggestions, warning chips as a filter, grading warnings by strength, folding groups with few checks. The Buy plan findings go to steps 4-5.

<a id="req-s28-s35"></a>

## S28 to S35: from the owner's check of 2026-11-07 (as in the requirements until 2026-11-25)

The owner's comments after S27, in the order to build them. Small and independent work first, then
sales accuracy, because target prices rest on the year's lows, which wrong sales distort. Numbers
are from the owner's data to 2026-11-06. Each visible step gets a UX review and the owner's check;
what a price, signal or alert means stays the owner's call, with the proposal in the actions file.

### S28: The owner's notes, small round

- Portfolio > Spread: uses wide screens like other pages; a group (item type, franchise, set, era,
  price of one) links to the Items page filtered by it, so Items gains the filters it lacks. The
  "worth a look" suggestions stay.
- A site refusing Tora while reading rankings or box opening cards alerts like a refused collector.
- Store codes: the owner's new codes and a pass over posts without a store (private lists).
- A franchise typed in Japanese: the importer that writes it fixed, one data command for the owner.
- A shop's parser that dropped sold-out items (their link has another form), which read as "page
  gone" and set listings aside: fixed, and the listings set aside for it come back.
- After the owner replaces both accounts' login codes: the old backup code form is no longer
  accepted.

### S29: Store notices and Lotteries

The Now page is what the owner actually reads, so notices should only say a sale has started.

- Sent at once: a post or reply in the person's stores with a start word, or a burst (3 or more
  different people on one store within 15 minutes, whatever the words). The burst is the safety net
  for wording the list misses and for people replying instead of posting. All other posts stay on
  Now. A shorter message with a link to the thread. Each person picks All, Sales starting, or Off.
  Size: 204 of 3,995 posts and replies in 30 days carry a start word, across all stores.
- Before any change: replay a busy past week, list what would and would not have been sent, and the
  owner marks what they would have missed.
- Lottery posts leave Now: only a first post with a lottery word, an application cue and no "not a
  lottery" phrase, its replies following; unsure stays on Now; Now says how many moved. Tested on a
  sample the owner marks. Expected effect is small: about 6 % of posts (11 % of first posts at most).

### S30: Sales accuracy

Of the sales kept in the last 60 days, the share over twice or under half the item's median for its
condition: Mercari 5.7 %, Yahoo! Auctions 5.5 %, a marketplace with its own pages 0.7 %, SNKRDUNK
0.2 %. Search-based sources are the problem. A random sample shows the causes:

- Goods matched to a game of the same name; near names (a sequel, a newer console's accessory).
- Sets and lots sold as one, read as one unit.
- A single card, or a part, sold under a sealed product's name.
- Other regions' versions; a graded card in a raw condition; a different card number in the title.

Not every far price is wrong, so rules go first and a price check last. Reserved listings are not
the cause (6.3 % against 5.1 %). Steps:

1. Measure per cause on a labeled sample, as the baseline.
2. Filter rules per cause; item kinds must match (software is not goods).
3. Far prices judged against the item's own recent sales, not only that night's batch: nights with
   few sales have little to compare with. Built, off for now (Decision log, 2026-11-07).
4. A sold listing found by two items' searches stored for each (the owner's decision pending).
5. Re-check stored sales from their kept titles: exclusions only, raw rows stay, a command for the
   owner. Measure again, and show what moved in values and year's lows.
6. Tora checks its own data each night (the owner, 2026-11-07) and alerts the admins when it looks
   odd; it fixes nothing, the alert is the cue to look into it. Within a source: the share of kept
   sales far from the item's median, against that source's usual share; a run keeping far fewer sales
   than usual. Across sources in one market: an item and condition whose medians differ over 2x with
   enough sales on both sides, and a source running high or low against the others on many items. Too
   few sales says nothing. One alert while a finding lasts, with what, how much and the usual level;
   the same findings on a settings page and in the data tool (sources kept from AI models left out).
   It comes after steps 1-5, so its usual levels are those of cleaned data.

### S31: Buy timing, target prices

The owner wants a quick judgment and real numbers: "Id rather have a number Tora is partially
confident than having nothing." So the rule changes from showing no target it cannot prove to
showing the target with its record.

- The top card: the verdict, the tags, and fair, good and ideal prices, each with a likely date and
  a confidence. Detail moves to tooltips and the Why card.
- Good and ideal come from how far similar items fell from this age to their first-year low.
  Confidence is how often similar items reached that price by that date, with how many items it
  rests on; too few similar items reads "rough". Tested first on past days with no look-ahead, for
  every type; the results go to the owner before the card changes. A weak row shows its weak record.
- Tools for timing, as far as anyone can: how much to buy at each price, an alert when a price is
  reached, a live listing already at a target, the risk of waiting (how often the price never came
  back), signs a fall is ending (listings, sales speed, the fall paused), dated events.
- Layout: on wide screens the card and Why on one side, the chart on the other; on phones card, Why,
  chart. Targets drawn on the chart.

### S32: Opportunities as a deal finder

Today's list rests on price analysis. The owner wants deals spotted in different ways, and the best
picked by potential and price.

- Lists by way of spotting: falling hard, cheap with the fall paused, sales picking up, listings
  drying up, a listing well under the market, rising fast.
- Potential: criteria a person sets (subjects, rarity, out of print, rank), each tested on the
  history and showing its record; one that does not prove out can stay as a stated preference.
- Every row shows potential, the Buy timing verdict and its target (S31).
- Buy plan is reconsidered here, keeping the monthly amount only if it still fits.

### S33: Look-back test

S27 step 7, wanted once the owner is happy with Buy timing. Two readings to pick from then: replay
Tora's picks from past days against an even spread, or today's mix priced in the past.

### S34: Sell timing

A spec comes later. The owner's starting rule: a good time to sell means the price went up, is not
expected to go up further, and there are clear ways to reinvest (so it depends on S31 and S32 having
good options to buy).

### S35: Sources and collection load

- Identity sources: search-by-number on a shop loses items (one shop: 15 of 56 linked items set aside
  in two weeks, none back). An identity source need not be a shop; official product pages and shops'
  official search APIs to weigh.
- Which stores earn their place: what each adds to prices and how much noise, per item type.
- A rhythm per item instead of the same effort for all: of 326 items on one marketplace, 195 gained
  15+ kept sales in 14 days and 64 none. Busy items nightly, quiet ones every 3 to 7 nights, for-sale
  searches nightly only for items owned or watched. About a third fewer requests (estimate).

<a id="req-s18"></a>

## S18: Documentation pass (as in the requirements until 2026-11-25)

The last phase (user, 2026-10-16): nothing to build, so it comes after everything else. Each phase keeps its guide current as it goes; this pass reads `docs/` and the README from start to finish against the app as it is then (S17, S9, S13, S10's France + China setup, S14, S15 all change what a newcomer sees), fixes what drifted, fills gaps, and checks every command and link. To consider then: the Japanese documentation for the portfolio (Open issues).

### Progress

1. First pass (2026-10-25): every guide read against the app; a script checked every relative link, every `pnpm` command named and every repo path (all resolve). Fixed: the README's guide table (five guides missing), its collectors line (Turso only) and the public plug-ins; setup's checks (`pnpm check:all`), `pnpm app` for your own server, five settings missing from the environment table, the MCP tool `opportunities`; running's crawl views and contrast check, the quiet-source warning, a new speed section (`pnpm perf`, `--load`, `pnpm stress-data`); alerts' admin messages (listings set aside, quiet source, self-check, read budget, failed server update), store notices, `pnpm alerts update` and `server`; the account file loaded into an empty account (backups); `stores` in a plug-in's entry point; whole threads on the Stores pages; the later TCG shops in the author's setup.
2. Gaps found, not written yet: running Tora on your own server as a service (start on boot, the schedule, updates from pushes): the guides give it one paragraph, the owner's own guide is private; the Japanese documentation.
