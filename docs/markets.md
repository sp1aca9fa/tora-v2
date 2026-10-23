# Markets and currency

## Markets

Every source belongs to a **market**: the country its prices come from (`jp`, `us`, `fr`, ... as
ISO 3166 codes), declared by its plug-in. A market appears in Settings once a plug-in for it has
registered (after its first `pnpm collect`). It is shown by its name in the app's texts
(`sources.market.<code>` in `apps/web/messages/*.json`), else by its code (`FR`).

In **Settings > Admin preferences > Markets**, the admin picks:

- the **primary market**: only its sources make an item's value;
- the **secondary market** (optional): one price per item to compare with, shown on the item page
  next to the value (e.g. "Japan vs US"), never counted in it;
- with three or more markets, **what item pages compare**: the primary against the secondary
  (default) or every market.

Each compared market shows its reference source's price for the item (else a supporting
source's), converted to the base currency. Markets are told apart by their sources' market, not
their currency: two markets may share one (France and Germany both in euros).

**Graded cards need a source that prices them.** A lot is valued only from prices in its own
condition. If the primary market's sources price ungraded cards only (Cardmarket's price guide,
TCGplayer), graded cards there get no value until a source with graded sales is added or a manual
price is set; another market's graded sales are compared, never counted.

**Which condition is compared.** TCG: ungraded cards in their own grade, graded cards at ungraded
A (other markets often price ungraded near-mint only), sealed product with shrink wrap unless the
lot has none. Other categories: the lot's own condition (the one most units are in); another
market's price counts when it prices that condition, or when it is a plain "as sold new" price and
the lot is in its list's best value.

Each market has its own roles and identity pages (see [Sources and roles](sources.md)). Changing
the primary market rebuilds the values and their history right after (a minute or two).

**Choosing them.** The primary market is where you buy and would sell: where the prices that say
what your items are worth come from, usually your country. The secondary market is the one you
want to check against (is it cheaper abroad? is a card's price driven by one country?). Each needs
at least one source with real sales or market prices to be useful.

## Currency

Every amount (costs, prices, values) is stored in one **base currency**, set by the admin in
**Settings > Admin preferences > Markets > Currencies**.

- **Pick it first**, before adding anything: while nothing is stored, any currency can be chosen.
  Usually your primary market's currency.
- **One currency only** (every source prices in the base): nothing else to set up.
- **Two or more currencies** (usually the secondary market's): each other currency needs an
  exchange rate to the base, from a **rate plug-in** or **typed by hand**. Prices in a currency
  without a rate are not saved until it has one (Settings flags it).
- **Changing the base later** is rare (e.g. after years, a new primary market). It is offered only
  for a currency with rates; after a confirmation naming how many amounts it touches, every stored
  amount is converted with the rate of its own date and values are rebuilt. Do it while no collect
  is running.

Plug-ins never convert: each reports amounts in its own currency, in the currency's smallest unit
(yen; cents for dollars). The collect converts each amount to the base with the rate of its day and
keeps the rate used.

A typed rate is used from today until changed; earlier days keep their rates. A rate plug-in's
rates arrive with the next collect.

## Rate plug-ins

A plug-in package may export `rates`, a list of `RateSource` (`packages/collector-sdk/src/types.ts`).
`collectors-public/src/fx.ts` is the one to copy: the European Central Bank's reference rates
through [Frankfurter](https://frankfurter.dev), free and keyless, covering about 30 currencies.

```ts
export const frankfurter: RateSource = {
  key: 'frankfurter', // chosen in Settings per currency; never change it
  label: 'European Central Bank (Frankfurter)',
  currencies: ['EUR', 'JPY', 'USD' /* ... */], // every currency it has rates between
  async rates(http, { from, to }, start, end) {
    // Units of `to` per unit of `from`, one entry per day it has (inclusive range).
    return [{ date: '2026-10-14', rate: 151.2 } /* ... */];
  },
};
```

Rules for a rate plug-in:

- **Daily rates**; working days are enough (the app uses the last rate on or before a date).
- **The direction**: `rate` is units of `to` per unit of `from`. The app asks for the pair it needs.
- **History**: the first run asks for about a year back (item pages compare the last year); later
  runs ask from the last stored day.
- **A free source whose terms allow it**, fetched through `http` (the polite client).
- **Declare the currencies** it covers: Settings offers it only for currencies it lists together
  with the base.
- Days without a rate are left out, not filled in.

Then, in Settings > Markets > Currencies, pick the plug-in for the currency; the next collect
fetches its history.
