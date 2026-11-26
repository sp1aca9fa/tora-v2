import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { appSettings } from './schema';

/**
 * One alert pass of a kind at a time (plan 9.F, `docs/rules/alerts.md`: each alert goes once even
 * when two collects end close together). A lease is a row of the settings table under the pass's
 * key: held 10 minutes and renewed while the pass goes on; a waiter waits until the expiry plus a
 * minute (a holder that died), then takes it, or gives up when it was renewed.
 */
export const LEASE_MS = 10 * 60_000;
const LEASE_GRACE_MS = 60_000;
const LEASE_POLL_MS = 10_000;

export interface LeaseOptions {
  /** The lease's clock in ms and its wait (tests and the rehearsal); default the real ones. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Gives up after this long at most, whatever the holder's expiry: a caller with a time limit of
   * its own (the hosted daily job, killed at 60 s) must not spend it waiting.
   */
  maxWaitMs?: number;
}

export type LeaseDb = Pick<Db, 'insert' | 'select' | 'update'>;

async function takeLease(db: LeaseDb, key: string, id: string, at: number): Promise<boolean> {
  const value = { id, until: at + LEASE_MS };
  const taken = await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
      // Taken a minute past the expiry (a holder that died); a broken value counts as expired.
      setWhere: sql`coalesce(json_extract(${appSettings.value}, '$.until'), 0) <= ${at - LEASE_GRACE_MS}`,
    })
    .returning({ key: appSettings.key });
  return taken.length > 0;
}

/** Renews (`until`) or releases (0) the lease, only while it is this pass's own. */
async function setLease(db: LeaseDb, key: string, id: string, until: number): Promise<boolean> {
  const own = await db
    .update(appSettings)
    .set({ value: { id, until } })
    .where(and(eq(appSettings.key, key), sql`json_extract(${appSettings.value}, '$.id') = ${id}`))
    .returning({ key: appSettings.key });
  return own.length > 0;
}

/** Takes the lease, waiting out a holder as said above; false when it gave up. */
async function waitForLease(
  db: LeaseDb,
  key: string,
  id: string,
  clock: () => number,
  sleep: (ms: number) => Promise<void>,
  maxWaitMs = Infinity,
): Promise<boolean> {
  const latest = clock() + maxWaitMs;
  let deadline: number | null = null;
  for (;;) {
    const at = clock();
    if (await takeLease(db, key, id, at)) return true;
    if (deadline === null) {
      const [row] = await db
        .select({ until: sql<unknown>`json_extract(${appSettings.value}, '$.until')` })
        .from(appSettings)
        .where(eq(appSettings.key, key));
      const until = typeof row?.until === 'number' ? row.until : at;
      deadline = Math.min(Math.max(until, at) + LEASE_GRACE_MS, latest);
      // Released (or expired) between the take and this read: take again at once (fix round 1,
      // item 5), once; a holder that died waits out the grace.
      if (until <= at) continue;
    }
    if (at >= deadline) return false;
    await sleep(Math.min(LEASE_POLL_MS, deadline - at));
  }
}

export interface Lease {
  /** Renews the lease; false when another pass took it (stop before the next send). */
  renew(): Promise<boolean>;
  release(): Promise<void>;
}

/** Takes the lease under `key` (waiting as said above); null when another pass still holds it. */
export async function holdLease(
  db: LeaseDb,
  key: string,
  options: LeaseOptions = {},
): Promise<Lease | null> {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const id = crypto.randomUUID();
  if (!(await waitForLease(db, key, id, clock, sleep, options.maxWaitMs))) return null;
  return {
    renew: () => setLease(db, key, id, clock() + LEASE_MS),
    release: async () => void (await setLease(db, key, id, 0)),
  };
}
