import { describe, expect, it } from 'vitest';
import {
  type ValuationObservation,
  buylistFloor,
  lastSale,
  sourceSummaries,
  valueUnit,
  withoutExcludedTrades,
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
  priceBase: price,
  observedAt: daysAgo(ago),
  observationType: 'sold',
});

describe('withoutOutliers', () => {
  it('drops values outside 1.5 IQR, only with 4+ samples', () => {
    expect(withoutOutliers([10, 11, 12, 13, 100])).toEqual([10, 11, 12, 13]);
    expect(withoutOutliers([1, 100, 1000])).toEqual([1, 100, 1000]);
  });
});

describe('valueUnit fallbacks for rare items', () => {
  const at = (source: string, price: number, ago: number, bucket: string) =>
    sold(source, price, ago, bucket);

  it('looks back a year before pooling conditions', () => {
    const obs = [
      at('mercari', 30_000, 20, 'cond:like_new'),
      at('mercari', 26_000, 250, 'cond:like_new'),
      at('mercari', 28_000, 300, 'cond:like_new'),
    ];
    expect(valueUnit({ bucket: 'cond:like_new', observations: obs, now })).toMatchObject({
      unitBase: 28_000,
      windowDays: 365,
      pooled: false,
      confidence: 'low',
    });
  });

  it('pools similar conditions, never graded slabs', () => {
    const obs = [
      at('mercari', 30_000, 20, 'cond:like_new'),
      at('mercari', 22_000, 40, 'cond:good'),
      at('mercari', 25_000, 60, 'cond:fair'),
    ];
    expect(valueUnit({ bucket: 'cond:like_new', observations: obs, now })).toMatchObject({
      unitBase: 25_000,
      sampleSize: 3,
      pooled: true,
      confidence: 'low',
    });
    const slabs = [
      at('snkrdunk', 10_000, 5, 'graded:PSA:10'),
      at('snkrdunk', 4_000, 6, 'graded:PSA:9'),
      at('snkrdunk', 4_100, 7, 'graded:PSA:9'),
      at('snkrdunk', 4_200, 8, 'graded:PSA:9'),
    ];
    expect(valueUnit({ bucket: 'graded:PSA:10', observations: slabs, now })).toMatchObject({
      unitBase: 10_000,
      sampleSize: 1,
      pooled: false,
    });
  });

  it('prefers a source with enough sales over one with a single sale', () => {
    const obs = [
      at('snkrdunk', 9_000, 5, 'cond:new'),
      at('mercari', 3_000, 5, 'cond:new'),
      at('mercari', 3_100, 6, 'cond:new'),
      at('mercari', 2_900, 7, 'cond:new'),
    ];
    expect(valueUnit({ bucket: 'cond:new', observations: obs, now })).toMatchObject({
      source: 'mercari',
      unitBase: 3_000,
    });
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
      unitBase: 10_000,
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
    expect(v90).toMatchObject({ windowDays: 90, unitBase: 2, confidence: 'medium' });
    const v180 = valueUnit({
      bucket: 'sealed:shrink',
      observations: [sold('snkrdunk', 5, 100), sold('snkrdunk', 7, 170)],
      now,
    });
    expect(v180).toMatchObject({ windowDays: 180, unitBase: 6, confidence: 'low', sampleSize: 2 });
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
    expect(v).toMatchObject({ unitBase: 500, sampleSize: 1 });
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
      valueUnit({ bucket: 'cond:new', observations: [], retailPriceBase: 8980, now }),
    ).toMatchObject({ method: 'retail', unitBase: 8980, confidence: 'low' });
    expect(valueUnit({ bucket: null, observations: [], now })).toMatchObject({
      method: 'none',
      unitBase: null,
    });
  });

  it("uses a shop's asking price only when no source has a sale, before the retail price", () => {
    const store = (price: number, ago: number, bucket = 'cond:good'): ValuationObservation => ({
      source: 'surugaya',
      bucket,
      priceBase: price,
      observedAt: daysAgo(ago),
      observationType: 'listing',
    });
    const v = valueUnit({
      bucket: 'cond:good',
      observations: [store(4180, 1), store(3900, 9), store(9000, 0, 'cond:new'), store(100, 40)],
      retailPriceBase: 8778,
      now,
    });
    expect(v).toMatchObject({
      unitBase: 4180,
      method: 'store',
      source: 'surugaya',
      confidence: 'low',
    });
    // Any sale wins, however old.
    expect(
      valueUnit({
        bucket: 'cond:good',
        observations: [store(4180, 1), sold('mercari', 3000, 300, 'cond:good')],
        now,
      }),
    ).toMatchObject({ unitBase: 3000, method: 'median' });
    // Too old: the retail price.
    expect(
      valueUnit({
        bucket: 'cond:good',
        observations: [store(4180, 31)],
        retailPriceBase: 8778,
        now,
      }),
    ).toMatchObject({ method: 'retail' });
  });

  it('a manual price always wins (latest one for the bucket)', () => {
    const v = valueUnit({
      bucket: 'sealed:box_opened_contents_sealed',
      observations: [sold('snkrdunk', 1, 1, 'sealed:box_opened_contents_sealed')],
      manualPrices: [
        { bucket: 'sealed:box_opened_contents_sealed', priceBase: 9000, setAt: daysAgo(10) },
        { bucket: 'sealed:box_opened_contents_sealed', priceBase: 9500, setAt: daysAgo(2) },
        { bucket: 'sealed:shrink', priceBase: 1, setAt: daysAgo(1) },
      ],
      now,
    });
    expect(v).toMatchObject({ method: 'manual', unitBase: 9500, ageDays: 2 });
  });
});

