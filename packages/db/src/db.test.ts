import { deriveBucket } from '@tora/core';
import { count, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { listHoldingsWithProducts } from './queries';
import { holdingEvents, holdings, priceObservations, products } from './schema';
import { seed } from './seed';

let db: Db;

beforeEach(async () => {
  // A temp file rather than :memory:, since libSQL transactions open a separate connection.
  const dir = await mkdtemp(join(tmpdir(), 'tora-db-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

describe('migrations + seed', () => {
  it('seeds the scenario data', async () => {
    const rows = await seed(db);
    const [p] = await db.select({ n: count() }).from(products);
    const [h] = await db.select({ n: count() }).from(holdings);
    const [e] = await db.select({ n: count() }).from(holdingEvents);
    expect(p?.n).toBe(rows.products.length);
    expect(h?.n).toBe(rows.holdings.length);
    expect(e?.n).toBe(rows.holdingEvents.length);

    const list = await listHoldingsWithProducts(db);
    expect(list).toHaveLength(rows.holdings.length);
  });

  it('has an amiibo lot of 3 identical units (scenario 2)', async () => {
    await seed(db);
    const lots = await db
      .select({ quantity: holdings.quantity, cost: holdings.costTotalJpy })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(eq(products.type, 'amiibo'));
    expect(lots).toContainEqual({ quantity: 3, cost: 9_900 });
  });

  it('links pulls to the box and keeps the box state as received (scenarios 4-5)', async () => {
    await seed(db);
    const [box] = await db
      .select({ holding: holdings })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(eq(products.type, 'sealed_tcg'));
    expect(box).toBeDefined();
    const pulls = await db
      .select()
      .from(holdings)
      .where(eq(holdings.parentHoldingId, box!.holding.id));
    expect(pulls.length).toBe(3);
    for (const pull of pulls) {
      expect(pull.costTotalJpy).toBe(0);
      expect(pull.acquisitionType).toBe('pull');
      expect(deriveBucket({ productType: 'card_single', ...pull })).toBe('raw:A');
    }

    const [acquired] = await db
      .select()
      .from(holdingEvents)
      .where(eq(holdingEvents.holdingId, box!.holding.id))
      .orderBy(holdingEvents.occurredAt);
    expect(acquired?.type).toBe('acquired');
    expect(acquired?.payload).toMatchObject({ packagingState: 'box_opened_contents_sealed' });
  });
});

describe('constraints', () => {
  it('rejects invalid enum values and quantities', async () => {
    const [product] = await db
      .insert(products)
      .values({ type: 'amiibo', nameEn: 'Test' })
      .returning();
    const base = { productId: product!.id, acquiredAt: '2026-10-09T00:00:00.000+09:00' };
    await expect(db.insert(holdings).values({ ...base, quantity: 0 })).rejects.toThrow();
    await expect(
      // @ts-expect-error invalid enum on purpose
      db.insert(holdings).values({ ...base, condition: 'mint' }),
    ).rejects.toThrow();
    await expect(db.insert(products).values({ type: 'amiibo' })).rejects.toThrow();
  });

  it('dedupes observations by source + external_ref', async () => {
    const [product] = await db
      .insert(products)
      .values({ type: 'amiibo', nameEn: 'Test' })
      .returning();
    const obs = {
      productId: product!.id,
      source: 'mercari',
      observationType: 'sold' as const,
      priceJpy: 1000,
      observedAt: '2026-10-09T00:00:00.000+09:00',
      fetchedAt: '2026-10-09T00:00:00.000+09:00',
      externalRef: 'm123',
    };
    await db.insert(priceObservations).values(obs);
    await expect(db.insert(priceObservations).values(obs)).rejects.toThrow();
    await db.insert(priceObservations).values({ ...obs, source: 'snkrdunk' });
  });
});
