# Tora documentation

Guides for running your own Tora: written for a person or their coding assistant. Read them in
this order the first time.

| Guide                                 | What it covers                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Setup](setup.md)                     | Accounts and tools, cloning, the database, deploying, the first user, first settings                                                                                                                                    |
| [Markets and currency](markets.md)    | Primary and secondary markets, the base currency, exchange rates, rate plug-ins                                                                                                                                         |
| [Categories](categories.md)           | Kinds of items, their fields and condition lists, item types and price buckets                                                                                                                                          |
| [Sources and roles](sources.md)       | Reference, supporting, comparison; identity pages; the quality gate                                                                                                                                                     |
| [Building a collector](collectors.md) | Where plug-ins live, the template, the plug-in contract (daytime jobs too), polite fetching, testing, importers, set lists, pull rates, rankings, signals, the checklist before turning a source on                     |
| [Running collectors](running.md)      | `pnpm collect`, the daily schedule, logs, Settings > Collectors, many collectors, imports, the data review, the hosted database's reads and Claude Code's access to it, the server's status, checking every page, speed |
| [Languages](languages.md)             | The app's two languages and adding a new one                                                                                                                                                                            |
| [Backups](backups.md)                 | The daily copy of the database, keeping copies off the PC, restoring                                                                                                                                                    |
| [A home server](home-server.md)       | Running everything on one small machine at home: services, updates, off-box copies                                                                                                                                      |
| [Alerts](alerts.md)                   | Telegram and Discord messages, the morning check, the activity log                                                                                                                                                      |
| [Buy timing](buy-timing.md)           | Where the verdicts show: the Wishlist, item pages, the Strategy page, alerts, MCP                                                                                                                                       |
| [Opportunities](opportunities.md)     | Where it shows: Worth a look, Popular, Signals, the Buy plan, MCP                                                                                                                                                       |
| [Store notices](store-feeds.md)       | Posts about cards on sale in stores near you: store lists, feeds, the notices                                                                                                                                           |

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

| File                               | What it holds                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Requirements](../requirements.md) | Core (the goal, the example scenarios, the stack, the repo layout), the Status table (one line per phase) and the chapter of the phase in progress: the first read when building |
| [Decision log](decisions.md)       | Dated decisions with their reasons, in date order; a record, not where rules live                                                                                                |
| [Build history](history.md)        | Each phase's chapter as asked and built, and the older texts the rules files replaced                                                                                            |
| [Agents](agents.md)                | How Claude Code agents build and review changes here (profile for the shared agents)                                                                                             |
| [CI](ci.md)                        | What the checks on every push run                                                                                                                                                |
| [Spec template](spec-template.md)  | The form of a task's spec                                                                                                                                                        |
| [UX review](ux-review.md)          | What the review of a changed page looks for                                                                                                                                      |

Settings > Admin preferences > Commands lists the home-PC commands with what each does.

## How Tora fits together

```
phone / browser ──> web app (Vercel, or your server) ──> database (Turso, or a file there)
                                              ^
home PC (WSL or Linux): pnpm collect ─────────┘   plug-ins fetch prices from the sites you choose
```

- The **web app** shows your items, what you paid and what they are worth. It never fetches from
  shops.
- The **collectors** run only on your home PC (a residential connection, at a polite pace); `pnpm collect` runs the plug-ins and saves the prices they return straight to the database (a plug-in never writes to it). The CLI refuses to run on Vercel or CI.
- **Plug-ins** are the code that knows a site. The public repo ships the framework and a few
  public-API plug-ins, not scrapers: you write (or ask your coding assistant to write) plug-ins
  for the shops you use. Whether a site may be collected from is your responsibility.

## Words used in the guides

- **Item** (product): a thing that exists once in the catalog, e.g. one card, one game edition ([the data model](rules/data-model.md#the-tables)).
- **Lot** (holding): units of an item you own, with their cost and condition ([the rules](rules/data-model.md#lots)).
- **Item type**: a category's kinds that share a condition list: the built-in `card`, `sealed`, `item`, `game`, or an admin's, like `watch/watch_condition` ([Categories](categories.md#item-types)). Roles are set per item type.
- **Role**: how a source's prices are used for one item type: reference, supporting, comparison or off ([the rules](rules/sources-markets.md#roles-and-the-valuation-order)).
- **Bucket**: the condition a price is for (`raw:A`, `graded:PSA:10`, `sealed:shrink`,
  `cond:new`, `watch_condition:unworn`; [the keys](categories.md#condition-lists-and-buckets)). A lot is valued from prices in its own bucket.
- **Source**: a site prices come from, described by its plug-in ([Sources and roles](sources.md)).
- **Listing**: a source's page for one item (or a saved search, for search-based sources; [Collecting](rules/collectors.md#what-is-read)).
- **Market**: the country or region a source's prices come from (`jp`, `us`, `eu`, ...), declared by its plug-in, whatever its currency ([Markets](markets.md#markets)). Only the primary market's sources make the value.
- **Base currency**: the currency amounts are stored and shown in ([the rules](rules/sources-markets.md#currency-and-rates)).
