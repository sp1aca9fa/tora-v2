// Valuation rules (requirements section 6). Pure: callers pass the observations and prices.
import { median } from './market';

export interface ValuationObservation {
  source: string;
  bucket: string | null;
  priceJpy: number;
  observedAt: string;
  observationType: 'sold' | 'listing' | 'buylist' | 'retail';
  excluded?: boolean | null;
}

export interface ManualPriceInput {
  bucket: string;
  priceJpy: number;
  setAt: string;
}

export type ValuationMethod = 'manual' | 'median' | 'retail' | 'none';
export type Confidence = 'high' | 'medium' | 'low';

export interface Valuation {
  /** Value of one unit; null when nothing is known. */
  unitJpy: number | null;
  method: ValuationMethod;
  source: string | null;
  sampleSize: number;
  /** Window used for the median (30, 90 or 180 days). */
  windowDays: number | null;
  /** Newest sample used, and its age in days at `now`. */
  newestAt: string | null;
  ageDays: number | null;
  confidence: Confidence | null;
}

/** Market sources in fallback order; sources not listed come after these. */
export const SOURCE_PRIORITY = ['snkrdunk', 'mercari', 'surugaya'];
export const WINDOWS = [30, 90, 180] as const;
const DAY = 86_400_000;

/** Removes outliers outside 1.5 x IQR (only with 4+ samples, where quartiles mean something). */
export function withoutOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const s = values.toSorted((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return s[lo]! + (s[Math.ceil(i)]! - s[lo]!) * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  return s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
}

const ageDays = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));

function sourceOrder(sources: string[]): string[] {
  const known = SOURCE_PRIORITY.filter((s) => sources.includes(s));
  return [...known, ...sources.filter((s) => !SOURCE_PRIORITY.includes(s)).sort()];
}

/**
 * Value of one unit in a bucket: manual price, else the median of sold observations of the first
 * source that has any (30 days, widened to 90 / 180 when fewer than 3 samples, IQR-filtered),
 * else the retail price, else nothing.
 */
export function valueUnit(input: {
  bucket: string | null;
  observations: readonly ValuationObservation[];
  manualPrices?: readonly ManualPriceInput[];
  retailPriceJpy?: number | null;
  now?: Date;
}): Valuation {
  const now = input.now ?? new Date();
  const none: Valuation = {
    unitJpy: null,
    method: 'none',
    source: null,
    sampleSize: 0,
    windowDays: null,
    newestAt: null,
    ageDays: null,
    confidence: null,
  };

  const manual = input.manualPrices
    ?.filter((m) => m.bucket === input.bucket && Date.parse(m.setAt) <= now.getTime())
    .toSorted((a, b) => b.setAt.localeCompare(a.setAt))[0];
  if (manual) {
    return {
      ...none,
      unitJpy: manual.priceJpy,
      method: 'manual',
      source: 'manual',
      newestAt: manual.setAt,
      ageDays: ageDays(manual.setAt, now),
    };
  }

  if (input.bucket) {
    const sold = input.observations.filter(
      (o) =>
        o.observationType === 'sold' &&
        !o.excluded &&
        o.bucket === input.bucket &&
        Date.parse(o.observedAt) <= now.getTime(),
    );
    for (const source of sourceOrder([...new Set(sold.map((o) => o.source))])) {
      const ofSource = sold.filter((o) => o.source === source);
      const within = (days: number) =>
        ofSource.filter((o) => now.getTime() - Date.parse(o.observedAt) <= days * DAY);
      const window = WINDOWS.find((d) => within(d).length >= 3) ?? 180;
      const samples = within(window);
      if (samples.length === 0) continue;
      const prices = withoutOutliers(samples.map((o) => o.priceJpy));
      const newestAt = samples
        .map((o) => o.observedAt)
        .sort()
        .at(-1)!;
      const recent = within(30).length;
      return {
        unitJpy: Math.round(median(prices)!),
        method: 'median',
        source,
        sampleSize: samples.length,
        windowDays: window,
        newestAt,
        ageDays: ageDays(newestAt, now),
        confidence: recent >= 5 ? 'high' : within(180).length >= 3 ? 'medium' : 'low',
      };
    }
  }

  if (input.retailPriceJpy) {
    return {
      ...none,
      unitJpy: input.retailPriceJpy,
      method: 'retail',
      source: 'retail',
      confidence: 'low',
    };
  }
  return none;
}

