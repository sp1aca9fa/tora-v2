import { type Taxonomy, resolveTaxonomy, taxonomyVersion, toLocalIso } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { categoryUsage, saveTaxonomy, sentTaxonomyRefusals } from './categories';
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

it("takes the admin's own regions, refuses others, and clears a removed one after asking", async () => {
  const base = resolveTaxonomy(null);
  const withSpanish = (regions: string[]): Taxonomy => ({
    ...base,
    categories: base.categories.map((c) =>
      c.key === 'tcg'
        ? { ...c, regions, regionNames: { es: { en: 'Spanish', es: 'Español' } } }
        : c,
    ),
  });
  await saveTaxonomy(db, withSpanish(['jp', 'en', 'es']), true);
  const card = (region: string) =>
    createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'single', name: 'Umbreon VMAX', region } },
      { quantity: 1, costTotalBase: 100, acquiredAt: toLocalIso() },
    );
  const { product } = await card('es');
  expect(product.region).toBe('es');
  await expect(card('xx')).rejects.toThrow('invalid_input');
  expect((await categoryUsage(db)).regions['tcg/es']).toBe(1);

  const change = await saveTaxonomy(db, withSpanish(['jp', 'en']), false);
  expect(change.touched).toEqual([{ code: 'region_removed', name: 'tcg: es', count: 1 }]);
  await saveTaxonomy(db, withSpanish(['jp', 'en']), true);
  const [after] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
  expect(after!.region).toBeNull();
});

it('refuses a save over categories saved since the form loaded them (G46)', async () => {
  // Tab A loads the stored taxonomy; tab B saves a new value (value3) in the meantime.
  await saveTaxonomy(db, withWatches(), true);
  const loadedA = (await loadSourceRegistry(db)).taxonomy!;
  // What the page hands the browser: the same data through JSON, keys in another order.
  const inBrowser = JSON.parse(JSON.stringify(loadedA)) as Taxonomy;
  inBrowser.lists = inBrowser.lists.map((l) => {
    const { values, key, ...rest } = l;
    return { values, ...rest, key };
  });
  const versionA = taxonomyVersion(inBrowser);
  const own = (t: Taxonomy) => t.lists.filter((l) => !l.builtIn);
  expect(sentTaxonomyRefusals(loadedA, own(loadedA), versionA)).toEqual([]);

  const withB = withWatches();
  withB.lists = withB.lists.map((l) =>
    l.key === 'watch_condition'
      ? { ...l, values: [...l.values, { key: 'value3', names: { ja: '新品同様' } }] }
      : l,
  );
  await saveTaxonomy(db, withB, true);
  const stored = (await loadSourceRegistry(db)).taxonomy!;
  expect(sentTaxonomyRefusals(stored, own(stored), versionA)).toEqual(['stale']);
  // A form without a version (loaded before this check) is refused too.
  expect(sentTaxonomyRefusals(stored, own(stored), undefined)).toEqual(['stale']);
  // Reloaded, the form's version is the stored one again.
  expect(sentTaxonomyRefusals(stored, own(stored), taxonomyVersion(stored))).toEqual([]);
});

it('checks the version again inside the write, so two saves from one version cannot both land', async () => {
  await saveTaxonomy(db, withWatches(), true);
  const v0 = taxonomyVersion((await loadSourceRegistry(db)).taxonomy!);
  const withValue = (key: string, ja: string) => {
    const t = withWatches();
    t.lists = t.lists.map((l) =>
      l.key === 'watch_condition' ? { ...l, values: [...l.values, { key, names: { ja } }] } : l,
    );
    return t;
  };
  // Both tabs passed the early check at v0; the first write lands, the second is refused.
  expect((await saveTaxonomy(db, withValue('value3', '新品同様'), true, v0)).blocked).toEqual([]);
  const second = await saveTaxonomy(db, withValue('value3', '美品'), true, v0);
  expect(second.blocked).toEqual(['stale']);
  const stored = (await loadSourceRegistry(db)).taxonomy!;
  const list = stored.lists.find((l) => l.key === 'watch_condition')!;
  expect(list.values.find((v) => v.key === 'value3')?.names).toEqual({ ja: '新品同様' });
});

it('refuses an own list on a key the app keeps instead of dropping it (G47)', async () => {
  await saveTaxonomy(db, withWatches(), true);
  const prev = (await loadSourceRegistry(db)).taxonomy!;
  const raw = {
    key: 'raw',
    names: { en: 'Raw' },
    values: [{ key: 'mint', names: { en: 'Mint' } }],
  };
  const lists = [...prev.lists.filter((l) => !l.builtIn), raw];
  expect(sentTaxonomyRefusals(prev, lists, taxonomyVersion(prev))).toEqual(['list_key']);
  // Resolved first, the list would be gone and the save would pass.
  expect(resolveTaxonomy({ ...prev, lists }).lists.some((l) => l.key === 'raw')).toBe(false);
  for (const key of ['graded', 'cond', 'card_grades']) {
    expect(sentTaxonomyRefusals(prev, [{ ...raw, key }], taxonomyVersion(prev))).toEqual([
      'list_key',
    ]);
  }
});
