// Each item's kept sales, shop asks and buy prices in one packed row (requirements S19 part 2):
// Turso bills rows read, not bytes, so values, snapshots, buy timing, the quality gate and the
// item pages read one row per item instead of its every sale, with the same results (exact times
// kept). Triggers on price_observations mark the days that changed (`price_days_dirty`);
// `refreshItemSales` replaces those days in the packed rows after the collect and after changes
// made in the app, and rebuilds everything once a week.
import { type ValuationObservation, localDate, toLocalIso } from '@tora/core';
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { saveSetting } from './registry';
import {
  type PackedGroup,
  type PackedSales,
  appSettings,
  itemSales,
  priceDaysDirty,
  priceObservations,
  products,
} from './schema';

const DAY = 86_400_000;
/** Everything is rebuilt this often, whatever the marks say. */
const FULL_EVERY = 7 * DAY;
/** Past this many marked days (e.g. after a base currency change), everything is rebuilt. */
const FULL_ABOVE = 20_000;
const BUILT_KEY = 'itemSalesBuiltAt';
/** Marked days at most this far apart are read as one stretch. */
const STRETCH_GAP = 3 * DAY;

type ObservationRow = {
  productId: string;
  source: string;
  bucket: string | null;
  currency: string | null;
  observedAt: string;
  observationType: PackedGroup['t'];
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

/** A stored time as the app writes it (the stored text, exactly: times are kept in its zone). */
const timeText = (ms: number) => toLocalIso(new Date(ms));
const dayOf = (ms: number) => timeText(ms).slice(0, 10);

const emptySales = (): PackedSales => ({ groups: [], n: {} });

/** Adds observations of one item to its packed sales (kept ones in their group, all counted). */
function addRows(packed: PackedSales, rows: ObservationRow[]) {
  const byKey = new Map(
    packed.groups.map((g) => [`${g.s}\u0000${g.b}\u0000${g.c}\u0000${g.t}`, g]),
  );
  const touched = new Set<PackedGroup>();
  for (const r of rows) {
    const day = r.observedAt.slice(0, 10);
    const perDay = (packed.n[r.source] ??= {});
    perDay[day] = (perDay[day] ?? 0) + 1;
    if (r.excluded) continue;
    const key = `${r.source}\u0000${r.bucket}\u0000${r.currency}\u0000${r.observationType}`;
    let g = byKey.get(key);
    if (!g) {
      g = { s: r.source, b: r.bucket, c: r.currency, t: r.observationType, at: [], p: [], e: [] };
      byKey.set(key, g);
      packed.groups.push(g);
    }
    if (r.quantityInferred) g.e.push(g.at.length);
    g.at.push(Date.parse(r.observedAt));
    g.p.push(r.priceBase);
    touched.add(g);
  }
  // Oldest first (estimated positions follow their trades).
  for (const g of touched) {
    const estimated = new Set(g.e);
    const order = g.at.map((_, i) => i).sort((a, b) => g.at[a]! - g.at[b]! || g.p[a]! - g.p[b]!);
    g.e = order.flatMap((i, k) => (estimated.has(i) ? [k] : []));
    g.at = order.map((i) => g.at[i]!);
    g.p = order.map((i) => g.p[i]!);
  }
}

/** One item's packed sales from all its observations. */
export function packSales(rows: ObservationRow[]): PackedSales {
  const packed = emptySales();
  addRows(packed, rows);
  return packed;
}

/** Replaces a source's days `from`-`to` with these observations (all of that source and span). */
export function replaceDays(
  packed: PackedSales,
  source: string,
  from: string,
  to: string,
  rows: ObservationRow[],
) {
  for (const g of packed.groups) {
    if (g.s !== source) continue;
    const estimated = new Set(g.e);
    const keep = g.at
      .map((t, i) => i)
      .filter((i) => {
        const day = dayOf(g.at[i]!);
        return day < from || day > to;
      });
    g.e = keep.flatMap((i, k) => (estimated.has(i) ? [k] : []));
    g.at = keep.map((i) => g.at[i]!);
    g.p = keep.map((i) => g.p[i]!);
  }
  packed.groups = packed.groups.filter((g) => g.at.length > 0);
  const perDay = packed.n[source];
  if (perDay) {
    for (const day of Object.keys(perDay)) if (day >= from && day <= to) delete perDay[day];
    if (Object.keys(perDay).length === 0) delete packed.n[source];
  }
  addRows(packed, rows);
}

async function writeSales(db: Db, rows: { productId: string; sales: PackedSales }[]) {
  const empty = rows.filter(
    (r) => r.sales.groups.length === 0 && Object.keys(r.sales.n).length === 0,
  );
  const kept = rows.filter((r) => !empty.includes(r));
  for (let i = 0; i < kept.length; i += 50) {
    await db
      .insert(itemSales)
      .values(kept.slice(i, i + 50))
      .onConflictDoUpdate({
        target: itemSales.productId,
        set: { sales: sql`excluded.sales`, updatedAt: toLocalIso() },
      });
  }
  if (empty.length) {
    await db.delete(itemSales).where(
      inArray(
        itemSales.productId,
        empty.map((r) => r.productId),
      ),
    );
  }
}

/** The packed sales of these items, or of every item (items without any are left out). */
export async function loadItemSales(
  db: Db,
  productIds?: string[],
): Promise<Map<string, PackedSales>> {
  const out = new Map<string, PackedSales>();
  if (!productIds) {
    for (const r of await db.select().from(itemSales)) out.set(r.productId, r.sales);
    return out;
  }
  for (let i = 0; i < productIds.length; i += 200) {
    const ids = productIds.slice(i, i + 200);
    for (const r of await db.select().from(itemSales).where(inArray(itemSales.productId, ids))) {
      out.set(r.productId, r.sales);
    }
  }
  return out;
}

/**
 * Replaces the marked days in the packed rows, or rebuilds everything when asked, when there is
 * no build yet, when the last full build is a week old or when very many days are marked
 * (`marksOnly`, after a change in the app: only when there is no build yet). Returns the items
 * written.
 */
export async function refreshItemSales(
  db: Db,
  options: { full?: boolean; marksOnly?: boolean; now?: Date } = {},
): Promise<{ items: number; full: boolean }> {
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
    await db.delete(itemSales).where(sql`${itemSales.productId} not in (select id from products)`);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const rows = await db
        .select(observationColumns)
        .from(priceObservations)
        .where(inArray(priceObservations.productId, chunk));
      const byProduct = new Map<string, ObservationRow[]>(chunk.map((id) => [id, []]));
      for (const r of rows) byProduct.get(r.productId)!.push(r);
      await writeSales(
        db,
        [...byProduct].map(([productId, list]) => ({ productId, sales: packSales(list) })),
      );
      written += chunk.length;
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
    const spans: { productId: string; source: string; from: string; to: string }[] = [];
    for (const { productId, source, days } of marked.values()) {
      days.sort();
      let from = days[0]!;
      let to = from;
      for (const day of days.slice(1)) {
        if (Date.parse(day) - Date.parse(to) > STRETCH_GAP) {
          spans.push({ productId, source, from, to });
          from = day;
        }
        to = day;
      }
      spans.push({ productId, source, from, to });
    }
    // Item by item (in chunks): its packed row, the marked spans' sales, merged and written.
    const productIds = [...new Set(spans.map((s) => s.productId))];
    for (let i = 0; i < productIds.length; i += 50) {
      const ids = productIds.slice(i, i + 50);
      const chunk = spans.filter((s) => ids.includes(s.productId));
      const packed = await loadItemSales(db, ids);
      const rows: ObservationRow[] = [];
      for (let j = 0; j < chunk.length; j += 50) {
        rows.push(
          ...(await db
            .select(observationColumns)
            .from(priceObservations)
            .where(
              or(
                ...chunk.slice(j, j + 50).map((s) =>
                  and(
                    eq(priceObservations.productId, s.productId),
                    eq(priceObservations.source, s.source),
                    gte(priceObservations.observedAt, s.from),
                    // Times start with their date: '~' sorts after every time of the last day.
                    sql`${priceObservations.observedAt} < ${`${s.to}~`}`,
                  ),
                ),
              ),
            )),
        );
      }
      for (const s of chunk) {
        const sales = packed.get(s.productId) ?? emptySales();
        packed.set(s.productId, sales);
        replaceDays(
          sales,
          s.source,
          s.from,
          s.to,
          rows.filter((r) => {
            const day = r.observedAt.slice(0, 10);
            return (
              r.productId === s.productId && r.source === s.source && day >= s.from && day <= s.to
            );
          }),
        );
      }
      await writeSales(
        db,
        [...packed].map(([productId, sales]) => ({ productId, sales })),
      );
      written += packed.size;
    }
  }
  // Marks made while this ran (later rowids) stay for the next refresh.
  if (last) await db.delete(priceDaysDirty).where(sql`rowid <= ${last}`);
  if (full) await saveSetting(db, BUILT_KEY, toLocalIso(now));
  return { items: written, full };
}

