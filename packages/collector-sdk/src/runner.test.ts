import {
  type Db,
  bucketStats,
  collectorHealth,
  confirmCandidate,
  createDb,
  createHolding,
  createQuerySource,
  createUser,
  currentSupply,
  lowestAsk,
  linkSource,
  listPendingCandidates,
  listProductSources,
  pendingMatchesForUser,
  rejectCandidate,
  saveTaxonomy,
  schema,
  unlinkSource,
} from '@tora/db';
import { resolveTaxonomy } from '@tora/core';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { BlockedError } from './http';
import { pace, runCollector } from './runner';
import type { Collector } from './types';

let db: Db;
let userId: string;
const quiet = { log: () => {}, http: { minDelayMs: 0, maxDelayMs: 0 } };

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-run-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

function fakeCollector(overrides: Partial<Collector> = {}): Collector {
  return {
    source: 'fake',
    label: 'Fake',
    supports: (p) => p.category === 'tcg',
    findCandidates: async () => [
      { externalId: 'X1', title: 'Battle Partners Box', url: 'https://x/1', score: 0.95 },
      { externalId: 'X2', title: 'Battle Partners Pack', url: 'https://x/2', score: 0.4 },
    ],
    collect: async (link, product, ctx) => {
      const day = '2026-10-01';
      await ctx.save(
        [10_000, 11_000, 12_000].map((price, i) => ({
          productId: product.id,
          source: 'fake',
          observationType: 'sold' as const,
          bucket: 'sealed:shrink',
          price,
          currency: 'JPY',
          observedAt: `${day}T12:00:00.000+09:00`,
          fetchedAt: ctx.now.toISOString(),
          externalRef: `${link.externalId}|${day}|${i}`,
        })),
      );
      return { state: { mode: 'incremental', ingestedThrough: day }, complete: true, title: 'Box' };
    },
    ...overrides,
  };
}

async function box() {
  return createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'BP BOX', setName: 'BP' } },
    {
      quantity: 1,
      costTotalBase: 5000,
      acquiredAt: '2026-09-01T00:00:00.000+09:00',
      packagingState: 'sealed_shrink',
    },
  );
}

it('matches, waits for confirmation, then collects idempotently', async () => {
  const { holding, product } = await box();
  await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'amiibo', name: 'amiibo' } },
    {
      quantity: 1,
      costTotalBase: 1000,
      acquiredAt: '2026-09-01T00:00:00.000+09:00',
      condition: 'new_unused',
    },
  );
  const collector = fakeCollector({
    productDetails: (title) => ({ name: `${title} (synced)`, setCode: 'ZZ' }),
  });

  const first = await runCollector(db, collector, quiet);
  expect(first).toMatchObject({ status: 'ok', candidates: 2, observationsAdded: 0 });
  const pending = await listPendingCandidates(db, product.id);
  expect(pending.map((c) => c.externalId)).toEqual(['X1', 'X2']);
  expect(await pendingMatchesForUser(db, userId)).toMatchObject([{ holdingId: holding.id }]);

  // Pending candidates are not searched again.
  expect((await runCollector(db, collector, quiet)).candidates).toBe(0);

  await rejectCandidate(db, pending[1]!.id);
  await confirmCandidate(db, pending[0]!.id);
  expect(await listPendingCandidates(db, product.id)).toHaveLength(0);

  const collected = await runCollector(db, collector, quiet);
  // Details come from the linked listing once; later edits are not overwritten.
  const [synced] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, product.id));
  expect(synced).toMatchObject({ name: 'Box (synced)', setCode: 'ZZ' });
  await db
    .update(schema.products)
    .set({ name: 'My edit' })
    .where(eq(schema.products.id, product.id));
  await runCollector(db, collector, quiet);
  const [kept] = await db.select().from(schema.products).where(eq(schema.products.id, product.id));
  expect(kept?.name).toBe('My edit');
  expect(collected).toMatchObject({ status: 'ok', candidates: 0, observationsAdded: 3 });
  expect((await runCollector(db, collector, quiet)).observationsAdded).toBe(0);

  const [source] = await listProductSources(db, product.id);
  expect(source).toMatchObject({ externalId: 'X1', title: 'Box', observations: 3 });
  expect(source?.lastSuccessAt).toBeTruthy();
  const stats = await bucketStats(db, product.id, 30, new Date('2026-10-09T00:00:00Z'));
  expect(stats).toEqual([
    expect.objectContaining({ bucket: 'sealed:shrink', count: 3, medianBase: 11_000 }),
  ]);

  const runs = await db.select().from(schema.collectorRuns);
  expect(runs.every((r) => r.status === 'ok' && r.finishedAt)).toBe(true);
  const [health] = await collectorHealth(db);
  expect(health).toMatchObject({ source: 'fake', linked: 1, pending: 0 });
});

