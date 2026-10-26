# Running collectors

Collectors run only on the home PC (WSL2 or Linux, a residential connection), at a polite pace,
and write straight to the database. Never on Vercel or CI: the CLI refuses when `VERCEL` or `CI` is
set.

## `pnpm collect`

```bash
pnpm collect                         # every collector: match, then collect
pnpm collect --market <market>       # one market's collectors (e.g. us)
pnpm collect --source <source>       # one collector
pnpm collect --match-only            # only look for listings of unlinked items
pnpm collect --collect-only          # only fetch prices for linked listings
pnpm collect --product <product-id>  # one item
pnpm collect --refresh                # also listings already collected today
pnpm collect --review                # then the data review (or TORA_REVIEW=1)
pnpm valuate                         # only refresh values and the value history
```

A full run: exchange rates, uploaded files waiting to be read, each collector in turn, pictures,
values, and the day's value snapshot. It refuses to run against a database that needs a migration
(run `pnpm db:migrate`).

**Once a day, once per site.** Prices are daily, so a listing already collected today (a day in the
app's time zone, Settings > Admin preferences > Time zone) is left out: a run started again the same
day (a retry after the PC turned off, a second task) does only what is left. `--refresh` or
`--product` collects again anyway. A site another collect is already running (by hand or by the
schedule) is skipped, so two runs never fetch from the same site at once; the skipped run does not
count as the day's run, and the schedule tries again later. A site that blocked a run (HTTP 403 or
429, a captcha) is left alone until the next day, so the day's retries do not keep knocking;
`--source` or `--refresh` tries it anyway.

**How items get prices.** Register an item; on the next run each collector searches its site for
it and stores the best candidates; confirm the right one under **Actions** or the item's **Lots & details** page
(Price sources) (or paste the listing's link); the next runs backfill its history (a page budget
per run, resuming where they stopped), then add new sales. An item can have several listings (e.g.
a box with and without shrink wrap), each feeding its own condition.

## The daily schedule

`scripts/collect-cron.sh` runs `pnpm collect`, then the day's database backup (`pnpm backup`, see
[backups](backups.md)), then `pnpm alerts after-run` (failures to admins, see [alerts](alerts.md)), **at most once a day**: it exits at once when today's run already succeeded (a day in the app's time zone, written down by each collect), waits a
random 0-5 min, loads nvm, and logs to
`~/.local/state/tora/collect.log`. Because it is safe to start often, it is started by events
rather than one fixed time. Arguments are passed on (`--market jp`), each set with its own daily
stamp and lock.

To read the end of that log (why the last run stopped, what each source did), run
`pnpm collect:log` in the repo folder; `tail -f ~/.local/state/tora/collect.log` follows a run
live. A run that stops early sends admins the reason read from the log (e.g. a database migration
not run yet) and records it on Settings > Activity; the schedule tries again the next hour.

A second Tora on the same PC (a test copy, another market) needs its own state folder, or the
two share one log, one set of locks and one daily stamp: set `TORA_STATE_DIR` in that copy's
`.env` (e.g. `~/.local/state/tora-test`).

**Windows Task Scheduler** (recommended when the PC is not always on), from WSL, no admin needed:

```bash
./scripts/install-windows-task.sh
```

This registers the `tora-collect` task: 5 minutes after you log on, plus daily at 12:00 (or as soon
as possible if the PC was off), then every hour around the clock. A run cut short by turning the PC
off is retried; a finished day is skipped, unless an admin pressed **Collect now** in Settings >
Collectors: the next hourly check (`pnpm collect:request`) takes the request and runs a collect at
once (re-run the install script once to get the hourly check around the clock). Only the task
without arguments takes requests. It starts WSL by itself. Leave the PC on until a run is
done (Settings > Collectors shows how long one takes). Remove it with
`powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"`.

**cron** (only if WSL or the Linux machine stays running):

```bash
crontab -e
0 * * * * /path/to/tora-v2/scripts/collect-cron.sh          # hourly; runs once a day
*/5 * * * * cd /path/to/tora-v2 && pnpm import-uploads       # optional: files uploaded in the app
```

Manual run any time: `pnpm collect`, or `FORCE=1 MAX_JITTER_SECONDS=0 ./scripts/collect-cron.sh`
to go through the scheduled path.

## Watching it: Settings > Collectors

