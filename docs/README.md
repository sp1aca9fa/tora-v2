# Tora documentation

Guides for running your own Tora: written for a person or their coding assistant. Read them in
this order the first time.

| Guide                                 | What it covers                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| [Setup](setup.md)                     | Accounts and tools, cloning, the database, deploying, the first user, first settings |
| [Markets and currency](markets.md)    | Primary and secondary markets, the base currency, exchange rates                     |
| [Categories](categories.md)           | Kinds of items, their fields and condition lists, item types and price buckets       |
| [Sources and roles](sources.md)       | Reference, supporting, comparison; identity pages; the quality gate                  |
| [Building a collector](collectors.md) | The plug-in contract, the template plug-in, testing, rate plug-ins, importers        |
| [Running collectors](running.md)      | `pnpm collect`, the daily schedule, many collectors, logs, imports, the data review  |
| [Languages](languages.md)             | The app's two languages and adding a new one                                         |

Settings > Admin preferences > Commands lists the home-PC commands with what each does.

## How Tora fits together

```
phone / browser ──> web app (Vercel) ──> database (Turso)
                                              ^
home PC (WSL or Linux): pnpm collect ─────────┘   plug-ins fetch prices from the sites you choose
```

- The **web app** shows your items, what you paid and what they are worth. It never fetches from
  shops.
- The **collectors** run only on your home PC (a residential connection, at a polite pace) and
  write prices straight to the database. The CLI refuses to run on Vercel or CI.
- **Plug-ins** are the code that knows a site. The public repo ships the framework and a few
  public-API plug-ins, not scrapers: you write (or ask your coding assistant to write) plug-ins
  for the shops you use. Whether a site may be collected from is your responsibility.

## Words used in the guides

- **Item** (product): a thing that exists once in the catalog, e.g. one card, one game edition.
- **Lot** (holding): units of an item you own, with their cost and condition.
- **Item type**: a category's kinds that share a condition list (`card`, `sealed`, `game`, or an
  admin's, like `watch/watch_condition`). Roles are set per item type.
- **Bucket**: the condition a price is for (`raw:A`, `graded:PSA:10`, `sealed:shrink`,
  `cond:new`, `watch_condition:unworn`). A lot is valued from prices in its own bucket.
- **Source**: a site prices come from, described by its plug-in.
- **Listing**: a source's page for one item (or a saved search, for search-based sources).
- **Market**: a country's set of sources, with its currency. The primary market makes the value.
- **Base currency**: the currency every amount is stored and shown in.