/** An item's kept observations as valuations take them, from `since` (ISO) when given. */
export function unpackSales(
  sales: PackedSales | undefined,
  filter: { since?: string; currency?: string; types?: PackedGroup['t'][] } = {},
): (ValuationObservation & { currency: string | null })[] {
  if (!sales) return [];
  const since = filter.since ? Date.parse(filter.since) : -Infinity;
  const out: (ValuationObservation & { currency: string | null })[] = [];
  for (const g of sales.groups) {
    if (filter.types && !filter.types.includes(g.t)) continue;
    if (filter.currency && g.c !== null && g.c !== filter.currency) continue;
    const estimated = new Set(g.e);
    for (let i = 0; i < g.at.length; i++) {
      if (g.at[i]! < since) continue;
      out.push({
        source: g.s,
        bucket: g.b,
        priceBase: g.p[i]!,
        observedAt: timeText(g.at[i]!),
        observationType: g.t,
        excluded: false,
        quantityInferred: estimated.has(i),
        currency: g.c,
      });
    }
  }
  return out;
}

/** Kept sales of one item, source, condition, currency and day. */
export interface SoldDay {
  productId: string;
  source: string;
  bucket: string | null;
  currency: string | null;
  day: string;
  /** Prices in the base currency, lowest first. */
  prices: number[];
  /** Sales whose lot size was estimated. */
  estimated: number;
}