describe('buylistFloor', () => {
  it('returns the latest buylist price, separate from market value', () => {
    const obs: ValuationObservation[] = [
      { ...sold('surugaya', 7000, 3), observationType: 'buylist' },
      { ...sold('surugaya', 6500, 10), observationType: 'buylist' },
    ];
    expect(buylistFloor(obs, 'sealed:shrink', now)?.priceBase).toBe(7000);
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
      priceBase: 10_800,
      observedAt: daysAgo(0.2),
      approximate: true,
    },
    {
      source: 'snkrdunk',
      bucket: 'sealed:no_shrink',
      priceBase: 8_000,
      observedAt: daysAgo(0.1),
      approximate: true,
    },
  ];

  it('takes the newest real sale in the bucket, including fresh recent trades', () => {
    expect(lastSale(obs, recent, 'sealed:shrink', undefined, now)).toMatchObject({
      priceBase: 10_800,
      approximate: true,
    });
    expect(lastSale(obs, [], 'sealed:shrink', 'mercari', now)).toMatchObject({
      priceBase: 9_000,
      approximate: false,
    });
    expect(lastSale(obs, recent, null, undefined, now)).toBeNull();
  });

  it('summarizes each source with its median and the last sale trend', () => {
    const s = sourceSummaries(obs, recent, 'sealed:shrink', now, ['snkrdunk', 'mercari']);
    expect(s.map((x) => x.source)).toEqual(['snkrdunk', 'mercari']);
    expect(s[0]).toMatchObject({
      medianBase: 10_000,
      sampleSize: 3,
      last: { priceBase: 10_800 },
      trendPct: 8,
    });
    expect(s[1]).toMatchObject({ medianBase: 9_000, sampleSize: 1, trendPct: 0 });
  });
});

