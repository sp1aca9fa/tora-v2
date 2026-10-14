import { baseCurrency, convertMinor, ratePair, tokyoDate } from '@tora/core';
import { type Db, fxRateOn, loadSourceRegistry } from '@tora/db';

/** A currency has no stored rate to the base yet (Settings > Markets sets where it comes from). */
export class MissingRateError extends Error {
  constructor(from: string, to: string) {
    super(`no ${from} to ${to} exchange rate stored yet (Settings > Markets)`);
  }
}

export interface Converted {
  /** In the base currency's smallest unit. */
  amount: number;
  /** Units of the base per unit of the currency; null when it was the base already. */
  rate: number | null;
  /** The day of the rate used. */
  rateDate: string | null;
}

/**
 * Converts plug-in amounts (in their own currency) to the base currency with the rate of their
 * day (S16): what the collect does at its boundary, so plug-ins never need to know the base.
 */
export async function baseConverter(db: Db) {
  const base = baseCurrency(await loadSourceRegistry(db));
  const rates = new Map<string, Promise<{ date: string; rate: number } | null>>();
  const convert = async (
    minor: number,
    currency: string | null | undefined,
    at: string | Date,
  ): Promise<Converted> => {
    if (!currency || currency === base) return { amount: minor, rate: null, rateDate: null };
    const day = tokyoDate(typeof at === 'string' ? new Date(at) : at);
    const key = `${currency}|${day}`;
    if (!rates.has(key)) rates.set(key, fxRateOn(db, ratePair(currency, base), day));
    const rate = await rates.get(key)!;
    if (!rate) throw new MissingRateError(currency, base);
    return {
      amount: convertMinor(minor, currency, base, rate.rate),
      rate: rate.rate,
      rateDate: rate.date,
    };
  };
  return Object.assign(convert, { base });
}

export type BaseConverter = Awaited<ReturnType<typeof baseConverter>>;
