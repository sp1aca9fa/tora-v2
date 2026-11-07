import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dealWayStates, localDate } from '@tora/core';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { loadOpportunities, refreshOpportunities } from './opportunities';
import { priceObservations } from './schema';
import { saveSupply } from './supply';
import { createUser } from './users';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-opportunities-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-21T12:00:00+09:00');
const DAY = 86_400_000;

/** Two SNKRDUNK sales a day for `days` days up to NOW, priced by days back. */
async function sales(productId: string, days: number, price: (back: number) => number) {
  const rows = Array.from({ length: days * 2 }, (_, i) => {
    const back = Math.floor(i / 2);
    const at = new Date(NOW.getTime() - back * DAY - (i % 2) * 3_600_000).toISOString();
    return {
      productId,
      source: 'snkrdunk',
      observationType: 'sold' as const,
      bucket: 'sealed:shrink',
      priceBase: Math.round(price(back)),
      priceOriginal: Math.round(price(back)),
      currency: 'JPY',
      observedAt: at,
      fetchedAt: at,
      externalRef: `${productId}-${i}`,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(priceObservations).values(rows.slice(i, i + 200));
  }
}

const box = (name: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name,
    franchise: 'pokemon',
    region: 'jp',
  });

// Over two years of daily data for eleven items: slow on a loaded machine.
it('saves every item signals and its group tests, and ranks them', async () => {
  // Ten boxes flat for 600 days, then rising 2 % a week for 250, one flat throughout: the flat
  // one lags a rising line, and the line's rise was followed by higher prices.
  const rising: { id: string }[] = [];
  for (let n = 1; n <= 10; n++) {
    const p = await box(`Rising ${n}`);
    await sales(
      p.id,
      850,
      (back) => 10000 * (1 + n / 100) * Math.exp((0.02 / 7) * Math.max(0, 250 - back)),
    );
    rising.push(p);
  }
  const flat = await box('Flat');
  await sales(flat.id, 850, () => 10000);
  const day = '2026-10-21';
  await saveSupply(db, [
    {
      productId: flat.id,
      source: 'snkrdunk',
      bucket: 'sealed:shrink',
      day,
      lowestAskBase: 8000,
      lowestAskOriginal: 8000,
      currency: 'JPY',
      fxRate: null,
      listings: 3,
      url: 'https://example.test/flat',
      fetchedAt: NOW.toISOString(),
    },
    // Another site's cheaper listing is not compared.
    {
      productId: rising[0]!.id,
      source: 'mercari',
      bucket: 'sealed:shrink',
      day,
      lowestAskBase: 100,
      lowestAskOriginal: 100,
      currency: 'JPY',
      fxRate: null,
      listings: 1,
      fetchedAt: NOW.toISOString(),
    },
  ]);
  await db.insert(priceObservations).values({
    productId: flat.id,
    source: 'shop',
    observationType: 'buylist',
    bucket: null,
    priceBase: 8500,
    priceOriginal: 8500,
    currency: 'JPY',
    observedAt: NOW.toISOString(),
    fetchedAt: NOW.toISOString(),
    externalRef: 'buy-1',
  });

  expect(await loadOpportunities(db)).toBeNull();
  const saved = await refreshOpportunities(db, NOW);
  expect(saved.day).toBe(day);
  expect(saved.items).toHaveLength(11);
  const group = 'tcg|booster_box|pokemon|jp';
  expect(saved.tests[group]!.items).toBe(11);
  expect(saved.tests[group]!.signals.line_rising!.checked).toBeGreaterThanOrEqual(10);

  const loaded = (await loadOpportunities(db))!;
  expect(loaded.day).toBe(day);
  const f = loaded.items.find((i) => i.productId === flat.id)!;
  expect(f).toMatchObject({
    bucket: 'sealed:shrink',
    source: 'snkrdunk',
    itemType: 'sealed',
    ask: { price: 8000, source: 'snkrdunk', url: 'https://example.test/flat' },
    buylist: { price: 8500, source: 'shop' },
    askUnder: true,
    buylistNear: true,
  });
  expect(f.on).toEqual(['line_rising', 'laggard']);
  const r = loaded.items.find((i) => i.productId === rising[0]!.id)!;
  expect(r.ask).toBeNull();
  // The rising ones' line signal was followed by higher prices: proven, ranked first.
  expect(r.proven).toEqual(['line_rising']);
  expect(loaded.items[0]!.proven.length).toBeGreaterThan(0);
  expect(f.proven).not.toContain('laggard');
}, 20_000);

it('saves listings now and 14 days ago from the price source and condition only (S32)', async () => {
  const dayAgo = (n: number) => localDate(new Date(NOW.getTime() - n * DAY));
  const report = (
    productId: string,
    back: number,
    listings: number | null,
    source = 'snkrdunk',
    bucket = 'sealed:shrink',
  ) => ({
    productId,
    source,
    bucket,
    day: dayAgo(back),
    lowestAskBase: null,
    lowestAskOriginal: null,
    currency: 'JPY',
    fxRate: null,
    listings,
    fetchedAt: NOW.toISOString(),
  });
  const named = async (name: string) => {
    const p = await box(name);
    await sales(p.id, 40, () => 10000);
    return p.id;
  };
  const [full, near, far, stale, noCount, otherOnly, oldNear, oldFar, gone, notCounted] = [
    await named('Full'),
    await named('Near'),
    await named('Far'),
    await named('Stale'),
    await named('No count'),
    await named('Other only'),
    await named('Old near'),
    await named('Old far'),
    await named('Gone'),
    await named('Not counted'),
  ];
  await saveSupply(db, [
    report(full!, 0, 6),
    report(full!, 14, 10),
    // Another site and another condition say nothing about the item's own numbers.
    report(full!, 0, 500, 'mercari'),
    report(full!, 14, 900, 'mercari'),
    report(full!, 14, 700, 'snkrdunk', 'sealed:open'),
    report(near!, 1, 4),
    report(near!, 12, 8),
    report(oldNear!, 3, 4),
    report(oldNear!, 17, 8),
    report(oldFar!, 3, 4),
    report(oldFar!, 11, 8),
    report(gone!, 0, 3, 'snkrdunk', 'sealed:open'),
    report(gone!, 14, 8),
    report(notCounted!, 0, null),
    report(notCounted!, 0, 3, 'snkrdunk', 'sealed:open'),
    report(notCounted!, 14, 8),
    report(far!, 0, 4),
    report(far!, 18, 8),
    report(stale!, 4, 2),
    report(stale!, 14, 8),
    report(noCount!, 0, null),
    report(noCount!, 14, null),
    report(otherOnly!, 0, 2, 'mercari'),
    report(otherOnly!, 14, 8, 'mercari'),
  ]);
  const saved = await refreshOpportunities(db, NOW);
  const of = (id: string) => saved.items.find((o) => o.productId === id)!;
  expect(of(full!).listings).toEqual({ now: 6, before: 10 });
  expect(dealWayStates(of(full!)).listings_drying).toBe(true);
  expect(of(near!).listings).toEqual({ now: 4, before: 8 });
  // More than 3 days from the day asked: unknown, and so is a report past its freshness.
  expect(of(far!).listings).toEqual({ now: 4, before: null });
  expect(dealWayStates(of(far!)).listings_drying).toBeNull();
  expect(of(stale!).listings).toEqual({ now: null, before: 8 });
  expect(of(noCount!).listings).toEqual({ now: null, before: null });
  // Measured from the report's day, so a 3-day-old report still compares about 14 days.
  expect(of(oldNear!).listings).toEqual({ now: 4, before: 8 });
  expect(of(oldFar!).listings).toEqual({ now: 4, before: null });
  // The report counts another condition, not this one: nothing for sale, the strongest drying.
  expect(of(gone!).listings).toEqual({ now: 0, before: 8 });
  expect(dealWayStates(of(gone!)).listings_drying).toBe(true);
  // Reported without a count is not the same: unknown, not 0.
  expect(of(notCounted!).listings).toEqual({ now: null, before: 8 });
  expect(of(otherOnly!).listings).toEqual({ now: null, before: null });
  // The MCP passes `numbers` on whole: the counts stay out of it.
  expect(of(full!).numbers).not.toHaveProperty('listings');
});
