# Tora

A personal tracker for collectibles (TCG singles and sealed product, game collector's editions,
amiibo, controllers, ...): what I own, what I paid, and what it is worth now, based on Japanese
second-hand market data accumulated in its own database. A few accounts (family); each sees only
their own collection, while the product catalog and market data are shared.

- **Web app** (`apps/web`): Next.js, hosted on Vercel, behind username + password + authenticator
  code, limited to 2 devices per account.
- **Database**: Turso (hosted libSQL / SQLite) via Drizzle ORM. Local dev uses a SQLite file.
- **Collectors**: run only on a home PC in WSL2 (residential IP) and write straight to Turso.
  Private scrapers live in an optional git submodule (`collectors/`); the public repo installs,
  builds and tests without it.

```
apps/web                 Next.js app (UI, server actions, auth)
packages/core            Domain logic: taxonomy, lot splits, valuation buckets
packages/auth            Password hashing, TOTP, backup codes, secret encryption
packages/db              Drizzle schema, migrations, queries, user CLI, seed
packages/catalog         TCG set catalog: fetch script + JSON data (Pokemon, One Piece, Yu-Gi-Oh!, Magic)
packages/collector-sdk   Collector interface, registry, `pnpm collect`
collectors-public/       Collectors safe to publish (TCGCSV, FX)
collectors/              PRIVATE submodule (optional)
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
one. Sources: TCGdex (Pokemon), the One Piece Card Game official product list, Yugipedia
(Yu-Gi-Oh! OCG) and Scryfall (Magic). Only set names, codes, types and dates are taken.

```bash
pnpm catalog:fetch [pokemon|one_piece|yugioh|mtg]   # refresh the JSON (a few minutes), review, commit
pnpm catalog:sync                                   # load into the database (idempotent)
```

## Collectors

Collectors only fetch for products with active sources, at a polite pace, and only from the home
PC. Never run them on Vercel or CI.

### Private submodule

```bash
git submodule add git@github.com:<you>/<private-collectors-repo>.git collectors
pnpm install
```

Without it, `pnpm collect` reports the package as missing and does nothing. The app's Settings
page shows collector runs once they exist.

### Daily schedule (cron in WSL)

`scripts/collect-cron.sh` loads nvm, sleeps a random 0-60 min (jitter), runs `pnpm collect`, and
appends to `~/.local/state/tora/collect.log`.

```bash
chmod +x scripts/collect-cron.sh
crontab -e
# every day at 04:00 (+ up to 60 min jitter)
0 4 * * * /home/<user>/code/<path>/tora-v2/scripts/collect-cron.sh
```

cron must be running in WSL. Either enable systemd (`/etc/wsl.conf` -> `[boot]` `systemd=true`,
then `wsl --shutdown` from Windows) or start it manually with `sudo service cron start`.

### Fallback: Windows Task Scheduler

If WSL is not always running, let Windows start it:

1. Task Scheduler -> Create Task -> Triggers: Daily 04:00 (optionally "Delay task for up to
   1 hour" for jitter).
2. Action: Program `wsl.exe`, arguments:
   ```
   -d Ubuntu -- bash -lc "NO_JITTER=1 /home/<user>/code/<path>/tora-v2/scripts/collect-cron.sh"
   ```
3. Settings: "Run task as soon as possible after a scheduled start is missed".

Use either cron or Task Scheduler, not both.