describe('withoutExcludedTrades (case V21)', () => {
  const trade = (source: string, priceBase: number, observedAt: string, bucket = 'raw:A') => ({
    source,
    bucket,
    priceBase,
    observedAt,
  });
  it('drops one trade per sale marked excluded with the same source, condition, price and time', () => {
    const at = '2026-10-09T12:00:00.000Z';
    const recent = [
      trade('snkrdunk', 5000, at),
      trade('snkrdunk', 5000, at),
      trade('snkrdunk', 5000, at, 'raw:B'),
      trade('snkrdunk', 5001, at),
      trade('mercari', 5000, at),
      trade('snkrdunk', 4000, daysAgo(2)),
    ];
    // The same instant written with an offset is the same time.
    const left = withoutExcludedTrades(recent, [
      trade('snkrdunk', 5000, '2026-10-09T21:00:00+09:00'),
    ]);
    expect(left).toEqual([recent[1], recent[2], recent[3], recent[4], recent[5]]);
    expect(withoutExcludedTrades(recent, [])).toEqual(recent);
    expect(withoutExcludedTrades([], [trade('snkrdunk', 5000, at)])).toEqual([]);
    // The last sale then skips it.
    const last = lastSale(
      [],
      withoutExcludedTrades(
        [trade('snkrdunk', 9000, at), trade('snkrdunk', 3000, daysAgo(2))],
        [trade('snkrdunk', 9000, at)],
      ),
      'raw:A',
      undefined,
      now,
    );
    expect(last?.priceBase).toBe(3000);
  });

  it('matches an approximate time within a day, nearest first, one trade per sale', () => {
    const h = 3_600_000;
    const sale = '2026-10-09T12:00:00.000Z';
    const at = (hours: number) => new Date(Date.parse(sale) + hours * h).toISOString();
    const approx = (priceBase: number, hours: number, bucket = 'raw:A') => ({
      ...trade('flea', priceBase, at(hours), bucket),
      approximate: true,
    });
    // Read again the next night: "N hours ago" from a later clock moved the time by 5 hours.
    const recent = [approx(50_000, 5), approx(50_000, -2), approx(50_000, 30), approx(40_000, 0)];
    expect(withoutExcludedTrades(recent, [trade('flea', 50_000, sale)], now)).toEqual([
      recent[0],
      recent[2],
      recent[3],
    ]);
    // Two sales: the two nearest trades go; one more than a day off stays.
    expect(
      withoutExcludedTrades(
        recent,
        [trade('flea', 50_000, sale), trade('flea', 50_000, at(4))],
        now,
      ),
    ).toEqual([recent[2], recent[3]]);
    // An exact-time trade is not moved: a few hours off is another trade.
    expect(
      withoutExcludedTrades([trade('flea', 50_000, at(5))], [trade('flea', 50_000, sale)], now),
    ).toHaveLength(1);
    // Another condition, a garbled time: no match.
    expect(
      withoutExcludedTrades([approx(50_000, 1, 'raw:B')], [trade('flea', 50_000, sale)], now),
    ).toHaveLength(1);
    expect(
      withoutExcludedTrades([approx(50_000, 1)], [trade('flea', 50_000, 'garbled')], now),
    ).toHaveLength(1);
  });

  it('matches an approximate trade over 30 days old within 30 days, nearest first', () => {
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    const approx = (priceBase: number, days: number) => ({
      ...trade('flea', priceBase, at(days)),
      approximate: true,
    });
    // Stored as "20日前"; read again later as "1ヶ月前": 24 days off, still that sale.
    const sale = trade('flea', 50_000, at(55));
    const recent = [approx(50_000, 31), approx(50_000, 56), approx(50_000, 90)];
    expect(withoutExcludedTrades(recent, [sale], now)).toEqual([recent[0], recent[2]]);
    expect(withoutExcludedTrades([recent[0]!], [sale], now)).toEqual([]);
    // 35 days off is another trade; under 30 days old the window stays 1 day.
    expect(
      withoutExcludedTrades([approx(50_000, 31)], [trade('flea', 50_000, at(66))], now),
    ).toHaveLength(1);
    expect(
      withoutExcludedTrades([approx(50_000, 20)], [trade('flea', 50_000, at(22))], now),
    ).toHaveLength(1);
    expect(
      withoutExcludedTrades([approx(50_000, 20)], [trade('flea', 50_000, at(20.5))], now),
    ).toEqual([]);
    // An exact time never gets the window.
    expect(
      withoutExcludedTrades([trade('flea', 50_000, at(40))], [trade('flea', 50_000, at(45))], now),
    ).toHaveLength(1);
  });
});
