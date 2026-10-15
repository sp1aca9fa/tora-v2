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
# a new private repo (e.g. on GitHub), then in the Tora checkout:
git submodule add git@github.com:<you>/<your-collectors>.git collectors
mkdir -p collectors/src collectors/test/fixtures
```

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
```

## Describing a source (`SourceInfo`)

Defined in `packages/core/src/sources.ts`. One per collector (same `key` as its `source`), plus one
per shop purchases come from that is not a price source (`shopOnly`).

| Field                     | What it says                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                     | Stored with every price; **never change it** once data exists                                                                                                                 |
| `label`, `badge`, `color` | How it is shown (badge: one or two characters; chart colour)                                                                                                                  |
| `market`                  | ISO 3166 country of its prices (`jp`, `us`, `fr`)                                                                                                                             |
| `currency`                | ISO 4217 currency of its prices (`JPY`, `USD`, `EUR`)                                                                                                                         |
| `priceKinds`              | `sold` (real sales), `listing` (asking prices), `buylist` (what a shop pays)                                                                                                  |
| `categories`              | Category keys it collects; none: the built-in TCG and games ([Categories](categories.md))                                                                                     |
| `roles`                   | Suggested role per item type: `{ card: 'reference', sealed: 'supporting' }`; unlisted: off                                                                                    |
| `priority`                | Default order among sources of the same role (lower first)                                                                                                                    |
| `identity`                | Item types it has **one stable page per item** for (an identity page candidate)                                                                                               |
| `links`                   | `[{ pattern, url }]`: a regular expression for its item links (without protocol and `www.`; group 1 = the ID, optional group 2 = `{rest}`) and the canonical link with `{id}` |
| `aliases`                 | Names purchases from it show in receipts, screenshots, notes (case-blind)                                                                                                     |
| `singleItemOrders`        | Each order is one item (an order ID is one lot)                                                                                                                               |
| `orderIds`                | `{ pattern, hint }`: the shape of its order IDs and where a purchase page shows them                                                                                          |
| `shopOnly`                | A shop purchases come from, not a price source                                                                                                                                |
| `noAi`                    | Its terms forbid giving its data to AI models: left out of the data review and MCP tools                                                                                      |
| `detailsDays`             | Listing details (`raw.ids`, `raw.listings`) dropped after this many days; the day's price stays                                                                               |

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
| `observedAt`      | When it sold (or was seen), `toTokyoIso(date)` from `@tora/core`                                                                               |
| `fetchedAt`       | `toTokyoIso(ctx.now)`                                                                                                                          |
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

Long histories: read a few pages per run (the template uses 5) and resume. For histories that
give only a day and no sale ID, `sweepHistory` in `@tora/collector-sdk` saves complete days only
and resumes where it stopped. `heldBuckets` lists the conditions users own, for sites that show
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
(`matchesHeader`, `parse` returning `ReceiptMail`), and/or from links the user pastes in the app
(`matchesLink`, `readLink`, for shops that send no receipt). `productFor` makes a new item from a
receipt and `holdingFor` reads the lot's condition. Amounts are in the shop's currency's smallest
unit. See [Running collectors](running.md#imports) for how imports run.

## Checklist before turning a source on

- [ ] The site's terms allow it; `noAi` / `detailsDays` set when they say so.
- [ ] `market`, `currency` and `priceKinds` are true.
- [ ] Every price has the right bucket; unreadable conditions are left out.
- [ ] `externalRef` is stable, so re-runs add nothing twice.
- [ ] `links` matches item pages only (never a search page); `identity` only for types with one page per item.
- [ ] Suggested role: comparison, until Settings shows its numbers agree.
- [ ] Tests pass on saved answers; one real `pnpm collect --source <key> --product <id>` looks right.
