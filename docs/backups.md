# Backups

What you paid, when, and each lot's history exist only in the database: prices can be collected
again, purchases cannot. Tora keeps a copy of the whole database on the home PC.

## The daily copy

After each daily collect, the schedule (`scripts/collect-cron.sh`, see
[Running collectors](running.md)) runs `pnpm backup`, which saves `tora-YYYY-MM-DD.db.gz`: the
whole database as a compressed SQLite file (every table, including accounts and collected prices).
It runs even when the collect failed, and only once a day (the day in the app's time zone).

- **Where**: `~/.local/share/tora/backups`, or the folder in `BACKUP_DIR` in the root `.env`.
- **Kept**: the last 30 days, plus the first copy of each month for 12 months (about 41 files).
  Older ones are deleted by the next backup.
- **Size and time**: a database of about 870,000 rows (61 tables) gave a 139 MB file in about 150 s (measured 2026-11-25). Each backup reads every row twice (the copy, then a count that checks it), about 1.7 million rows at that size: on a hosted database that counts against the read budget ([Running collectors](running.md#the-hosted-databases-monthly-reads)).
- **Analysis copy**: each run also unpacks the latest copy to `~/.local/share/tora/analysis/tora.db`
  (or `TORA_ANALYSIS_DB`) and takes out the data of sources kept from AI models
  (`ops/scrub-analysis.sql`), keeping the old copy if that fails. The same step blanks everything
  used to sign in or to reach a person
  ([Accounts and access](rules/accounts.md#the-mcp-server)). When the refresh fails, `pnpm backup` only prints "analysis copy not updated" and sends no alert. A PC that copies a server's backups ([Home server](home-server.md#6-backups-off-the-box)) refreshes its copy with `ops/copy-backups.sh`, which needs `sqlite3`, tells Discord when it fails, and leaves out (and logs) a statement for a table the server's backup does not have yet; `pnpm backup` runs every statement, so there such a table fails the refresh. After marking a source as kept from AI models, run `pnpm backup --force` on the machine that makes the backups (then `ops/copy-backups.sh` on a PC that copies them) and check that the output names today's analysis copy before using Claude on it. Heavy questions read it instead of Turso: the MCP `query_sql` tool does,
  and so should any analysis script (a single careless query on Turso can use a large part of the
  free monthly reads).

Settings > Collectors shows admins when the last copy was made (in red after two days without one).

By hand: `pnpm backup` (skips when today's copy exists; `pnpm backup --force` makes it again).
Before a change made by hand: `pnpm backup --keep <name>` writes `<name>.db.gz` and exits 1 if it is
already there, so `pnpm backup --keep x && <the change>` run a second time stops before the change.
Pruning and the analysis copy leave that file alone; it stays until you remove it. On a PC that receives a server's copies (`ops/copy-backups.sh`), that folder mirrors the server's, and a copy kept there is deleted at the next copy: make `--keep` copies on the server.

### Copies off the PC

A copy that lives only on the PC is lost with the PC's disk. Point `BACKUP_DIR` at a folder that a
sync app already uploads, e.g. OneDrive, or Google Drive set to mirror files, on Windows, seen from WSL under `/mnt/c` (replace `<<WINDOWS_USER>>` with your Windows user name, the folder under `C:\Users`):

```bash
BACKUP_DIR="/mnt/c/Users/<<WINDOWS_USER>>/OneDrive/Tora backups"
```

A home server's copies reach your PC through `ops/copy-backups.sh` instead ([Home server](home-server.md#6-backups-off-the-box)).

The copies hold everything as it is: account data (password hashes, authenticator secrets encrypted with `AUTH_SECRET`) and the data of sources kept from AI models (only the analysis copy has those taken out). Keep that folder private and never let an AI tool open a copy; Claude Code reads only the analysis copy. `AUTH_SECRET` itself is not in them: keep it in your password manager, since a restored database needs the same one. If it is lost, set a new one and run `pnpm user reset-2fa <<USERNAME>>` for every account ([what else it breaks](rules/accounts.md#secrets)).

## Restoring

`pnpm restore <file>` loads a copy into the database in `DATABASE_URL`, which **must be new and
empty**: a restore never overwrites data, so the broken database stays as it is until you delete
it. The restored database holds only what the copy held: purchases, edits and imports made after
the copy was taken are lost unless you enter them again. Run every command in the repo folder, on
the machine that makes the backups (the home server, or the PC that collects).

1. **Stop everything that writes or reads sites**, and leave it stopped as the steps say. The copy
   does not hold the refusals sites gave after it was made, so a collect started before the next
   day could read a site that refused that day.
   - Home server (leave out any unit you did not install): `sudo systemctl disable --now tora-collect.timer tora-market-jobs.timer tora-update.timer; sudo systemctl stop tora-app tora-collect.service tora-market-jobs.service`
   - A PC that collects with the Windows task: `powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"` (and each `tora-collect-market-...` task); with cron, `crontab -e` and put `#` before Tora's lines.
   - A hosted app keeps running on the old database: change nothing in it until step 5.
2. **If the old database still opens, take a last copy**: `pnpm backup --keep before-restore-<<DAY>>` (replace `<<DAY>>` with today's date, as `2026-11-26`; it writes `before-restore-<<DAY>>.db.gz` next to the daily copies; if it says the copy is already there, nothing was written: pick another name). Load it in step 4 only when its data is right (a lost host, a move). To undo damage or a bad change, load the copy from before it (its own `--keep` copy, else a daily copy), and keep this one in case.
3. **Make the new, empty database.**
   - Hosted (Turso), as in [Setup](setup.md#2-database-turso):
     ```bash
     turso db create tora-restored --location aws-ap-northeast-1
     turso db show tora-restored --url
     turso db tokens create tora-restored
     ```
   - A database file: pick a new file name that does not exist yet, for example
     `/home/<<USER>>/.local/share/tora/local/tora-restored.db` (replace `<<USER>>` with your Linux
     user name; the restore creates the file).
4. **Restore, update and rebuild.** Replace `<<NEW_URL>>` with the URL printed by
   `turso db show`, or `file:` followed by the path from step 3; `<<TOKEN>>` with the token from
   `turso db tokens create` (leave it empty for a file); and `<<BACKUP_FILE>>` with the full path of the copy to load (in `BACKUP_DIR`, else `~/.local/share/tora/backups`; `before-restore-<<DAY>>.db.gz` when step 2's copy is the one to load).
   The `&&` stops at the first command that fails:
   ```bash
   export DATABASE_URL=<<NEW_URL>> DATABASE_AUTH_TOKEN=<<TOKEN>>
   pnpm restore <<BACKUP_FILE>> && pnpm db:migrate && pnpm rebuild
   ```
   `pnpm rebuild` makes every saved result again from the raw sales (on a hosted database it reads
   every sale once). If `pnpm restore` stops with an error, that database is partial: never migrate
   or switch to it. Delete it (`turso db destroy tora-restored`, or remove the file), make it again
   (step 3) and restore again. Close this terminal afterwards: it still points at the new database.
5. **Switch to it.** Put the new `DATABASE_URL` (and token) in `.env` on the machine that collects,
   and in the app's environment: on Vercel its environment variables, then redeploy; on a home server
   the same `.env`, then `sudo systemctl start tora-app && sudo systemctl enable --now tora-update.timer`.
   On a new machine, first copy the old state folder (`~/.local/state/tora`, or `TORA_STATE_DIR`) if
   it still exists: it keeps the daytime reads' refusals. `AUTH_SECRET` must be the same as before.
   Sign in and check the portfolio and your latest purchases.
6. **The next day (the app's time zone), turn the schedule on again**: on a home server
   `sudo systemctl enable --now tora-collect.timer`; on a PC `./scripts/install-windows-task.sh`
   (each task with the arguments it had), or remove the `#` in `crontab -e`. Turn the daytime reads
   on only after that night's collect has run on the restored database:
   `sudo systemctl enable --now tora-market-jobs.timer`. A refusal a daytime read met after the copy
   is not lost: the runner keeps a stamp of it (`market-refused-<marketplace>` in the state folder)
   until its wait ends, or, for a marketplace stopped at 25 a day, until an admin starts it again
   ([Collecting](rules/collectors.md#daytime-reads)), and writes it back at its next start. The day's
   count of requests starts fresh.
7. **Delete the old database last, and only after a day on the restored one.** This cannot be undone,
   and anything written to it after the copy goes with it. Hosted: `turso db destroy tora`; a file:
   remove the old file.

To look inside a copy yourself (never from Claude Code or another AI tool: the copies hold the sources kept from them), unzip it and open it with any SQLite tool (replace `<<DAY>>` with the copy's date):

```bash
gunzip -k tora-<<DAY>>.db.gz && sqlite3 tora-<<DAY>>.db "select count(*) from holdings"
```

Or restore it into a new local file (step 4 above with `DATABASE_URL=file:./data/restored.db`, a file that does not exist yet) and run the app against it.

## Each person's own data

Every account can also download its own data in the app (Settings > Your data): a spreadsheet of
its lots and a JSON file. That is for the person, not a backup of the app; see
the spreadsheet import in [Running collectors](running.md#imports) for bringing a spreadsheet back.

An **empty** account can load the JSON file on the same page, from this install or another one
with the same base currency and version: its items, lots, history, manual prices, watchlist and
imports come back. Items the install does not have are added, and their prices come with the next
collect. An account that already has data cannot load one. Exactly what a file holds and what a
load refuses: [the account download](rules/accounts.md#the-account-download).
