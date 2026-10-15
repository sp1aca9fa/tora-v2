import { type Taxonomy, resolveTaxonomy, toLocalIso } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { categoryUsage, saveTaxonomy } from './categories';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { loadSourceRegistry, saveSourceInfos } from './registry';
import * as schema from './schema';
import { insertObservations } from './sources';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';
import { valueHoldings } from './valuation';

let db: Db;
let userId: string;

/** The built-in templates plus watches with their own condition list and fields. */
const withWatches = (): Taxonomy => {
  const base = resolveTaxonomy(null);
  return {
    categories: [
      ...base.categories,
      {
        key: 'watch',
        names: { en: 'Watches', ja: '時計' },
        kinds: [{ key: 'wrist', names: { en: 'Wristwatch' }, conditions: 'watch_condition' }],
        fields: [
          { key: 'releaseDate', standard: true },
          { key: 'brand', names: { en: 'Brand' }, type: 'text', required: true },
          {
            key: 'movement',
            names: { en: 'Movement' },
            type: 'choice',
            choices: [
              { key: 'auto', names: { en: 'Automatic' } },
              { key: 'quartz', names: { en: 'Quartz' } },
            ],
          },
        ],
      },
    ],
    lists: [
      ...base.lists,
      {
        key: 'watch_condition',
        names: { en: 'Watch condition' },
        values: [
          { key: 'unworn', names: { en: 'Unworn' } },
          { key: 'excellent', names: { en: 'Excellent' }, pool: 'worn' },
          { key: 'good', names: { en: 'Good' }, pool: 'worn' },
        ],
      },
    ],
  };
};

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-categories-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    ...TEST_SOURCES,
    {
      key: 'watchshop',
      label: 'Watch shop',
      market: 'jp',
      currency: 'JPY',
      priceKinds: ['sold'],
      categories: ['watch'],
      roles: { 'watch/watch_condition': 'reference' },
    },
  ]);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it('registers, values and edits items of a category the admin made', async () => {
  expect((await saveTaxonomy(db, withWatches(), false)).blocked).toEqual([]);
  const registry = await loadSourceRegistry(db);
  expect(registry.taxonomy?.categories.map((c) => c.key)).toEqual(['tcg', 'game', 'watch']);

  const { holding, product } = await createHolding(
    db,
    userId,
    {
      product: {
        category: 'watch',
        kind: 'wrist',
        name: 'Seiko SPB143',
        fields: { brand: 'Seiko', movement: 'auto', unknown: 'dropped' },
      },
    },
    { quantity: 1, costTotalBase: 100000, acquiredAt: toLocalIso(), conditionValue: 'excellent' },
  );
  expect(product.itemType).toBe('watch/watch_condition');
  expect(product.fields).toEqual({ brand: 'Seiko', movement: 'auto' });

  // Too few "excellent" sales: the "worn" group (excellent + good) is pooled; unworn is not.
  const day = (n: number) => toLocalIso(new Date(Date.now() - n * 86_400_000));
  await insertObservations(
    db,
    [
      ['watch_condition:good', 90000, 3],
      ['watch_condition:good', 100000, 4],
      ['watch_condition:excellent', 110000, 5],
      ['watch_condition:unworn', 300000, 6],
    ].map(([bucket, price, n], i) => ({
      productId: product.id,
      source: 'watchshop',
      observationType: 'sold' as const,
      bucket: bucket as string,
      priceBase: price as number,
      currency: 'JPY',
      observedAt: day(n as number),
      fetchedAt: day(0),
      externalRef: `w${i}`,
    })),
  );
  const value = (await valueHoldings(db, userId, [{ holding, product }])).get(holding.id)!;
  expect(value).toMatchObject({
    bucket: 'watch_condition:excellent',
    pooled: true,
    unitBase: 100000,
  });

  // Removing a used value and a used choice asks first, then clears them.
  const next = withWatches();
  next.lists.at(-1)!.values = next.lists.at(-1)!.values.filter((v) => v.key !== 'excellent');
  next.categories.at(-1)!.fields[2]!.choices = [{ key: 'quartz', names: { en: 'Quartz' } }];
  const asked = await saveTaxonomy(db, next, false);
  expect(asked.touched.map((t) => [t.code, t.count])).toEqual([
    ['choice_removed', 1],
    ['value_removed', 1],
  ]);
  expect((await categoryUsage(db)).values).toEqual({ 'watch_condition/excellent': 1 });
  await saveTaxonomy(db, next, true);
  const [lot] = await db.select().from(schema.holdings).where(eq(schema.holdings.id, holding.id));
  expect(lot!.conditionValue).toBeNull();
  const [item] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
  expect(item!.fields).toEqual({ brand: 'Seiko' });

  // A category with items cannot be removed (it is hidden instead).
  const removed = { ...next, categories: next.categories.slice(0, 2) };
  await expect(saveTaxonomy(db, removed, true)).rejects.toThrow();
});

it('keeps the built-in item types and roles for TCG and games', async () => {
  const registry = await loadSourceRegistry(db);
  expect(registry.taxonomy?.categories.map((c) => c.key)).toEqual(['tcg', 'game']);
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'software', name: 'Zelda' } },
    { quantity: 1, costTotalBase: 5000, acquiredAt: toLocalIso(), condition: 'new_unused' },
  );
  expect(product.itemType).toBe('game');
  expect(registry.roles.surugaya?.game).toBe('reference');
});
