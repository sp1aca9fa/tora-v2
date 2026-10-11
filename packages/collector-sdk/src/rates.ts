import { tokyoDate } from '@tora/core';
import { type Db, latestFxDate, saveFxRates } from '@tora/db';
import type { PoliteHttp } from './http';
import type { RateSource } from './types';

/** How far back the first run fills (the item pages compare prices of the last year). */
const HISTORY_DAYS = 400;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Fetches the days not stored yet for every rate source; returns the number of days saved. */
export async function updateRates(
  db: Db,
  sources: RateSource[],
  http: PoliteHttp,
  now: Date = new Date(),
): Promise<{ pair: string; saved: number; latest: string | null }[]> {
  const today = tokyoDate(now);
  const out = [];
  for (const source of sources) {
    const latest = await latestFxDate(db, source.pair);
    // The newest stored day is fetched again: a rate published later the same day replaces it.
    const from = latest ?? addDays(today, -HISTORY_DAYS);
    const rates = (await source.rates(http, from, today)).filter(
      (r) => r.date >= from && r.date <= today && Number.isFinite(r.rate) && r.rate > 0,
    );
    const saved = await saveFxRates(db, source.pair, rates);
    out.push({ pair: source.pair, saved, latest: rates.at(-1)?.date ?? latest });
  }
  return out;
}