it('marks the run blocked and stops on 403/429', async () => {
  await box();
  const collector = fakeCollector({
    findCandidates: async () => {
      throw new BlockedError('HTTP 429');
    },
  });
  const run = await runCollector(db, collector, quiet);
  expect(run.status).toBe('blocked');
  const [row] = await db.select().from(schema.collectorRuns);
  expect(row).toMatchObject({ status: 'blocked' });
  expect(row?.error).toContain('429');
});

it('keeps going after one product fails (partial)', async () => {
  await box();
  const run = await runCollector(
    db,
    fakeCollector({
      findCandidates: async () => {
        throw new Error('parse error');
      },
    }),
    quiet,
  );
  expect(run.status).toBe('partial');
  expect(run.errors[0]).toContain('parse error');
});

it('offers a linked look-alike instead of searching the site', async () => {
  const first = await box();
  await linkSource(db, first.product.id, {
    source: 'fake',
    externalId: 'L9',
    title: 'BP BOX listing',
  });
  // Same name and kind, registered separately.
  const second = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'BP  BOX' } },
    {
      quantity: 1,
      costTotalBase: 5000,
      acquiredAt: '2026-10-01T12:00:00.000+09:00',
      packagingState: 'sealed_shrink',
    },
  );
  let searched = 0;
  const collector = fakeCollector({
    findCandidates: async () => {
      searched++;
      return [];
    },
  });
  await runCollector(db, collector, { ...quiet, matchOnly: true });
  expect(searched).toBe(0);
  expect((await listPendingCandidates(db, second.product.id)).map((c) => c.externalId)).toEqual([
    'L9',
  ]);
});

it('search-based sources: every product gets its query once, and an unlinked one stays off', async () => {
  const { product } = await box();
  const queries: unknown[] = [];
  const collector = fakeCollector({
    defaultQuery: (p) => ({ keywords: [p.name] }),
    collect: async (link) => {
      queries.push(link.query);
      return { state: { mode: 'incremental' }, complete: true };
    },
  });
  await runCollector(db, collector, quiet);
  expect(queries).toEqual([{ keywords: ['BP BOX'] }]);
  const [source] = await listProductSources(db, product.id);
  expect(source).toMatchObject({ source: 'fake', externalId: 'search', active: true });

  await unlinkSource(db, source!.id);
  await runCollector(db, collector, quiet);
  expect((await listProductSources(db, product.id)).filter((s) => s.active)).toEqual([]);
  expect(queries).toHaveLength(1);
});

it('replaces auto-made queries of an older version, but keeps edited ones', async () => {
  const a = await box();
  const b = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: 'Other BOX' } },
    {
      quantity: 1,
      costTotalBase: 1,
      acquiredAt: '2026-10-01T12:00:00.000+09:00',
      packagingState: 'sealed_shrink',
    },
  );
  await createQuerySource(db, a.product.id, 'fake', {
    keywords: ['old'],
    extra: { references: ['https://x/1'] },
  });
  await createQuerySource(db, b.product.id, 'fake', {
    keywords: ['mine'],
    extra: { edited: true },
  });
  const seen = new Map<string, unknown>();
  const collector = fakeCollector({
    defaultQuery: (p) => ({ keywords: [`new ${p.name}`], extra: { auto: true, v: 2 } }),
    queryVersion: 2,
    collect: async (link) => {
      seen.set(link.productId, link.query?.keywords);
      return { state: { mode: 'incremental' }, complete: true };
    },
  });
  await runCollector(db, collector, { ...quiet, collectOnly: true });
  expect(seen.get(a.product.id)).toEqual(['new BP BOX']);
  // What the user added to the old query stays.
  const [upgraded] = await listProductSources(db, a.product.id);
  expect(upgraded?.query?.extra).toMatchObject({ references: ['https://x/1'], v: 2 });
  expect(seen.get(b.product.id)).toEqual(['mine']);
});

