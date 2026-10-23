# Building a collector

A **plug-in** is the code that knows one site: how to search it for an item, how to read its
prices, and how the app should use it. Tora ships the framework (`packages/collector-sdk`), a few
public-API plug-ins (`collectors-public/src`) and a **template** to copy
(`collectors-public/template`). You (or your coding assistant) write plug-ins for the sites you use.

Read [Sources and roles](sources.md) first: it says what makes a good price reference and identity
page, and what goes wrong when a plug-in declares something wrong.

## Where plug-ins live

`pnpm collect` loads two packages by path, each from `src/index.ts`:

| Folder               | For                                                             |
| -------------------- | --------------------------------------------------------------- |
| `collectors-public/` | Plug-ins safe to publish (public APIs, rate sources)            |
| `collectors/`        | Your own, usually a **private** git repo mounted as a submodule |

A missing package is skipped, so the app, build and tests work without `collectors/`. Vercel never
loads plug-ins: they save their descriptions to the database on each run and the app reads them
there.

Set up your private package:

```bash
# This repo's own `collectors/` entry points at its author's private repo: replace it with yours.
git rm collectors
# a new private repo (e.g. on GitHub), then in the Tora checkout:
git submodule add git@github.com:<you>/<your-collectors>.git collectors
mkdir -p collectors/src collectors/test/fixtures
```

Without a private repo, a plain `collectors/` folder works too (after `git rm collectors`); it is
then part of your copy of the repo.

`collectors/package.json`:

```json
{
  "name": "@tora/collectors-private",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`collectors/tsconfig.json`:

```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

It is not a workspace member (so the public lockfile never depends on it); it imports `@tora/*`
through the repo root's `node_modules`. `pnpm typecheck` and `pnpm test` include it when present.
Commit plug-in changes inside `collectors/` first and push them, then commit the updated submodule
pointer in the main repo. Clone with `git clone --recurse-submodules`, or run
`git submodule update --init` in an existing checkout.

## Start from the template

```bash
cp collectors-public/template/src/example-market.ts collectors/src/my-shop.ts
cp -r collectors-public/template/fixtures collectors/test/fixtures/my-shop
cp collectors-public/template/test/example-market.test.ts collectors/test/my-shop.test.ts
cp collectors-public/template/src/index.ts collectors/src/index.ts   # first plug-in only
```

Then rename `example` / `Example Market` everywhere, fix the import paths, and replace the URLs and
the parsing with your site's. `pnpm test` runs the test against the saved answers;
`pnpm collect --source my-shop --product <id>` tries it on one real item.

The template is a made-up card marketplace with one page per card and a JSON API. It shows:

- `supports`: cards only;
- `findCandidates`: a search, each result scored 0-1;
- `collect`: the sales history, newest first, read a few pages per run and resumed on the next
  run (`state`, `complete`), each sale in its condition's bucket;
- the `SourceInfo`: market, currency, price kinds, a suggested role, identity, a link pattern.

## The package's entry point

`src/index.ts` exports (`CollectorModule` in `packages/collector-sdk/src/types.ts`):

```ts
export const collectors: Collector[] = [myShop]; // price sources
export const importers: PurchaseImporter[] = []; // optional: purchases from order emails or links
export const rates: RateSource[] = []; // optional: exchange rates (see markets.md)
export const sources: SourceInfo[] = [/* one per collector, and per shop purchases come from */];
export const setCards: SetCardSource[] = []; // optional: a set's hit cards for the box opening value
export const pullRates: PullRateSource[] = []; // optional: suggested pull rates per set
export const rankings: RankingSource[] = []; // optional: a site's popularity ranking (S13)
```

## Describing a source (`SourceInfo`)

Defined in `packages/core/src/sources.ts`. One per collector (same `key` as its `source`), plus one
per shop purchases come from that is not a price source (`shopOnly`).

