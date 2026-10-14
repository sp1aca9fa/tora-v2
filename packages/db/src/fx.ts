import {
  type RateSetting,
  baseCurrency,
  fromMinor,
  marketCurrency,
  ratePair,
  tokyoDate,
} from '@tora/core';
import { and, asc, desc, eq, gt, gte, lte, ne } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry, setCurrencySettings } from './registry';
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

/**
 * The rate in effect on a date: that day's, else the last one before (weekends, holidays), else
 * the first one after (a day before any stored rate, e.g. an old sale and a rate typed today).
 */
export async function fxRateOn(db: Db, pair: string, date: string): Promise<FxRate | null> {
  const [row] = await db
    .select({ date: fxRates.date, rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.pair, pair), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .limit(1);
  if (row) return row;
  const [after] = await db
    .select({ date: fxRates.date, rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.pair, pair), gt(fxRates.date, date)))
    .orderBy(asc(fxRates.date))
    .limit(1);
  return after ?? null;
}

/**
 * Where a currency's rate comes from (Settings > Markets; null: back to the first plug-in covering
 * it). A typed rate is stored as today's rate: it applies from today until changed, earlier days
 * keep theirs.
 */
export async function setRateSetting(
  db: Db,
  code: string,
  setting: RateSetting | null,
  now = new Date(),
): Promise<void> {
  const registry = await loadSourceRegistry(db);
  const base = baseCurrency(registry);
  const rates = { ...registry.currency?.rates };
  if (setting) rates[code] = setting;
  else delete rates[code];
  await setCurrencySettings(db, { ...registry.currency, base, rates });
  if (setting && 'manual' in setting) {
    await saveFxRates(db, ratePair(code, base), [{ date: tokyoDate(now), rate: setting.manual }]);
  }
}

/** Adds a currency to keep rates for (Settings > Markets), or removes one the admin added. */
export async function setExtraCurrency(db: Db, code: string, keep: boolean): Promise<void> {
  const registry = await loadSourceRegistry(db);
  const base = baseCurrency(registry);
  const extra = new Set(registry.currency?.extra ?? []);
  if (keep && code !== base) extra.add(code);
  else extra.delete(code);
  await setCurrencySettings(db, { ...registry.currency, base, extra: [...extra].sort() });
}

/** The newest stored rate of each currency to the base. */
export async function latestRates(db: Db, codes: string[]): Promise<Record<string, FxRate>> {
  const base = baseCurrency(await loadSourceRegistry(db));
  const out: Record<string, FxRate> = {};
  for (const code of codes) {
    const rate = await fxRateOn(db, ratePair(code, base), '9999-12-31');
    if (rate) out[code] = rate;
  }
  return out;
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
  /** In the source's currency (e.g. dollars), and converted to the base with the rate of `fxDate`. */
  price: number;
  currency: string;
  priceBase: number;
  fxRate: number | null;
  fxDate: string | null;
  observedAt: string;
  /** E.g. TCGplayer's printing ("Holofoil") or eBay's condition group ("PSA 10"). */
  variant: string | null;
  /** The condition it prices (e.g. `graded:PSA:10`); null: ungraded / sealed as sold new. */
  bucket: string | null;
  /** How many listings the price summarizes (eBay asks), when it is a summary. */
  count: number | null;
}

/**
 * Newest price per listing of a product in another market's currency than the primary one (e.g.
 * TCGplayer), from the last `days`.
 */
export async function foreignPrices(
  db: Db,
  productId: string,
  now: Date = new Date(),
  days = 14,
): Promise<ForeignPrice[]> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const primary = marketCurrency(await loadSourceRegistry(db));
  const rows = await db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.excluded, false),
        ne(priceObservations.currency, primary),
        gte(priceObservations.fetchedAt, since),
      ),
    )
    .orderBy(desc(priceObservations.observedAt));
  const seen = new Set<string>();
  const out: ForeignPrice[] = [];
  for (const o of rows) {
    const raw = (o.raw ?? {}) as { subType?: string; fxDate?: string; count?: number };
    const key = `${o.source}|${o.url}|${raw.subType ?? ''}`;
    if (seen.has(key) || o.priceOriginal === null || !o.currency) continue;
    seen.add(key);
    out.push({
      source: o.source,
      title: o.title,
      url: o.url,
      price: fromMinor(o.priceOriginal, o.currency),
      currency: o.currency,
      priceBase: o.priceBase,
      fxRate: o.fxRate,
      fxDate: raw.fxDate ?? null,
      observedAt: o.observedAt,
      variant: raw.subType ?? null,
      bucket: o.bucket,
      count: raw.count ?? null,
    });
  }
  return out;
}

/**
 * One estimated price per foreign source, for comparing with Japan in the same condition:
 * its ungraded (or sealed as sold new) prices only, and when there are several (TCGplayer
 * printings, several linked listings) the middle one. `of`: how many prices it was chosen from.
 */
export function foreignEstimates(prices: ForeignPrice[]): (ForeignPrice & { of: number })[] {
  const bySource = new Map<string, ForeignPrice[]>();
  for (const p of prices) {
    if (p.bucket !== null) continue;
    bySource.set(p.source, [...(bySource.get(p.source) ?? []), p]);
  }
  return [...bySource.values()].map((list) => {
    const sorted = list.toSorted((a, b) => a.priceBase - b.priceBase);
    return { ...sorted[Math.floor((sorted.length - 1) / 2)]!, of: sorted.length };
  });
}
