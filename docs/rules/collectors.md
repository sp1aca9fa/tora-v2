# Collecting: what is read, the pace and the limits

How much Tora reads from a site, how slowly, what it does when a site refuses, when the collect
runs, and what is kept. This file is the one home of these rules and their numbers. The code is
`packages/collector-sdk/src/` (`http.ts`, `runner.ts`, `lock.ts`, `market-jobs.ts`,
`cli/collect.ts`), `packages/core/src/market-ceiling.ts`, `packages/db/src/sources.ts` and
`scripts/collect-cron.sh`. Writing a plug-in: [Collectors](../collectors.md). Running and
scheduling: [Running collectors](../running.md), [Home server](../home-server.md).

Not here: the messages sent about a failed or refused run and the other flags in Settings ([Alerts](alerts.md)); roles, rates and what a plug-in's declarations do
([Sources and markets](sources-markets.md)); which pages a daytime job reads for a game (the
Wishlist's chapter of the requirements); the store feeds, read in a person's own browser at their
own pace ([Store notices](../store-feeds.md)).

## Words

- **Plug-in**: the code that reads one site. It returns what it read and never writes to the
  database.
- **The collect**: the program that runs the plug-ins one after another and saves what they
  return. It runs only on the home server and refuses to start on a hosted platform or in CI.
- **Run**: one plug-in's part of a collect. It ends OK (nothing failed; a listing set aside that night, or failing its 7-day retry, is not a failure), partial (at least one item's read or search failed, or it stopped at its request cap with listings left), failed (the run itself stopped on an error that is not a refusal) or blocked (a refusal). A partial or failed run keeps the rows it saved before it ended.
- **Refusal**: a site saying no (see below). A refusal is never worked around.
- **Day**: a calendar day in the app's time zone, unless hours are said.
- **Night**: one day's collect, whatever hour its runs start; a run's reads count for the day it started, for the once-a-day rule too.

## What is read

Never a whole site. In a run, for the site's source:

- **Listings**: every active listing linked to an item, each at most once a day, except a tracked game no one holds, watches or ranks: the collect leaves it out, but a chosen one is read at the identity shop for games on its slot night (one night in seven, `TRACKED_SLOTS`; the Wishlist chapter of the requirements); its marketplace reads are daytime jobs. Items someone holds, has opened or watches come first, then listings never read, then the least recently read.
- **New sales before old ones**: with a plug-in that reads older history apart, every listing gets its new sales first, and older history is read only with the requests left; other plug-ins read a listing's new and older sales together.
- **Searches** for items with no active listing on the site and no result there waiting to be confirmed: items someone holds, has opened or watches, items in a ranking's top ([Opportunities](opportunities.md#popular-and-rankings)), and a chosen tracked game at the identity shop for games on its slot night; the slot games last, the others by when the item was added, oldest first. How depends on the plug-in ([Collectors](../collectors.md)):
  - A site searched page by page: at most 50 items a run, each item once a day, at most 8 results kept per search. A result becomes a listing only when a person confirms it.
  - A site read through a saved search: every item the plug-in handles gets its search at once, tracked games included (their reads are daytime jobs), with nothing to confirm.
  - A site linked by the item's product code: the link is made at once, with nothing to confirm and no cap of 50, for every item the plug-in handles that has no row there at all.
- **Order in a run**: searches (or link setup) first, then every listing's new sales, then older history. A run that reaches its cap before every listing had its new sales is partial; one that reaches it in older history is not.
- **Gone listings**: a listing found gone (an answer 404 or 410, or the plug-in reporting it gone, for example its search no longer lists it) on 3 different nights with no successful read in between is set aside, and its item asks for a new link on Actions. A night it was not read, or failed another way, neither counts nor breaks the run of nights. It is tried again 7 days after it was set aside or last tried, unless its item has an active listing there by then: a success brings it back, a failure of any kind waits 7 more days. Other errors never set a listing aside.
- **Sources left out**: those of a market not in use, and those that are off for every item type and are no type's identity source, unless the run names them (`--source` for either, `--market` for a market not in use). Opened boxes' cards are read whatever the market, and a run naming a market reads every market's rankings.
- **Other reads of a collect**, each with its own cap of requests: exchange rates 10, purchase
  links 200, rankings 20 (once a day), the cards of opened boxes 400, pictures 40.

A run with `--refresh`, or naming an item, reads again what was already read today. There is no daily cap per site: each later start that day reads what is left, up to a run's cap, and a run that failed is started again at each hourly start.

## The pace of a run

