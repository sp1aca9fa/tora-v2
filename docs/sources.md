# Sources and roles

A **source** is a site prices come from. Its plug-in describes it (market, currency, what its
prices are, suggested roles, whether it has one page per item); the admin decides how the app uses
it. Settings apply to every account.

## Roles

In **Settings > Admin preferences > Price sources**, each source of a market has a role per item
type:

| Role           | Meaning                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reference**  | The trusted source for that item type. Valued first; in a compared market, its price is the one compared (else the next with a price: [the rule](rules/sources-markets.md#markets-and-the-compared-price)). |
| **Supporting** | Used when the reference has too few sales (see [Values](rules/values.md)).                                                                                                                                  |
| **Comparison** | Shown on the item page's Price sources, never counted.                                                                                                                                                      |
| **Off**        | Not used for that item type.                                                                                                                                                                                |

Sources sharing a role are tried in the order shown (arrows in Settings; on the item page the reference's tab is green). A role change rebuilds the values and their history right after.

**How a value is made.** The median of recent sales in the lot's bucket (its condition), else in similar conditions, from the first source with enough of them, the reference before supporting sources; else the newest asking price in the same condition (a shop's, or a marketplace's when its plug-in stores asks as prices); else the retail price. Only
the primary market's sources count. Sales far from the rest (outliers) are left out of the median; the item page still lists them, unmarked. The steps, their windows and numbers, and what counts as an outlier are in
[Values and confidence](rules/values.md), their one home.

## Tora does not judge a site

Tora cannot tell whether a site is good: it follows what each plug-in declares. A per-item link
pattern (`links`) makes a source an identity choice; its price kinds (`priceKinds`) decide the
asking-price warnings; its roles are suggestions. The only automatic check is the **quality gate**
below. So the plug-in author is responsible for declaring the truth, and the admin for the roles.

## The quality gate: trust is earned

After each collect, each **supporting** source's sales are compared with its market's reference's
on the same items and conditions:

- when enough can be compared and its prices stray too far, it disagrees: it is valued as
  comparison only until a later check agrees or can no longer be made (too few pairs: [the rule](rules/sources-markets.md#the-quality-gate)), admins get a notice, and Settings shows how far above or
  below the reference it runs;
- with fewer items in common it is **unverified** and keeps its role.

What is compared, how many are needed and how far is too far:
[the quality gate's rules](rules/sources-markets.md#the-quality-gate).

Example: a flea market's card sales strayed from the reference card shop's by a gap over 15 %, so it became comparison only for cards, while for sealed product it agreed and kept supporting.

## A good price reference

The reference decides what everything is worth, so it needs:

- **Real sales, not asks.** Sold prices with their dates. An asking price says what a seller hopes
  for; sources whose prices are asks (`priceKinds: ['listing']`) are marked in Settings as giving asking or store prices ([the rule](rules/sources-markets.md#what-a-plug-ins-declarations-do))
  and are best kept as supporting or comparison.
- **The condition of each sale**, so each lot is valued from prices in its own bucket (a graded card is not a raw one; a box without shrink wrap is valued from boxes with it only when its own sales are too few).
- **Enough volume**: several sales a month for the items you hold, or values fall back to wider
  windows and weaker sources.
- **Stable access**: the same pages or API every day, without blocks or captchas.
- **Terms that allow it**: see below.

A daily **market price** computed by the site from its own sales (like Cardmarket's trend) can be a
reference too: its plug-in declares `priceKinds: ['market']` and saves it as one sale a day, so
values are the median of those days. TCGCSV saves TCGplayer's market price as an asking price with no condition: it is only compared across markets and never makes a value, even as a primary market's reference.

**Supporting** fits a source with real sales but less reliable matching (a flea-market search that
may include bundles or fakes, filtered by rules). **Comparison** fits asks, buy-back prices, and a new source while you look at its prices. The quality gate checks only a supporting source with sales of its own, so a source of asks or store prices only is never checked and keeps its role: keep it as comparison unless you trust its prices.

## Identity pages

Each market has an **identity page** per item type (**Settings > Admin preferences > Identity**):
the source whose product page says exactly what an item is, used to find the same item on other
sites. It need not be the price reference. Items the person owns without one show under **Actions**, more quietly in the secondary market (items other than cards and sealed only when their lots cost more in total than an amount the admin sets on the same page, in the base currency; its default is in [the rules](rules/sources-markets.md#identity-links)).

A good identity page:

- **one stable page per item**, not a search;
- shows the item's **name, set, number** (or edition, platform, model) and a **picture**;
- has a **durable URL with an ID** the plug-in can read (`links` pattern, first group = the ID);
- is **findable by search**, so the collector can propose it as a candidate.

Sources with a `links` pattern are offered; those declaring `identity` for the item type are the ones looked for when none is chosen. Search-only sources (flea markets, auctions, a price API without item pages) declare none
and are never offered.

## What goes wrong when a plug-in declares something wrong

| Declared wrongly                                 | What happens                                                                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A search page given as an item link (`links`)    | Every item "linked" to the same changing results; the identity link means nothing                                                                                                                                                   |
| Asks saved as sales (rows of type `sold`)        | Values follow what sellers hope for, usually too high; `priceKinds` sets the Settings mark, so a source marked as asks still counts its `sold` rows                                                                                 |
| No bucket on prices (`bucket: null`)             | Never counted in a value; compared across markets for cards and sealed products in any condition, elsewhere only when the lot is in its list's best condition ([the rule](rules/sources-markets.md#markets-and-the-compared-price)) |
| The wrong market or currency                     | Prices counted in the wrong market's value, or converted with the wrong rate                                                                                                                                                        |
| `identity` for a type it has no item pages for   | Items asked for an identity link nobody can give                                                                                                                                                                                    |
| A noisy source suggested as reference            | Values jump; set it to supporting so the quality gate can catch it (only if it has sales of its own: [the gate](#the-quality-gate-trust-is-earned))                                                                                 |
| `noAi` missing on a source whose terms forbid AI | Its data reaches the data review and Claude (your responsibility under its terms)                                                                                                                                                   |

## Terms and responsibility

Which sites you collect from, whether their terms allow it, and how good their data is are up to
you; the author takes no responsibility for other setups, sources or imports. Read each site's
terms first. When a site's terms forbid giving its data to AI models, declare `noAi: true`: it is
left out of the data review, the MCP tools and anything else that feeds a model. When they allow
keeping listing details only for a while, declare `detailsDays`.

## The author's setup, as an example

The suggestions of the author's plug-ins make the **Japan collectibles** setup (primary Japan,
secondary US):

| Source             | Market | Cards      | Sealed TCG | Games & other | Identity page | What it gives                                               |
| ------------------ | ------ | ---------- | ---------- | ------------- | ------------- | ----------------------------------------------------------- |
| SNKRDUNK           | Japan  | reference  | reference  | -             | cards, sealed | verified trades, raw grades and slabs apart                 |
| Mercari            | Japan  | supporting | supporting | supporting    | -             | sold listings (searched; bundles, parts and fakes filtered) |
| 駿河屋             | Japan  | -          | supporting | reference     | sealed, games | store and buy-back prices (no sales)                        |
| TCGplayer (TCGCSV) | US     | reference  | reference  | -             | cards, sealed | US market prices (one a day)                                |
| eBay               | US     | supporting | supporting | -             | -             | US asking prices (official API; `noAi`)                     |

Three Japanese TCG shops were added later (private plug-ins): their asking prices, what is in stock
and their buy-back prices, plus identity pages for shops with one page per card.

Only TCGCSV, eBay, Cardmarket and Yahoo! Shopping are public (`collectors-public/`); the others are private plug-ins.

- **TCGCSV**: TCGplayer's catalog and daily market prices as public files, for Japanese and English
  Pokemon cards and sealed product. TCGplayer prices ungraded cards only.
- **eBay**: eBay's official Browse API, active listings only (eBay closed its sold data to new
  developers). Each collect stores, per condition, the median asking price, the lowest, how many
  are listed and the listing IDs (kept 14 days; no titles or links). Its terms forbid giving its
  data to AI models, so it is `noAi`. Needs a production keyset from developer.ebay.com in the server's `.env` (`EBAY_CLIENT_ID` = App ID, `EBAY_CLIENT_SECRET` = Cert ID); without it the collector
  is skipped.
- **Cardmarket (TCGdex)**: Cardmarket's daily price guide in euros through [TCGdex](https://tcgdex.dev)
  (open, keyless, MIT licensed), for single cards of the international prints (no sealed product).
  Its market is `eu` (Europe). Off unless `ENABLE_CARDMARKET=1` is in the server's `.env`, since
  it would otherwise search every English card each night. Its identity link is TCGdex's card
  link (`https://api.tcgdex.net/v2/en/cards/swsh7-215`).
- **Yahoo! Shopping (official API)**: see the section below.

## Yahoo! Shopping (official API)

What it adds: for game items of the Japan market, the cheapest new and used copies in stock across
the shops of Yahoo! JAPAN Shopping, found by the game's JAN (the product code the identity shop's
page shows). New and used copies are two rows; used copies have no condition grade, so they are
shown apart from graded copies. When no new copy is in stock, the game is marked as no
longer sold new. A game whose identity page showed no JAN is not searched (never by name). Each
game costs two requests a night, at most one a second. The API is free.

Getting a Client ID:

1. Sign in with a Yahoo! JAPAN ID (make one if needed).
2. Register an application at https://e.developer.yahoo.co.jp/register. The application type is
   your choice there (the API reference does not name one). Choose the shopping API for the
   application when registering it.
3. Copy its **Client ID** from the application's page on the developer dashboard.

If the collectors page shows the error "the Yahoo! JAPAN application lacks the shopping API", the
shopping API must be added on the application's page at the developer site.

In the server's `.env` (in the Tora folder), add this line, replacing `<<YOUR_CLIENT_ID>>` with the
Client ID from step 3:

```sh
YAHOO_SHOPPING_CLIENT_ID=<<YOUR_CLIENT_ID>>
```

The next nightly collect picks it up and the source appears under Settings > Collectors. To turn it
off, remove the line: the source stays listed in Settings with its links, nothing more is read, and
its last prices stop showing as for sale after 3 days. The Client ID is a secret: Tora sends it only
to the API and keeps it out of the database and the logs. Read the API's terms before turning it on: they do not say clearly
whether search results may be stored, and Tora stores the prices it reads. Its data may be given
to AI models (not `noAi`); wherever its prices are shown, the credit "Web Services by Yahoo! JAPAN"
links to https://developer.yahoo.co.jp/sitemap/.
