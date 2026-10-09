# Collectibles Tracker: Requirements (v1)

## How to use this file (Claude Code: read first)

- This file is split into **Core** (sections 1-7) and **Sessions** (S1-S7).
- Every session: read **Core** fully, then read **only the current session** (first one not marked done in the Status table).
- Do **not** read or start the next session until the current one meets its acceptance criteria and the user confirms.
- At the end of a session: update the Status table, note any decisions or deviations under "Decision log", commit.
- If something in Core turns out wrong or ambiguous, ask the user, then fix Core rather than working around it.

### Status

| Session | Topic | Status |
|---|---|---|
| S1 | Foundation: monorepo, schema, i18n, access | built; awaiting user check on phone via Vercel |
| S2 | Registration UI (products, lots, pulls, events) | todo |
| S3 | Collector framework + SNKRDUNK + catalog search | todo |
| S4 | Mercari sold collector | todo |
| S5 | Valuation engine, Portfolio, Item detail, charts | todo |
| S6 | Export / import (JSON, CSV) + backups | todo |
| S7 | US data (TCGCSV, eBay), 駿河屋, FX, JP vs US spread | todo |

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

---

# CORE

## 1. Goal

A personal, single-user app to track collectibles (Pokemon and other TCG singles and sealed products, game collector's editions, amiibo, special controllers, other game-related items):
- what I own, quantity, condition, when/where/how much I paid
- what it is worth now, per condition, from accumulated Japanese second-hand market data (and US data for comparison)
- for sealed TCG products: which cards I pulled, and box-level profit/loss
- price trends from data accumulated in our own DB

Priority right now: **start registering items and accumulating price data as early as possible.**

Personal use only. Data is never published or served to anyone else (the hosted app sits behind a login).

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
- **Auth** (app is on the public internet): single-user password login. Only a hash of the password is stored (env var). Session = signed, httpOnly, Secure, SameSite=Lax cookie, long-lived for the phone PWA. Failed attempts are counted in the DB with temporary lockout. Rotating the session secret logs out all devices. Every page and API route requires a session except the login page and static assets.
- Phone use is first-class: registration flows must be mobile-first. Add a PWA manifest so it can be added to the home screen.
- Scheduling: cron in WSL calling `pnpm collect` (daily, with random jitter). Document a fallback using Windows Task Scheduler -> `wsl` if WSL is not always running.

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

### products (catalog entry, one per distinct item)
- `type`: card_single | sealed_tcg | game_ce | game | amiibo | controller | figure | other
- `name_ja`, `name_en` (at least one required), `franchise` (e.g. Pokemon, One Piece, Fire Emblem), `set_name`, `set_code`, `card_number`, `rarity`, `language` (JP/EN/other), `release_date`, `retail_price_jpy`, `image_url`, `notes`

### product_sources (how to fetch prices for a product)
- `product_id`, `source` (snkrdunk | mercari | surugaya | tcgcsv | ebay | ...), `external_id` (nullable), `query` (JSON: keywords, exclude_keywords, category_id, price_min, price_max, extra), `active`, `last_success_at`
- A product can have several sources. Sources are created automatically when a product is created from a source search (S3), or edited manually.

### holdings (a lot of identical units I own)
- `product_id`, `quantity` (>= 1), `cost_total_jpy` (total paid for the lot, incl. what I choose to include like shipping)
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
- `product_id`, `bucket`, `price_jpy`, `set_at`, `note`. Always wins over computed values.

### valuation_snapshots (daily, for portfolio-over-time chart)
- `date`, `holding_id`, `value_jpy`, `method`, `source`, `sample_size`, `confidence`

### fx_rates
- `date`, `pair` (USDJPY), `rate`

### collector_runs (health)
- `source`, `started_at`, `finished_at`, `status` (ok | partial | failed | blocked), `requests`, `observations_added`, `error`

### login_attempts (auth lockout)
- `ip_hash`, `attempted_at`, `success`. Old rows may be pruned (not domain data; excluded from export).

## 6. Valuation rules

**Buckets** (the condition dimension prices are compared on):
- Raw cards: `raw:S`, `raw:A`, `raw:B`, `raw:C`, `raw:D`
- Graded cards: `graded:<GRADER>:<grade>` e.g. `graded:PSA:10`
- Sealed TCG: by packaging_state, e.g. `sealed:shrink`, `sealed:no_shrink`, `sealed:box_opened_contents_sealed`
- Other items: `cond:new` (new_unused), `cond:like_new`, `cond:good` (no_noticeable_damage), `cond:fair` (minor_damage, damaged, poor)
- Each collector maps its source's condition labels to these buckets (mapping table in the collector, unit-tested).

**Value of a holding** = value of one unit in its bucket x quantity:
1. Manual price for that product+bucket, if set.
2. Else median of `sold` observations in the bucket over the last 30 days; widen to 90, then 180 days if fewer than 3 samples. Drop outliers with IQR before the median.
3. Fallback chain by source: SNKRDUNK -> Mercari -> 駿河屋 (used/new store price) -> retail price -> none.
4. Every value carries: source, sample size, age of newest sample, confidence (high: >= 5 samples within 30 days; medium: >= 3 within 180; low: otherwise).
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

## S3: Collector framework + SNKRDUNK + catalog search

Build:
- `collector-sdk`: Collector interface (`search(query)`, `fetchObservations(productSource)`, condition-to-bucket mapping), runner CLI `pnpm collect [--source x] [--product id]`, rate limiter, retry, `collector_runs` logging.
- **SNKRDUNK collector** (private submodule): inspect the site's network calls in a browser to find the JSON endpoints used by product pages. Implement product search, product mapping, and sales history (trades with condition labels, graded and sealed). Backfill all available history on first mapping.
- Add flow step 1: **search sources** (SNKRDUNK now, others later) and create the product + product_source from a result. Manual creation stays available.
- Settings: collector status, last runs, flagged health issues.
- Cron setup documented and working.

Acceptance:
- Create the 30th anniversary box and 3 pulled cards from SNKRDUNK search; history is backfilled into `price_observations` with correct buckets.
- **Data gate (with the user)**: for 5 real owned items, compare our computed medians against what the user sees on the site. Agree it is trustworthy before continuing.

## S4: Mercari sold collector

Build:
- Mercari JP collector (private submodule) using the same search API as jp.mercari.com (no login). Port the request token (DPoP-style ES256 JWT) generation from the open-source `mercari` PyPI package as a reference; verify current behavior by inspecting the site's network requests.
- Search with `status=sold_out` using each product's saved query (keywords, exclude keywords, category, price band). Map `item_condition_id` to buckets. Use the item's last-updated time as the sale-time proxy.
- Product source editor in UI: edit query, preview the latest matched results, exclude mismatches (sets `excluded` + reason). This is where matching quality is tuned.

Acceptance:
- Scenario items 1-3 (CE, amiibo, controllers) get Mercari sold observations with sensible buckets.
- Data gate repeated for 3 non-card items.

## S5: Valuation, Portfolio, Item detail

Build:
- `packages/core` valuation per section 6, with unit tests (IQR, window widening, fallback chain, manual override, confidence).
- Daily `valuation_snapshots` job (runs after collectors).
- **Portfolio screen**: spent / current value / unrealized P/L, value-over-time chart, breakdown by type, holdings list with value, confidence and freshness indicators, filters.
- **Item detail screen**: header with my holdings of this product; price chart per bucket with source toggles and bucket chips; recent observations table; buylist floor; manual price override.
- **Box tab** on sealed TCG holdings: paid | value as received | pulls value | net, plus the pull list.

Acceptance:
- Scenario 5 and 7 visible and correct; values show source, sample size, age and confidence.

## S6: Export / import

Build:
- **JSON export** (canonical, lossless): `schema_version`, exported_at, all products, product_sources, holdings, holding_events, manual_prices, price_observations (option to exclude raw payloads), fx_rates.
- **CSV export**: one file per table with stable IDs, zipped. Must be enough to rebuild the collection in Excel/pandas.
- **JSON import** into an empty DB.
- Round-trip test: seed -> export -> import into empty DB -> identical computed totals and row counts.
- Scheduled local backup of the Turso DB to the home PC (dated SQL dump or JSON export, keep last 30).

Acceptance:
- Scenario 8; round-trip test passes in CI-like `pnpm test`.

## S7: US data, 駿河屋, FX, JP vs US spread

Build:
- FX collector (public): daily USDJPY from a free source (e.g. Frankfurter) into `fx_rates`.
- TCGCSV collector (public): daily TCGplayer prices incl. the Pokemon Japan category; map tcgplayer product IDs via source search.
- eBay sold collector (private): sold/completed search results for the product's query; lower default confidence. Playwright only if plain fetch fails.
- 駿河屋 collector (private): new/used store prices and 買取 (buylist) prices for mapped products.
- Item detail: JP vs US comparison (JPY converted, with fx date), spread %.

Acceptance:
- At least one card and one non-card item show JP vs US side by side.

---

## Out of scope for v1 (future ideas, do not build)

- Markets screen: JP vs US arbitrage table after fees and shipping
- Yahoo auctions / Yahoo flea market collectors
- Photos and receipt attachments
- JAN barcode scan when registering
- Realized gains report per year (tax)
- Price alerts
- Multi-user
