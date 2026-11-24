import { isDeepStrictEqual } from 'node:util';
import {
  type WishAlert,
  type WishAlertData,
  type WishAlertState,
  type WishKeyedCopy,
  alertPrefs,
  mergeDelivered,
  parseWishState,
  stepWish,
  wishNotice,
} from '@tora/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  type AlertContext,
  appUrl,
  channelsOf,
  conditionWords,
  linkUrl,
  moneyFor,
  sendToUser,
  sendWatchAlerts,
  textsFor,
} from './alerts';
import type { Db } from './client';
import { loadSourceRegistry } from './registry';
import { type Watch, appSettings, users, watches } from './schema';
import { wishViews } from './wish-view';

/**
 * One closing step at a time (plan 9.F): the after-run starts after every collect attempt, so two
 * can overlap. The lease is held 10 minutes and renewed before each person; a waiter waits until
 * the expiry plus a minute (a holder that died), then takes it, or gives up when it was renewed.
 */
export const WISH_LEASE_KEY = 'wishAlertLease';
export const WISH_LEASE_MS = 10 * 60_000;
const WISH_LEASE_GRACE_MS = 60_000;
const WISH_LEASE_POLL_MS = 10_000;

export interface WishPassOptions {
  /** The lease's clock in ms and its wait (tests and the rehearsal); default the real ones. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WishPassResult {
  /** Alerts for people with buy alerts on (sent or not), and messages a channel took. */
  alerts: number;
  sent: number;
  /** Delivered alerts whose state could not be written (that copy may come once more). */
  lost: number;
  /** Wishes whose stored state is not a valid one: skipped, never reset. */
  invalid: number;
  /** Wishes saved while the pass read them: stepped afresh by the next pass. */
  skipped: number;
  /** People whose part of the pass threw before anything was sent (logged): the next pass steps them. */
  failed: number;
  /** `busy`: another pass held the lease; `lease_lost`: another took it during this one. */
  status: 'done' | 'busy' | 'lease_lost';
}

type LeaseDb = Pick<Db, 'insert' | 'select' | 'update'>;

async function takeLease(db: LeaseDb, id: string, at: number): Promise<boolean> {
  const value = { id, until: at + WISH_LEASE_MS };
  const taken = await db
    .insert(appSettings)
    .values({ key: WISH_LEASE_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
      // Taken a minute past the expiry (a holder that died); a broken value counts as expired.
      setWhere: sql`coalesce(json_extract(${appSettings.value}, '$.until'), 0) <= ${at - WISH_LEASE_GRACE_MS}`,
    })
    .returning({ key: appSettings.key });
  return taken.length > 0;
}

/** Renews (`until`) or releases (0) the lease, only while it is this pass's own. */
async function setLease(db: LeaseDb, id: string, until: number): Promise<boolean> {
  const own = await db
    .update(appSettings)
    .set({ value: { id, until } })
    .where(
      and(
        eq(appSettings.key, WISH_LEASE_KEY),
        sql`json_extract(${appSettings.value}, '$.id') = ${id}`,
      ),
    )
    .returning({ key: appSettings.key });
  return own.length > 0;
}

async function waitForLease(
  db: LeaseDb,
  id: string,
  clock: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  let deadline: number | null = null;
  for (;;) {
    const at = clock();
    if (await takeLease(db, id, at)) return true;
    if (deadline === null) {
      const [row] = await db
        .select({ until: sql<unknown>`json_extract(${appSettings.value}, '$.until')` })
        .from(appSettings)
        .where(eq(appSettings.key, WISH_LEASE_KEY));
      const until = typeof row?.until === 'number' ? row.until : at;
      deadline = Math.max(until, at) + WISH_LEASE_GRACE_MS;
      // Released (or expired) between the take and this read: take again at once (fix round 1,
      // item 5), once; a holder that died waits out the grace.
      if (until <= at) continue;
    }
    if (at >= deadline) return false;
    await sleep(Math.min(WISH_LEASE_POLL_MS, deadline - at));
  }
}

interface ReadRow {
  raw: string | null;
  state: Watch['alertState'];
  price: number | null;
  bucket: string;
}

