import { describe, expect, it } from 'vitest';
import {
  type ValuationObservation,
  buylistFloor,
  lastSale,
  sourceSummaries,
  valueUnit,
  withoutOutliers,
} from './valuation';

const now = new Date('2026-10-10T03:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const sold = (
  source: string,
  price: number,
  ago: number,
  bucket = 'sealed:shrink',
): ValuationObservation => ({
  source,
  bucket,
  priceJpy: price,
  observedAt: daysAgo(ago),
  observationType: 'sold',
});

describe('withoutOutliers', () => {
  it('drops values outside 1.5 IQR, only with 4+ samples', () => {
    expect(withoutOutliers([10, 11, 12, 13, 100])).toEqual([10, 11, 12, 13]);
    expect(withoutOutliers([1, 100, 1000])).toEqual([1, 100, 1000]);
  });
});

describe('valueUnit', () => {
  it('counts samples whose lot size was estimated', () => {
    const obs = [10_000, 10_200, 9_800].map((p, i) => ({
      ...sold('snkrdunk', p, i + 1),
      quantityInferred: i < 2,
    }));
    const v = valueUnit({ bucket: 'sealed:shrink', observations: obs, now });
    expect(v).toMatchObject({ method: 'median', sampleSize: 3, estimatedSamples: 2 });
  });

  it('uses the 30-day median with high confidence when there are 5+ recent sales', () => {
    const obs = [10_000, 10_200, 9_800, 10_100, 9_900, 50_000].map((p, i) =>
      sold('snkrdunk', p, i + 1),
    );
    const v = valueUnit({ bucket: 'sealed:shrink', observations: obs, now });
    expect(v).toMatchObject({
      unitJpy: 10_000,
      method: 'median',
      source: 'snkrdunk',
      windowDays: 30,
      confidence: 'high',
      ageDays: 1,
    });
    expect(v.sampleSize).toBe(6);
  });

  it('widens the window to 90 then 180 days when there are fewer than 3 samples', () => {
    const v90 = valueUnit({
      bucket: 'sealed:shrink',
      observations: [sold('snkrdunk', 1, 10), sold('snkrdunk', 2, 50), sold('snkrdunk', 3, 80)],
      now,
    });
    expect(v90).toMatchObject({ windowDays: 90, unitJpy: 2, confidence: 'medium' });
    const v180 = valueUnit({
      bucket: 'sealed:shrink',
      observations: [sold('snkrdunk', 5, 100), sold('snkrdunk', 7, 170)],
      now,
    });
    expect(v180).toMatchObject({ windowDays: 180, unitJpy: 6, confidence: 'low', sampleSize: 2 });
  });

  it('ignores other buckets, excluded and future observations', () => {
    const v = valueUnit({
      bucket: 'raw:A',
      observations: [
        sold('snkrdunk', 999, 1, 'graded:PSA:10'),
        { ...sold('snkrdunk', 888, 1, 'raw:A'), excluded: true },
        sold('snkrdunk', 777, -2, 'raw:A'),
        sold('snkrdunk', 500, 3, 'raw:A'),
      ],
      now,
    });
    expect(v).toMatchObject({ unitJpy: 500, sampleSize: 1 });
  });

  it('falls back by source: SNKRDUNK, then Mercari, then 駿河屋, then retail', () => {
    expect(
      valueUnit({
        bucket: 'cond:new',
        observations: [sold('mercari', 3000, 2, 'cond:new'), sold('snkrdunk', 1, 400, 'cond:new')],
        now,
      }).source,
    ).toBe('mercari');
    expect(
      valueUnit({
        bucket: 'cond:new',
        observations: [sold('surugaya', 4000, 2, 'cond:new'), sold('mercari', 3000, 2, 'cond:new')],
        now,
      }).source,
    ).toBe('mercari');
    expect(
      valueUnit({ bucket: 'cond:new', observations: [], retailPriceJpy: 8980, now }),
    ).toMatchObject({ method: 'retail', unitJpy: 8980, confidence: 'low' });
    expect(valueUnit({ bucket: null, observations: [], now })).toMatchObject({
      method: 'none',
      unitJpy: null,
    });
  });

  it('a manual price always wins (latest one for the bucket)', () => {
    const v = valueUnit({
      bucket: 'sealed:box_opened_contents_sealed',
      observations: [sold('snkrdunk', 1, 1, 'sealed:box_opened_contents_sealed')],
      manualPrices: [
        { bucket: 'sealed:box_opened_contents_sealed', priceJpy: 9000, setAt: daysAgo(10) },
        { bucket: 'sealed:box_opened_contents_sealed', priceJpy: 9500, setAt: daysAgo(2) },
        { bucket: 'sealed:shrink', priceJpy: 1, setAt: daysAgo(1) },
      ],
      now,
    });
    expect(v).toMatchObject({ method: 'manual', unitJpy: 9500, ageDays: 2 });
  });
});

describe('buylistFloor', () => {
  it('returns the latest buylist price, separate from market value', () => {
    const obs: ValuationObservation[] = [
      { ...sold('surugaya', 7000, 3), observationType: 'buylist' },
      { ...sold('surugaya', 6500, 10), observationType: 'buylist' },
    ];
    expect(buylistFloor(obs, 'sealed:shrink', now)?.priceJpy).toBe(7000);
    expect(valueUnit({ bucket: 'sealed:shrink', observations: obs, now }).method).toBe('none');
  });
});

describe('last sale and per-source summaries', () => {
  const obs = [
    sold('snkrdunk', 10_000, 6),
    sold('snkrdunk', 10_400, 7),
    sold('snkrdunk', 9_800, 8),
    sold('mercari', 9_000, 3),
  ];
  const recent = [
    {
      source: 'snkrdunk',
      bucket: 'sealed:shrink',
      priceJpy: 10_800,
      observedAt: daysAgo(0.2),
      approximate: true,
    },
    {
      source: 'snkrdunk',
      bucket: 'sealed:no_shrink',
      priceJpy: 8_000,
      observedAt: daysAgo(0.1),
      approximate: true,
    },
  ];

  it('takes the newest real sale in the bucket, including fresh recent trades', () => {
    expect(lastSale(obs, recent, 'sealed:shrink', undefined, now)).toMatchObject({
      priceJpy: 10_800,
      approximate: true,
    });
    expect(lastSale(obs, [], 'sealed:shrink', 'mercari', now)).toMatchObject({
      priceJpy: 9_000,
      approximate: false,
    });
    expect(lastSale(obs, recent, null, undefined, now)).toBeNull();
  });

  it('summarizes each source with its median and the last sale trend', () => {
    const s = sourceSummaries(obs, recent, 'sealed:shrink', now);
    expect(s.map((x) => x.source)).toEqual(['snkrdunk', 'mercari']);
    expect(s[0]).toMatchObject({
      medianJpy: 10_000,
      sampleSize: 3,
      last: { priceJpy: 10_800 },
      trendPct: 8,
    });
    expect(s[1]).toMatchObject({ medianJpy: 9_000, sampleSize: 1, trendPct: 0 });
  });
});