- **Between two requests to one site**: a random wait of 2 to 5 seconds, counted from the start of one request to the start of the next, so the time an answer takes counts toward it. A plug-in may only make it longer: its shortest wait is the longer of its own and 2 seconds; its longest is the longest of its own, 5 seconds and its shortest. A plug-in asking for 30 seconds waits 30; one asking for 1 second waits 2 to 5; one asking for 4 to 8 seconds waits 4 to 8. The identity shop for games asks every program, in its robots file, for 30 seconds between requests; its plug-in waits at least that, a number fixed in the plug-in: the robots file itself is not read (the owner, 2026-11-23). The wait holds within one read; the first request of a collect's next read of the same site (rankings, then the site's run) does not wait for it.
- **One request at a time per site**: sources run one after another, and a lock per site keeps a
  second collect, or a daytime job, off a site being read.
- **Requests per run**: 500, or the number the plug-in sets (more or fewer). Every try counts. A
  run that reaches it with listings left is partial, and the next hourly start goes on.
- **A server error, or no answer in 30 seconds**: tried again up to 3 times, 5, 10 and 20 seconds after the failed try ends, and never sooner than the wait between requests allows. A plug-in may ask for fewer tries, never more. A site's Retry-After header is not read. A connection that fails another way (reset, refused, no such host) is not tried again.

Example. A source with 180 listings and 30 items to search, one request each, at 2 to 5 seconds: about 210 requests
and 12 minutes. A source whose plug-in waits 30 seconds reads the same in about 1 hour 45 minutes.

## Refusals

- **What counts**: an answer 403 or 429, or a challenge page, at any status: an HTML answer under 50,000 characters with a challenge's words in it (`CAPTCHA_MARKERS`), or an answer that should be JSON and is not, with those words.
- **Then**: the source's run stops at once as blocked, with no further try. The site is left alone for the rest of the day the refusal came, in every later collect and in every read of a collect (exchange rates, rankings, opened boxes, purchase links, pictures), each of which takes the site's lock; a refusal in any of them counts as the site's refusal. A refusal in a daytime job counts the same for the collect. Only a run naming the source, an item or `--refresh` tries it again that day. An admin's "collect now" names none of these, so it leaves the site alone too.
- **Any other error answer**, or no answer after the last try, fails that one listing; the run goes on.
- **With no retries asked**, a server error fails the listing like any other error. A plug-in may read an answer itself: as a refusal (a service whose server error, or another error answer, means "slow down" or "no"), or a 403 that says the item was deleted as the listing gone.

## When the collect runs

- The server starts the schedule's script every hour. The script does nothing when today's
  collect and backup already succeeded.