async function readRow(db: Db, userId: string, id: string): Promise<ReadRow | null> {
  const [row] = await db
    .select({
      raw: sql<string | null>`${watches.alertState}`,
      state: watches.alertState,
      price: watches.targetPriceBase,
      bucket: watches.bucket,
    })
    .from(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)));
  return row ?? null;
}

/** Compare-and-set on what the step was computed from (plan 9.K): price, bucket and state text. */
async function writeIfSame(
  db: Db,
  userId: string,
  id: string,
  from: ReadRow,
  state: NonNullable<Watch['alertState']>,
): Promise<boolean> {
  const written = await db
    .update(watches)
    .set({ alertState: state })
    .where(
      and(
        eq(watches.id, id),
        eq(watches.userId, userId),
        sql`${watches.alertState} IS ${from.raw}`,
        sql`${watches.targetPriceBase} IS ${from.price}`,
        eq(watches.bucket, from.bucket),
      ),
    )
    .returning({ id: watches.id });
  return written.length > 0;
}

/**
 * Game wishes' alerts after the nightly collect (S36 C3): per wish and read night, the copy at or
 * under the person's price that the state machine (`stepWish`) names, in one message per person
 * (kind buy: the person's buy setting and style apply). A wish with an alert for someone with a
 * channel keeps its old state until a channel took it (a failed send goes again on a rerun); every
 * other wish's state is written at once, so turning alerts on later sends no old news. Every read
 * is the person's own (`wishViews` and the rows by `userId`).
 */
