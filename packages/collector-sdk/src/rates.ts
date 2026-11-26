import { baseCurrency, ratePair, rateSettingFor, ratedCurrencies, localDate } from '@tora/core';
import { type Db, latestFxDate, loadSourceRegistry, saveFxRates } from '@tora/db';
import { BlockedError, type PoliteHttp } from './http';
import type { SourceLock } from './images';
import type { RateSource } from './types';

/** How far back the first run fills (the item pages compare prices of the last year). */
const HISTORY_DAYS = 400;

/** A client's refusal, read through a call so a check before a request does not narrow it. */
const refusalOf = (http: PoliteHttp) => http.refusal;

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Fetches the days not stored yet of every currency the app needs (its markets' and the ones set
 * in Settings > Markets, incl. ones added there) to the base, from the rate plug-in chosen for it (default: the first
 * covering it); rates typed by hand are left alone. Returns the days saved per pair.
 *
 * Exchange rates are a read of the collect ("Refusals"): a rate site refused today (`leave`) is
 * left out, its lock is taken before its first pair (held by another run: its pairs wait), and a
 * refusal stops that site at once (its client sends nothing more), its pair marked `refused` with
 * the refusal's time, which the caller records as a blocked run of that site; its later pairs are
 * `left`, and the other sites are still read. Each site has its own client (`httpFor`, so its own
 * request cap); without it every site shares `http`. The pairs not read keep their stored rates
 * (`waits`).
 */
export async function updateRates(
  db: Db,
  sources: RateSource[],
  http: PoliteHttp,
  now: Date = new Date(),
  options: {
    /** Sources left alone for the rest of the day (a refusal today). */
    leave?: ReadonlySet<string>;
    lock?: SourceLock;
    /** The client of one rate site (one per site, each with its own cap); default: `http`. */
    httpFor?: (source: string) => PoliteHttp;
  } = {},
): Promise<
  {
    pair: string;
    saved: number;
    latest: string | null;
    source: string | null;
    /**
     * Not read this time: the site refused today or earlier in this call, its lock is held, it
     * refused now, or the client it shares with a site that refused is stopped.
     */
    waits?: 'left' | 'locked' | 'refused' | 'stopped';
    /** `refused`: when the site refused (null: its client does not know). */
    refusedAt?: Date | null;
  }[]
> {
  const registry = await loadSourceRegistry(db);
  const base = baseCurrency(registry);
  const settings = registry.currency ?? { base };
  const today = localDate(now);
  const out = [];
  const locks = new Map<string, { release: () => void } | null>();
  const clients = new Map<string, PoliteHttp>();
  /** Sites refused in this call: their later pairs are left alone, other sites still read. */
  const refused = new Set<string>();
  try {
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
      const key = source.key;
      if (options.leave?.has(key) || refused.has(key)) {
        out.push({ pair, saved: 0, latest, source: key, waits: 'left' as const });
        continue;
      }
      if (options.lock) {
        if (!locks.has(key)) locks.set(key, await options.lock(key));
        if (!locks.get(key)) {
          out.push({ pair, saved: 0, latest, source: key, waits: 'locked' as const });
          continue;
        }
      }
      // The newest stored day is fetched again: a rate published later the same day replaces it.
      const from = latest ?? addDays(today, -HISTORY_DAYS);
      if (!clients.has(key)) clients.set(key, options.httpFor?.(key) ?? http);
      const client = clients.get(key)!;
      // A client shared with a site that refused (no `httpFor`) sends nothing more: the pair waits
      // without naming this site.
      if (client.refusal !== null) {
        out.push({ pair, saved: 0, latest, source: key, waits: 'stopped' as const });
        continue;
      }
      // A refusal, also one the plug-in caught, stops that site: its client sends nothing more,
      // so its pairs after it wait too; the other sites go on.
      const fetched = await source
        .rates(client, { from: code, to: base }, from, today)
        .catch((error: unknown) => {
          if (error instanceof BlockedError || refusalOf(client)) return null;
          throw error;
        });
      // Read again after the request (the check above was before it).
      const refusal = refusalOf(client);
      if (!fetched || refusal) {
        refused.add(key);
        out.push({
          pair,
          saved: 0,
          latest,
          source: key,
          waits: 'refused' as const,
          refusedAt: refusal?.at ?? null,
        });
        continue;
      }
      const rates = fetched.filter(
        (r) => r.date >= from && r.date <= today && Number.isFinite(r.rate) && r.rate > 0,
      );
      const saved = await saveFxRates(db, pair, rates);
      out.push({ pair, saved, latest: rates.at(-1)?.date ?? latest, source: key });
    }
  } finally {
    for (const lock of locks.values()) lock?.release();
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
