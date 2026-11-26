# Collectibles Tracker: Requirements (v1)

## How to use this file (Claude Code: read first)

- This file holds what Tora is for and where it stands: the goal, the example scenarios, the stack and the repo layout (**Core**), and one line per build phase (the Status table).
- The rules the code computes from are in `docs/rules/`, one file per concern, each the one home of its numbers; Core sections 3 and 5 to 7 point to them. Before changing something, read the rules file of the concern it touches ([the list](docs/README.md)).
- A phase's chapter (what was asked, designed and built) is a record in [docs/history.md](docs/history.md), not where rules live. One chapter is still below, S36's, until the owner's Wishlist steps are done, since fixes from those checks are built from it (the doc sorting, 2026-11-24). The chapters of the other phases, those still awaiting checks included, are records: later work on them is built from the rules files.
- Dated decisions are in [docs/decisions.md](docs/decisions.md); new ones are appended there.
- The owner's own setup, sources and to-dos are in private notes (`collectors/ops/notes.md`, in the private submodule).
- Do **not** start the next phase until the current one meets its acceptance criteria and the user confirms.
- At the end of a phase: update its line in the Status table, move its chapter, with the dated log it holds, to the history, commit.
- If something here or in a rules file turns out wrong or ambiguous, or the chapter below and a rules file differ, point it out and ask the owner, then fix it in its home (a rule or a number in its rules file; the goal, stack, layout and Status here) rather than working around it.

### Status

