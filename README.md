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
and marketplaces you use. A plug-in implements the `Collector` interface (find listings for a
product, fetch its sold prices) and/or the `PurchaseImporter` interface (read order emails into
purchases), see `packages/collector-sdk/src/types.ts`. Plug-in packages are loaded by path from
`collectors-public/` (publishable ones) and `collectors/` (an optional private package, e.g. a git
submodule), so the app, build and tests work without any of them. The framework enforces a polite
pace (2-5 s between requests, a request cap per run, stop on 403/429/captcha) and refuses to run on
Vercel/CI, but whether a site may be collected from is up to you: check its terms of use first.

```
apps/web                 Next.js app (UI, server actions, auth)
packages/core            Domain logic: taxonomy, lot splits, valuation buckets
packages/auth            Password hashing, TOTP, backup codes, secret encryption
packages/db              Drizzle schema, migrations, queries, user CLI, seed
packages/catalog         TCG set catalog: fetch script + JSON data (Pokemon, One Piece, Yu-Gi-Oh!, Magic)
packages/collector-sdk   Collector interface, registry, `pnpm collect`
collectors-public/       Publishable plug-ins (public APIs, e.g. TCGCSV and FX rates, planned)
collectors/              Optional private plug-ins (git submodule; not in this repo)
```

## Local setup (WSL2)

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
`JBSWY3DPEHPK3PXP` (add it to an authenticator app, demo use only) and backup codes.

Other commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm typecheck`,
`pnpm db:generate` (after editing `packages/db/src/schema.ts`), `pnpm collect`.

All tools read the single `.env` at the repo root. A relative `file:` `DATABASE_URL` resolves
from the repo root.

## Deploying

### 1. Turso (database)

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
turso db create tora --location aws-ap-northeast-1     # Tokyo
turso db show tora --url                               # libsql://...
turso db tokens create tora                            # auth token
```

Migrations run from your PC, not from Vercel builds. Point `.env` at Turso and migrate:

```bash
DATABASE_URL=libsql://tora-<org>.turso.io
DATABASE_AUTH_TOKEN=<token>
```

```bash
pnpm db:migrate
```

Your home PC's `.env` keeps these values so `pnpm collect` writes to Turso. For local UI work
against a throwaway DB, switch `DATABASE_URL` back to `file:./data/local.db`.

### 2. Vercel (web app)

1. Push this repo to GitHub and import it in Vercel.
2. **Root Directory**: `apps/web`. Framework: Next.js (auto-detected).
3. Environment variables (Production):
   - `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (from Turso)
   - `AUTH_SECRET` (the same value as in your local `.env`, see below)
   - `ENABLE_EXPERIMENTAL_COREPACK=1` (so Vercel uses the pnpm version pinned in `package.json`)
4. Deploy. Functions run in Tokyo (`hnd1`, see `apps/web/vercel.json`) next to the Turso DB.
5. On the phone: open the URL, sign in, then "Add to Home Screen".

### 3. Accounts

There is no sign-up page. Accounts are managed from the home PC (with `.env` pointing at Turso):

```bash
pnpm user create <username>        # password, then scan the QR code with an authenticator app,
                                   # confirm one code, write down the 8 backup codes