| Field                     | What it says                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `key`                     | Stored with every price; **never change it** once data exists                                                                                                                  |
| `label`, `badge`, `color` | How it is shown (badge: one or two characters; chart colour)                                                                                                                   |
| `market`                  | ISO 3166 country of its prices (`jp`, `us`, `fr`)                                                                                                                              |
| `currency`                | ISO 4217 currency of its prices (`JPY`, `USD`, `EUR`)                                                                                                                          |
| `priceKinds`              | `sold` (real sales), `market` (a daily market price the site works out from its sales, saved as one `sold` row a day), `listing` (asking prices), `buylist` (what a shop pays) |
| `categories`              | Category keys it collects; none: the built-in TCG and games ([Categories](categories.md))                                                                                      |
| `roles`                   | Suggested role per item type: `{ card: 'reference', sealed: 'supporting' }`; unlisted: off                                                                                     |
| `priority`                | Default order among sources of the same role (lower first)                                                                                                                     |
| `identity`                | Item types it has **one stable page per item** for (an identity page candidate)                                                                                                |
| `links`                   | `[{ pattern, url }]`: a regular expression for its item links (without protocol and `www.`; group 1 = the ID, optional group 2 = `{rest}`) and the canonical link with `{id}`  |
| `aliases`                 | Names purchases from it show in receipts, screenshots, notes (case-blind)                                                                                                      |
| `singleItemOrders`        | Each order is one item (an order ID is one lot)                                                                                                                                |
| `orderIds`                | `{ pattern, hint }`: the shape of its order IDs and where a purchase page shows them                                                                                           |
| `shopOnly`                | A shop purchases come from, not a price source                                                                                                                                 |
| `noAi`                    | Its terms forbid giving its data to AI models: left out of the data review and MCP tools                                                                                       |
| `detailsDays`             | Listing details (`raw.ids`, `raw.listings`) dropped after this many days; the day's price stays                                                                                |

The roles are suggestions: the admin sets them in Settings. Suggest **comparison** for a new
source until its numbers have been checked.

## The `Collector` interface

```ts
interface Collector {
  source: string; // = SourceInfo.key
  label: string;
  http?: { minDelayMs?; maxDelayMs?; maxRequests? }; // this site's pace (only slower)
  supports(product): boolean; // which items it handles
  findCandidates(product, ctx): Promise<FoundCandidate[]>;
  defaultQuery?(product): SourceQuery | null; // search-based sources only
  queryVersion?: number;
  historyPhase?: boolean; // older history in a second pass (see "Long histories")
  collect(link, product, ctx, heldBuckets?): Promise<CollectResult>;
  productDetails?(title, product): ProductDetails | null;
}
```

### How a run goes

For each collector, `pnpm collect`:

1. **Matches**: for owned (or opened) items it `supports` that have no listing on it yet, calls
   `findCandidates` (up to 50 items per run). Candidates appear under **Actions** and the item
   page's Price sources; the user confirms one or pastes a link (read with `links`).
2. **Collects**: for every confirmed listing, calls `collect`, which saves prices through
   `ctx.save` and returns where it stopped.
3. Records the run (status, requests, prices added, working time) for Settings > Collectors.

### `supports(product)`

Return true for the items the site can price. Read `product.category`, `product.kind`,
`productClass(product)` (the item type, from `@tora/core`), standard fields (`franchise`,
`region`, `setCode`, `cardNumber`, `platform`, ...) and custom fields in `product.fields`.

### `findCandidates(product, ctx)`

Search the site and return listings that may be this item, best first:

```ts
{ externalId: 'c-1001', title: 'ピカチュウ 025/100', url, imageUrl, price /* own currency */, score: 0.9 }
```

- `externalId`: the site's stable ID for the listing (what `links` reads from a pasted link).
- `score` 0-1: how sure it is the same item. Use what identifies it (set code, card number,
  edition, platform), not just words in the name; `termCoverage` from `@tora/collector-sdk` helps.
  Leave out results below about 0.3. The user confirms every candidate.
- `ctx.setOf(product)` gives the catalog set (code, release date); `ctx.linkedListings(id)` gives
  the item's titles on other sources (e.g. an English title to search a US site with).

### `collect(link, product, ctx, heldBuckets)`

Fetch the listing's prices and save them with `ctx.save(rows)`. Each row (`PriceInput`):

