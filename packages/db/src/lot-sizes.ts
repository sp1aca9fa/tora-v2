// Applies estimated lot sizes to stored trades whose source did not report them (see
// `estimateLotSize`). Re-runnable: each trade is recomputed from its original lot price, against
// the trades of the same product, source and condition within a few days of it.
import { estimateLotSize, localDate, toLocalIso } from '@tora/core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { loadItemSales, refreshItemSales } from './item-sales';
import { loadSourceRegistry, saveSetting } from './registry';
import { appSettings, priceObservations } from './schema';
import { clearBucketValues } from './valuation';

const DAY = 86_400_000;
/** Trades this many days before or after count as "around the same time". */
const REFERENCE_DAYS = 3;
/** Trades checked every night; all of them once a week. */
const RECENT_DAYS = 14;
const FULL_EVERY = 7 * DAY;
const FULL_KEY = 'lotSizesFullAt';

/**
 * Estimated trades of the last `RECENT_DAYS` (their neighbours read with them), or all of them
 * when asked or once a week (an older trade changes only when a sale near it changes).
 */
export async function inferLotSizes(
  db: Db,
  options: { full?: boolean; now?: Date } = {},
): Promise<{ checked: number; updated: number; full: boolean }> {
  const now = options.now ?? new Date();
  const [last] = await db.select().from(appSettings).where(eq(appSettings.key, FULL_KEY));
  const lastFull = typeof last?.value === 'string' ? Date.parse(last.value) : NaN;
  const full = !!options.full || !(now.getTime() - lastFull < FULL_EVERY);
  const recentFrom = localDate(new Date(now.getTime() - RECENT_DAYS * DAY));
  const readFrom = localDate(new Date(now.getTime() - (RECENT_DAYS + REFERENCE_DAYS + 1) * DAY));
  const sourceKeys = (await loadSourceRegistry(db)).sources.map((s) => s.key);
  // Items with estimated lots among their kept sales (from the packed item sales, any marked days
  // updated first).
  await refreshItemSales(db, { marksOnly: true });
  const productIds = [...(await loadItemSales(db))]
    .filter(([, sales]) =>
      sales.groups.some(
        (g) =>
          g.t === 'sold' &&
          g.e.some((i) => full || toLocalIso(new Date(g.at[i]!)).slice(0, 10) >= recentFrom),
      ),
    )
    .map(([id]) => id);
  let checked = 0;
  const updates: { id: string; priceBase: number }[] = [];
  const changed = new Set<string>();
  for (let i = 0; i < productIds.length; i += 50) {
    const rows = await db
      .select({
        id: priceObservations.id,
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        observedAt: priceObservations.observedAt,
        priceBase: priceObservations.priceBase,
        priceOriginal: priceObservations.priceOriginal,
        quantityInferred: priceObservations.quantityInferred,
      })
      .from(priceObservations)
      .where(
        and(
          inArray(priceObservations.productId, productIds.slice(i, i + 50)),
          eq(priceObservations.observationType, 'sold'),
          eq(priceObservations.excluded, false),
          // Named sources: the item + source index then reads only these days.
          full
            ? undefined
            : and(
                sourceKeys.length ? inArray(priceObservations.source, sourceKeys) : undefined,
                gte(priceObservations.observedAt, readFrom),
              ),
        ),
      );
    const groups = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) {
      const key = `${r.productId}|${r.source}|${r.bucket}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    for (const group of groups.values()) {
      const trades = group
        .map((r) => ({
          ...r,
          t: Date.parse(r.observedAt),
          // What one unit sold for, as far as is known: reported lots are already per unit;
          // unreported ones are mostly single units, so their lot price is the reference.
          reference: r.quantityInferred ? (r.priceOriginal ?? r.priceBase) : r.priceBase,
        }))
        .sort((a, b) => a.t - b.t);
      let from = 0;
      let to = 0;
      for (const [index, trade] of trades.entries()) {
        while (trades[from]!.t < trade.t - REFERENCE_DAYS * DAY) from++;
        while (to < trades.length && trades[to]!.t <= trade.t + REFERENCE_DAYS * DAY) to++;
        if (!trade.quantityInferred || trade.priceOriginal === null) continue;
        if (!full && trade.observedAt < recentFrom) continue;
        checked++;
        const references: number[] = [];
        for (let j = from; j < to; j++) if (j !== index) references.push(trades[j]!.reference);
        const units = estimateLotSize(trade.priceOriginal, references);
        const priceBase = Math.round(trade.priceOriginal / units);
        if (priceBase !== trade.priceBase) {
          updates.push({ id: trade.id, priceBase });
          changed.add(trade.productId);
        }
      }
    }
  }
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    const cases = sql.join(
      chunk.map((u) => sql`when ${u.id} then ${u.priceBase}`),
      sql` `,
    );
    await db
      .update(priceObservations)
      .set({ priceBase: sql`case ${priceObservations.id} ${cases} end` })
      .where(
        inArray(
          priceObservations.id,
          chunk.map((u) => u.id),
        ),
      );
  }
  await clearBucketValues(db, [...changed]);
  if (full) await saveSetting(db, FULL_KEY, toLocalIso(now));
  return { checked, updated: updates.length, full };
}
