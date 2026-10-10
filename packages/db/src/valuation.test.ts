import { tokyoDate } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { addPull, createHolding, markOpened, sellHolding } from './mutations';
import { insertObservations } from './sources';
import { createUser } from './users';
import {
  boxView,
  clearManualPrice,
  portfolioSeries,
  portfolioValuation,
  priceHistory,
  runSnapshots,
  setManualPrice,
} from './valuation';

let db: Db;
let uid: string;
const now = new Date('2026-10-10T03:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-val-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
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
  priceJpy: price,
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
      costTotalJpy: 5_400,
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
    { product: { category: 'game', kind: 'amiibo', name: 'Link', retailPriceJpy: 3_300 } },
    { quantity: 3, costTotalJpy: 9_900, acquiredAt: ago(30), condition: 'new_unused' },
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
      valueJpy: null,
    });
    expect(view?.paidJpy).toBe(5_400);
    // ピカチュウ 3,100 + ミュウ 925 (IQR drops 20,000) x 2
    expect(view?.pullsValueJpy).toBe(3_100 + 925 * 2);
    expect(view?.netJpy).toBe(3_100 + 925 * 2 - 5_400);

    await setManualPrice(db, uid, box.product.id, 'sealed:box_opened_contents_sealed', 9_000);
    // The manual price is set at the real current time, so value at the real time too.
    const withManual = await boxView(db, uid, box.holding.id, new Date());
    expect(withManual?.asReceived).toMatchObject({ method: 'manual', valueJpy: 9_000 });
    await clearManualPrice(db, uid, box.product.id, 'sealed:box_opened_contents_sealed');
    expect((await boxView(db, uid, box.holding.id, now))?.asReceived.valueJpy).toBeNull();
  });
});

describe('portfolio (scenario 7)', () => {
  it('totals spent, value and unrealized P/L over owned holdings', async () => {
    const { amiibo } = await scenario();
    const p = await portfolioValuation(db, uid, now);
    // Owned: 2 pull lots + amiibo (retail fallback 3,300 x 3); the box is consumed.
    expect(p.totals).toMatchObject({ total: 3, valued: 3, spentJpy: 9_900 });
    expect(p.totals.valueJpy).toBe(3_100 + 925 * 2 + 9_900);
    expect(p.totals.unrealizedJpy).toBe(p.totals.valueJpy - 9_900);
    const row = p.rows.find((r) => r.holding.id === amiibo.holding.id);
    expect(row?.valuation).toMatchObject({ method: 'retail', confidence: 'low' });
    expect(p.breakdown.map((b) => b.kind).sort()).toEqual(['amiibo', 'single']);

    await sellHolding(db, uid, amiibo.holding.id, {
      quantity: 3,
      priceJpy: 12_000,
      feesJpy: 0,
      occurredAt: ago(1),
    });
    expect((await portfolioValuation(db, uid, now)).totals.total).toBe(2);
  });

  it('writes daily snapshots with backfill and builds the value-over-time series', async () => {
    await scenario();
    const run = await runSnapshots(db, now, 45);
    expect(run.days).toBe(46);
    const series = await portfolioSeries(db, uid, 60, now);
    const today = series.find((s) => s.date === tokyoDate(now));
    expect(today?.valueJpy).toBe(3_100 + 925 * 2 + 9_900);
    // 40 days ago only the pulls (box opened 59 days ago) were held; ピカチュウ sold for 2,000 then.
    const early = series.find(
      (s) => s.date === tokyoDate(new Date(now.getTime() - 39 * 86_400_000)),
    );
    expect(early?.valueJpy).toBe(2_000);
    // Re-running only recomputes the last week.
    expect((await runSnapshots(db, now, 45)).days).toBe(8);
  });

  it('builds daily medians for the price chart', async () => {
    const { mew } = await scenario();
    const points = await priceHistory(db, mew.product.id, 365, now);
    expect(points).toHaveLength(5);
    expect(points.every((p) => p.bucket === 'raw:A' && p.count === 1)).toBe(true);
  });
});
