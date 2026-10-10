import {
  type Db,
  bucketStats,
  collectorHealth,
  confirmCandidate,
  createDb,
  createHolding,
  createUser,
  linkSource,
  listPendingCandidates,
  listProductSources,
  pendingMatchesForUser,
  rejectCandidate,
  schema,
  unlinkSource,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { BlockedError } from './http';
import { runCollector } from './runner';
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
          priceJpy: price,
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
      costTotalJpy: 5000,
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
      costTotalJpy: 1000,
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
    expect.objectContaining({ bucket: 'sealed:shrink', count: 3, medianJpy: 11_000 }),
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
      costTotalJpy: 5000,
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
