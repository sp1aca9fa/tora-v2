import { INSIGHT_PERIODS, localDate } from '@tora/core';
import { saveSourceInfos } from './registry';
import { TEST_SOURCES } from './testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import {
  addPull,
  createHolding,
  editHolding,
  markOpened,
  sellHolding,
  setLotTracking,
} from './mutations';
import { insertObservations } from './sources';
import { createUser } from './users';
import {
  boxView,
  estimatedPullCosts,
  clearManualPrice,
  loadMarketData,
  moversByPeriod,
  tradeCounts,
  portfolioSeries,
  portfolioValuation,
  withLivePoint,
  priceHistory,
  runSnapshots,
  summarizeByProduct,
  setManualPrice,
  refreshBucketValues,
  valueHolding,
  valueHoldings,
} from './valuation';
import { refreshItemSales } from './item-sales';
import { holdings, portfolioCharts, priceObservations, products } from './schema';
import { and, eq } from 'drizzle-orm';
import { setObservationExcluded } from './sources';

let db: Db;
let uid: string;
const now = new Date('2026-10-10T03:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-val-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  uid = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

let ref = 0;
const sold = (productId: string, bucket: string, price: number, daysAgo: number) => ({
  productId,
  source: 'snkrdunk',
  observationType: 'sold' as const,
  bucket,
  priceBase: price,
  observedAt: ago(daysAgo),
  fetchedAt: now.toISOString(),
  externalRef: `r${ref++}`,
});

async function scenario() {
  // Scenario 4-5: box opened by the clerk (packs sealed), cards pulled, box then opened.
  const box = await createHolding(
    db,
    uid,
    { product: { category: 'tcg', kind: 'booster_box', name: 'BP BOX', setName: 'BP' } },
    {
      quantity: 1,
      costTotalBase: 5_400,
      acquiredAt: ago(60),
      packagingState: 'box_opened_contents_sealed',
    },
  );
  const pika = await addPull(
    db,
    uid,
    box.holding.id,
    { card: { name: 'ピカチュウ' } },
    { quantity: 1, rawGrade: 'A', acquiredAt: ago(59) },
  );
  const mew = await addPull(
    db,
    uid,
    box.holding.id,
    { card: { name: 'ミュウ' } },
    { quantity: 2, rawGrade: 'A', acquiredAt: ago(59) },
  );
  await markOpened(db, uid, box.holding.id, {
    quantity: 1,
    packagingState: 'opened',
    occurredAt: ago(59),
  });

  const amiibo = await createHolding(
    db,
    uid,
    { product: { category: 'game', kind: 'amiibo', name: 'Link', retailPriceBase: 3_300 } },
    { quantity: 3, costTotalBase: 9_900, acquiredAt: ago(30), condition: 'new_unused' },
  );

  await insertObservations(db, [
    ...[10_000, 10_400, 9_800, 10_200, 10_100].map((p, i) =>
      sold(box.product.id, 'sealed:shrink', p, i + 2),
    ),
    ...[3_000, 3_200, 3_100].map((p, i) => sold(pika.product.id, 'raw:A', p, i + 1)),
    ...[800, 900, 1_000, 950, 20_000].map((p, i) => sold(mew.product.id, 'raw:A', p, i + 1)),
    // History for the chart: a week ago the cards sold lower.
    sold(pika.product.id, 'raw:A', 2_000, 40),
  ]);
  await refreshItemSales(db);
  return { box, pika, mew, amiibo };
}

describe('box view (scenario 5)', () => {
  it('values the box as received, the pulls, and the net', async () => {
    const { box } = await scenario();
    const view = await boxView(db, uid, box.holding.id, now);
    expect(view?.receivedState).toBe('box_opened_contents_sealed');
    // No market data for opened-box-with-sealed-packs: not valued as a shrink-wrapped box.
    expect(view?.asReceived).toMatchObject({
      bucket: 'sealed:box_opened_contents_sealed',
      valueBase: null,
    });
    expect(view?.paidBase).toBe(5_400);
    // ピカチュウ 3,100 + ミュウ 925 (IQR drops 20,000) x 2
    expect(view?.pullsValueBase).toBe(3_100 + 925 * 2);
    expect(view?.netBase).toBe(3_100 + 925 * 2 - 5_400);

    await setManualPrice(db, uid, box.product.id, 'sealed:box_opened_contents_sealed', 9_000);
    // The manual price is set at the real current time, so value at the real time too.
    const withManual = await boxView(db, uid, box.holding.id, new Date());
    expect(withManual?.asReceived).toMatchObject({ method: 'manual', valueBase: 9_000 });
    await clearManualPrice(db, uid, box.product.id, 'sealed:box_opened_contents_sealed');
    expect((await boxView(db, uid, box.holding.id, now))?.asReceived.valueBase).toBeNull();
  });
});

describe('portfolio (scenario 7)', () => {
  it('totals spent, value and unrealized P/L over owned holdings', async () => {
    const { amiibo } = await scenario();
    const p = await portfolioValuation(db, uid, now);
    // Owned: 2 pull lots + amiibo (retail fallback 3,300 x 3). The opened box keeps its cost
    // (5,400) in the totals at no value: its value lives in the pulls, which cost nothing.
    expect(p.totals).toMatchObject({
      total: 3,
      valued: 3,
      spentBase: 9_900 + 5_400,
      openedCostBase: 5_400,
    });
    expect(p.totals.valueBase).toBe(3_100 + 925 * 2 + 9_900);
    expect(p.totals.unrealizedBase).toBe(p.totals.valueBase - 9_900 - 5_400);
    const row = p.rows.find((r) => r.holding.id === amiibo.holding.id);
    expect(row?.valuation).toMatchObject({ method: 'retail', confidence: 'low' });
    expect(p.breakdown.map((b) => b.kind).sort()).toEqual(['amiibo', 'booster_box', 'single']);

    await sellHolding(db, uid, amiibo.holding.id, {
      quantity: 3,
      priceBase: 12_000,
      feesBase: 0,
      occurredAt: ago(1),
    });
    expect((await portfolioValuation(db, uid, now)).totals.total).toBe(2);
  });

  it('rebuilds snapshots from the first acquisition and builds the value-over-time series', async () => {
    const { amiibo } = await scenario();
    // An ungraded card has no market value: it counts at cost in the value line.
    await createHolding(
      db,
      uid,
      { product: { category: 'tcg', kind: 'single', name: 'ミュウツー' } },
      { quantity: 1, costTotalBase: 700, acquiredAt: ago(5) },
    );
    const run = await runSnapshots(db, now);
    // The box was bought 60 days ago: every day since then, today included.
    expect(run.days).toBe(61);
    const series = await portfolioSeries(db, uid, 365, now);
    const on = (daysAgo: number) =>
      series.find((s) => s.date === localDate(new Date(now.getTime() - daysAgo * 86_400_000)));
    expect(series[0]?.date).toBe(ago(60).slice(0, 10));
    expect(on(0)).toMatchObject({
      valueBase: 3_100 + 925 * 2 + 9_900 + 700,
      // The opened box stays in the cost line (its value moved to the pulls).
      costBase: 9_900 + 700 + 5_400,
      atCostBase: 700,
    });
    // 40 days ago only the pulls (box opened 59 days ago) were held; ピカチュウ sold for 2,000 then.
    expect(on(39)?.valueBase).toBe(2_000);
    // The movers read the values the run saved for the days they compare; the same as read out
    // of the lots' histories.
    const movers = await moversByPeriod(db, uid, INSIGHT_PERIODS);
    expect([...movers.mine.values()].flat().length).toBeGreaterThan(0);
    expect((await db.select().from(portfolioCharts))[0]?.recent?.day).toBe(localDate(now));
    await db.update(portfolioCharts).set({ recent: null });
    expect(await moversByPeriod(db, uid, INSIGHT_PERIODS)).toEqual(movers);
    // The run saved the chart; summed again from the snapshots, it is the same.
    await db.delete(portfolioCharts);
    expect(await portfolioSeries(db, uid, 365, now)).toEqual(series);
    // Today's point from the header's values: the same while nothing changed since the run, and
    // the header's market value plus the lots still at cost.
    const portfolio = await portfolioValuation(db, uid, now);
    const live = withLivePoint(series, portfolio, now);
    expect(live).toEqual(series);
    expect(live.at(-1)!.valueBase - live.at(-1)!.atCostBase).toBe(portfolio.totals.valueBase);
    // A lot's cost changed after the run: summed again at once.
    const [mewtwo] = await db
      .update(holdings)
      .set({ costTotalBase: 800 })
      .where(eq(holdings.costTotalBase, 700))
      .returning();
    expect(mewtwo).toBeDefined();
    const after = await portfolioSeries(db, uid, 365, now);
    expect(after.at(-1)).toMatchObject({ atCostBase: 800, costBase: 9_900 + 800 + 5_400 });
    await db.update(holdings).set({ costTotalBase: 700 }).where(eq(holdings.id, mewtwo!.id));

    // Re-running writes nothing new; moving a purchase date later removes the days before it.
    expect(await runSnapshots(db, now)).toMatchObject({ rows: 0, removed: 0 });
    await editHolding(db, uid, amiibo.holding.id, { acquiredAt: ago(10) });
    const again = await runSnapshots(db, now);
    expect(again.removed).toBe(20);
    expect(again.rows).toBe(0);
  });

  it('estimates pull costs from the opened box, for reference', async () => {
    const { box, pika, mew } = await scenario();
    const costs = await estimatedPullCosts(db, uid, box.holding.id, now);
    // Box 5,400 split by market value: ピカチュウ 3,100 x1 vs ミュウ 925 x2.
    const total = 3_100 + 925 * 2;
    expect(costs.get(pika.holding.id)).toBe(Math.round((5_400 * 3_100) / total));
    expect(costs.get(mew.holding.id)).toBe(Math.round((5_400 * 925 * 2) / total));
  });

  it('combines lots per product for the portfolio summary', async () => {
    const { mew } = await scenario();
    const second = await createHolding(
      db,
      uid,
      { productId: mew.product.id },
      { quantity: 1, costTotalBase: 1_000, acquiredAt: ago(3), grading: 'raw', rawGrade: 'A' },
    );
    const p = await portfolioValuation(db, uid, now);
    const valuations = new Map(p.rows.map((r) => [r.holding.id, r.valuation]));
    const summary = summarizeByProduct(p.rows, valuations);
    const m = summary.find((s) => s.product.id === mew.product.id)!;
    expect(m.lots.map((l) => l.holding.id)).toContain(second.holding.id);
    expect(m).toMatchObject({ units: 3, spentBase: 1_000, valuedLots: 2, valueBase: 925 * 3 });
    expect(m.unrealizedBase).toBe(925 * 3 - 1_000);
    // Highest value first.
    expect(summary[0]!.valueBase).toBeGreaterThanOrEqual(summary.at(-1)!.valueBase);
  });

  it('builds daily medians for the price chart', async () => {
    const { mew } = await scenario();
    const points = await priceHistory(db, mew.product.id, 365, now);
    expect(points).toHaveLength(5);
    expect(points.every((p) => p.bucket === 'raw:A' && p.count === 1)).toBe(true);
  });
});

describe('saved bucket values (S8 speed)', () => {
  const owned = () =>
    db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(and(eq(holdings.userId, uid), eq(holdings.status, 'owned')));
  const full = async () => {
    const rows = await owned();
    const market = await loadMarketData(db, uid, [...new Set(rows.map((r) => r.product.id))], now);
    return new Map(
      rows.map((r) => [r.holding.id, valueHolding(r.holding, r.product, market, now)]),
    );
  };

  it('values holdings as a full valuation does, saved or not', async () => {
    await scenario();
    const expected = await full();
    // Valued live and saved, then read back from the saved rows.
    expect(await valueHoldings(db, uid, await owned(), now)).toEqual(expected);
    expect(await valueHoldings(db, uid, await owned(), now)).toEqual(expected);
    expect((await refreshBucketValues(db, now)).values).toBe(3);
    expect(await valueHoldings(db, uid, await owned(), now)).toEqual(expected);
  });

  it('forgets a product once its sales change; manual prices apply on top', async () => {
    const { mew } = await scenario();
    await refreshBucketValues(db, now);
    const [outlier] = await db
      .select()
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.productId, mew.product.id),
          eq(priceObservations.priceBase, 1_000),
        ),
      );
    await setObservationExcluded(db, outlier!.id, true);
    const values = await valueHoldings(db, uid, await owned(), now);
    expect(values).toEqual(await full());
    // 800, 900, 950 (20,000 dropped as an outlier)
    expect(values.get(mew.holding.id)?.valueBase).toBe(900 * 2);

    await setManualPrice(db, uid, mew.product.id, 'raw:A', 1_500);
    const later = new Date();
    const withManual = await valueHoldings(db, uid, await owned(), later);
    expect(withManual.get(mew.holding.id)).toMatchObject({ method: 'manual', valueBase: 3_000 });
  });
});