it('searches newer items too when older ones are of a kind the source does not handle', async () => {
  // 60 older items the fake source skips (games) must not take every slot of a run.
  for (let i = 0; i < 60; i++) {
    await createHolding(
      db,
      userId,
      { product: { category: 'game', kind: 'software', name: `Game ${i}` } },
      { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-09-01T00:00:00.000+09:00' },
    );
  }
  const { product } = await box();
  const run = await runCollector(db, fakeCollector(), { ...quiet, matchOnly: true });
  expect(run.candidates).toBe(2);
  expect((await listPendingCandidates(db, product.id)).length).toBe(2);
});

it('collects for a category the admin made, in its own condition values (S16)', async () => {
  const taxonomy = resolveTaxonomy(null);
  await saveTaxonomy(
    db,
    {
      categories: [
        ...taxonomy.categories,
        {
          key: 'watch',
          kinds: [{ key: 'wrist', conditions: 'watch_condition' }],
          fields: [{ key: 'brand', type: 'text' }],
        },
      ],
      lists: [
        ...taxonomy.lists,
        {
          key: 'watch_condition',
          values: [
            { key: 'unworn', names: { en: 'Unworn' } },
            { key: 'worn', names: { en: 'Worn' } },
          ],
        },
      ],
    },
    false,
  );
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'watch', kind: 'wrist', name: 'Seiko', fields: { brand: 'Seiko' } } },
    {
      quantity: 1,
      costTotalBase: 90_000,
      acquiredAt: '2026-09-01T00:00:00.000+09:00',
      conditionValue: 'unworn',
    },
  );
  await linkSource(db, product.id, { source: 'watches', externalId: 'W1' });
  const seen: string[] = [];
  const collector = fakeCollector({
    source: 'watches',
    supports: (p) => p.category === 'watch',
    findCandidates: async () => [],
    collect: async (link, p, ctx) => {
      seen.push(`${p.category}/${p.kind}/${p.itemType}/${p.fields?.brand}`);
      await ctx.save([
        {
          productId: p.id,
          source: 'watches',
          observationType: 'sold' as const,
          bucket: 'watch_condition:unworn',
          price: 100_000,
          currency: 'JPY',
          observedAt: '2026-10-01T12:00:00.000+09:00',
          fetchedAt: ctx.now.toISOString(),
          externalRef: 'w1',
        },
      ]);
      return { state: {}, complete: true };
    },
  });
  expect(await runCollector(db, collector, quiet)).toMatchObject({
    status: 'ok',
    observationsAdded: 1,
  });
  expect(seen).toEqual(['watch/wrist/watch/watch_condition/Seiko']);
  const stats = await bucketStats(db, product.id, 30, new Date('2026-10-09T00:00:00Z'));
  expect(stats).toEqual([expect.objectContaining({ bucket: 'watch_condition:unworn', count: 1 })]);
});

it("uses a plug-in's own pace, never faster than 2 s", () => {
  const plugin = (http?: Collector['http']) => ({ source: 'x', http }) as Collector;
  expect(pace(plugin())).toEqual({ minDelayMs: 2000, maxDelayMs: 5000 });
  expect(pace(plugin({ minDelayMs: 8000, maxRequests: 50 }))).toEqual({
    minDelayMs: 8000,
    maxDelayMs: 8000,
    maxRequests: 50,
  });
  expect(pace(plugin({ minDelayMs: 100, maxDelayMs: 500 }))).toMatchObject({
    minDelayMs: 2000,
    maxDelayMs: 2000,
  });
});

it('leaves out listings already collected today, on the home PC clock', async () => {
  const { product } = await box();
  let calls = 0;
  const collector = fakeCollector({
    collect: async () => (calls++, { state: null, complete: true }),
  });
  await runCollector(db, collector, quiet);
  await confirmCandidate(db, (await listPendingCandidates(db, product.id))[0]!.id);
  const today = { ...quiet, skipCollectedToday: true };
  await runCollector(db, collector, today);
  expect(calls).toBe(1);
  // Started again the same day (a retry): nothing left to do.
  await runCollector(db, collector, today);
  expect(calls).toBe(1);
  // Another day.
  await runCollector(db, collector, { ...today, now: new Date(Date.now() + 86_400_000) });
  expect(calls).toBe(2);
});

it('saves what is for sale now, one report per source and day', async () => {
  const { product } = await box();
  await linkSource(db, product.id, { source: 'fake', externalId: 'X1' });
  let report = [
    { bucket: 'sealed:shrink', lowestAsk: 9_000, currency: 'JPY', listings: 12 },
    { bucket: 'sealed:no_shrink', lowestAsk: 8_000, currency: 'JPY', listings: null },
  ];
  const collector = fakeCollector({
    collect: async () => ({ state: null, complete: true, supply: report }),
  });
  const day1 = new Date('2026-10-10T03:00:00Z');
  await runCollector(db, collector, { ...quiet, collectOnly: true, now: day1 });
  // A second run the same day replaces that day's numbers.
  report = [
    { bucket: 'sealed:shrink', lowestAsk: 9_500, currency: 'JPY', listings: 10 },
    report[1]!,
  ];
  await runCollector(db, collector, { ...quiet, collectOnly: true, now: day1 });
  let rows = (await currentSupply(db, [product.id], day1)).get(product.id)!;
  expect(rows).toHaveLength(2);
  expect(lowestAsk(rows, 'sealed:shrink')).toMatchObject({
    lowestAskBase: 9_500,
    lowestAskOriginal: 9_500,
    listings: 10,
    day: '2026-10-10',
  });
  // The next day only what is listed that day counts.
  report = [{ bucket: 'sealed:shrink', lowestAsk: 9_800, currency: 'JPY', listings: 9 }];
  const day2 = new Date('2026-10-11T03:00:00Z');
  await runCollector(db, collector, { ...quiet, collectOnly: true, now: day2 });
  rows = (await currentSupply(db, [product.id], day2)).get(product.id)!;
  expect(rows.map((r) => [r.bucket, r.lowestAskBase])).toEqual([['sealed:shrink', 9_800]]);
  // Too old: nothing for sale now.
  expect((await currentSupply(db, [product.id], new Date('2026-10-20T03:00:00Z'))).size).toBe(0);
});