/** Kept sales per day of packed sales, from `since` (a local date), in one currency when given. */
export function soldDaysOf(
  productId: string,
  sales: PackedSales | undefined,
  filter: { since?: string; currency?: string } = {},
): SoldDay[] {
  const days = new Map<string, SoldDay>();
  for (const g of sales?.groups ?? []) {
    if (g.t !== 'sold') continue;
    if (filter.currency && g.c !== null && g.c !== filter.currency) continue;
    const estimated = new Set(g.e);
    for (let i = 0; i < g.at.length; i++) {
      const day = dayOf(g.at[i]!);
      if (filter.since && day < filter.since) continue;
      const key = `${g.b}\u0000${g.c}\u0000${g.s}\u0000${day}`;
      let d = days.get(key);
      if (!d) {
        d = { productId, source: g.s, bucket: g.b, currency: g.c, day, prices: [], estimated: 0 };
        days.set(key, d);
      }
      d.prices.push(g.p[i]!);
      if (estimated.has(i)) d.estimated++;
    }
  }
  for (const d of days.values()) d.prices.sort((a, b) => a - b);
  return [...days.values()];
}

/**
 * The kept sales per day of these items, from `since` (a local date) or all, in one currency
 * when given (sales without a currency count as any).
 */
export async function soldDays(
  db: Db,
  productIds: string[],
  filter: { since?: string; currency?: string } = {},
): Promise<SoldDay[]> {
  const packed = await loadItemSales(db, productIds);
  return productIds.flatMap((id) => soldDaysOf(id, packed.get(id), filter));
}

/** Every observation per source of an item (any type, kept or excluded): count and last day. */
export function sourceCounts(sales: PackedSales | undefined) {
  return Object.entries(sales?.n ?? {}).map(([source, perDay]) => ({
    source,
    n: Object.values(perDay).reduce((a, b) => a + b, 0),
    latest: Object.keys(perDay).sort().at(-1) ?? null,
  }));
}

/** The local date `days` before `now`. */
export const daysBack = (days: number, now = new Date()) =>
  localDate(new Date(now.getTime() - days * DAY));
