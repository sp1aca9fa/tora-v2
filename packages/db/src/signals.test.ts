import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { priceObservations, products, signals, tcgSets } from './schema';
import { latestSignals, refreshSignals, strategySamples } from './signals';
import { createUser } from './users';
import { addWatch } from './watches';
import { eq } from 'drizzle-orm';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-signals-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-16T12:00:00+09:00');

/** One SNKRDUNK sale a day for `days` days up to NOW, priced by days back. */
async function sales(productId: string, days: number, price: (back: number) => number, end = NOW) {
  await db.insert(priceObservations).values(
    Array.from({ length: days }, (_, back) => {
      const at = new Date(end.getTime() - back * 86_400_000).toISOString();
      return {
        productId,
        source: 'snkrdunk',
        observationType: 'sold' as const,
        bucket: 'sealed:shrink',
        priceBase: price(back),
        priceOriginal: price(back),
        currency: 'JPY',
        observedAt: at,
        fetchedAt: at,
        externalRef: `${productId}-${back}`,
      };
    }),
  );
}

const box = (name: string, setId?: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name,
    franchise: 'pokemon',
    region: 'jp',
    ...(setId ? { setId } : {}),
  });

it('saves the numbers per watched item and day, once a day, and picks a sample', async () => {
  const p = await box('Box A');
  await sales(p.id, 200, (back) => 10_000 + back * 10);
  await addWatch(db, uid, { productId: p.id }, { packagingState: 'sealed_shrink' });
  const first = await refreshSignals(db, NOW);
  expect(first.saved).toBe(1);
  await refreshSignals(db, NOW);
  const rows = await db.select().from(signals);
  expect(rows).toHaveLength(1);
  const s = rows[0]!.stats;
  expect(rows[0]).toMatchObject({ bucket: 'sealed:shrink', source: 'snkrdunk' });
  // Falling over time (older sales were dearer).
  expect(s.trend84!).toBeLessThan(0);
  expect(s.q25d180).not.toBeNull();
  expect(s.ageDays).toBe(199);
  expect(s.releaseFrom).toBe('first_sale');
  // No release date: no pattern.
  expect(s.pattern).toBeNull();
  const latest = await latestSignals(db, [{ productId: p.id, bucket: 'sealed:shrink' }], NOW);
  expect(latest.size).toBe(1);
  expect((await strategySamples(db)).sealed?.productId).toBe(p.id);
});

it('uses the new-set pattern of similar items with release dates, and drops a merged item', async () => {
  const sets = await db
    .insert(tcgSets)
    .values(
      ['2025-01-01', '2025-02-01', '2025-03-01', '2026-09-16'].map((date, i) => ({
        franchise: 'pokemon',
        region: 'jp' as const,
        name: `Set ${i}`,
        setType: 'expansion' as const,
        releaseDate: date,
        source: 'test',
        sourceKey: `s${i}`,
      })),
    )
    .returning();
  // Older boxes: down 30 % from day 30 to day 120.
  for (const set of sets.slice(0, 3)) {
    const b = await box(set.name, set.id);
    const release = Date.parse(`${set.releaseDate}T12:00:00+09:00`);
    const end = new Date(release + 200 * 86_400_000);
    await sales(b.id, 200, (back) => (200 - back < 30 ? 1000 : 200 - back < 120 ? 850 : 700), end);
  }
  const young = await box('New box', sets[3]!.id);
  await sales(young.id, 30, () => 1000);
  await addWatch(db, uid, { productId: young.id }, { packagingState: 'sealed_shrink' });
  const r = await refreshSignals(db, NOW);
  expect(r.withPattern).toBe(1);
  const [row] = await db.select().from(signals);
  expect(row!.stats.pattern?.items).toBe(3);
  expect(row!.stats.pattern!.change).toBeLessThan(-0.15);

  const dup = await box('New box ', sets[3]!.id);
  await db
    .insert(signals)
    .values({ productId: dup.id, bucket: '', day: '2026-10-16', stats: row!.stats });
  await mergeProducts(db, { id: uid, role: 'admin' }, dup.id, young.id);
  expect(await db.select().from(signals).where(eq(signals.productId, dup.id))).toEqual([]);
  expect(await db.select().from(products).where(eq(products.id, dup.id))).toEqual([]);
});
