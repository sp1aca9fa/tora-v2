import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appTimeZone, localDate, setAppTimeZone, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { loadSourceRegistry, loadTimeZone } from './registry';
import { holdingEvents, holdings, priceObservations, productSources } from './schema';
import { insertObservations, linkSource, updateSourceProgress } from './sources';
import { changeTimeZone, storedTimes } from './time-zone';
import { createUser } from './users';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-tz-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});
afterEach(() => setAppTimeZone(null));

it('rewrites every stored time as the same instant in the new zone', async () => {
  expect(await loadTimeZone(db)).toBe('Asia/Tokyo');
  const { product, holding } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
    // 03:00 in Tokyo on the 2nd: still the 1st in Paris (summer time).
    { quantity: 1, costTotalBase: 16_000, acquiredAt: '2026-10-02T03:00:00.000+09:00' },
  );
  await insertObservations(db, [
    {
      productId: product.id,
      source: 'shop',
      observationType: 'sold',
      bucket: 'sealed:shrink',
      priceBase: 17_000,
      priceOriginal: 17_000,
      currency: 'JPY',
      // Winter in Paris.
      observedAt: '2026-12-06T12:00:00.000+09:00',
      fetchedAt: '2026-12-06T12:00:00.000+09:00',
      externalRef: 'a',
    },
  ]);
  const link = await linkSource(db, product.id, { source: 'shop', externalId: 'x' });
  await updateSourceProgress(db, link.id, {
    success: true,
    recentSales: [{ bucket: null, priceBase: 1, observedAt: '2026-10-02T03:00:00.000+09:00' }],
  });
  expect(await storedTimes(db)).toBeGreaterThan(0);

  expect(await changeTimeZone(db, 'Europe/Paris')).toBeGreaterThan(5);
  expect(appTimeZone()).toBe('Europe/Paris');
  expect((await loadSourceRegistry(db)).timeZone).toBe('Europe/Paris');

  const [h] = await db.select().from(holdings).where(eq(holdings.id, holding.id));
  expect(h!.acquiredAt).toBe('2026-10-01T20:00:00.000+02:00');
  const [o] = await db.select().from(priceObservations);
  expect(o!.observedAt).toBe('2026-12-06T04:00:00.000+01:00');
  expect(o!.fetchedAt).toBe('2026-12-06T04:00:00.000+01:00');
  const [e] = await db.select().from(holdingEvents).where(eq(holdingEvents.holdingId, holding.id));
  expect(e!.occurredAt.endsWith('+02:00') || e!.occurredAt.endsWith('+01:00')).toBe(true);
  const [s] = await db.select().from(productSources).where(eq(productSources.id, link.id));
  expect(s!.recentSales![0]!.observedAt).toBe('2026-10-01T20:00:00.000+02:00');
  expect(s!.createdAt.endsWith('+02:00') || s!.createdAt.endsWith('+01:00')).toBe(true);
  // New times follow too.
  expect(localDate(new Date('2026-10-01T23:00:00Z'))).toBe('2026-10-02');
  expect(toLocalIso(new Date('2026-10-01T23:00:00Z'))).toBe('2026-10-02T01:00:00.000+02:00');

  // Back again: the same instants.
  await changeTimeZone(db, 'Asia/Tokyo');
  const [back] = await db.select().from(holdings).where(eq(holdings.id, holding.id));
  expect(back!.acquiredAt).toBe('2026-10-02T03:00:00.000+09:00');
});

it('refuses an unknown zone and does nothing for the same one', async () => {
  await expect(changeTimeZone(db, 'Mars/Olympus')).rejects.toThrow();
  expect(await changeTimeZone(db, 'Asia/Tokyo')).toBe(0);
});