Each collector's last run (status, requests, prices added, errors), items waiting for
confirmation, listings not collected for 3+ days, big median moves, and its **working time** (time
the PC slept is not counted) against its usual time; a run over twice its usual time is flagged.
The last night's total is compared with a **night window** the admin sets (6 hours by default).

A source whose runs suddenly add no sales on its last 3 days with runs, while they usually did (a
site that changed so its pages still load but yield nothing), is **quiet**: admins get an alert
once a day while it stays so.

## Many collectors

Measure first on Settings > Collectors, then:

| Setup                                                        | How to run                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Up to about 3 markets and 10 collectors, a few hundred items | One nightly `pnpm collect` (the author's: 6 collectors, about 100 items, about an hour) |
| More markets or collectors                                   | One run per market at its own hour (below); remove the all-markets task                 |
| Too many items for one night                                 | Not built yet: taking turns, held items first                                           |

```bash
AT=01:00 scripts/install-windows-task.sh --market jp   # task tora-collect-market-jp
AT=03:00 scripts/install-windows-task.sh --market us   # task tora-collect-market-us
powershell.exe -Command "Unregister-ScheduledTask -TaskName tora-collect -Confirm:\$false"
```

`--source <key>` works the same for one collector. Different sites may run side by side (two tasks
at once); never two runs for the same site. Each site's pace and request cap are its plug-in's
(`http`, see [Building a collector](collectors.md#polite-fetching)).

## Imports

**Order emails.** Importer plug-ins turn a shop's order emails into purchases. Export them with
Google Takeout (a Gmail filter and label, then Mail limited to that label), then:

```bash
pnpm purchases <export.mbox> --user <username> [--source <source>]
```

Takeout may report "No data found" for a label applied shortly before; export again later.

The app never gets access to Gmail. Purchases already registered are skipped, differing ones and
likely duplicates are asked about, canceled orders are left out, items an importer leaves out on
purpose (e.g. not collectibles) are listed, an order of several items becomes one lot per item,
and nothing is written before
you confirm. Imported lots wait under **Imports > Review** for their grade or packaging.

**Purchase links.** For shops that send no receipt email, paste the links of what you bought under
**Imports > Purchase links**; the next `pnpm collect` reads each one with the importer whose
`matchesLink` accepts it and shows what happened next to each link.

**Any shop, through Claude.** Screenshots, PDFs, CSV or copied text in one folder:

```bash
pnpm import-ai <folder> --user <username> [--dry-run] [--yes]
```

Haiku reads the files (`claude -p` with only the Read tool, confined to that folder) and lists
every purchase; the code checks each row and Sonnet reads again the flagged ones plus a 10% sample.
Nothing is written before you confirm; readings are cached in the folder (`.tora-import.json`).
The same import runs from the app (**Imports > Upload**, up to 30 files of 4 MB): read on the home
PC by the next `pnpm collect` or `pnpm import-uploads` (your Claude plan), or right away by the app
when the app has an `ANTHROPIC_API_KEY` (a few cents per batch).

**A spreadsheet** (no command; **Imports > Spreadsheet**, in the app). A CSV in the layout of
**Settings > Your data**'s lots download (or its empty template): headers and names (category,
kind, condition, status) in either of the app's languages or as keys, UTF-8 or the Japanese
encoding Excel saves. A preview shows what each row would do: a new lot, already in Tora (its lot
ID is in the account, the same order is, or a lot of the same item with the same date, quantity
and cost), skipped (not an owned lot) or a problem; confirming adds the new rows as lots waiting
in Review. A row matching only by item, date, quantity and cost shows that lot and can be ticked
"Add anyway" (a real second purchase). Rows already in Tora are never changed: edit lots in the
app. Up to 5,000 rows, 2 MB.

Every import keeps a log: its page (Imports > History) lists the rows not imported and why, and
the rows already in Tora with the lot each matched, so nothing is left out silently.

## The data review

The checks flag sales far from an item's value and searches that keep little of what they find.
`pnpm review` (or `pnpm collect --review`) hands only those to Claude Code on the home PC
(`claude -p`, no tools): Haiku judges each case, unsure ones go to Sonnet, and findings appear
under **Imports > Suggestions** (exclude a sale, make a search skip a word, fill in item details).
Nothing changes until you accept one. `--dry-run` prints the verdicts only. Sources marked `noAi`
are never sent.

## The hosted database's monthly reads

Turso's free plan allows 500 million rows read and 10 million written a month. Tora counts what
its own queries read and write (Turso reports it with each reply), per day and per origin (app
pages, collect, backup, Claude's MCP tools, ...), and shows the month so far in **Settings > Admin
preferences > Database**, with the pace for the whole month. The app's daily check alerts admins
when the month passes the budget set there (150 million by default), or heads past it at this pace
from the 5th. Turso's dashboard has the exact total, including anything run outside Tora (such as
the Turso shell). Nothing is counted while Tora runs on a local file. The pages and the collect read
saved numbers (the sales per day, saved values and the saved Portfolio chart) instead of every
sale; see requirements S19 for what each reads. Every night a self-check packs a few items again from their raw sales and compares them with what is saved; a difference is fixed and admins get an alert. `pnpm rebuild` rebuilds every saved result from the raw sales (after a restore, or if the self-check keeps finding differences).

## Claude Code and the hosted database

Programs started by Claude Code (it sets `CLAUDECODE=1`) refuse to open the hosted database
(Turso): its reads count against the free plan's monthly quota, and Claude's analysis questions
are better answered from the analysis copy (see [Backups](backups.md)). The Tora MCP server is
the exception (its tools read a few hundred rows; `query_sql` reads the analysis copy). To run a
command against Turso from a Claude Code session anyway, prefix it yourself:
`TORA_ALLOW_TURSO=1 pnpm ...`. A database server on this machine (localhost) is always allowed.

## The server's status (Settings > Admin > Server)

On a self-hosted server, admins see what it runs without a terminal: the version (git commit),
uptime, memory, disk, the systemd services and timers named `tora-*` (`TORA_UNITS` for another
pattern), the last collect and backup, and the end of each log in the state folder. Read-only.

For a helper on another machine (Claude Code, a monitoring tool), make a read-only token there:
it reads the same at `/api/server/status` (`Authorization: Bearer <token>`; `?lines=` per log,
`?log=collect` for one log) and can change nothing. Values of secret settings and lines naming a
source kept from AI models are left out. With `TORA_STATUS_URL` (the app's address) and
`TORA_STATUS_TOKEN` in `.env`, `node scripts/server-status.mjs` prints it.

## Checking every page: `pnpm crawl`

Signs in, follows every link from the home page and opens each page at phone (390 px) and wide
(1280 px) widths, then lists pages with an HTTP error, a console or page error, a raw text key, an
unfilled `{placeholder}`, sideways scrolling or text too faint to read on its background (WCAG
AA); it exits with 1 when any has one. `--views all` adds the smallest phone (320 px), a tablet, a
2560 px screen, 200 % zoom and dark mode; a comma list picks some (`--views phone,dark`). It only opens
pages. Run it against a test copy with a dev server running (`--base`, default
`http://localhost:3200`), with `CRAWL_USER`, `CRAWL_PASSWORD` and `CRAWL_TOTP_KEY` (or
`CRAWL_TOTP_KEY_FILE`) in `.env`. Options: `--max 150` pages, `--per-pattern 2` pages per address
shape (items, lots), `--only /settings`, `--shots <dir>` for screenshots, `--out <file>` for a
JSON report.

## Speed: `pnpm perf`

Opens each main page at phone width (a slow 4G connection and CPU) and wide width, first with an
empty cache, then `--runs` more times, and prints when the page finished arriving, its largest
paint, layout shift, page sizes and database round trips; values over a target, or over 30 %
slower than `--baseline <former --out>`, fail the run. Run it against a production build started
with `TORA_PERF=1` on a test copy, never the real app. Options: `--only Item`, `--sql 3` (each
page's costliest statements), `--out <file>`.

`pnpm perf --load <people> [--seconds 60]` has that many accounts open pages over and over at once,
and prints requests per second, failures and the slowest pages. It signs them in by adding a
device to each (removed at the end), so run it only from a test copy whose `.env` names a local
database file.

`pnpm stress-data <medium|large> --out <new.db> [--from <db>]` makes a copy of a local database
grown to a larger size (items cloned with their sales, lots and members added; large adds a third
market) to measure on. It only reads the database it copies and refuses a hosted one; then run
`pnpm rebuild` with `DATABASE_URL` set to the copy.
