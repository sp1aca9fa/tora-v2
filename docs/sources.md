# Sources and roles

A **source** is a site prices come from. Its plug-in describes it (market, currency, what its
prices are, suggested roles, whether it has one page per item); the admin decides how the app uses
it. Settings apply to every account.

## Roles

In **Settings > Admin preferences > Price sources**, each source of a market has a role per item
type:

| Role           | Meaning                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **Reference**  | The trusted source for that item type. Valued first; in the secondary market, its price is the one compared. |
| **Supporting** | Used when the reference has too few sales (fewer than 3 in the windows the value tries).                     |
| **Comparison** | Shown on the item page's Price sources, never counted.                                                       |
| **Off**        | Not used for that item type.                                                                                 |

Sources sharing a role are tried in the order shown (arrows in Settings; the reference marked
green). A role change rebuilds the values and their history right after.

**How a value is made.** The median of the reference's sales in the lot's bucket over 30 days,
widened to 90 / 180 / 365 when there are fewer than 3; else a supporting source's; else a shop's
asking price in the same condition (at most 30 days old); else the retail price. Only the primary
market's sources count. Sales far from the rest (outliers) are left out and listed on the item
page.

## Tora does not judge a site

Tora cannot tell whether a site is good: it follows what each plug-in declares. A per-item link
pattern (`links`) makes a source an identity choice; its price kinds (`priceKinds`) decide the
asking-price warnings; its roles are suggestions. The only automatic check is the **quality gate**
below. So the plug-in author is responsible for declaring the truth, and the admin for the roles.

## The quality gate: trust is earned

After each collect, each **supporting** source's sales are compared with its market's reference's
on the same items and conditions (the last 90 days, 3+ sales on each side):

- on **10 or more** items in common, a median gap **over 15%** means it disagrees: it is valued as
  comparison only until it agrees again, admins get a notice, and Settings shows the gap;
- with fewer items in common it is **unverified** and keeps its role.

Example: a flea market's card sales ran about 15% below the reference card shop's, so it became
comparison only for cards, while for sealed product it agreed and kept supporting.

## A good price reference

The reference decides what everything is worth, so it needs:

- **Real sales, not asks.** Sold prices with their dates. An asking price says what a seller hopes
  for; sources whose prices are asks (`priceKinds: ['listing']`) are labelled as asks in the app
  and are best kept as supporting or comparison.
- **The condition of each sale**, so each lot is valued from prices in its own bucket (a graded
  card is not a raw one; a box without shrink wrap is not one with it).
- **Enough volume**: several sales a month for the items you hold, or values fall back to wider
  windows and weaker sources.
- **Stable access**: the same pages or API every day, without blocks or captchas.
- **Terms that allow it**: see below.

A daily **market price** computed by the site from its own sales (like Cardmarket's trend) can be a
reference too: its plug-in declares `priceKinds: ['market']` and saves it as one sale a day, so
values are the median of those days. TCGCSV still saves TCGplayer's market price as an asking
price: right for comparing markets, weak as a primary market's only source.

**Supporting** fits a source with real sales but less reliable matching (a flea-market search that
may include bundles or fakes, filtered by rules). **Comparison** fits asks, buy-back prices, and any
new source until its numbers look right: start every new source as comparison.

## Identity pages

Each market has an **identity page** per item type (**Settings > Admin preferences > Identity**):
the source whose product page says exactly what an item is, used to find the same item on other
sites. It need not be the price reference. Items without one show under **Actions** (items
other than cards and sealed only above an amount the admin sets on the same page, ¥3,000 by
default, in the base currency).

A good identity page:

- **one stable page per item**, not a search;
- shows the item's **name, set, number** (or edition, platform, model) and a **picture**;
- has a **durable URL with an ID** the plug-in can read (`links` pattern, first group = the ID);
- is **findable by search**, so the collector can propose it as a candidate.

Only sources whose plug-in declares `identity` for the item type, and a `links` pattern, are
offered. Search-only sources (flea markets, auctions, a price API without item pages) declare none
and are never offered.

## What goes wrong when a plug-in declares something wrong

| Declared wrongly                                 | What happens                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| A search page given as an item link (`links`)    | Every item "linked" to the same changing results; the identity link means nothing       |
| Asks declared as sales (`priceKinds: ['sold']`)  | Values follow what sellers hope for, usually too high, without the asking-price warning |
| No bucket on prices (`bucket: null`)             | Never counted in a value; only compared across markets as the plain "as sold new" price |
| The wrong market or currency                     | Prices counted in the wrong market's value, or converted with the wrong rate            |
| `identity` for a type it has no item pages for   | Items asked for an identity link nobody can give                                        |
| A noisy source suggested as reference            | Values jump; set it to supporting so the quality gate can catch it                      |
| `noAi` missing on a source whose terms forbid AI | Its data reaches the data review and Claude (your responsibility under its terms)       |

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

Only TCGCSV, eBay and Cardmarket are public (`collectors-public/`); the others are private plug-ins.

- **TCGCSV**: TCGplayer's catalog and daily market prices as public files, for Japanese and English
  Pokemon cards and sealed product. TCGplayer prices ungraded cards only.
- **eBay**: eBay's official Browse API, active listings only (eBay closed its sold data to new
  developers). Each collect stores, per condition, the median asking price, the lowest, how many
  are listed and the listing IDs (kept 14 days; no titles or links). Its terms forbid giving its
  data to AI models, so it is `noAi`. Needs a production keyset from developer.ebay.com in the home
  PC's `.env` (`EBAY_CLIENT_ID` = App ID, `EBAY_CLIENT_SECRET` = Cert ID); without it the collector
  is skipped.
- **Cardmarket (TCGdex)**: Cardmarket's daily price guide in euros through [TCGdex](https://tcgdex.dev)
  (open, keyless, MIT licensed), for single cards of the international prints (no sealed product).
  Its market is `eu` (Europe). Off unless `ENABLE_CARDMARKET=1` is in the home PC's `.env`, since
  it would otherwise search every English card each night. Its identity link is TCGdex's card
  link (`https://api.tcgdex.net/v2/en/cards/swsh7-215`).
