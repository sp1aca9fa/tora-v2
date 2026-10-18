import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { priceObservations, products, signals, suggestions, tcgSets } from './schema';
import { latestSignals, refreshSignals } from './signals';
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

it('saves the numbers per watched item and day, once a day', async () => {
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

it('learns the new-release wait per set line, and suggests a line for an item unlike its group', async () => {
  const DAY = 86_400_000;
  const set = async (key: string, title: string, date: string) =>
    (
      await db
        .insert(tcgSets)
        .values({
          franchise: 'pokemon',
          region: 'jp',
          name: key,
          nameAlias: title,
          setType: 'expansion',
          releaseDate: date,
          source: 'test',
          sourceKey: key,
        })
        .returning()
    )[0]!;
  // A first year of daily sales from release, priced by age.
  const year = async (productId: string, date: string, price: (age: number) => number) => {
    const end = new Date(Date.parse(`${date}T12:00:00+09:00`) + 399 * DAY);
    await sales(productId, 400, (back) => price(399 - back), end);
  };
  // Sub-expansions fall to a low at day 150; main expansions rise from release.
  const dip = (age: number) => 400 + Math.abs(age - 150) * 4;
  const rise = (age: number) => 1000 + age;
  for (const [i, date] of ['2024-06-01', '2024-07-01', '2024-08-01'].entries()) {
    const sub = await set(`sub${i}`, `強化拡張パック「Sub ${i}」`, date);
    await year((await box(`Sub box ${i}`, sub.id)).id, date, dip);
    const main = await set(`main${i}`, `拡張パック「Main ${i}」`, date);
    await year((await box(`Main box ${i}`, main.id)).id, date, rise);
  }
  // No set and no pack words in its name: no line, though its prices move like the sub-expansions.
  const odd = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Odd box',
    franchise: 'pokemon',
    region: 'jp',
    releaseDate: '2024-09-01',
  });
  await year(odd.id, '2024-09-01', dip);

  const newSub = await box(
    'New sub',
    (await set('subN', '強化拡張パック「New」', '2026-09-01')).id,
  );
  const newHigh = await box(
    'New high',
    (await set('hiN', 'ハイクラスパック「New」', '2026-09-01')).id,
  );
  for (const p of [newSub, newHigh]) {
    await sales(p.id, 40, () => 1000);
    await addWatch(db, uid, { productId: p.id }, { packagingState: 'sealed_shrink' });
  }
  const r = await refreshSignals(db, NOW);
  const stats = new Map((await db.select().from(signals)).map((s) => [s.productId, s.stats]));
  // The sub-expansions' own low; the high class line has no items with a full year: all of them.
  // (The ±7-day typical price is flat around the bottom of the V: the earliest of it counts.)
  expect(stats.get(newSub.id)).toMatchObject({ line: 'sub', lowAge: { items: 3, line: 'sub' } });
  expect(stats.get(newSub.id)!.lowAge!.age).toBeGreaterThanOrEqual(143);
  expect(stats.get(newSub.id)!.lowAge!.age).toBeLessThanOrEqual(150);
  expect(stats.get(newHigh.id)).toMatchObject({
    line: 'high_class',
    lowAge: { items: 7, line: null },
  });

  expect(r.lineSuggestions).toBe(1);
  const [filed] = await db.select().from(suggestions);
  expect(filed).toMatchObject({ kind: 'set_line', productId: odd.id, payload: { line: 'sub' } });
});
