# Tora

A personal, single-user tracker for collectibles (TCG singles and sealed product, game collector's
editions, amiibo, controllers, ...): what I own, what I paid, and what it is worth now, based on
Japanese second-hand market data accumulated in its own database.

- **Web app** (`apps/web`): Next.js, hosted on Vercel, behind a password login.
- **Database**: Turso (hosted libSQL / SQLite) via Drizzle ORM. Local dev uses a SQLite file.
- **Collectors**: run only on a home PC in WSL2 (residential IP) and write straight to Turso.
  Private scrapers live in an optional git submodule (`collectors/`); the public repo installs,
  builds and tests without it.

```
apps/web                 Next.js app (UI, server actions, auth)
packages/core            Domain logic: enums, lot splits, valuation buckets
packages/db              Drizzle schema, migrations, seed, queries
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
pnpm hash-password            # prompts for a password, prints AUTH_PASSWORD_HASH=...
openssl rand -base64 32       # use as AUTH_SECRET
# paste both into .env

pnpm db:migrate               # creates ./data/local.db
pnpm db:seed                  # sample data (local DB only, refuses remote DBs)
pnpm dev                      # http://localhost:3000
```

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
   - `AUTH_PASSWORD_HASH` (from `pnpm hash-password`)
   - `AUTH_SECRET` (`openssl rand -base64 32`, different from your local one)
   - `ENABLE_EXPERIMENTAL_COREPACK=1` (so Vercel uses the pnpm version pinned in `package.json`)
4. Deploy. Functions run in Tokyo (`hnd1`, see `apps/web/vercel.json`) next to the Turso DB.
5. On the phone: open the URL, sign in, then "Add to Home Screen".

### Auth notes

- Only a scrypt hash of the password is stored (env var). Sessions are signed, httpOnly, Secure,
  SameSite=Lax cookies valid for 180 days.
- After 5 failed attempts from one IP in 15 minutes, that IP is locked for the rest of the window.
  More than 50 failures per hour across all IPs locks login for everyone. IPs are stored as keyed
  hashes.
- To log out every device, change `AUTH_SECRET` (or the password) and redeploy.
- The app fails closed: if either auth variable is missing, nothing but the login page is served.

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