pnpm user list
pnpm user devices <username>
pnpm user revoke <username> <device-id|all>
pnpm user reset-password <username>
pnpm user reset-2fa <username>     # lost phone: new authenticator + backup codes
pnpm user disable|enable <username>
```

The first account is an admin. If the database has data from before accounts existed, the first
account you create takes it over.

### Auth notes

- Login: username + password, then a 6-digit authenticator code (or a one-time backup code).
- **Max 2 devices per account.** Each login registers the device; a third is refused until one is
  revoked (Settings on another device, or `pnpm user revoke`). Signing out frees the slot.
  On iPhone, Safari and the home-screen app count as two devices: sign in from the home-screen app.
- Sessions do not expire while used (the cookie is renewed automatically). Revoking the device,
  changing the password or resetting 2FA ends them.
- Password: scrypt hash. Authenticator secret: AES-GCM encrypted with a key derived from
  `AUTH_SECRET`, which is why the local `.env` and Vercel must share the same `AUTH_SECRET`.
- Lockout: 5 failures per IP per 15 min, 10 per username per hour, 50 overall per hour. IPs and
  usernames in the log are keyed hashes.
- The app fails closed: without `AUTH_SECRET`, only the login page is served.

## TCG catalog

`packages/catalog/data/*.json` holds Japanese sets with release dates (Magic sets apply to every
region). Sealed products (box, pack, deck) are created from a set the first time someone registers
one. Sources: the official Pokemon card product list (codes cross-checked with TCGdex), the One Piece Card Game official product list, Yugipedia
(Yu-Gi-Oh! OCG) and Scryfall (Magic). Only set names, codes, types and dates are taken.

```bash
pnpm catalog:fetch [pokemon|one_piece|yugioh|mtg]   # refresh the JSON (a few minutes), review, commit
pnpm catalog:sync                                   # load into the database; removes sets that left the catalog
```

## Collectors

Collectors only fetch for products with active sources, at a polite pace (2-5 s between requests,
a request cap per run, stop on 403/429/captcha), and only from the home PC. Never run them on
Vercel or CI (the CLI refuses when `VERCEL` or `CI` is set).

```bash
pnpm collect                         # all collectors: match, then collect
pnpm collect --source <source>       # one collector
pnpm collect --match-only            # only look for listings of unlinked items
pnpm collect --collect-only          # only fetch trades for linked listings
pnpm collect --product <product-id>  # one product
pnpm valuate                         # only refresh valuation snapshots (collect does this too)
```

### How items get prices

1. Register an item in the app as usual.
2. On the next run, each collector searches its site for owned (or opened) items without a
   listing and stores the best candidates.
3. In the app, the item page shows them under **Price sources** (and Portfolio shows a banner):
   confirm the right one, or paste the listing's link instead. A product can have several listings
   (e.g. a box with and without shrink wrap); each feeds its own price bucket.
4. The next runs backfill the listing's sales history (a page budget per run, resuming where they
   stopped), then add new sales.

Settings shows each source's last run, items waiting for confirmation, listings not collected for
3+ days and big median moves.

### Purchase import

Importer plug-ins turn a shop's order emails into purchases. Export the emails with Google Takeout
(Gmail filter + label, then Mail limited to that label) and run, on the home PC:

```bash
pnpm purchases <export.mbox> --user <username> [--source <source>]
```

The app never gets access to Gmail. Purchases are matched by transaction ID: ones already
registered with the same data are skipped, different data or likely duplicates are asked about,
cancelled orders are left out, and nothing is written before you confirm. Imported items then
appear under **Review import** in the app to set each one's grade, cert number or packaging.

### Private plug-ins (submodule)

The author's own plug-ins live in a private repo mounted at `collectors/` (git submodule). Use the
same layout for yours: `collectors/src/index.ts` exporting `collectors` and `importers`.

```bash
git clone --recurse-submodules git@github.com:sp1aca9fa/tora-v2.git
# or, in an existing checkout:
git submodule update --init
pnpm install
```

Without it, `pnpm collect` reports the package as missing and does nothing; the app, build and
tests work as usual. Vercel builds skip it (private submodules are not fetched), which is intended.
Commit collector changes inside `collectors/` first, push them, then commit the updated submodule
pointer in the main repo.

### Daily schedule

`scripts/collect-cron.sh` runs `pnpm collect` **at most once per day**: it exits right away when
today's run already succeeded, waits a random 0-5 min first (jitter), loads nvm, and logs to
`~/.local/state/tora/collect.log`. Because it is safe to trigger often, it is started by events
rather than a fixed time.

**Windows Task Scheduler (recommended, PC not always on):**

```bash
./scripts/install-windows-task.sh     # from WSL; no admin needed
```

This registers the `tora-collect` task: 5 minutes after you log on to Windows, plus daily at
12:00 and "as soon as possible" if the PC was off then. It starts WSL by itself.
Remove it with `powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"`.

**cron (only if WSL stays running):**

```bash
crontab -e
0 * * * * /home/<user>/code/<path>/tora-v2/scripts/collect-cron.sh   # hourly; runs once a day
```

Manual run any time: `pnpm collect`, or `FORCE=1 MAX_JITTER_SECONDS=0 ./scripts/collect-cron.sh`
to go through the scheduled path.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free for personal, hobby, research, educational and
other noncommercial use, including changing and sharing it under the same terms; commercial use
is not permitted. This makes the project source-available rather than open source. Third-party
dependencies keep their own licenses.
