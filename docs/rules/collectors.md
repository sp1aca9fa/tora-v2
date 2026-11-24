# Collecting: what is read, the pace and the limits

How much Tora reads from a site, how slowly, what it does when a site refuses, when the collect
runs, and what is kept. This file is the one home of these rules and their numbers. The code is
`packages/collector-sdk/src/` (`http.ts`, `runner.ts`, `lock.ts`, `market-jobs.ts`,
`cli/collect.ts`), `packages/core/src/market-ceiling.ts`, `packages/db/src/sources.ts` and
`scripts/collect-cron.sh`. Writing a plug-in: [Collectors](../collectors.md). Running and
scheduling: [Running collectors](../running.md), [Home server](../home-server.md).

Not here: the messages sent about a failed or refused run and the flags in Settings
([Alerts](alerts.md)); roles, rates and what a plug-in's declarations do
([Sources and markets](sources-markets.md)); which pages a daytime job reads for a game (the
Wishlist's chapter of the requirements); the store feeds, read in a person's own browser at their
own pace ([Store notices](../store-feeds.md)).

## Words

- **Plug-in**: the code that reads one site. It returns what it read and never writes to the
  database.
- **The collect**: the program that runs the plug-ins one after another and saves what they
  return. It runs only on the home server and refuses to start on a hosted platform or in CI.
- **Run**: one plug-in's part of a collect. It ends done, partial (something failed or was left),
  failed or blocked.
- **Refusal**: a site saying no (see below). A refusal is never worked around.
- **Day**: a calendar day in the app's time zone, unless hours are said.

## What is read

Never a whole site. In a run, for the site's source:

- **Listings**: every active listing linked to an item, each at most once a day. Items someone
  holds or watches come first, then listings never read, then the least recently read.
- **New sales before old ones**: every listing gets its new sales first; older history is read
  only with the requests left.
- **Searches** for items with no listing on the site yet: items someone holds or watches, and
  items in a ranking's top. At most 50 items a run, each item once a day, at most 8 results kept
  per search. A result becomes a listing only when a person confirms it.
- **Gone listings**: a listing answering "not found" on 3 nights in a row is set aside and its
  item asks for a new link. It is tried again every 7 days; a success brings it back. Other
  errors never set a listing aside.
- **Sources left out**: those of a market not in use, and those that are off for every item type
  and are no type's identity source.
- **Other reads of a collect**, each with its own cap of requests: exchange rates 10, purchase
  links 200, rankings 20 (once a day), the cards of opened boxes 400, pictures 40.

A run with `--refresh`, or naming an item, reads again what was already read today.

## The pace of a run

- **Between two requests to one site**: a random wait of 2 to 5 seconds. A plug-in may only make
  it longer: its shortest wait is never under 2 seconds. A plug-in asking for 30 seconds waits 30;
  one asking for 1 second waits 2 to 5.
- **One request at a time per site**: sources run one after another, and a lock per site keeps a
  second collect, or a daytime job, off a site being read.
- **Requests per run**: 500, or the number the plug-in sets (more or fewer). Every try counts. A
  run that reaches it with listings left is partial, and the next hourly start goes on.
- **A server error, or no answer in 30 seconds**: tried again up to 3 times, after 5, 10 and 20
  seconds. A plug-in may ask for fewer tries, never more.

Example. A source with 180 listings and 30 items to search, at 2 to 5 seconds: about 210 requests
and 12 minutes. A source whose plug-in waits 30 seconds reads the same in about 1 hour 45 minutes.

## Refusals

- **What counts**: an answer 403 or 429, or a challenge page (a short page, or an answer that
  should be data and is not, with a challenge's words in it).
- **Then**: the source's run stops at once as blocked, with no further try. The site is left
  alone for the rest of that day, in every later collect and in the reads of rankings and opened
  boxes too. Only a run naming the source, an item or `--refresh` tries it again that day.
- **Any other error answer** fails that one listing; the run goes on.
- **With no retries asked**, a server error fails the listing like any other error. A plug-in for
  a service whose server error means "slow down" raises the refusal itself.

## When the collect runs

- The server starts the schedule's script every hour. The script does nothing when today's
  collect and backup already succeeded.
- Otherwise it waits a random 0 to 300 seconds, runs the collect, the backup and the alerts, and
  marks the day only when collect and backup both succeeded. So a night that failed, was refused
  or stopped at a cap goes on at the next hourly start, reading only what is left.
- An admin's "collect now" is taken at the next hourly start, without the random wait, also when
  today's collect already ran.
- A run still marked as running when its source starts again is closed as failed (after 3 hours
  when the starter does not hold the site's lock).
- **A long run** (shown in Settings): its working time, the server's sleep not counted, is over
  twice the median of up to 7 runs before it and at least 5 minutes more. The night's total is
  compared with the night window (6 hours unless the admin sets another).

## Daytime reads

Reads beyond the night's collect, queued as jobs for the marketplaces that have them.

| Rule                | Value                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Hours               | 05:00 to 22:00 app time; no request from 22:00                                    |
| Pace                | a random 10 to 20 seconds between requests; a plug-in may only make it longer     |
| Requests a day      | 200 per marketplace to start, counted before each is sent                         |
| A request           | one per step, no retry, 20 seconds for an answer                                  |
| Beside a collect    | never: jobs stop while a collect runs or an admin's "collect now" waits           |
| After a refused run | no job request to a site for 24 hours after the night's collect was refused there |
| A refusal           | the day's number is halved (never under 25) and nothing is asked for 72 hours     |
| A refusal at 25     | the marketplace stops until an admin starts it again, at 25 a day                 |
| The number          | never rises by itself; an unknown number means no request                         |
| A job that fails    | after 5 failures in a row it is tried at most once a day, after the other jobs    |

## What is kept

- A row with the same source and the same reference at the source is saved once.
- What the site returned is kept with each row, so matching can be improved and applied again
  later. A source declaring `detailsDays` loses its listing details after that many days
  ([Sources and markets](sources-markets.md#what-a-plug-ins-declarations-do)).
- A failing collector never changes stored data; values only get older.
- Parsing is covered by tests on saved answers, so a site's change shows as a failing test.

## Numbers

Each is a choice.

| Number                                  | Value                        | In the code                                                     | Chosen                            |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------- | --------------------------------- |
| Wait between requests                   | 2 to 5 seconds               | `PoliteHttp`, `MIN_DELAY_MS`                                    | built 2026-10-09                  |
| Requests per run                        | 500                          | `PoliteHttp`                                                    | built 2026-10-09                  |
| Tries again, waits, no answer           | 3; 5, 10, 20 s; 30 s         | `PoliteHttp`                                                    | built 2026-10-09, 10-25           |
| Searches per run, results kept          | 50, 8                        | `MATCH_PER_RUN`                                                 | built 2026-10-12                  |
| Set aside after, tried again every      | 3 nights, 7 days             | `LISTING_BROKEN_NIGHTS`, `LISTING_RETRY_DAYS`                   | decided 2026-10-23, 11-07         |
| Random wait before a collect            | 0 to 300 seconds             | `MAX_JITTER_SECONDS`                                            | built 2026-10-10                  |
| A run left as running                   | 3 hours                      | `STALE_RUN_MS`                                                  | built 2026-10-10                  |
| A long run; the night window            | 2 times and 5 min; 6 h       | set in `collectorTimes`                                         | decided 2026-10-15                |
| Daytime: a day, the floor, pace, hours  | 200, 25, 10 to 20 s, 5 to 22 | `MARKET_PER_DAY`, `MARKET_FLOOR`, `MARKET_PACE`, `MARKET_HOURS` | decided 2026-11-23                |
| Daytime: wait after a refusal, failures | 72 hours, 5                  | `MARKET_WAIT_MS`, `MARKET_FAILURES_DAILY`                       | decided 2026-11-23; 5 built 11-24 |
| Daytime: after a refused collect        | 24 hours                     | `COLLECT_REFUSAL_MS`                                            | built 2026-11-24                  |
