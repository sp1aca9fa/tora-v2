import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SignalStats, baseCurrency } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { pendingActions } from './actions';
import { baseChoices, changeBaseCurrency, storedAmounts } from './base-currency';
import { type Db, createDb } from './client';
import { fxRateOn, saveFxRates } from './fx';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { loadSourceRegistry, saveSetting, setCurrencySettings } from './registry';
import {
  holdings,
  priceObservations,
  signals,
  suggestions,
  supply,
  users,
  watches,
} from './schema';
import { insertObservations } from './sources';
import { changeTimeZone } from './time-zone';
import { createUser } from './users';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-base-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it('converts every amount with the rate of its own date and moves the rates to the new base', async () => {
  // Yen per euro and per dollar.
  await saveFxRates(db, 'EURJPY', [
    { date: '2026-10-01', rate: 160 },
    { date: '2026-10-05', rate: 170 },
  ]);
  await saveFxRates(db, 'USDJPY', [{ date: '2026-10-05', rate: 150 }]);
  await setCurrencySettings(db, { base: 'JPY', rates: { EUR: { source: 'ecb' } } });

  const { product, holding } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
    { quantity: 1, costTotalBase: 16_000, acquiredAt: '2026-10-02T12:00:00.000+09:00' },
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
      observedAt: '2026-10-06T12:00:00.000+09:00',
      fetchedAt: '2026-10-06T12:00:00.000+09:00',
      externalRef: 'a',
    },
    {
      productId: product.id,
      source: 'us',
      observationType: 'listing',
      bucket: null,
      priceBase: 15_000,
      priceOriginal: 10_000,
      currency: 'USD',
      fxRate: 150,
      observedAt: '2026-10-06T12:00:00.000+09:00',
      fetchedAt: '2026-10-06T12:00:00.000+09:00',
      externalRef: 'b',
    },
  ]);
  expect(await baseChoices(db)).toEqual(['EUR', 'USD']);
  const before = await storedAmounts(db);

  await changeBaseCurrency(db, 'EUR', new Date('2026-10-07T03:00:00Z'));

  expect(baseCurrency(await loadSourceRegistry(db))).toBe('EUR');
  // ¥16,000 on Oct 2 at 160: €100.00, stored in cents.
  const [lot] = await db.select().from(holdings).where(eq(holdings.id, holding.id));
  expect(lot!.costTotalBase).toBe(10_000);
  const prices = await db.select().from(priceObservations);
  // ¥17,000 on Oct 6 at 170: €100.00; the yen price now has a rate to the euro.
  expect(prices.find((p) => p.externalRef === 'a')).toMatchObject({ priceBase: 10_000 });
  expect(prices.find((p) => p.externalRef === 'a')!.fxRate).toBeCloseTo(1 / 170);
  // $100 at 150 yen = ¥15,000 = €88.24; its rate is now euros per dollar.
  expect(prices.find((p) => p.externalRef === 'b')).toMatchObject({ priceBase: 8824 });
  expect(prices.find((p) => p.externalRef === 'b')!.fxRate).toBeCloseTo(150 / 170);
  // Rates to the new base: dollars through the yen, and the yen itself.
  expect((await fxRateOn(db, 'USDEUR', '2026-10-06'))!.rate).toBeCloseTo(150 / 170);
  expect((await fxRateOn(db, 'JPYEUR', '2026-10-06'))!.rate).toBeCloseTo(1 / 170);
  // The yen's rate now comes from where the euro's did.
  expect((await loadSourceRegistry(db)).currency?.rates).toEqual({ JPY: { source: 'ecb' } });
  expect(await storedAmounts(db)).toBe(before);
});

it('takes any currency at setup, and later only one with a rate', async () => {
  expect(await baseChoices(db)).toContain('KRW');
  await changeBaseCurrency(db, 'EUR');
  expect(baseCurrency(await loadSourceRegistry(db))).toBe('EUR');
  await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
    { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-10-02T12:00:00.000+09:00' },
  );
  expect(await baseChoices(db)).toEqual([]);
  await expect(changeBaseCurrency(db, 'GBP')).rejects.toThrow('no_rate');
});

