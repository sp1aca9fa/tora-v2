// Money (requirements S16, base currency): every stored amount is a whole number in the base
// currency's smallest unit (yen: 1 yen, euro: 1 cent). Prices in other currencies are converted
// with the day's exchange rate when they are collected.

/** Base of a setup that never chose one (Tora started in Japan). */
export const DEFAULT_BASE = 'JPY';

/**
 * How a currency gets its exchange rate to the base: a rate plug-in (by key) or a rate the admin
 * typed (units of the base per unit of the currency), used until changed.
 */
export type RateSetting = { source: string } | { manual: number };

/** The admin's currency settings (app_settings `currency`). */
export interface CurrencySettings {
  /** ISO 4217 code every amount is stored in; changed only by `pnpm base-currency`. */
  base: string;
  /** Per currency (ISO 4217): where its rate comes from; not set: the first plug-in covering it. */
  rates?: Record<string, RateSetting>;
}

/** A rate plug-in as the app sees it (saved by the collectors). */
export interface RateSourceInfo {
  key: string;
  label: string;
  /** Currencies it has rates between (ISO 4217). */
  currencies: string[];
}

const digitsCache = new Map<string, number>();

/** Digits after the decimal point of a currency's smallest unit (JPY 0, EUR 2). */
export function currencyDigits(code: string): number {
  let d = digitsCache.get(code);
  if (d === undefined) {
    try {
      d =
        new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      d = 2;
    }
    digitsCache.set(code, d);
  }
  return d;
}

/** An amount typed or read in whole units (12.5 euros) to the smallest unit (1250). */
export const toMinor = (amount: number, code: string) =>
  Math.round(amount * 10 ** currencyDigits(code));

/** An amount in the smallest unit (1250) to whole units (12.5). */
export const fromMinor = (minor: number, code: string) => minor / 10 ** currencyDigits(code);

/** Stored pair name of a rate: units of `to` per unit of `from` (e.g. `USDJPY`: yen per dollar). */
export const ratePair = (from: string, to: string) => `${from}${to}`;

/** An amount in `from`'s smallest unit converted to `to`'s, at `rate` units of `to` per `from`. */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from === to) return minor;
  return toMinor(fromMinor(minor, from) * rate, to);
}

/** The settings with what is not set filled in. */
export function resolveCurrency(saved: Partial<CurrencySettings> | null | undefined) {
  return { base: saved?.base || DEFAULT_BASE, rates: saved?.rates ?? {} };
}

/** Where a currency's rate comes from: the admin's choice, else the first plug-in covering it. */
export function rateSettingFor(
  settings: CurrencySettings,
  plugins: RateSourceInfo[],
  code: string,
): RateSetting | null {
  const chosen = settings.rates?.[code];
  if (chosen && ('manual' in chosen || plugins.some((p) => p.key === chosen.source))) return chosen;
  const covering = plugins.find(
    (p) => p.currencies.includes(code) && p.currencies.includes(settings.base),
  );
  return covering ? { source: covering.key } : null;
}
