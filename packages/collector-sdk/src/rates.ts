import { baseCurrency, ratePair, rateSettingFor, ratedCurrencies, localDate } from '@tora/core';
import { type Db, latestFxDate, loadSourceRegistry, saveFxRates } from '@tora/db';
import type { PoliteHttp } from './http';
import type { RateSource } from './types';

/** How far back the first run fills (the item pages compare prices of the last year). */
const HISTORY_DAYS = 400;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Fetches the days not stored yet of every currency the app needs (its markets' and the ones set
 * in Settings > Markets, incl. ones added there) to the base, from the rate plug-in chosen for it (default: the first
 * covering it); rates typed by hand are left alone. Returns the days saved per pair.
 */
export async function updateRates(
  db: Db,
  sources: RateSource[],
  http: PoliteHttp,
  now: Date = new Date(),
): Promise<{ pair: string; saved: number; latest: string | null; source: string | null }[]> {
  const registry = await loadSourceRegistry(db);
  const base = baseCurrency(registry);
  const settings = registry.currency ?? { base };
  const today = localDate(now);
  const out = [];
  for (const code of ratedCurrencies(settings, registry.sources)) {
    const pair = ratePair(code, base);
    const setting = rateSettingFor(settings, sources, code);
    if (setting && 'manual' in setting) continue;
    const source = sources.find((s) => s.key === setting?.source);
    const latest = await latestFxDate(db, pair);
    if (!source) {
      out.push({ pair, saved: 0, latest, source: null });
      continue;
    }
    // The newest stored day is fetched again: a rate published later the same day replaces it.
    const from = latest ?? addDays(today, -HISTORY_DAYS);
    const rates = (await source.rates(http, { from: code, to: base }, from, today)).filter(
      (r) => r.date >= from && r.date <= today && Number.isFinite(r.rate) && r.rate > 0,
    );
    const saved = await saveFxRates(db, pair, rates);
    out.push({ pair, saved, latest: rates.at(-1)?.date ?? latest, source: source.key });
  }
  return out;
}

/** A fetched rate this many days old is reported by the collect (it is still used). */
export const STALE_RATE_DAYS = 7;

/**
 * Fetched rates whose latest stored day is more than `STALE_RATE_DAYS` before today: prices keep
 * being converted with it (S16), so the collect says so. Typed rates apply until changed and are
 * left out; a pair with no rate at all is reported by `updateRates`.
 */
export async function staleRates(
  db: Db,
  sources: RateSource[],
  now: Date = new Date(),
): Promise<{ from: string; to: string; latest: string; days: number }[]> {
  const registry = await loadSourceRegistry(db);
  const base = baseCurrency(registry);
  const settings = registry.currency ?? { base };
  const today = localDate(now);
  const out = [];
  for (const code of ratedCurrencies(settings, registry.sources)) {
    const setting = rateSettingFor(settings, sources, code);
    if (setting && 'manual' in setting) continue;
    const latest = await latestFxDate(db, ratePair(code, base));
    if (!latest) continue;
    const days = Math.round((Date.parse(today) - Date.parse(latest)) / 86_400_000);
    if (days > STALE_RATE_DAYS) out.push({ from: code, to: base, latest, days });
  }
  return out;
}
