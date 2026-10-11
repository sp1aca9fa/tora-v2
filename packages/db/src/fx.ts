import { and, desc, eq, gte, lte, ne } from 'drizzle-orm';
import type { Db } from './client';
import { type Product, fxRates, priceObservations, tcgSets } from './schema';

export interface FxRate {
  date: string;
  rate: number;
}

/** Newest date stored for a pair (e.g. `USDJPY`), or null. */
export async function latestFxDate(db: Db, pair: string): Promise<string | null> {
  const [row] = await db
    .select({ date: fxRates.date })
    .from(fxRates)
    .where(eq(fxRates.pair, pair))
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row?.date ?? null;
}

/** Stores daily rates (a day already stored keeps the newer value). */
export async function saveFxRates(db: Db, pair: string, rates: FxRate[]): Promise<number> {
  for (const r of rates) {
    await db
      .insert(fxRates)
      .values({ pair, date: r.date, rate: r.rate })
      .onConflictDoUpdate({ target: [fxRates.date, fxRates.pair], set: { rate: r.rate } });
  }
  return rates.length;
}

/** The rate in effect on a date: that day's, else the last one before (weekends, holidays). */
export async function fxRateOn(db: Db, pair: string, date: string): Promise<FxRate | null> {
  const [row] = await db
    .select({ date: fxRates.date, rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.pair, pair), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .limit(1);
  return row ?? null;
}

/**
 * A product's set code and release date: its own fields first, else the catalog set it points to,
 * else a catalog set of the same franchise with exactly its set name.
 */
export async function productSetInfo(
  db: Db,
  product: Pick<Product, 'setId' | 'setName' | 'setCode' | 'releaseDate' | 'franchise'>,
): Promise<{ code: string | null; releaseDate: string | null } | null> {
  let set: { code: string | null; releaseDate: string | null } | undefined;
  if (product.setId) {
    [set] = await db
      .select({ code: tcgSets.code, releaseDate: tcgSets.releaseDate })
      .from(tcgSets)
      .where(eq(tcgSets.id, product.setId));
  } else if (product.setName && product.franchise) {
    [set] = await db
      .select({ code: tcgSets.code, releaseDate: tcgSets.releaseDate })
      .from(tcgSets)
      .where(and(eq(tcgSets.franchise, product.franchise), eq(tcgSets.name, product.setName)))
      .limit(1);
  }
  const code = product.setCode ?? set?.code ?? null;
  const releaseDate = product.releaseDate ?? set?.releaseDate ?? null;
  return code || releaseDate ? { code, releaseDate } : null;
}

export interface ForeignPrice {
  source: string;
  title: string | null;
  url: string | null;
  /** In the source's currency (e.g. dollars), and converted to yen with the rate of `fxDate`. */
  price: number;
  currency: string;
  priceJpy: number;
  fxRate: number | null;
  fxDate: string | null;
  observedAt: string;
  /** E.g. TCGplayer's printing ("Holofoil"). */
  variant: string | null;
}

/** Newest price per foreign listing of a product (e.g. TCGplayer), from the last `days`. */
export async function foreignPrices(
  db: Db,
  productId: string,
  now: Date = new Date(),
  days = 14,
): Promise<ForeignPrice[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = await db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.excluded, false),
        ne(priceObservations.currency, 'JPY'),
        gte(priceObservations.fetchedAt, since),
      ),
    )
    .orderBy(desc(priceObservations.observedAt));
  const seen = new Set<string>();
  const out: ForeignPrice[] = [];
  for (const o of rows) {
    const raw = (o.raw ?? {}) as { subType?: string; fxDate?: string };
    const key = `${o.source}|${o.url}|${raw.subType ?? ''}`;
    if (seen.has(key) || o.priceOriginal === null || !o.currency) continue;
    seen.add(key);
    out.push({
      source: o.source,
      title: o.title,
      url: o.url,
      price: o.priceOriginal / 100,
      currency: o.currency,
      priceJpy: o.priceJpy,
      fxRate: o.fxRate,
      fxDate: raw.fxDate ?? null,
      observedAt: o.observedAt,
      variant: raw.subType ?? null,
    });
  }
  return out;
}