export async function sendWishAlerts(
  db: Db,
  ctx: AlertContext,
  now = new Date(),
  options: WishPassOptions = {},
): Promise<WishPassResult> {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const result: WishPassResult = {
    alerts: 0,
    sent: 0,
    lost: 0,
    invalid: 0,
    skipped: 0,
    failed: 0,
    status: 'done',
  };
  const id = crypto.randomUUID();
  if (!(await waitForLease(db, id, clock, sleep))) return { ...result, status: 'busy' };
  try {
    const people = new Map(
      (
        await db
          .select({ user: users })
          .from(users)
          .innerJoin(watches, eq(watches.userId, users.id))
          .where(isNull(users.disabledAt))
      ).map((r) => [r.user.id, r.user] as const),
    );
    if (people.size === 0) return result;
    const base = await appUrl(db);
    const label = new Map(
      (await loadSourceRegistry(db)).sources.map((s) => [s.key, s.label] as const),
    );
    const sellerOf = (c: WishKeyedCopy) => {
      const source = label.get(c.source) ?? c.source;
      return c.own || !c.seller ? source : `${source}, ${c.seller}`;
    };
    for (const user of people.values()) {
      if (!(await setLease(db, id, clock() + WISH_LEASE_MS))) {
        result.status = 'lease_lost';
        break;
      }
      // One person's failure (a read, a row that breaks a step) keeps no one else's alerts back
      // (fix round 1, item 8): counted and logged without a name, the next person goes on.
      try {
        const views = [...(await wishViews(db, user.id, null, { now, alerts: true })).values()];
        const buy = alertPrefs(user.preferences).buy;
        let reachable: boolean | null = null;
        const held: {
          view: (typeof views)[number];
          from: ReadRow;
          /** The wish part the step read, and the step's. */
          wish: WishAlertState | null;
          stepped: WishAlertState;
          alert: WishAlert;
          next: NonNullable<Watch['alertState']>;
        }[] = [];
        for (const view of views) {
          if (view.state === 'not_game' || !view.alert || view.lastRun === null) continue;
          const from = await readRow(db, user.id, view.watch.id);
          if (
            !from ||
            from.price !== view.watch.targetPriceBase ||
            from.bucket !== view.watch.bucket ||
            JSON.stringify(from.state) !== JSON.stringify(view.watch.alertState)
          ) {
            result.skipped++;
            continue;
          }
          const wish = parseWishState(from.state?.wish);
          if (wish === 'invalid') {
            result.invalid++;
            continue;
          }
          const step = stepWish(wish, {
            night: view.lastRun,
            read: view.alert.read,
            price: from.price,
            copies: [...view.alert.tonight, ...view.alert.kept],
            shopSeen: view.alert.shopSeen,
            checkNeeded: view.state === 'check_needed',
          });
          if (!step) continue;
          const next = { ...from.state, wish: step.state };
          if (step.alert && buy) {
            result.alerts++;
            reachable ??= (await channelsOf(db, user.id)).length > 0;
            if (reachable) {
              held.push({ view, from, wish, stepped: step.state, alert: step.alert, next });
              continue;
            }
          }
          if (JSON.stringify(step.state) === JSON.stringify(wish)) continue;
          if (!(await writeIfSame(db, user.id, view.watch.id, from, next))) result.skipped++;
        }
        if (held.length === 0) continue;
        if (!(await setLease(db, id, clock() + WISH_LEASE_MS))) {
          result.status = 'lease_lost';
          break;
        }
        const money = await moneyFor(db, user);
        const items = held.map(({ view, from, alert }): WishAlertData => {
          const several = views.filter((v) => v.product.id === view.product.id).length > 1;
          return {
            name:
              view.product.name +
              (several && from.bucket ? ` (${conditionWords(from.bucket)})` : ''),
            copy: {
              title: alert.copy.title,
              price: money(alert.copy.cost),
              seller: sellerOf(alert.copy),
            },
            plusShipping: alert.plusShipping,
            target: money(from.price!),
            // Each price as the alerted copy's: as paid, or the stored one plus shipping.
            only: alert.only
              ? {
                  next: alert.nextUp
                    ? { price: money(alert.nextUp.cost), plusShipping: !alert.nextUp.paid.known }
                    : null,
                }
              : null,
            sellers: alert.sellers.map((s) => ({
              price: money(s.cost),
              seller: sellerOf(s),
              plusShipping: !s.paid.known,
            })),
            distinct: alert.distinct,
            url: alert.copy.url ?? linkUrl(base, `/watchlist/${view.watch.id}`),
          };
        });
        const t = await textsFor(db, user, ctx);
        const delivered = await sendToUser(db, user.id, wishNotice(t, items), ctx);
        if (delivered === 0) continue;
        result.sent += delivered;
        // Sent: each wish's state is written by itself, so a write that throws costs that wish
        // only (counted lost: its copy may come once more), never the others' states.
        for (const { view, from, wish: read, stepped, alert, next } of held) {
          try {
            if (await writeIfSame(db, user.id, view.watch.id, from, next)) continue;
            // A save won meanwhile: it stands, and the copy sent is remembered (plan section 3).
            // One that left the price, condition and wish part as the step read them (a note)
            // restarted nothing: the step's state goes on it (fix round 1, item 6).
            const fresh = await readRow(db, user.id, view.watch.id);
            const wish = fresh && parseWishState(fresh.state?.wish);
            const same =
              !!fresh &&
              fresh.price === from.price &&
              fresh.bucket === from.bucket &&
              isDeepStrictEqual(wish, read);
            const saved =
              fresh &&
              wish !== 'invalid' &&
              (await writeIfSame(db, user.id, view.watch.id, fresh, {
                ...fresh.state,
                wish: same ? stepped : mergeDelivered(wish, alert, stepped),
              }));
            if (!saved) result.lost++;
          } catch (error) {
            result.lost++;
            ctx.log?.(
              `wish alerts: a sent alert's state was not written: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error) {
        result.failed++;
        ctx.log?.(
          `wish alerts: one person's wishes failed, the others went on: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    await setLease(db, id, 0);
  }
  return result;
}

/**
 * The closing step of a night (S36 C3): the watches' buy alerts, then the game wishes'. `afterBuy`
 * hears the first part's counts before the second starts (the after-run's log line).
 */
export async function nightAlerts(
  db: Db,
  ctx: AlertContext,
  now = new Date(),
  options: WishPassOptions & { afterBuy?: (buy: { sent: number; alerts: number }) => void } = {},
): Promise<{ buy: { sent: number; alerts: number }; wish: WishPassResult }> {
  const { afterBuy, ...wishOptions } = options;
  const buy = await sendWatchAlerts(db, ctx, now);
  afterBuy?.(buy);
  return { buy, wish: await sendWishAlerts(db, ctx, now, wishOptions) };
}