describe('trade counts (Summary insights)', () => {
  it("counts sales per period for items anyone holds, marking the user's own", async () => {
    const { pika, mew } = await scenario();
    // The opened box is held by nobody any more; ピカチュウ also sold 40 days before.
    const counts = await tradeCounts(db, uid, [30, 90]);
    const of = (id: string) => counts.find((c) => c.product.id === id)!;
    expect(counts).toHaveLength(2);
    expect([...of(mew.product.id).sales]).toEqual([
      [30, 5],
      [90, 5],
    ]);
    expect([...of(pika.product.id).sales]).toEqual([
      [30, 3],
      [90, 4],
    ]);
    expect(of(pika.product.id).mine).toBe(true);
  });
});

describe('tracking switches (S8)', () => {
  it("counts cost, value and P/L by each lot's switches", async () => {
    const { amiibo, mew } = await scenario();
    const before = (await portfolioValuation(db, uid, now)).totals;
    // Bought to use: worth still shown, cost and P/L left out.
    await setLotTracking(db, uid, amiibo.holding.id, { countInCost: false, countInValue: true });
    let after = (await portfolioValuation(db, uid, now)).totals;
    expect(after.spentBase).toBe(before.spentBase - 9_900);
    expect(after.valueBase).toBe(before.valueBase);
    expect(after.unrealizedBase).toBe(before.unrealizedBase - (3_300 * 3 - 9_900));
    expect(after.notInvestment).toBe(1);
    // ミュウ (pulled, cost 0, worth 925 x 2) out of the P/L: its gain no longer counts.
    await setLotTracking(db, uid, mew.holding.id, { countInCost: true, countInValue: false });
    after = (await portfolioValuation(db, uid, now)).totals;
    expect(after.valueBase).toBe(before.valueBase - 925 * 2);
    expect(after.unrealizedBase).toBe(before.unrealizedBase - 925 * 2);
  });

  it('applies to every lot of the item on request', async () => {
    const { amiibo } = await scenario();
    await createHolding(
      db,
      uid,
      { productId: amiibo.product.id },
      { quantity: 1, costTotalBase: 3_300, acquiredAt: ago(5), condition: 'new_unused' },
    );
    const off = { countInCost: false, countInValue: false };
    expect(await setLotTracking(db, uid, amiibo.holding.id, off)).toBe(1);
    expect(await setLotTracking(db, uid, amiibo.holding.id, off, true)).toBe(2);
  });
});
