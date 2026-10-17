// The sales per item, source, condition and day (requirements S19): the item chart, the source
// counts, buy timing and the strategy page read these instead of every sale. Triggers on
// price_observations mark the days that changed; `refreshPriceDays` rebuilds them after the
// collect and after changes made in the app, and everything once a week.
import { localDate, toLocalIso } from '@tora/core';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { saveSetting } from './registry';
import { appSettings, priceDays, priceDaysDirty, priceObservations, products } from './schema';

const DAY = 86_400_000;
/** Everything is rebuilt this often, whatever the marks say. */
const FULL_EVERY = 7 * DAY;
/** Past this many marked days (e.g. after a base currency change), everything is rebuilt. */
const FULL_ABOVE = 20_000;
const BUILT_KEY = 'priceDaysBuiltAt';
/** Marked days at most this far apart are rebuilt as one stretch. */
const STRETCH_GAP = 3 * DAY;

export type PriceDay = typeof priceDays.$inferSelect;
type BatchItem = Parameters<Db['batch']>[0][number];

type ObservationRow = {
  productId: string;
  source: string;
  bucket: string | null;
  currency: string | null;
  observedAt: string;
  observationType: string;
  excluded: boolean;
  priceBase: number;
  quantityInferred: boolean;
};

const observationColumns = {
  productId: priceObservations.productId,
  source: priceObservations.source,
  bucket: priceObservations.bucket,
  currency: priceObservations.currency,
  observedAt: priceObservations.observedAt,
  observationType: priceObservations.observationType,
  excluded: priceObservations.excluded,
  priceBase: priceObservations.priceBase,
  quantityInferred: priceObservations.quantityInferred,
};

/** The day rows of these observations. */
export function buildPriceDays(rows: ObservationRow[]): PriceDay[] {
  const days = new Map<string, PriceDay>();
  for (const r of rows) {
    const day = r.observedAt.slice(0, 10);
    const key = [r.productId, r.source, r.bucket ?? '', r.currency ?? '', day].join('\u0000');
    let d = days.get(key);
    if (!d) {
      d = {
        productId: r.productId,
        source: r.source,
        bucket: r.bucket,
        currency: r.currency,
        day,
        prices: [],
        estimated: 0,
        observations: 0,
      };
      days.set(key, d);
    }
    d.observations++;
    if (r.observationType !== 'sold' || r.excluded) continue;
    d.prices.push(r.priceBase);
    if (r.quantityInferred) d.estimated++;
  }
  for (const d of days.values()) d.prices.sort((a, b) => a - b);
  return [...days.values()];
}

/** Writes the rebuilt days in one batch after `clear` (the pages never see them half done). */
async function writeDays(db: Db, clear: BatchItem[], rows: PriceDay[]) {
  const inserts: BatchItem[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    inserts.push(db.insert(priceDays).values(rows.slice(i, i + 200)));
  }
  const all = [...clear, ...inserts];
  if (all.length) await db.batch(all as [BatchItem, ...BatchItem[]]);
}

/**
 * Rebuilds the marked days, or everything when asked, when there is no build yet, when the last
 * full build is a week old or when very many days are marked (`marksOnly`, after a change in the
 * app: only when there is no build yet). Returns the day rows written.
 */
export async function refreshPriceDays(
  db: Db,
  options: { full?: boolean; marksOnly?: boolean; now?: Date } = {},
): Promise<{ days: number; full: boolean }> {
  const now = options.now ?? new Date();
  const [mark] = await db
    .select({ last: sql<number | null>`max(rowid)`, n: sql<number>`count(*)` })
    .from(priceDaysDirty);
  const last = mark?.last ?? 0;
  const [built] = await db.select().from(appSettings).where(eq(appSettings.key, BUILT_KEY));
  const builtAt = typeof built?.value === 'string' ? Date.parse(built.value) : NaN;
  const full =
    !!options.full ||
    Number.isNaN(builtAt) ||
    (!options.marksOnly && (now.getTime() - builtAt >= FULL_EVERY || (mark?.n ?? 0) > FULL_ABOVE));
  let written = 0;
  if (full) {
    const ids = (await db.select({ id: products.id }).from(products)).map((p) => p.id);
    await db.delete(priceDays).where(sql`${priceDays.productId} not in (select id from products)`);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const rows = buildPriceDays(
        await db
          .select(observationColumns)
          .from(priceObservations)
          .where(inArray(priceObservations.productId, chunk)),
      );
      await writeDays(db, [db.delete(priceDays).where(inArray(priceDays.productId, chunk))], rows);
      written += rows.length;
    }
  } else if (last) {
    // Per item and source, the marked days in stretches (days a few apart read together).
    const marked = new Map<string, { productId: string; source: string; days: string[] }>();
    for (const d of await db
      .select()
      .from(priceDaysDirty)
      .where(sql`rowid <= ${last}`)) {
      const key = `${d.productId}\u0000${d.source}`;
      const m = marked.get(key);
      if (m) m.days.push(d.day);
      else marked.set(key, { productId: d.productId, source: d.source, days: [d.day] });
    }
    const list: { productId: string; source: string; from: string; to: string }[] = [];
    for (const { productId, source, days } of marked.values()) {
      days.sort();
      let from = days[0]!;
      let to = from;
      for (const day of days.slice(1)) {
        if (Date.parse(day) - Date.parse(to) > STRETCH_GAP) {
          list.push({ productId, source, from, to });
          from = day;
        }
        to = day;
      }
      list.push({ productId, source, from, to });
    }
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const rows = buildPriceDays(
        await db
          .select(observationColumns)
          .from(priceObservations)
          .where(
            or(
              ...chunk.map((s) =>
                and(
                  eq(priceObservations.productId, s.productId),
                  eq(priceObservations.source, s.source),
                  gte(priceObservations.observedAt, s.from),
                  // Times start with their date: '~' sorts after every time of the last day.
                  sql`${priceObservations.observedAt} < ${`${s.to}~`}`,
                ),
              ),
            ),
          ),
      );
      await writeDays(
        db,
        chunk.map((s) =>
          db
            .delete(priceDays)
            .where(
              and(
                eq(priceDays.productId, s.productId),
                eq(priceDays.source, s.source),
                gte(priceDays.day, s.from),
                lte(priceDays.day, s.to),
              ),
            ),
        ),
        rows,
      );
      written += rows.length;
    }
  }
  // Marks made while this ran (later rowids) stay for the next refresh.
  if (last) await db.delete(priceDaysDirty).where(sql`rowid <= ${last}`);
  if (full) await saveSetting(db, BUILT_KEY, toLocalIso(now));
  return { days: written, full };
}

/**
 * The saved days of these items with kept sales, from `since` (a local date) or all, in one
 * currency when given (sales without a currency count as any).
 */
export async function soldDays(
  db: Db,
  productIds: string[],
  filter: { since?: string; currency?: string } = {},
): Promise<PriceDay[]> {
  const out: PriceDay[] = [];
  for (let i = 0; i < productIds.length; i += 100) {
    const rows = await db
      .select()
      .from(priceDays)
      .where(
        and(
          inArray(priceDays.productId, productIds.slice(i, i + 100)),
          filter.since ? gte(priceDays.day, filter.since) : undefined,
          filter.currency
            ? or(sql`${priceDays.currency} is null`, eq(priceDays.currency, filter.currency))
            : undefined,
        ),
      );
    for (const r of rows) if (r.prices.length) out.push(r);
  }
  return out;
}

/** The local date `days` before `now`. */
export const daysBack = (days: number, now = new Date()) =>
  localDate(new Date(now.getTime() - days * DAY));