it('keeps the identity cost threshold in the base currency', async () => {
  // The default follows the base: ¥3,000, else 20 in the currency's own units.
  expect((await loadSourceRegistry(db)).markets?.identityMinCost).toBe(3000);
  await changeBaseCurrency(db, 'EUR');
  expect((await loadSourceRegistry(db)).markets?.identityMinCost).toBe(2000);
  // A typed threshold is converted with the rate when amounts are converted...
  await saveSetting(db, 'markets', { identityMinCost: 5000 });
  await saveFxRates(db, 'JPYEUR', [{ date: '2026-10-01', rate: 0.006 }]);
  await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
    { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-10-02T12:00:00.000+09:00' },
  );
  await changeBaseCurrency(db, 'JPY', new Date('2026-10-03T12:00:00Z'));
  expect((await loadSourceRegistry(db)).markets?.identityMinCost).toBe(8333);
});

it('asks admins to finish the setup until the currency and time zone are chosen, even as they are', async () => {
  const setup = async () =>
    (await pendingActions(db, userId, null, { admin: true })).find((i) => i.kind === 'setup');
  expect(await setup()).toMatchObject({ missing: ['currency', 'timeZone'] });
  expect((await pendingActions(db, userId)).some((i) => i.kind === 'setup')).toBe(false);
  await changeBaseCurrency(db, 'JPY');
  expect(await setup()).toMatchObject({ missing: ['timeZone'] });
  await changeTimeZone(db, 'Asia/Tokyo');
  expect(await setup()).toBeUndefined();
});

it('converts the amounts of watches, asks, daily numbers, buy plans and review suggestions', async () => {
  await saveFxRates(db, 'EURJPY', [
    { date: '2026-10-01', rate: 160 },
    { date: '2026-10-05', rate: 200 },
  ]);
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
    { quantity: 1, costTotalBase: 16_000, acquiredAt: '2026-10-02T12:00:00.000+09:00' },
  );
  const at = '2026-10-02T12:00:00.000+09:00';
  await db.insert(watches).values({
    userId,
    productId: product.id,
    bucket: 'sealed:shrink',
    targetPriceBase: 20_000,
  });
  await db.insert(supply).values({
    productId: product.id,
    source: 'shop',
    bucket: 'sealed:shrink',
    day: '2026-10-02',
    lowestAskBase: 16_000,
    fetchedAt: at,
  });
  await db.insert(signals).values({
    productId: product.id,
    bucket: 'sealed:shrink',
    day: '2026-10-02',
    stats: { fair: 32_000, usual180: null, ask: 16_000 } as unknown as SignalStats,
  });
  await db
    .update(users)
    .set({ preferences: { buyPlan: { budget: 40_000, until: '2026-12-01', items: [] } } })
    .where(eq(users.id, userId));
  await db.insert(suggestions).values({
    userId,
    kind: 'fix_value',
    targetKey: 'x',
    payload: {},
    reason: 'r',
    evidence: { sale: { priceBase: 16_000 } },
    createdAt: at,
  });

  await changeBaseCurrency(db, 'EUR', new Date('2026-10-07T03:00:00Z'));

  // Today's rate (200) for the target and the budget; the day's (160) for the rest.
  expect((await db.select().from(watches))[0]!.targetPriceBase).toBe(10_000);
  expect((await db.select().from(supply))[0]!.lowestAskBase).toBe(10_000);
  expect((await db.select().from(signals))[0]!.stats).toMatchObject({
    fair: 20_000,
    usual180: null,
    ask: 10_000,
  });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  expect(user!.preferences?.buyPlan?.budget).toBe(20_000);
  expect((await db.select().from(suggestions))[0]!.evidence).toEqual({
    sale: { priceBase: 10_000 },
  });
});