- Otherwise it waits a random 0 to 300 seconds, runs the collect, then the backup and the alerts whatever the collect did (the alerts' own limits: [Alerts](alerts.md)), and marks the day the script started, in the app's time zone, only when collect and backup both succeeded. The collect succeeded when no run failed, was refused or stopped at its request cap with listings left; a run that is partial only because some items failed counts as done. So a night that failed, was refused
  or stopped at a cap goes on at the next hourly start, reading only what is left. A site refused earlier that day is left out of that start and does not keep the day from being marked; a site another collect is reading does for its own run; rankings and opened boxes found locked are only skipped for that start.
- An admin's "collect now" is taken at the next hourly start, without the random wait, also when
  today's collect already ran. It reads only what is left that day, as any later start does.
- A run still marked as running when its source starts again is closed as failed: at once when the new run holds the site's lock (the collect always takes it, so a run still reading keeps the site and the new one skips it), and only after 3 hours when the starter does not hold it. The rows it saved stay.
- **A long run** (shown in Settings, for each source's last finished run): its working time, the server's sleep not counted, is over twice the median of the source's finished runs before it (the last 1 to 7, of any status) and at least 5 minutes over that median; with no run before it there is no flag. **A long night**: the working times of each source's last run started within 24 hours before the newest run's start, added up, are over the night window (6 hours unless the admin sets another in Settings); exactly the window is not over.

## Daytime reads

Reads beyond the night's collect, queued as jobs for the marketplaces that have them.

| Rule                | Value                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hours               | 05:00 to 22:00 app time; no request from 22:00                                                                                                                   |
| Pace                | a random 10 to 20 seconds from the start of one request to the next; a plug-in may only make it longer (its own shortest and longest count where over 10 and 20) |
| Requests a day      | 200 per marketplace to start, counted before each is sent (one then refused counts)                                                                              |
| A request           | one per step, no retry, 20 seconds for an answer                                                                                                                 |
| Beside a collect    | never: jobs stop while a collect runs or an admin's "collect now" waits                                                                                          |
| After a refused run | no job request to a site for 24 hours from the start of its last collect run, when that run was refused                                                          |
| A refusal           | the day's number is halved, rounded down (never under 25), and no job asks for 72 hours from the refusal                                                         |
| A refusal at 25     | the marketplace stops, with no 72-hour wait, until an admin starts it again at 25 a day                                                                          |
| The number          | never rises by itself; an unknown number means no request                                                                                                        |
| A job that fails    | runs after the jobs that did not fail, fewest failures first (failed steps since its last saved one); after 5 in a row it is tried at most once a day            |

## What is kept

- A sale with the same source and the same reference at the source is saved once: the first read is kept, and a later change at the site to that sale is not read. A day's ask (per item, source and condition) is replaced by the last read that day; the day is the run's start day.
- What the site returned is kept with each row, so matching can be improved and applied again
  later. A source declaring `detailsDays` loses its listing details after that many days
  ([Sources and markets](sources-markets.md#what-a-plug-ins-declarations-do)).
- A failing collector never changes stored data; values only get older.
- Parsing is covered by tests on saved answers, so a site's change shows as a failing test.

## Numbers

Each is a choice.

| Number                                                           | Value                                 | In the code                                                     | Chosen                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wait between requests                                            | 2 to 5 seconds                        | `PoliteHttp`, `MIN_DELAY_MS`                                    | the requirements' first text; built 2026-10-09                                                                                                            |
| The identity shop for games: wait                                | 30 seconds at least                   | its plug-in's `http`                                            | the owner, 2026-11-23 (its robots file asks every program for 30)                                                                                         |
| Requests per run                                                 | 500                                   | `PoliteHttp`                                                    | Claude, at build, 2026-10-09 (the requirements ask for a cap, no number)                                                                                  |
| Tries again, waits, no answer                                    | 3; 5, 10, 20 s; 30 s                  | `PoliteHttp`                                                    | Claude, at build, 2026-10-09 (the requirements' first text asks for retries with backoff on 5xx, no number); the 30 s 2026-10-25                          |
| Searches per run, results kept                                   | 50, 8                                 | `MATCH_PER_RUN`, `runCollector`                                 | Claude, at build: 50 2026-10-09, 8 2026-10-10 (the 50 named 2026-10-12)                                                                                   |
| Other reads per collect: rates, links, rankings, boxes, pictures | 10, 200, 20, 400, 40                  | `collect.ts`                                                    | Claude, at build, with each read (rates 2026-10-12, links 2026-10-11, rankings 2026-10-21, boxes 2026-10-19, pictures 2026-10-10); no decision names them |
| A challenge page: under                                          | 50,000 characters                     | `PoliteHttp`                                                    | Claude, at build, 2026-10-09 (commit `5846352`)                                                                                                           |
| Set aside after, tried again every                               | 3 nights, 7 days                      | `LISTING_BROKEN_NIGHTS`, `LISTING_RETRY_DAYS`                   | 3 Claude, at build, 2026-10-23; 7 days the owner, 2026-11-07                                                                                              |
| Random wait before a collect                                     | 0 to 300 seconds                      | `MAX_JITTER_SECONDS`                                            | Claude, at build, 2026-10-10 (the requirements ask for jitter)                                                                                            |
| A run left as running                                            | 3 hours                               | `STALE_RUN_MS`                                                  | decision log, 2026-10-10 (whose not recorded)                                                                                                             |
| A long run; the night window                                     | 2 times, 5 min over, 1 to 7 runs; 6 h | `collectorTimes`, `COLLECT_WINDOW_HOURS`                        | 2 times and 6 h the owner, 2026-10-15; 5 min and 7 runs Claude, at build, 2026-10-15                                                                      |
| Daytime: a day, the floor, pace, hours                           | 200, 25, 10 to 20 s, 5 to 22          | `MARKET_PER_DAY`, `MARKET_FLOOR`, `MARKET_PACE`, `MARKET_HOURS` | the owner, 2026-11-23 (the Wishlist chapter of the requirements); the pace tested on one marketplace, not at many games a day nor from the server         |
| Daytime: wait after a refusal, failures                          | 72 hours, 5                           | `MARKET_WAIT_MS`, `MARKET_FAILURES_DAILY`                       | 72 hours: the owner's 3 days of 2026-11-23, read as 72 h (assumption, 2026-11-24); 5 Claude, at build, 2026-11-24 (assumption)                            |
| Daytime: after a refused collect                                 | 24 hours                              | `COLLECT_REFUSAL_MS`                                            | Claude, at build, 2026-11-24 (assumption)                                                                                                                 |
| Daytime: tries, an answer within                                 | 1, 20 s                               | `runSource`                                                     | Claude, at build, 2026-11-24 (no record names them)                                                                                                       |
