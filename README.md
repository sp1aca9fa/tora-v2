# Tora

A personal tracker for collectibles (TCG singles and sealed product, game collector's editions,
amiibo, controllers, ...): what I own, what I paid, and what it is worth now, based on Japanese
second-hand market data accumulated in its own database. A few accounts (family); each sees only
their own collection, while the product catalog and market data are shared.

- **Web app** (`apps/web`): Next.js, hosted on Vercel, behind username + password + authenticator
  code, limited to 2 devices per account.
- **Database**: Turso (hosted libSQL / SQLite) via Drizzle ORM. Local dev uses a SQLite file.
- **Collectors**: run only on a home PC in WSL2 (residential IP) and write straight to Turso.
  The public repo ships the app and the collector framework, **not** scrapers for any site.

### Bring your own sources

Prices and purchase imports come from **source plug-ins** that you choose and write for the shops
and marketplaces you use, starting from a runnable template. The framework enforces a polite pace
and refuses to run on Vercel or CI, but whether a site may be collected from is up to you: check
its terms of use first. Categories, markets, the base currency and the app's languages are set by
an admin, so Tora works for any collectibles in any country.

```
apps/web                 Next.js app (UI, server actions, auth)
packages/core            Domain logic: categories, sources and markets, valuation, buckets
packages/auth            Password hashing, TOTP, backup codes, secret encryption
packages/db              Drizzle schema, migrations, queries, user CLI, seed
packages/catalog         TCG set catalog: fetch script + JSON data (Pokemon, One Piece, Yu-Gi-Oh!, Magic)
packages/collector-sdk   Plug-in contract, polite HTTP, `pnpm collect` and the imports
packages/mcp             Read-only MCP server (Claude reads your data on the home PC)
collectors-public/       Publishable plug-ins (TCGCSV and eBay prices, ECB exchange rates) and the template
collectors/              Optional private plug-ins (git submodule; not in this repo)
docs/                    The guides
```

## Quick start (local)

Requires Node 22+ (24 LTS recommended) and pnpm via corepack.

```bash
corepack enable
pnpm install
cp .env.example .env
openssl rand -base64 32       # put it in .env as AUTH_SECRET
pnpm db:migrate               # creates ./data/local.db
pnpm db:seed                  # catalog + demo account with sample data (local DB only)
pnpm dev                      # http://localhost:3000
```

The seed prints the demo login: `demo` / `local-dev-password`, authenticator key
`JBSWY3DPEHPK3PXP` (demo use only).

## Documentation

| Guide                                      | What it covers                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| [Setup](docs/setup.md)                     | Accounts and tools, the database, deploying, the first user, first settings   |
| [Markets and currency](docs/markets.md)    | Primary and secondary markets, the base currency, exchange rates              |
| [Categories](docs/categories.md)           | Kinds of items, fields, condition lists, item types and price buckets         |
| [Sources and roles](docs/sources.md)       | Reference, supporting, comparison; identity pages; the quality gate           |
| [Building a collector](docs/collectors.md) | The plug-in contract, the template, testing, rate plug-ins, importers         |
| [Running collectors](docs/running.md)      | `pnpm collect`, the daily schedule, many collectors, imports, the data review |
| [Languages](docs/languages.md)             | The app's two languages and adding one                                        |

In the app, Settings > Admin preferences > Commands lists the home-PC commands.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, hobby, research, educational and
other noncommercial use, including changing and sharing it under the same terms; commercial use
is not permitted. This makes the project source-available rather than open source. Third-party
dependencies keep their own licenses.
