# Backups

What you paid, when, and each lot's history exist only in the database: prices can be collected
again, purchases cannot. Tora keeps a copy of the whole database on the home PC.

## The daily copy

After each daily collect, the schedule (`scripts/collect-cron.sh`, see
[Running collectors](running.md)) runs `pnpm backup`, which saves `tora-YYYY-MM-DD.db.gz`: the
whole database as a compressed SQLite file (every table, including accounts and collected prices).
It runs even when the collect failed, and only once a day (the day in the app's time zone).

- **Where**: `~/.local/share/tora/backups`, or the folder in `BACKUP_DIR` in the root `.env`.
- **Kept**: the last 30 days, plus the first copy of each month for 12 months (about 42 files).
  Older ones are deleted by the next backup.
- **Size and time**: a database with 280,000 collected prices gives an 18 MB file in about 40 s.
  Each backup reads every row once, well within Turso's free monthly reads.

Settings > Collectors shows admins when the last copy was made (in red after two days without one).

By hand: `pnpm backup` (skips when today's copy exists; `pnpm backup --force` makes it again).

### Copies off the PC

A copy that lives only on the PC is lost with the PC's disk. Point `BACKUP_DIR` at a folder that a
sync app already uploads, e.g. OneDrive or Google Drive on Windows, seen from WSL under `/mnt/c`:

```bash
BACKUP_DIR="/mnt/c/Users/<you>/OneDrive/Tora backups"
```

The copies hold account data too (password hashes, authenticator secrets encrypted with
`AUTH_SECRET`), so keep that folder private. `AUTH_SECRET` itself is not in them: keep it in your
password manager, since a restored database needs the same one.

## Restoring

`pnpm restore <file>` loads a copy into the database in `DATABASE_URL`, which **must be new and
empty**: a restore never overwrites data, so the broken database stays untouched until you delete
it.

1. Make a new Turso database and a token for it (as in [Setup](setup.md#2-database-turso)):
   ```bash
   turso db create tora-restored --location aws-ap-northeast-1
   turso db show tora-restored --url
   turso db tokens create tora-restored
   ```
2. Restore into it, then bring it up to date with the repo:
   ```bash
   DATABASE_URL=libsql://tora-restored-<org>.turso.io DATABASE_AUTH_TOKEN=<token> \
     pnpm restore ~/.local/share/tora/backups/tora-2026-10-16.db.gz
   DATABASE_URL=libsql://tora-restored-<org>.turso.io DATABASE_AUTH_TOKEN=<token> pnpm db:migrate
   ```
3. Switch to it: put the new URL and token in the home PC's `.env` and in Vercel's environment
   variables, then redeploy on Vercel. Sign in and check the portfolio.
4. Once happy, delete the old database (`turso db destroy tora`).

To look inside a copy without the app, unzip it and open it with any SQLite tool:

```bash
gunzip -k tora-2026-10-16.db.gz && sqlite3 tora-2026-10-16.db "select count(*) from holdings"
```

Or restore it into a local file and run the app against it (`DATABASE_URL=file:./data/restored.db`).

## Each person's own data

Every account can also download its own data in the app (Settings > Your data): a spreadsheet of
its lots and a JSON file. That is for the person, not a backup of the app; see
the spreadsheet import in [Running collectors](running.md#imports) for bringing a spreadsheet back.
