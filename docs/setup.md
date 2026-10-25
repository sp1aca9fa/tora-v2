# Setup

From an empty machine to a running Tora: the web app online, a database, your account, and a home
PC that collects prices every day. About an hour, plus writing plug-ins for your shops.

## What you need

| What                                             | Why                                                                  | Cost         |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------------ |
| A GitHub account                                 | Vercel deploys from your copy of the repo                            | free         |
| A [Vercel](https://vercel.com) account           | Hosts the web app                                                    | free (Hobby) |
| A [Turso](https://turso.tech) account            | Hosts the database (libSQL, SQLite-compatible)                       | free tier    |
| A home PC with Linux or Windows + WSL2           | Runs the collectors (a residential connection), migrations, accounts | -            |
| Node 22+ (24 LTS recommended), pnpm via corepack | Everything is TypeScript                                             | free         |
| An authenticator app (phone)                     | Sign-in asks for a 6-digit code                                      | free         |
| Optional: Claude Code with a Claude plan         | Reading screenshot imports and the data review on the home PC        | your plan    |

The license is [PolyForm Noncommercial](../LICENSE.md): personal and other noncommercial use only.

## 1. Clone and run locally

```bash
git clone https://github.com/<you>/tora-v2.git
cd tora-v2
corepack enable
pnpm install
cp .env.example .env
openssl rand -base64 32       # put it in .env as AUTH_SECRET

pnpm db:migrate               # creates ./data/local.db
pnpm db:seed                  # catalog + demo account with sample data (local database only)
pnpm dev                      # http://localhost:3000
```

The seed prints the demo login (`demo` / `local-dev-password`, authenticator key
`JBSWY3DPEHPK3PXP`, backup codes). Everything reads the single `.env` at the repo root; a relative
`file:` `DATABASE_URL` resolves from the repo root.

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (all four:
`pnpm check:all`), `pnpm build`. Checking the running app (every page, speed, many people at
once): see [Running collectors](running.md#checking-every-page-pnpm-crawl).
After editing `packages/db/src/schema.ts`: `pnpm db:generate`, then `pnpm db:migrate`.

### Environment variables

| Variable                                                           | Where                           | What                                                                                       |
| ------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                              | `.env` and Vercel               | `file:./data/local.db` locally; the Turso URL and token in production                      |
| `AUTH_SECRET`                                                      | `.env` and Vercel               | The **same** random value in both (see below)                                              |
| `ENABLE_EXPERIMENTAL_COREPACK=1`                                   | Vercel                          | Uses the pnpm version pinned in `package.json`                                             |
| `ANTHROPIC_API_KEY`                                                | Vercel, optional                | Uploaded screenshots are read right away by the Claude API ([imports](running.md#imports)) |
| Keys a plug-in needs (e.g. `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`) | `.env` on the home PC only      | Never on Vercel: collectors run only at home                                               |
| `BACKUP_DIR`                                                       | `.env` on the home PC, optional | Where the daily database copies go ([backups](backups.md))                                 |
| `CRON_SECRET`                                                      | Vercel                          | Lets Vercel run the morning check of [alerts](alerts.md)                                   |
| `TORA_STATE_DIR`                                                   | `.env` on the home PC, optional | A second Tora on the same PC: its own log, locks and daily stamps ([running](running.md))  |
| `TORA_LOCAL_HTTP=1`                                                | `.env` on your server, optional | The app opened over plain `http` from the home network (sign-in cookies without `Secure`)  |
| `TORA_DEV_ALERTS=1`                                                | `.env`, optional                | A dev server (`pnpm dev`) also runs the morning check and store feed checks                |
| `ENABLE_CARDMARKET=1`                                              | `.env` on the home PC, optional | Turns on the public Cardmarket plug-in ([sources](sources.md))                             |

`AUTH_SECRET` signs sessions and encrypts the authenticator secrets that `pnpm user` writes (and
the alert channels), which is why the home PC and Vercel must share it. Changing it signs everyone out and needs
`pnpm user reset-2fa` for every account.

## 2. Database (Turso)

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create tora --location aws-ap-northeast-1     # pick a region near you and Vercel's
turso db show tora --url                               # libsql://...
turso db tokens create tora                            # auth token
```

Put the URL and token in the home PC's `.env` and migrate:

```bash
DATABASE_URL=libsql://tora-<org>.turso.io
DATABASE_AUTH_TOKEN=<token>
```

```bash
pnpm db:migrate
```

Migrations always run from the home PC, never from Vercel builds. After pulling a change that adds
a migration (`packages/db/drizzle/*.sql`), push it, then run `pnpm db:migrate` right away: the
collect refuses to run against a database that is behind, and new pages may fail until it is
migrated. For UI work against a throwaway database, point `DATABASE_URL` back at a `file:` path.

## 3. Web app (Vercel)

This guide hosts the app on Vercel and the database on Turso: both free, nothing to keep running.
The app also runs on any always-on machine of your own with Node: `pnpm app` (builds, then
serves on port 3000 to the network), with `DATABASE_URL=file:/path/to/tora.db` in `.env` (no Turso, no
read quota) and the collect and backups on the same machine. There the app runs the morning check
of [alerts](alerts.md) itself (no `CRON_SECRET`), and reaching it from your phone is up to you (a
tunnel such as Tailscale Funnel or Cloudflare Tunnel, or your own domain).

1. Push the repo to GitHub and import it in Vercel.
2. **Root Directory**: `apps/web`. Framework: Next.js (detected).
3. Environment variables (Production): `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUTH_SECRET`,
   `ENABLE_EXPERIMENTAL_COREPACK=1`, optionally `ANTHROPIC_API_KEY`.
4. Deploy. Functions run in the region set in `apps/web/vercel.json` (`hnd1`, Tokyo): set it next
   to your Turso database.
5. On the phone: open the URL, sign in, then "Add to Home Screen".

A private `collectors/` submodule is not fetched by Vercel, which is intended: the app never loads
plug-ins, it reads what they saved in the database.

## 4. Accounts

There is no sign-up page. The first account is made from the home PC (with `.env` pointing at
Turso); after that an admin manages accounts in **Settings > Admin > Accounts**: a new account or
a reset gives a one-time setup link (24 hours) to send to the person, who chooses their own
password and adds Tora to their authenticator app on their own device. A new password asks for
their authenticator code, a new authenticator for their password (a full reset asks for neither:
for a person who lost both). Creating, resetting and disabling ask for the admin's own
authenticator code; signing devices out only for a confirmation. Every task is in Settings >
Activity. The terminal commands still work:

```bash
pnpm user create <username>        # password, scan the QR code, confirm one code, keep the 8 backup codes
pnpm user list
pnpm user devices <username>
pnpm user revoke <username> <device-id|all>
pnpm user reset-password <username>
pnpm user reset-2fa <username>     # lost phone: new authenticator + backup codes
pnpm user disable|enable <username>
```

The first account is an admin; admins see **Settings > Admin preferences** (settings for the whole
app). Each account sees only its own collection; the catalog and market data are shared.

- Sign-in: username, password, then a 6-digit code (or a one-time backup code).
- At most 2 devices per account; a third is refused until one is revoked (Settings, or
  `pnpm user revoke`). Signing out frees the slot. On iPhone, Safari and the home-screen app count
  as two devices.
- Sessions last while used. Revoking the device, changing the password or resetting 2FA ends them.
- Lockout: 5 failures per IP per 15 min, 10 per username per hour, 50 overall per hour.
- Without `AUTH_SECRET` only the sign-in page is served.

A demo account shows the app without anyone's collection: `pnpm user create demo`, then
`pnpm demo demo` fills it with sample lots (run it again to reset; only accounts named `demo*` are
touched), then `pnpm collect` gives the items real prices.

## 5. First settings (in this order)

These are choices made once, at setup, for the whole app (Settings > Admin preferences):

1. **Base currency** (Markets > Currencies): every amount is stored in it. Pick it before adding
   anything: while nothing is stored, any currency can be chosen. Later it can only change to a
   currency with exchange rates, and every stored amount is converted. See [Markets and
   currency](markets.md).
2. **Time zone**: what a day is (daily value snapshots, charts, the collect's once a day); every
   time is stored and shown in it. Usually yours; the page offers the device's. Changing it later
   rewrites every stored time.
3. **Languages**: the primary language (shown first, and on the sign-in page) and an optional
   secondary one for the toggle. See [Languages](languages.md).
4. **Categories**: TCG and games are ready-made; add your own (watches, figures, ...) with their
   kinds, fields and condition list. See [Categories](categories.md).
5. **Plug-ins**: put yours in `collectors/` (see [Building a collector](collectors.md)) and run
   `pnpm collect` once: the plug-ins register their sources, markets and rate sources, which the
   next settings list.
6. **Markets**: the primary market (makes the value) and the secondary market (one price to compare
   with), and each other currency's rate source. See [Markets and currency](markets.md).
7. **Price sources** and **Identity**: each source's role per item type and each market's identity
   page per item type. See [Sources and roles](sources.md).
8. **The daily collect**: install the scheduled task. See [Running collectors](running.md). It
   also backs up the database every day; set `BACKUP_DIR` to keep the copies off the PC too. See
   [Backups](backups.md).

Then add your items in the app (Add, or Imports), confirm the listings the collectors find for
them under **Actions**, and the next collects fill in their history and values.

## 6. Claude access (optional)

`packages/mcp` is a local [MCP](https://modelcontextprotocol.io) server that lets Claude read one
user's data, read-only, on the home PC (never deployed). Sources whose terms forbid AI use
(`noAi`) are left out.

```bash
claude mcp add tora -- pnpm --silent --dir /path/to/tora-v2 mcp --user <username>
```

For Claude Desktop, put the same command in `claude_desktop_config.json` (`"command": "pnpm"`,
`"args": ["--silent", "--dir", "/path/to/tora-v2", "mcp", "--user", "<username>"]`; with the repo
in WSL, `"command": "wsl"` and `pnpm ...` in `args`). Tools: `portfolio_summary`, `list_products`,
`product_detail`, `price_history`, `sales`, `watchlist`, `opportunities`, `collector_status`, `review_queue`,
`data_checks` (start here for "does anything look off?") and `query_sql` (one read-only SELECT).

## Set catalogs

Set lists come from plug-ins (`catalogs` in a plug-in package), like prices. The public package
ships TCG sets with release dates (`collectors-public/catalog/data/*.json`: Pokemon in Japanese and
English, One Piece, Yu-Gi-Oh! OCG, Magic); sealed products are created from a set the first time
someone registers one. Only set names, codes, types and dates are taken from the official lists,
TCGdex, Yugipedia and Scryfall.

Only what your categories use is loaded: the sets of the regions a set category lists (the TCG
category's print languages, Settings > Categories), plus sets that are the same everywhere. A
setup without a set category loads none. The collect loads them again whenever the lists or your
categories change.

```bash
pnpm catalog:fetch [pokemon|one_piece|yugioh|mtg]   # refresh the JSON, review, commit
pnpm catalog:sync                                   # load now instead of at the next collect
```