| Field             | Value                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `productId`       | `product.id`                                                                                                                                   |
| `source`          | The collector's `source`                                                                                                                       |
| `observationType` | `sold`, `listing` (ask), `buylist`, or `retail`                                                                                                |
| `bucket`          | The condition it is for (`raw:A`, `graded:PSA:10`, `sealed:shrink`, `cond:new`, `{list}:{value}`); `null` only for a plain "as sold new" price |
| `price`           | Per unit, in the currency's **smallest unit** (yen; cents for dollars); never converted                                                        |
| `priceOriginal`   | Usually the same as `price` (the amount as the site showed it)                                                                                 |
| `currency`        | ISO 4217 code of `price`                                                                                                                       |
| `observedAt`      | When it sold (or was seen): an ISO time with any offset (a site's own is fine); stored in the app's time zone                                  |
| `fetchedAt`       | `toLocalIso(ctx.now)` from `@tora/core` (or any ISO time)                                                                                      |
| `externalRef`     | **Unique per source** for this price (a sale ID, or `id                                                                                        | condition | day`): saving it again is a no-op |
| `title`, `url`    | The listing's title and link                                                                                                                   |
| `raw`             | Anything useful to keep (JSON); no personal data                                                                                               |

Return a `CollectResult`:

- `state`: what to remember on the link for the next run (a cursor: the newest sale saved, the
  page to resume from). It comes back as `link.state`.
- `complete`: false when a page budget cut the run short (the next run continues).
- `title`, `url`, `imageUrl`: the listing as it is now (the item gets its first listing's picture).
- `recentSales`: the newest trades as the page shows them, when it shows times like "3 hours ago"
  (`approximate: true`); shown as "last sale".
- `supply` (optional): what is for sale now, one entry per condition with something listed:
  `{ bucket, lowestAsk, currency, listings, url }`. `lowestAsk` is per unit in the site's own
  currency (divide a lot's price by its size); `listings` is null when the site does not say how
  many. Saved once a day and shown on item pages and the Watchlist as asking prices, never sales.
  Leave it out when the site cannot tell.

Long histories: read a few pages per run (the template uses 5) and resume. For histories that
give only a day and no sale ID, `sweepHistory` in `@tora/collector-sdk` saves complete days only
and resumes where it stopped. A collector whose history fill-in is long (a new listing with years of
sales) sets `historyPhase: true`: each run then calls `collect` once per listing with
`ctx.phase === 'fresh'` (new sales, what is for sale, last sale; return `complete: false` when
older history is left), items someone holds or watches first, and then again with
`ctx.phase === 'history'` (older history only) for the listings left behind, with the requests
that remain. A backfill then never keeps other listings from their daily prices, and running out
of requests in the history pass is normal. `heldBuckets` lists the conditions users own, for sites that show
few trades per condition.

### Search-based sources

A site with no page per item (a flea market, an auction search) defines `defaultQuery(product)`
returning a `SourceQuery` (`keywords`, `excludeKeywords`, `categoryId`, `priceMin`, `priceMax`,
`extra`). Every supported item then gets an active search at once, with no candidates to confirm;
the user can tune it in the app. Raise `queryVersion` when you change `defaultQuery`: searches it
made earlier are regenerated, ones the user edited are kept. A search source filters what it finds
(bundles, parts, other editions) and declares no `identity` or `links`.

### `productDetails(title, product)`

Optional: details read from a confirmed listing's title (set code, card number, rarity, picture),
applied once per link. Return null when the title says nothing reliable.

## Polite fetching

Always fetch through `ctx.http` (`PoliteHttp`), never `fetch` directly:

- 2-5 s between requests (a plug-in can only slow it down, with `http: { minDelayMs }`), a request
  cap per run (500 by default, `http: { maxRequests }`); what is left waits for the next run;
- retries with backoff on server errors;
- stops the source for the run on 403, 429 or a captcha page (`BlockedError`): never work around a
  block;
- `ctx.http.json`, `text`, `postJson`, `bytes`.

Collectors run one after another, each with its own client: different sites never slow each
other, and one site never gets two requests at once. The CLI refuses to run on Vercel or CI.

## Testing with fixtures

Save the site's answers once (a search page, a sales page) as files next to the test, and give the
plug-in a fake `http` that returns them: tests never reach the network and keep working when the
site is down. The template's test shows it. Make fixtures from public pages only, with nothing
personal in them; for a public repo, prefer made-up data in the site's shape.

Test at least: `supports`, the best candidate first, conditions read as buckets (and unreadable
ones left out), a first run, a second run that only adds new sales, and a run resumed after the
page budget.

## Purchase importers

A `PurchaseImporter` reads purchases from a shop into lots: from order emails
(`matchesHeader`, `parse` returning a `ReceiptMail`, or a list for an order of several items), and/or
from links the user pastes in the app (`matchesLink`, `readLink`, for shops that send no receipt).
Each item of a several-item order gets its own key (`<order>#2`); items left out on purpose are
`{ kind: 'skip', title, reason }`. `productFor` makes a new item from a receipt (an existing item
of the same name, spaces, 「」 and ボックス/BOX aside, is reused) and `holdingFor` reads the lot's
condition. Amounts are in the shop's currency's smallest unit. See [Running collectors](running.md#imports) for how imports run.

## Set card sources

A `SetCardSource` lists a TCG set's cards of one rarity with their lowest asks
(`cards({ code, name, rarity }, ctx)`, e.g. searches for "ポケモンカード151 SAR" and "SV2a SAR"), for the box opening value: what a
booster box's hit cards bring on average against its price. Its `sold(externalId, ctx)` gives a
card's recent selling price (the median of its recent single raw sales), read only for the ten
cards carrying most of a set's value. The nightly collect reads each set once a week, and again
after an admin changes its code or rarities in Settings > Admin > Box opening. Prices are in the
card's currency's smallest unit; graded copies and error prints are left out.

## Pull rate sources

A `PullRateSource` suggests pull rates: per set, how many cards of each rarity a box holds on
average (`SuggestedRates` in `packages/core/src/pull-rates.ts`: franchise, region, a text the
catalog set's name holds, the set code as card listings title it, packs a box, and per rarity
`perBox`, optionally only cards whose name holds a `match`), and where the numbers come from
(`source`). Rates are rarely official: name the site or simulator they come from. They are saved
each time the plug-ins are loaded (a collect, an import or `pnpm plugins`); the admin corrects
them per set in Settings > Admin > Box opening, and a set's own rates always win. The public
package ships community rates for Japanese Pokemon sets (`collectors-public/src/pull-rates.ts`).

```ts
export const pullRates: PullRateSource[] = [
  {
    key: 'my-rates',
    label: 'My pull rates',
    rates: () => [
      {
        franchise: 'pokemon',
        region: 'jp',
        name: 'ポケモンカード151',
        code: 'SV2a',
        packsPerBox: 20,
        tiers: [
          { rarity: 'SAR', perBox: 0.25 },
          { rarity: 'SR', perBox: 0.75 },
        ],
        source: 'example.com simulator (2026-10)',
      },
    ],
  },
];
```

## Ranking sources

A `RankingSource` reads a site's popularity ranking once a day, with the nightly collect (before
the collectors, so what it adds is collected the same night): its items in rank order, each with
its id on the plug-in's `source` (the id that source's collector links items by), its kind, its
page, and any price and activity numbers the site shows (`numbers`, e.g. listings, favorites).
Tora saves each day's ranks and matches every item: by its id on the source, else an item of the
same kind from the same catalog set or with the same name. The top 30 that match nothing become
candidates: Tora creates them (no creator), links them to the source and collects them like
watched items while they were in the top 30 within the last 30 days. They show on the
Opportunities page ([Opportunities](opportunities.md)) with their rank and the site's numbers;
how a rank change does as a signal is tested once enough days are saved.

```ts
export const rankings: RankingSource[] = [
  {
    key: 'myshop-popular-boxes',
    label: 'My shop popular boxes',
    source: 'myshop', // its collector links items by these ids
    item: { category: 'tcg', franchise: 'pokemon', region: 'jp' },
    async rank(ctx) {
      const html = await ctx.http.text('https://myshop.example/ranking?kind=box');
      return parseRanking(html).map((p) => ({
        externalId: p.id,
        title: p.title,
        kind: 'booster_box',
        url: p.url,
        price: p.price,
        numbers: { listings: p.listings },
      }));
    },
  },
];
```

Read only what the ranking page shows, one or a few requests a day, and keep the reader's tests
on a saved page (`test/fixtures`).

## Checklist before turning a source on

- [ ] The site's terms allow it; `noAi` / `detailsDays` set when they say so.
- [ ] `market`, `currency` and `priceKinds` are true.
- [ ] Every price has the right bucket; unreadable conditions are left out.
- [ ] `externalRef` is stable, so re-runs add nothing twice.
- [ ] `links` matches item pages only (never a search page); `identity` only for types with one page per item.
- [ ] Suggested role: comparison, until Settings shows its numbers agree.
- [ ] Tests pass on saved answers; one real `pnpm collect --source <key> --product <id>` looks right.
