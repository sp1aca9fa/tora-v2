import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseCurrency } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { baseChoices, changeBaseCurrency, storedAmounts } from './base-currency';
import { type Db, createDb } from './client';
import { fxRateOn, saveFxRates } from './fx';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { loadSourceRegistry, setCurrencySettings } from './registry';
import { holdings, priceObservations } from './schema';
import { insertObservations } from './sources';
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
  expect(await baseChoices(db)).toEqual(['EUR', 'USD']);

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
  expect((await loadSourceRegistry(db)).currency).toMatchObject({
    rates: { JPY: { source: 'ecb' } },
    extra: ['JPY'],
  });
  expect(await storedAmounts(db)).toBe(before);
});

it('refuses a currency without a rate', async () => {
  await expect(changeBaseCurrency(db, 'GBP')).rejects.toThrow('no_rate');
});