/** Latest buylist (買取) price for a bucket: an "instant sell floor", never a market value. */
export function buylistFloor(
  observations: readonly ValuationObservation[],
  bucket: string | null,
  now: Date = new Date(),
): { priceJpy: number; source: string; observedAt: string } | null {
  const latest = observations
    .filter(
      (o) =>
        o.observationType === 'buylist' &&
        !o.excluded &&
        (o.bucket === bucket || o.bucket === null) &&
        now.getTime() - Date.parse(o.observedAt) <= 30 * DAY,
    )
    .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  return latest
    ? { priceJpy: latest.priceJpy, source: latest.source, observedAt: latest.observedAt }
    : null;
}

/** A recent trade as last seen on a source (see product_sources.recent_sales). */
export interface RecentSaleInput {
  source: string;
  bucket: string | null;
  priceJpy: number;
  observedAt: string;
  approximate?: boolean;
}

export interface LastSale {
  source: string;
  priceJpy: number;
  observedAt: string;
  approximate: boolean;
}

/** Newest real sale in the bucket, from stored history or the fresher recent trades. */
export function lastSale(
  observations: readonly ValuationObservation[],
  recent: readonly RecentSaleInput[],
  bucket: string | null,
  source?: string,
  now: Date = new Date(),
): LastSale | null {
  if (!bucket) return null;
  const candidates: LastSale[] = [
    ...observations
      .filter((o) => o.observationType === 'sold' && !o.excluded && o.bucket === bucket)
      .map((o) => ({
        source: o.source,
        priceJpy: o.priceJpy,
        observedAt: o.observedAt,
        approximate: false,
      })),
    ...recent
      .filter((r) => r.bucket === bucket)
      .map((r) => ({
        source: r.source,
        priceJpy: r.priceJpy,
        observedAt: r.observedAt,
        approximate: Boolean(r.approximate),
      })),
  ].filter((s) => (!source || s.source === source) && Date.parse(s.observedAt) <= now.getTime());
  return candidates.toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null;
}

export interface SourceSummary {
  source: string;
  last: LastSale | null;
  /** Median in the bucket for this source (same windows and IQR as valuation). */
  medianJpy: number | null;
  sampleSize: number;
  windowDays: number | null;
  confidence: Confidence | null;
  /** Last sale vs median, in percent (positive: the last sale was above the median). */
  trendPct: number | null;
}

/** One summary per source with data in the bucket, in fallback order. */
export function sourceSummaries(
  observations: readonly ValuationObservation[],
  recent: readonly RecentSaleInput[],
  bucket: string | null,
  now: Date = new Date(),
): SourceSummary[] {
  if (!bucket) return [];
  const sources = new Set([
    ...observations
      .filter((o) => o.observationType === 'sold' && o.bucket === bucket)
      .map((o) => o.source),
    ...recent.filter((r) => r.bucket === bucket).map((r) => r.source),
  ]);
  return sourceOrder([...sources]).map((source) => {
    const v = valueUnit({
      bucket,
      observations: observations.filter((o) => o.source === source),
      now,
    });
    const last = lastSale(observations, recent, bucket, source, now);
    return {
      source,
      last,
      medianJpy: v.method === 'median' ? v.unitJpy : null,
      sampleSize: v.sampleSize,
      windowDays: v.windowDays,
      confidence: v.confidence,
      trendPct: trend(last?.priceJpy, v.method === 'median' ? v.unitJpy : null),
    };
  });
}

export function trend(
  last: number | null | undefined,
  typical: number | null | undefined,
): number | null {
  if (!last || !typical) return null;
  return Math.round(((last - typical) / typical) * 1000) / 10;
}
