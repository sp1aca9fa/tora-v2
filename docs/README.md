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
| [Backups](backups.md)                 | The daily copy of the database, keeping copies off the PC, restoring                 |
| [A home server](home-server.md)       | Running everything on one small machine at home: services, updates, off-box copies   |
| [Alerts](alerts.md)                   | Telegram and Discord messages, the morning check, the activity log                   |
| [Buy timing](buy-timing.md)           | The Watchlist's verdicts, the numbers saved daily, the buy strategies                |
| [Opportunities](opportunities.md)     | Items worth a look within their group, the signals and their tests on past prices    |
| [Store notices](store-feeds.md)       | Posts about cards on sale in stores near you: store lists, feeds, the notices        |

Rules the code computes from, each stated once (`rules/`):

| Rules                                                     | What it holds                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Values and confidence](rules/values.md)                  | How a value is made, its confidence, the totals and profit, the box view, the chart                    |
| [Buy timing](rules/buy-timing.md)                         | The numbers saved daily, the buy zones, the verdict, the new-release wait, the tests                   |
| [Opportunities](rules/opportunities.md)                   | Signals and their tests, the order of the lists, deal ways, popular, the buy plan, spread, box opening |
| [Sources, markets and currency](rules/sources-markets.md) | The valuation order, the quality gate, identity links, the compared price, rates                       |
| [Alerts and the self check](rules/alerts.md)              | Each message, who gets it, when it repeats; the Settings flags; the self check of sales                |
| [Collecting](rules/collectors.md)                         | What a collect reads, the pace and caps, refusals, the schedule, the daytime reads                     |
| [The data model](rules/data-model.md)                     | The rules every table follows, what is one person's or shared, collected prices, lots, the tables      |
| [Accounts and access](rules/accounts.md)                  | Signing in, devices and sessions, lockout, roles, setup links, the account download, secrets           |

Records and development:

| File                               | What it holds                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| [Requirements](../requirements.md) | The goal, the example scenarios, the stack, and one line per build phase              |
| [Decision log](decisions.md)       | Dated decisions with their reasons, in date order; a record, not where rules live     |
| [Build history](history.md)        | Each phase's chapter as asked and built, and the older texts the rules files replaced |
| [Agents](agents.md)                | How Claude Code agents build and review changes here (profile for the shared agents)  |
| [CI](ci.md)                        | What the checks on every push run                                                     |
| [Spec template](spec-template.md)  | The form of a task's spec                                                             |
| [UX review](ux-review.md)          | What the review of a changed page looks for                                           |

Settings > Admin preferences > Commands lists the home-PC commands with what each does.

## How Tora fits together

```
phone / browser ──> web app (Vercel, or your server) ──> database (Turso, or a file there)
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