One line per phase. Each links to its chapter in the history; the dated log of each line until 2026-11-25 is there too ([Status logs](docs/history.md#status-logs)).

| Session | Topic | Status |
|---|---|---|
| [S1](docs/history.md#req-s1) | Foundation: monorepo, schema, i18n, access | done |
| [S2](docs/history.md#req-s2) | Registration UI (products, lots, pulls, events) | done (reworked by S2b) |
| [S2b](docs/history.md#req-s2b) | Accounts + 2FA + devices, TCG/Game taxonomy, region, TCG set catalog | done |
| [S3](docs/history.md#req-s3) | Collector framework + SNKRDUNK + source matching | built; awaiting data gate with user |
| [S4](docs/history.md#req-s4) | Mercari sold collector + purchase import by link | built; awaiting user check |
| [S4b](docs/history.md#req-s4b) | MCP server: Claude reads the data (sanity checks, analysis, dev feedback) | built; awaiting user setup |
| [S5](docs/history.md#req-s5) | Valuation engine, Portfolio, Item detail, charts | built; awaiting user check |
| [S5b](docs/history.md#req-s5b) | SNKRDUNK purchase import (Gmail Takeout) + order IDs | built; awaiting user import |
| [S5c](docs/history.md#req-s5c) | Portfolio as a per-product summary + product images | built; awaiting user check |
| [S5d](docs/history.md#req-s5d) | Imports hub: one Imports menu for every import, its results and follow-ups | built; awaiting user check |
| [S4d](docs/history.md#req-s4d) | Automated data review: cheap model checks flagged data, suggestions queue | built; awaiting user check |
| [S4c](docs/history.md#req-s4c) | Import purchases from any shop through Claude (Haiku, Sonnet for flagged rows) | built; first real import done |
| [S7](docs/history.md#req-s7) | US data (TCGCSV, eBay), 駿河屋, FX, JP vs US spread | built |
| [S8](docs/history.md#s8) | Visual redesign + wide-screen layout, portfolio revamp (tracking groups, speed), Actions page, sources with roles | done (2026-10-17) |
| [S11](docs/history.md#req-s11) | Primary and secondary markets: roles and identity sources per market, one secondary price per item | done (2026-10-17) |
| [S16](docs/history.md#s16) | Make Tora work anywhere: admin-defined categories (kinds, fields, price condition), markets, languages and base currency; ground rules for running many collectors | parts 1-5 accepted 2026-10-17; left: the EUR + French check and measuring on large data |
| [S12](docs/history.md#s12) | Documentation for others: clone and run, build collectors, choose identity and reference sources, set up markets | done (2026-10-17) |
| [S6](docs/history.md#s6) | Backups, download my data, spreadsheet import, import log | done (2026-10-17) |
| [S17](docs/history.md#s17) | Notifications and activity log: alerts outside the app (Telegram, Discord), what triggers them, a log of what happened | done (2026-10-17) |
| [S9](docs/history.md#s9) | Watchlist and buy timing: track items not owned yet, find good prices to buy at | parts 1-4 accepted 2026-10-17; part 5 built 2026-10-18, awaiting user check |
| [S19](docs/history.md#s19) | Database reads within Turso's free plan, reliably and with leeway; then the switch back to Turso | built 2026-10-18 |
| [S22](docs/history.md#req-s22) | Item page as sub pages: Market, Buy timing (redesigned from the card), Lots & details | built 2026-10-18, awaiting user check |
| [S23](docs/history.md#req-s23) | Pokemon Center Online purchase import from its order emails | built 2026-10-18 (private importer plug-in) |
| [S24](docs/history.md#req-s24) | Japanese TCG shops as sources (private plug-ins): three shops first (asks, stock, 買取); more later | built 2026-10-19, awaiting the user's check |
| [S20](docs/history.md#s20) | Box opening value: at what box price opening is worth it (pull rates, hit card prices) | built 2026-10-19, awaiting the user's check |
| [S25](docs/history.md#s25) | Store notices: posts about cards on sale in physical stores (community boards, fed by the person's own browser), store codes mapped to stores, notices for the stores in the person's area (picked stores or a distance from where they are, travel mode), each store on or off; a new Stores page | built 2026-10-19 to 10-21, accepted for now (2026-10-20) |
| [S20 part 2](docs/history.md#s20) | Pull rates as a plug-in kind (suggested rates come from plug-ins, the built-in list moves to the public plug-in package) | built 2026-10-20 |
| [S21](docs/history.md#req-s21) | Admin account tasks in the app (create users, reset password or 2FA, devices, disable) | built 2026-10-20 (migration 0050), awaiting the user's check |
| [S13](docs/history.md#s13) | Opportunities and buy suggestions: signals that find opportunities within a category (from current data, then ranking plugins), then what to buy and when within a budget and a target date | built 2026-10-21, awaiting the user's check |
| [S10](docs/history.md#req-s10) | Reliability, consistency, efficacy and function review, incl. cloning the repo and doing a full setup from start to finish in another market (Spain + Brazil) | done (2026-10-24) |
| [S14](docs/history.md#req-s14) | Speed at any size: measure every page, data at three sizes, fix the slowest, keep a speed check; revisit infinite scroll for the app's long lists (the Items page first; built on the Stores pages, S25) | in progress (2026-10-25): every page within the targets; next the user's check |
| [S15](docs/history.md#req-s15) | Stress test and bug hunting: automated crawl and checks, edge cases, bug log | in progress (2026-10-25): next the user's check |
| [S18](docs/history.md#req-s18) | Documentation pass: bring every guide in `docs/` and the README up to date with what was built since S12 | in progress: continues as the doc sorting and review (2026-11-24); left: the Japanese documentation |
| [S26](docs/history.md#req-s26) | Opportunities as sub pages: Worth a look, Popular now, Signals, Buy plan; cards with tags and a target price; every item ranked, loaded as you scroll; a singles ranking and the top 60 as candidates | built 2026-10-27 |
| [S27](docs/history.md#req-s27) | Opportunities part 2: chains in store posts; singles (market note, steadier prices, the set as the line); tested signal plug-ins (PSA 10 vs raw A, a quick rise); planning: spend a budget well, a monthly plan, a spread check, a look-back test | steps 1-6 built (to 2026-10-31); follow-ups moved to S28, S31, S32 and S33 |
| [S28](docs/history.md#req-s28-s35) | The owner's notes, small round: Spread on wide screens and its links, refused rankings alert, store codes, franchise fix, old backup codes | built 2026-11-07 |
| [S29](docs/history.md#req-s28-s35) | Store notices and Lotteries: notices only when a sale starts, lottery posts out of Now | built 2026-11-07 |
| [S30](docs/history.md#req-s28-s35) | Sales accuracy: fewer wrong sales from search-based sources | in progress: rules, the re-check command and the self check built 2026-11-07; the run to come |
| [S31](docs/history.md#req-s28-s35) | Buy timing: target prices with dates and confidence, a simpler card | in progress: the owner decides what the card shows |
| [S32](docs/history.md#req-s28-s35) | Opportunities as a deal finder: ways of spotting deals, potential, price | built 2026-11-07; the owner decides definitions and Buy plan |
| [S33](docs/history.md#req-s28-s35) | Look-back test (from S27 step 7) | planned 2026-11-07, after the owner is happy with S31 |
| [S34](docs/history.md#req-s28-s35) | Sell timing | planned 2026-11-07, spec later; needs S31 and S32 |
| [S35](docs/history.md#req-s28-s35) | Sources and collection load: identity sources, which stores earn their place, a rhythm per item | measured 2026-11-07, nothing built; the owner decides |
| S36 (below) | Wishlist: items chosen to buy later (mostly used console games), bought near their lowest: fixes to game sales and asks, the wish as an item with 12 months of past sales, a page with prices as paid and alerts on copies that can be bought, console exclusives tracked ahead | steps A0 to D built 2026-11-23 to 11-24; next: the owner's steps, then step E |

### Decision log

In [docs/decisions.md](docs/decisions.md), in date order. New decisions are appended there.

---

# CORE

## 1. Goal

A personal app, for a handful of accounts, to track collectibles (Pokemon and other TCG singles and sealed products, game collector's editions, amiibo, special controllers, other game-related items):
- what I own, quantity, condition, when/where/how much I paid
- what it is worth now, per condition, from accumulated Japanese second-hand market data (and US data for comparison)
- for sealed TCG products: which cards I pulled, and box-level profit/loss
- price trends from data accumulated in our own DB

Priority right now: **start registering items and accumulating price data as early as possible.**

Personal use: a handful of accounts (the owner, possibly family). **Each user sees only their own collection**; the product catalog, TCG set catalog and market data are shared. Data is never published or served to anyone else (the hosted app sits behind a login).

## 2. Example scenarios (acceptance reference for the whole project)

1. Register a game's collector's edition (say, "Star Lancers: Collector's Edition") with its condition.
2. Register several amiibo, including 3 identical ones bought at the same price and condition in one entry (qty 3).
3. Register special edition controllers.
4. Register an anniversary box of a card game bought new at an electronics megastore, where the clerk opened the box in front of me (packaging state: box opened, packs sealed). Its value must be judged as an opened box, not as a shrink-wrapped one.
5. Register the cards pulled from that box, linked to it, and see: price paid for the box, what the box would be worth now in the state I received it, current value of the pulls, and net result.
6. Later, send a raw grade A pull to PSA, record the grading fee, and update it to PSA 10 when it returns, keeping history.
7. See total inventory: amount spent, current value, unrealized P/L, value over time.
8. Export everything and be able to reconstruct the full collection without the app.

## 3. Stack and environment

- Node 24 LTS (>= 22), pnpm workspaces, TypeScript strict everywhere.
- `apps/web`: Next.js (App Router), Tailwind, shadcn/ui, next-intl, zod.
- Charts: lightweight-charts (TradingView).
- DB: SQLite through Drizzle ORM with the libSQL client (`@libsql/client`). One `DATABASE_URL` serves the app, the scripts and the collect: a local file (the owner's install, development, tests) or a hosted libSQL database. Migrations are add-only. More: [docs/rules/data-model.md](docs/rules/data-model.md).
- Tests: vitest (with property tests), a page crawler, and CI on every push ([docs/ci.md](docs/ci.md)).
- **Where it runs:**
  - The owner's install: one home server runs everything (the app, the database file, the collect, the backups, their timers), reached from outside through a tunnel ([docs/home-server.md](docs/home-server.md)).
  - The other way ([docs/setup.md](docs/setup.md)): the app on a hosted platform with a hosted database. Collectors still run only on a home machine (a residential connection is needed; never on a hosted platform or in CI); the collect saves what they return in the database `DATABASE_URL` names (a plug-in never writes to it).
  - What reads no site (values, buy timing, the backup, the alerts) runs right after the collect on the same machine. The app runs its own morning check; a hosted app is called once a day for it ([Alerts](docs/rules/alerts.md#words)).
- **Accounts and access**: a name, a password and an authenticator code to sign in, at most 2 devices per account, no public sign-up, every page and action behind a session. The rules and their numbers: [docs/rules/accounts.md](docs/rules/accounts.md). These lines as first written are a record in [docs/history.md](docs/history.md#core-3-auth).
- Phone use is first-class: registration flows must be mobile-first. Add a PWA manifest so it can be added to the home screen.
- Scheduling: the home server (on the other way, the home PC's task, `scripts/install-windows-task.sh`) starts `scripts/collect-cron.sh` every hour; until that day's collect and backup have succeeded, each start runs the collect after a random wait, and an admin's collect now runs at the next start without the wait ([docs/rules/collectors.md](docs/rules/collectors.md#when-the-collect-runs)).

## 4. Repo layout and public/private split

The main repo is **public** (portfolio piece). The owner's own scrapers live in a **private** repo.

```
apps/web                 Next.js app (pages, API routes, server actions)
packages/db              Drizzle schema, migrations, every query and write, the saved numbers
packages/core            Domain logic with no database: lots and splits, valuation, buckets, buy timing, opportunities
packages/collector-sdk   The plug-in contract, the runner, polite HTTP, the command line tools
packages/auth            Passwords, authenticator codes, backup codes
packages/mcp             The read-only MCP server
collectors-public/       Plug-ins safe to publish
collectors/              PRIVATE git submodule: the owner's plug-ins and notes
ops/, scripts/           The home server's scripts and the schedule, CI checks, developer tools
```

- The public repo must install, build, test and run **without** the private submodule (its plug-ins are simply not loaded; the collect runs the public ones).
- No scraping code, tokens, endpoints or fixtures from private sources in the public repo.
- Secrets/config in `.env` (gitignored), with `.env.example`.
- Built into Tora, usable anywhere (user, 2026-10-19): what is specific to a country, a shop, a site or a market is a plug-in (collectors, purchase importers, rate sources, set card sources, pull rate sources, store directories, feeds...), and Tora's core stays general; a plug-in kind is documented (docs/) so others can write their own, without the private reading code.

## 5. Data model

Moved to [docs/rules/data-model.md](docs/rules/data-model.md) (2026-11-24): the general rules (facts and derived numbers, IDs, money, times, add-only migrations), what is one person's and what is shared, the rules of collected prices and of lots, and every table with what a row is. The columns are in `packages/db/src/schema.ts`. This section as first written is kept as a record in [docs/history.md](docs/history.md#core-3-5); nothing is built from it.

## 6. Valuation rules

Moved to [docs/rules/values.md](docs/rules/values.md) (2026-11-24): the one home of how a value is made (which prices count, the steps and windows, similar conditions, outliers, confidence), what shows beside it (last sale, per source, the instant sell floor), the totals and the profit, the box view, value over time and the saved values. This section as first written is kept as a record in [docs/history.md](docs/history.md#core-6); nothing is built from it.

## 7. Collector rules (all sources)

Moved to [docs/rules/collectors.md](docs/rules/collectors.md) (2026-11-24): the one home of what a collect reads, its pace and caps, what happens when a site refuses, when the collect runs, the daytime reads and what is kept. The health flags are in [docs/rules/alerts.md](docs/rules/alerts.md#shown-in-settings-only). This section as first written is kept as a record in [docs/history.md](docs/history.md#core-7); nothing is built from it.

UI principles (all screens):
- Calm by default: few numbers, details on demand. Show data freshness and confidence wherever a market value appears.
- Mobile-first for registration, desktop-friendly for analysis.
- A primary and an optional secondary language, picked by the admin, via next-intl; a text missing in a language shows in English. Item names follow the markets, not the language ([Languages](docs/languages.md)).

---

# SESSIONS

Every phase's chapter is a record in [docs/history.md](docs/history.md) (the Status table links to each). One chapter stays here, S36's, until the owner's Wishlist steps are done, since fixes are still built from it.

## S36: Wishlist

Added at the owner's request (2026-11-21; decided 2026-11-23). The owner registers specific items to buy
later, mostly used console games in their Japanese physical versions, waits 3 to 12 months and wants to buy
as near the lowest price as possible, without being caught by a game whose price bottoms out and then rises.
Opportunities (S13, S26, S32) stays the place for finding things to buy; the Wishlist is for items already
chosen. It is designed from that goal, not from what the data of the day allows: each limit is written as a
problem with its way around, or as a permanent limit with its effect ("Limits").

Numbers are from the owner's data and tests to 2026-11-23. The measurements, the owner's list of games and
each source's specifics (category numbers, page formats) are private, in the notes' Wishlist files. Each
step below is its own task with a spec; a step that changes what a page shows gets a UX review and the
owner's check. A number marked "to start" is a setting with no measurement behind it yet: it is changed
without a new decision.

### Scope rule

Nothing changes for cards and sealed products: their searches, stored asks, values and alerts stay as they
are, and the version number shared by all automatic searches is not raised (raising it would rewrite every
item's search). Each fix lives in the code path for games or in the Wishlist's own view. The same measures
can be run on cards and sealed later, as tasks of their own. What the rest of Tora does notice is said in
each step ("Outside the Wishlist"). One exception, by the owner's decision: step A0 slows one shop for
every item.

"Game" below means an item of the game category whose kind is software. For the other game kinds (a limited
edition, an amiibo, a controller) the game rules apply only when a person turns them on for the item at
the registration check, after seeing what they drop. A wish on anything that is not a game under this rule
keeps what the Watchlist does today (S9's zone, target and alerts), unchanged.

### Terms

- Wish: an item a person wants to buy, in one condition, with a note and an optional price of their own:
  the watch's target, called "the person's price" below, never prefilled. One list: the Watchlist (S9)
  becomes the Wishlist and every watch is a wish, its condition and its price carried over.
- Condition: a wish's condition is one of Core 6's buckets for items (new, like new, good, fair), as a watch
  has it today. "A better one" is an earlier bucket in that order. A listing with no bucket is shown apart
  as "condition not stated" and sends no alert.
- The item's rules: what counts as the item, shared by everyone: the console, the edition, the region, words
  a title must have, words it must not have, and "boxed" (B1). They belong to the item, not to a wish.
  Changing them takes the item's confirmation away (below) and marks every wish on it "check needed".
- Console table: one row per console, edited by admins: its name, its software category at each marketplace
  whose search takes a category (a plug-in may bring them), and whether "boxed" can be asked (B1). Adding a
  console is adding a row. A game whose console has no row, or no category at a marketplace, keeps today's
  search there, and its sales and asks there stay unconfirmed.
- Clean sale: a kept sale (not excluded) of one unit that passes the item's rules and the re-check of S30.
- Confirmed: an item's sales are confirmed once its labeled check passed (A1) or a person confirmed them at
  the registration check (B1). Its listings at a source are confirmed once that source's labeled check
  passed (A2) or a person confirmed that source's listings at the registration check. Sales never confirm
  listings. Checks count distinct sales and distinct listings. After a labeled check failed, only an admin
  can confirm in its place. Saving other search words for the item at a marketplace (B1) takes away the
  confirmation of its sales and of that marketplace's listings, for the item and for each boxed item that
  reads its rows; a person can confirm again after the next read.
- Checked listing: a listing for sale that passes the item's rules, at a source whose listings are confirmed
  for the item. A source linked to the item by the item's own page there, not by a search (the identity
  shop's own copy and the outside sellers on that page), is checked by that link, in the bucket its plug-in
  maps it to. A person can mark any listing shown or alerted "not the item": it is excluded for the item
  (the raw row stays) and no longer counts anywhere.
- As paid: the stored price, in the base currency, plus what the buyer adds: shipping when the buyer pays
  it, and a buyer's fee where a source charges one. Each source's plug-in says, for its sales and for its
  listings, whether its price includes them, adds a known amount, or does not tell (C1). Not known is never
  taken as zero.
- Level: the price a quarter of recent sales were at or under. For a day: the 0.25 quantile (of single
  sales, interpolated as Core's quantile is) of the as-paid prices of the item's clean sales in the wish's
  bucket, over the 30 days ending that day, from every source of the primary market whose sales' added cost is
  known and whose days in the window are all covered; the page names the sources counted. A day has a level
  only with 10 or more such sales. With fewer than 10 the window is 90 days, on the same conditions, and
  the page says so. Otherwise there is no level: the page shows the lowest, the highest and the count of the clean sales of the last 90 days, and
  from which day they are whole. The level is per bucket, as the replay measured it; pooling the used
  buckets is measured at the rerun (step D).
- Covered day, per source: a day whose night read that source for the item (the collect that runs just after
  that day ends: it carries the next day's date and has read the sales up to then, so a collect dated D
  covers D-1, and the newest day a level can have is yesterday), from the item's first nightly collect on; a day a later read-back reached past (A3, a tracked game's weekly read); or a day inside the
  span of a finished deep read (B3). A deep read's span runs to the day before its first page was read (a
  read over several days sees the newest sales only on its first day; the nights cover the days since), from
  the date it was asked to reach when it read 4 weeks past that date, and otherwise (the pages ran out
  first) from 4 weeks after the oldest listing it reached. A deep read that has not finished covers nothing
  yet. A span stands only while what it rests on does: it is dropped when the item's stored sales at that
  source are removed (its search saved again), when a load it overlaps is undone, or when the item's search
  today is no longer within the search the read was made under (a console corrected, a word dropped, a
  merge); the deep read is then asked for again.
- Record: the lowest level of any day, with its date and window. It is computed from the clean sales as they
  are now, never kept as a running minimum, so it follows an exclusion or a change of rules. It is never the
  lowest single sale: that is usually a loose or wrong copy, or was gone within hours.
- Young game: released under 90 days ago (from its first clean sale when the release date is unknown). Its
  page shows its age beside the level and never says "near the low so far".
- Buyable price tonight: what the item could be bought for at the last nightly read (C2).
- Tracked game: a game collected lightly without being wished or owned, so that its history exists before it
  is wished (step D).
- Night: one nightly collect. A night on which a source was not read (failed, refused, skipped) says nothing
  about that source: it is skipped in every count of nights below, never counted as "none found".

### Step A: fixes to today's data, games only

None of these is a bug against this file: they are choices that work for cards and fail for games, which
are valued from marketplace sales. Each is measured before and after.

A0. A shop's pace. The identity shop for games asks every program, in its robots file, for 30 seconds
between requests; Tora waited 2 to 5. Its plug-in waits 30 seconds. Its run goes from about 15 minutes to
about 2 hours a night (about 250 requests, two an item). Core 7's pace line and the collector guide gain
this exception with the step. Outside the Wishlist: the nightly collect ends about 1 h 45 later.

A1. Game sales. Today each item learns its usual categories and runs up to 2 extra searches inside them;
for games about 78 % of the cheap sales kept are not the game (goods, bonus cards quoting its name,
guidebooks, bundles). Fix: a game's sold search at a marketplace takes the console's software category from
the console table, in place of the extra searches, plus the item's required words; where a search takes no
category the words do the work. Excluded words are not sent in the search: the marks below apply them, so a
sale a word drops comes back when the word goes. The category and words are laid over the item's stored
search when it is read; the stored search is not rewritten. A game with no rules of its own uses its
console (found from its platform) and no words. Stored and new game sales that fail the item's rules are
marked excluded with a mark of their own, apart from S30's exclusions: each night the marks follow the
rules both ways (a word added drops sales, a word removed brings them back), never touching a sale a person
included or excluded, and raw rows stay. All of this sits behind one admin switch, off at first: the owner
sees before and after per game from a rehearsal on a copy, then turns it on; turning it off takes every
such mark away (sales outside the console's category that were not read while it was on are not read
again). An item whose rules would drop more than half of its kept sales (10 or more) is held, with nothing
marked, until a person confirms it at the registration check. S30's own re-check is not changed.
- Measured on the 27 games with enough sales: 12 % of kept sales removed, under 1 % of real copies lost,
  sold searches at Mercari down from 63 to 27 a night.
- Check, per game, by hand on stored titles and categories, with a blind second reading as in S30: the 20
  cheapest clean sales of the last 12 months, and the 20 nearest in price to the median of those 12 months'
  clean sales (all conditions). The game passes when 18 or more of each 20 are the item. With fewer than 20
  clean sales all are read and 90 % (rounded up) must be the item; with fewer than 10 the game is not judged
  and its sales stay unconfirmed until a person confirms them (B1). Every sale a check finds not to be the
  item is excluded by hand (the raw row stays), passed or not. A game that fails gets words added and is
  checked again.
- Outside the Wishlist: owned games' values move (junk at the cheap end goes, so medians mostly rise);
  fewer requests for games.

A2. Game asks. A marketplace's stored cheapest ask for a game is mostly not the game: asks under 30 % of the
item's own sales are not searched, by design, and the first listing over that line is usually something
else. From the start of step A, wherever a game's ask from a search-based marketplace is shown or used (the
list, the item's pages, the target alert, the deal lists) it reads "unverified" and triggers nothing. Fix:
the for-sale search takes the console's category; the cheapest listings that pass the item's rules are
stored per source and bucket with title, link, seller and category (the cheapest 20 until that source's
listings are confirmed for the item, then 3 to 5); the lowest ask is the cheapest of them. The 30 % line
stays. Check per game as in A1, on the distinct listings stored over 7 or more nights (to start): the 20
cheapest, 18 or more the item, the same rule for fewer. Passing confirms the game's listings at that source, and
"unverified" then goes for that game there. Outside the Wishlist: a game's ask on its item pages and in the
deal lists is the checked one, or none.

A3. The nightly read is a sample (one page of the newest sold listings; 81 % of the busiest game's sales
caught). Fix, for wishes: once a week the sold search is read back until the listings are 6 weeks old (to
start), so the level's 30 days are whole; it counts against the daily ceiling (B4). Tracked games get this
by their weekly read.

A4. A listing count that the source caps is "at least N" (72 % of game rows at Mercari). The Wishlist shows
it so and builds no fact on a falling count.

A5. Release date and list price. No game has a release date and one has a list price. The identity shop's
two pages read each night (its search result for the item and its buy-back list) already carry the release
date and the list price; the plug-in reads them and drops the first. Fix: both get fields of their own, and
the product code (JAN) and the maker are read from those same two pages where they show them. No other page
is read: the shop's product pages are behind a challenge. The release date fills the item's date only when
it is empty. The list price is stored on its own, never as the item's retail price (a value falls back on
that), and is shown as "list price at the shop": whether it includes tax is not known. Before any share of
it is shown, it is compared on 10 games with their printed launch prices. Outside the Wishlist: "New
release: wait" (S9) starts to apply to games out for weeks.

A6. The identity shop's ask is the lower of its own copy and an outside seller's on its site; the outside
seller's price is already in the stored row. The two get fields of their own; the merged figure stays for
everything that reads it today.

Acceptance, step A: the labeled checks pass for every wished game with 10 or more clean sales; on a copy of
the data, the searches, kept sales, stored asks, values and alerts of cards and sealed items are the same
before and after each step.

### Step B: the wish as an item, and its history

B1. Registration. A wish is made from an item (existing, new, or found through the identity shop's search,
which then links it and fills A5's fields). The item's rules come from the console table and the title.
"Boxed" can be asked for the consoles the table marks (to start: N64, DS, 3DS and GameCube, where a boxed
copy sells for about 1.3 to 2 times one whose title does not say; not Switch, PS4 or PS5, where the gap is
about 10 %): the boxed item is an item of its own, with the shop's complete copy as its page and no
marketplace search of its own: its sales and listings are those of the plain item whose title says boxed
(a sale is stored once, under the plain item). Several games can be added at once: lines of name and
console are pasted, a preview shows what would be created and which look-alike items exist, and the
person confirms; the shop link then comes from the nightly candidates as for any new item. After the item's first read (the next night, or its deep read),
the registration check shows, for sales, the 20 cheapest matches, the 20 nearest the median and what the
rules dropped, and for each source's listings apart the 20 cheapest stored and what the rules dropped. The person confirms each, or changes a word and sees it
again after the next read. Until its sales are confirmed a wish is marked "check needed", shows its sales as
unconfirmed and has no level, record or alert. Game watches that exist when this step is built get the same
check. The check also shows the words each marketplace is searched with for the item, with what the rules
add when the search is sent (A1). The words are made from the item's name when the search is first made and
do not follow a later rename; the wish's owner or an admin can change them there (not on a boxed item, which
has no search of its own). Saving other words removes the item's stored sales at that
marketplace, except sales a person excluded by hand, and sets its stored listings there aside (kept, not
shown on the check); both are read again (its covered spans are dropped
and its deep read is asked for again, as under "Covered day"); until that marketplace is read again no
confirmation can be made. A save that changes nothing does nothing. A person holding a lot of the item saves its search from the item's page under the same rule. From the
wish's page and its check, the item's maker or an admin opens the item's edit page (its name, its console).

B2. The identity shop's prices kept every night for wishes: used, new, buyback and stock, the shop's own
copy and outside sellers apart (A6).

B3. Deep read. A marketplace's sold search holds about the last 12 months (tested at Mercari on three games:
12 months for any game, 120 a page, no refusal at one request every 10 to 20 seconds; not tested: many games
in one day, and from the server's address; the window moves a day each day). The past sales of a new wish
are read once, to 12 months back: the read goes on until the listings are 4 weeks (to start) older than the
date wanted, since the order is only roughly by listing time, and is then cut by sale date. A read stopped
by the day's number or a refusal keeps what it read and goes on the next day from where it stopped. The
sales enter Tora through the collect, pass the same rules as nightly sales, and count once the read has
finished (covered days). Sales saved as raw files before this step existed are loaded the same way. The
deep read and the nightly read each find sales the other misses; together they are the history. With the
12 months loaded, the record is measured against the lowest 7-day median of the daily levels (the lowest of
many small samples runs low); the result goes to the owner before any page shows a record.

B4. Daily ceiling, one per marketplace. Everything Tora asks of a marketplace beyond the nightly collect
(deep reads, A3's re-reads, tracked games' reads, a "buying now" switch) is a job of its own: one request
every 10 to 20 seconds, at most 200 a day to start, never while a collect is running and, to start, only
between 05:00 and 22:00 (the install's time). It stops at the day's number or at a refusal. A refusal
alerts the admins as a refused collector does; the job then waits 3 days and halves its number, down to 25
(to start); refused at 25, it stops until an admin starts it again. The number never rises on its own. Its
order: A3's re-reads, deep reads of wishes, tracked games' weekly reads, deep reads of tracked games (those
out for 12 to 24 months first, whose launch months are leaving the window), and last the monthly pages of
step D, from what is left of the day's number. The collectors page shows the day's number, what was used
and what waits. A refusal is never worked around.

B5. New copies: an official shopping search API finds new and used copies by product code across shops,
with stock (the owner's client id; not yet tested). It gives the cheapest new copy and whether the item is
still sold new.

Acceptance, step B: a game on the owner's list is wished, confirmed at its registration check, and once its
deep read has finished shows 12 months of clean sales with a level for each day that has one; the
collectors page shows the ceiling and its use.

### Step C: the page, prices as paid, alerts

C1. As paid is computed in the Wishlist's view and alerts only; stored prices, values and every other page
stay as they are. Where a source shows, sale by sale, who pays the shipping, the plug-in stores it, and a
sale the buyer paid shipping on stays out of the level unless the amount is known. For the sales a source
does not tell this about, a plug-in may say its prices include shipping as a rule when a sample of 100 of
its sales shows 95 % or more do (to start); such sales count as known. A sale whose added cost is not known
stays out of the level and the record (at first: a marketplace whose sold search does not give shipping,
until the plug-in stores it). A listing whose added cost is not known is shown at its stored price with
"plus shipping".

C2. A wish shows:
- The buyable price tonight, from the last nightly read: the identity shop's own copy; outside sellers on
  its site, apart; the cheapest 3 to 5 checked listings per source in the wish's condition or a better one,
  each with title, link, seller and price as paid. A source not read that night shows the date of its last
  read, and its copies under that date, not as tonight's.
- The level with its count and window, its change over 4 weeks, and the record with its date.
- Bounds: the shop's buyback price under, the cheapest new copy over, and the share of the list price (A5).
- An estimate, labeled as one: a range where the price likely settles, roughly when, and named risks (a
  re-release likely, no longer sold new, a limited edition). It is entered on the wish with its date, basis
  and sources: from games of the same kind in Tora (step D), outside cases, or research the owner asks
  agents for (the app holds no model key). As the wish's own history grows the page says how much rests on
  the game and how much on its kind. Past estimates stay and are scored against what happened.
- Plain facts from stored data: the level's and the buyback price's change over 4 weeks; the shop out of
  stock, or no new copy found, for 5 or more nights running (to start; nights not read are skipped); a
  dated fact a person recorded (a re-release announced, with its source).
- No verdict on the list. A label that claims proof ("falling", "the low is in") appears only once a replay
  on past days has 30 or more separate cases over 10 or more games behind it and its outcome differs from
  the other labels'. Until then the page says "near the low so far" at most, never "this is the bottom".
  The item page's Buy timing card is not changed here; what it shows is S31's.

C3. Alerts. From this step a wish on a game gets only the alert below: S9's zone and target alerts stop for
every wish on a game, confirmed or not, with a price or not.
- In and out: after a nightly collect, a wish is "in" when a checked listing in its condition or a better
  one is at or under the person's price, as paid, and "out" otherwise. A listing whose added cost is not
  known counts on its stored price, and its alert says "plus shipping". A source not read that night keeps
  the listings of its last read for this state only: an alert is sent only for a copy read that night.
- The alert names the cheapest such copy (title, price as paid, seller, link) and the three cheapest checked
  listings from different sellers; when it is the only one at or under the price it says so, with the next
  price up.
- Sent when the wish goes from out to in, unless it was last in under 14 nights ago. While in, or on coming
  back within those 14 nights, sent again only when the cheapest copy is 3 % or more under the reference.
- The reference is the price of the copy last alerted, while that copy is still listed and for 14 nights at
  most. From the first night that copy is gone, marked "not the item", or past its 14 nights, the reference
  is the cheapest other checked price of that night (above the person's price or not), fixed until the next
  alert; with no other checked listing that night it stays as it was.
- A copy is alerted once: again only when its own price is 3 % or more under the price it was alerted at.
- Saving a new price starts this over: the wish counts as out and as never in, so the first night with a
  copy not yet alerted at or under the new price alerts.
- On saving a price the page says on how many of the last 30 nights with checked listings it would have
  been in. A wish with no price says no alert will come; one marked "check needed" says why none will.
- The morning summary carries, for the person's wishes: a level move of 5 % or more over 4 weeks, a buyback
  move of 10 % or more (the replay's sizes), the stock and new-copy facts, a newly recorded fact, and wishes
  marked "check needed".

C4. During the day. No second collect: the level moves over weeks. What a nightly read misses is the single
underpriced listing (at Mercari 46 % of listings 15 % under their week's average ask were gone by the next
night). The wish gives the words, the category and the price cap to save as a search in the marketplace's
own app, which notifies within minutes; the summary points to them when the cheapest checked listing is
within 10 % of the person's price (to start). Only if those notices prove too coarse: a "buying now" switch
on one wish, read a few times a day inside the daily ceiling until bought or switched off.

Acceptance, step C: for a wished game with a price, the page shows the last read's copies as paid, the
level, the record, the bounds and a labeled estimate; the morning after a checked copy at or under the price
is listed an alert names that copy; no alert comes from an unverified ask, from a listing not read that
night, or from sales alone.

### Step D: tracked games

Console games that are not on PC, tracked before they are wished: for nine consoles to start, more by
adding rows to the console table. Tracking ahead adds what cannot be read back: history older than 12
months, the shop's prices, and the cases the estimates rest on.
- A chosen set of about 300 (the makers' own games and the best-known exclusive series per console, drafted
  from a catalog, trimmed by the owner), read weekly: sold searches read back 2 weeks (to start), about 90
  requests a day of a marketplace's daily ceiling; and the identity shop's prices in the nightly collect, a
  seventh of the set each night: about 600 requests a week, about 45 minutes more a night at A0's pace.
- The rest of the exclusives, console by console, at one page a month at one marketplace, started only after
  the chosen set has run a month with no refusal, and only as far as the day's number allows after
  everything before them in B4's order. They get no deep read until wished.
- A game that later comes to PC stays tracked, marked. Tracked games belong to no person and show in no
  portfolio; admins see the list.
- Needs a catalog that knows each game's consoles; its terms are read before it is used.
- Estimates from kinds (how games of a kind aged), and a rerun of the replay after the deep reads and at 3
  and 6 months: only what it supports is added (a label, a tighter estimate, pooled used buckets).

### Step E: later, in this order, as the owner chooses

The price after points on campaign days; a monthly news pass by agents over the wishes (re-release, port,
price cut), recorded as dated facts with sources; each purchase recorded against the level and the low that
followed, the real measure of the goal; digital sale prices as dated facts; listing descriptions and seller
ratings for the copies an alert names; suggestions of games to wish for.

### Order

Before any of it, the last 12 months of the listed games' sales are saved as raw files, since each day
waited loses a day. Then A0; A1 to A6; B, where the owner's 15 games are added as wishes through the
pasted list and its preview (each checked against the shop's page when its candidates come up); C; D,
where the 10 comparison games are added as tracked games; E.

### Limits

- News. A re-release cut the old copy by 25 to 85 % in the 4 cases found; a game no longer sold new rises
  (in 3 of 14 outside cases, about double). Neither shows in prices beforehand. Tora shows the second as it
  happens (C2's facts) and records announcements within days to a month. It never says a bottom is in.
- The exact bottom is known only afterwards. The aim is the settled level, not the lowest sale.
- A young game is still falling from its launch price: its level, once it has one, is only the lowest so
  far. Its wish collects from the first day.
- Thin items (one or two sales a month) have no level: a range with its count, the shop's price, and an
  alert on any checked copy at or under the person's price. "Is this cheap" stays the person's judgment.
- The state of one particular copy, other regions' imports, and a site that refuses the connection.
- Nothing older than the 12 months a marketplace gives back (a paid archive was declined).

## Open issues (to plan later)

Logged at the user's request (2026-10-13): known gaps to come back to with a plan of their own. Not scheduled yet.

- Japanese documentation for the portfolio (user, 2026-10-15): Tora is also part of the user's personal portfolio, so some documentation in Japanese is wanted, without keeping every guide in two languages. To decide: what form (e.g. one Japanese overview of the project and its design, or the README's introduction) and how it stays current. S18 leaves it here until the form is chosen.
- Setup path for other people (user, 2026-10-13): the public repo has the app, the framework, every command (`pnpm collect`, `import-ai`, `import-uploads`, `demo`, `valuate`...) and the public plug-ins (TCGplayer via TCGCSV, eBay API, exchange rates); the scrapers for SNKRDUNK, Mercari, 駿河屋 and Yahoo Auctions are private (`collectors/`). Collecting needs a machine with a residential IP running `pnpm collect` daily. Accounts on an existing deployment need nothing (the owner's machine collects for every account); someone wanting their own deployment follows [the setup guide](docs/setup.md) (a hosted app and database plus a home PC) or [the home server guide](docs/home-server.md), and writes plug-ins for their own sources, which only a developer can do. The repo ships no scrapers for others; the guide to building and connecting a collector, with a template plug-in, is built ([S12](docs/history.md#s12)), and others' collectors are their responsibility. Options not built: a packaged collector app (installer or tray app running the daily collect on a home PC, no repo), API-only sources run by a scheduled job in the cloud (no residential IP needed, e.g. TCGCSV, eBay), a hosted multi-account deployment where people just sign up (the owner collects for all; terms and load to consider), a guided setup in the app.


- Git history rewrite (user, 2026-10-23): moving personal files out does not remove them from the public history (nor the board codes leaked earlier); rewrite it once, close to the finish line (needs a force-push and a fresh clone on the server).

- Left open by the whole-code review (2026-10-31):
  - The client address used by the sign-in lockout and alerts prefers `X-Real-IP`; whether the reverse proxy in front (Tailscale Serve) sets or passes it through decides whether a client can rotate it. To check on the server.
  - The picture step does not know which sites refused earlier in the run; pictures that keep failing are fetched again on every retry run (up to the run's picture cap: [Collecting](docs/rules/collectors.md#what-is-read)).
  - Backup codes made before 2026-10-31 stay unsalted hashes until replaced (new ones are keyed).
  - A store plug-in that reads "item gone" from a 404 on its search cannot tell it from a moved search page; needs the site's own no-results page as a fixture.
  - A sold listing found by two items' searches is stored once, for the first item (decision pending).
  - On a remote database, two tabs loading the same account file at once may get a busy error instead of "not empty" (nothing is loaded twice).

### Need further analysis

The user does not know yet what to do with these (2026-10-17): analyse before any plan.

- Partial items: the user owns only part of an item, but the item's price sources track the whole package. Example: ゼルダの伝説 ムジュラの仮面 (N64), cartridge only (箱・説明書なし), valued as a complete boxed copy, so the value is clearly too high. Editing the item by hand to "cartridge only" is easy; the hard part is recognising a partial item during the import (Mercari / 駿河屋 / SNKRDUNK titles and receipts: ソフトのみ, 箱なし, 箱説なし, 本体のみ, カードのみ...) without AI interpretation, and then matching and valuing it as that partial item (its own product or a "completeness" attribute of the lot, with buckets / search words to match, e.g. 駿河屋 lists 箱説なし copies separately). To decide: product vs lot attribute, which words mark completeness per category, how the import review shows it. For wished items on consoles where loose copies are common, S36 (B1) makes the boxed copy an item of its own; owned partial items stay open here.
- Bundles: one purchase of several items in one listing (see "Mixed bundles" below for the idea so far). Needs a plan: how an import recognises a bundle, splitting into one lot per item, how the cost is divided, and what happens to the items' price sources.

### Optional features

- Automatic purchase import from Gmail (from S6, user 2026-10-16): the daily job on the home PC checks Gmail for new SNKRDUNK receipts (and cancellations) and imports them with the S5b rules. Needs a read-only Gmail token kept on the home PC only; until then, a Google Takeout export and `pnpm purchases` do it.

## Out of scope for v1 (future ideas, do not build)

- Markets screen: JP vs US arbitrage table after fees and shipping
- Photos and receipt attachments
- JAN barcode scan when registering
- Realized gains report per year (tax)
- Markets and currency per person (user, 2026-10-12): built for the whole install as the admin's choice of primary and secondary markets and base currency ([S11](docs/history.md#req-s11), [S16](docs/history.md#s16); the rules: [Sources and markets](docs/rules/sources-markets.md)). A choice per person stays out of scope.
- "Ask Claude to look" for items no source covers (user, 2026-10-12): a button queues the item; the home PC runs a model with web search and page fetches only, and its finds (link, price, date, sold / listing, how sure) come back as suggestions; accepted ones become reference sales or a manual price. Trial (Haiku, 2 items: the TAG Heuer × Mario watch and the WCS2023 Hokusai deck shields): about $0.07 per item, no prices invented, but almost nothing usable (one eBay.de listing, a launch price, a search-snippet Amazon price). Now that auction closings are collected ([S8](docs/history.md#s8)), worth it only for what they still miss.
- Mixed bundles split into their items (user, 2026-10-12, undecided: maybe later, maybe never). A purchase of several different items in one listing (e.g. Mercari "ポケカWCS2023 ヨコハマ限定 デッキシールド、デッキケース" and "ピカチュウ ポケカ 公式 デッキシールド 4個セット" of different designs) is imported as one lot of one item, so it cannot be valued per item. Ideal: one lot per item, cost divided. Hard part: listing titles rarely name each item; the listing's photos and description would have to be read (a model could list the items it sees, the user confirms), and the cost split is a guess (equal, or by each item's market value). A cheap step first: a "split this lot" action in the app where the user names the items and the cost is divided.
