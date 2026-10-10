// Applies estimated lot sizes to stored trades whose source did not report them (see
// `estimateLotSize`). Re-runnable: each trade is recomputed from its original lot price, against
// the trades of the same product, source and condition within a few days of it.
import { estimateLotSize } from '@tora/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { priceObservations } from './schema';

const DAY = 86_400_000;
/** Trades this many days before or after count as "around the same time". */
const REFERENCE_DAYS = 3;

export async function inferLotSizes(db: Db): Promise<{ checked: number; updated: number }> {
  const productIds = (
    await db
      .selectDistinct({ id: priceObservations.productId })
      .from(priceObservations)
      .where(eq(priceObservations.quantityInferred, true))
  ).map((r) => r.id);
  let checked = 0;
  const updates: { id: string; priceJpy: number }[] = [];
  for (let i = 0; i < productIds.length; i += 50) {
    const rows = await db
      .select({
        id: priceObservations.id,
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        observedAt: priceObservations.observedAt,
        priceJpy: priceObservations.priceJpy,
        priceOriginal: priceObservations.priceOriginal,
        quantityInferred: priceObservations.quantityInferred,
      })
      .from(priceObservations)
      .where(
        and(
          inArray(priceObservations.productId, productIds.slice(i, i + 50)),
          eq(priceObservations.observationType, 'sold'),
          eq(priceObservations.excluded, false),
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
          reference: r.quantityInferred ? (r.priceOriginal ?? r.priceJpy) : r.priceJpy,
        }))
        .sort((a, b) => a.t - b.t);
      let from = 0;
      let to = 0;
      for (const [index, trade] of trades.entries()) {
        while (trades[from]!.t < trade.t - REFERENCE_DAYS * DAY) from++;
        while (to < trades.length && trades[to]!.t <= trade.t + REFERENCE_DAYS * DAY) to++;
        if (!trade.quantityInferred || trade.priceOriginal === null) continue;
        checked++;
        const references: number[] = [];
        for (let j = from; j < to; j++) if (j !== index) references.push(trades[j]!.reference);
        const units = estimateLotSize(trade.priceOriginal, references);
        const priceJpy = Math.round(trade.priceOriginal / units);
        if (priceJpy !== trade.priceJpy) updates.push({ id: trade.id, priceJpy });
      }
    }
  }
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    const cases = sql.join(
      chunk.map((u) => sql`when ${u.id} then ${u.priceJpy}`),
      sql` `,
    );
    await db
      .update(priceObservations)
      .set({ priceJpy: sql`case ${priceObservations.id} ${cases} end` })
      .where(
        inArray(
          priceObservations.id,
          chunk.map((u) => u.id),
        ),
      );
  }
  return { checked, updated: updates.length };
}
