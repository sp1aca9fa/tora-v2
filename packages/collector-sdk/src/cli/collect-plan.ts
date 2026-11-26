// What a collect leaves out before it starts, and what it records of a refusal (the parts of
// `pnpm collect` that can be tested).
import {
  type ProductClass,
  type SourceRegistry,
  identitySources,
  roleOf,
  sourceInfo,
  localDate,
  typesOf,
} from '@tora/core';
import { type Db, blockedOn, finishRun, markRunRefused, startRun } from '@tora/db';
import { errorText } from '../http';
import { replayMarketStamps } from '../market-jobs';

/**
 * Whether a source's data is used nowhere: its role is `off` for every item type (Settings >
 * Admin > Sources) and it is no type's identity source in its market. Its collector, rankings and
 * set cards are then not collected (requirements S8: roles say what a source is used for). A
 * source the registry does not describe is kept: unknown is not off.
 */
export function offEverywhere(registry: SourceRegistry, key: string): boolean {
  const info = sourceInfo(registry, key);
  if (!info) return false;
  // Every type of the admin's categories, and any other type the source has a role for.
  const classes = new Set<ProductClass>([
    ...typesOf(registry),
    ...Object.keys(registry.roles[key] ?? {}),
  ]);
  for (const cls of classes) {
    if (roleOf(registry, key, cls) !== 'off') return false;
    // null, not undefined: the source's own market (undefined would mean the primary one).
    if (identitySources(registry, cls, info.market ?? null).includes(key)) return false;
  }
  return true;
}

/** What a collect did with one source, for the activity log and the alert after the run. */
export interface SourceResult {
  source: string;
  status: string;
  requests: number;
  observations: number;
}

/**
 * A site refusing Tora outside a collector's run (the owner, 2026-11-07: alerts like a refused
 * collector). In the run's results, so it goes the way a refused collector does: a failed entry in
 * the activity log, sent to admins after the run. Its status has its own text (`status_blocked_*`
 * in the alert texts). The site is left alone for the rest of the day (`blockedOn`), so it comes
 * once a day per site. Requests are not counted: the step's client is shared by its sites.
 */
export type RefusedStep = 'rankings' | 'opening' | 'links' | 'pictures' | 'rates';

export const refusedResult = (source: string, step: RefusedStep): SourceResult => ({
  source,
  status: `blocked_${step}`,
  requests: 0,
  observations: 0,
});

/** Whether a collect's activity entry is a failure, which admins are sent. */
export const runFailed = (results: SourceResult[]) =>
  results.some((r) => r.status === 'failed' || r.status.startsWith('blocked'));

/** The steps of a collect that read a site outside a collector's run, in the log's words. */
export const READING: Record<RefusedStep, string> = {
  links: 'purchase links',
  rankings: 'rankings',
  opening: 'box opening cards',
  pictures: 'pictures',
  rates: 'exchange rates',
};

/**
 * The sites refused today, before a collect reads any site ("Refusals", "The rest of the day"):
 * the daytime runner's stamps are replayed first (a refusal the database lost in a restore counts
 * again), then the day's blocked runs and marketplace refusals are read (`blockedOn`), for the
 * app's day of `now`. `--refresh` tries every site again, so nothing is read. An unreadable stamp
 * is logged and the other stamps are still replayed; its site (from the file name) counts as
 * refused while the file is younger than the wait (its time stands for the refusal's).
 */
export async function refusedSites(
  db: Db,
  run: { refresh?: boolean; timeZone: string; now?: Date; stateDir?: string },
  log: (line: string) => void = () => {},
): Promise<Set<string>> {
  if (run.refresh) return new Set();
  const unreadable = new Set<string>();
  try {
    await replayMarketStamps(db, {
      stateDir: run.stateDir,
      log: (m) => log(`[daytime refusals] ${m}`),
      unreadable: (file, source) => {
        unreadable.add(source);
        log(`daytime refusals: ${file} not readable, ${source} counted as refused today`);
      },
    });
  } catch (error) {
    log(`daytime refusals: not replayed (${errorText(error)})`);
  }
  const refused = await blockedOn(db, localDate(run.now ?? new Date(), run.timeZone));
  for (const source of unreadable) refused.add(source);
  return refused;
}

/**
 * What a collect leaves alone, from the sites refused today: `blocked` for the collectors,
 * rankings and box opening cards (a run naming a source or an item tries them again), `leave`
 * for the reads of every site (exchange rates, purchase links, pictures: only the source named
 * tries again). A refusal in the run adds its site to both (`addRefused`).
 */
export function leftAlone(
  refusedToday: ReadonlySet<string>,
  run: { source?: string; product?: string },
): { blocked: Set<string>; leave: Set<string> } {
  return {
    blocked: run.source || run.product ? new Set() : new Set(refusedToday),
    leave: new Set([...refusedToday].filter((s) => s !== run.source)),
  };
}

export function addRefused(sets: { blocked: Set<string>; leave: Set<string> }, source: string) {
  sets.blocked.add(source);
  sets.leave.add(source);
}

/**
 * A refusal outside a collector's run (exchange rates, purchase links, rankings, box opening
 * cards, pictures): a blocked run of the site is recorded with the refusal's time, so the day's
 * later collects leave it alone (`blockedOn`), and its result tells admins after the run
 * (`refusedResult`). `at` unknown (the step's client has none): now.
 */
export async function recordRefusedRead(
  db: Db,
  source: string,
  step: RefusedStep,
  at: Date | null = null,
): Promise<SourceResult> {
  const reading = READING[step];
  const run = await startRun(db, source);
  await markRunRefused(db, run, at ?? new Date());
  await finishRun(db, run, {
    status: 'blocked',
    requests: 0,
    observationsAdded: 0,
    error: `${reading}: the site refused (see the collect log)`,
  });
  return refusedResult(source, step);
}
