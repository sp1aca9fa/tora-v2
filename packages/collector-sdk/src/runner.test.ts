import {
  type Db,
  addNight,
  addWatch,
  bucketStats,
  insertObservations,
  saveSourceInfos,
  collectorHealth,
  confirmCandidate,
  createDb,
  createHolding,
  createProduct,
  createQuerySource,
  createUser,
  currentSupply,
  leaveListingGone,
  lowestAsk,
  linkSource,
  pendingActions,
  listPendingCandidates,
  listProductSources,
  pendingMatchesForUser,
  productsWithBrokenListings,
  rejectCandidate,
  saveItemRules,
  saveSourceFacts,
  storedJan,
  storedJans,
  saveTaxonomy,
  schema,
  trackGame,
  unlinkSource,
  untrackGame,
} from '@tora/db';
import { resolveTaxonomy } from '@tora/core';
import { migrateDb } from '@tora/db/migrate';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BlockedError, ListingGoneError, RequestCapError } from './http';
import { pace, runCollector } from './runner';
import type { Collector } from './types';
import { baseConverter } from './money';
import { saveObservations } from './save';

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
  expect(run.capReached).toBe(false);
});

it('says when a run stopped at its request cap, so the schedule continues it', async () => {
  await box();
  const run = await runCollector(
    db,
    fakeCollector({
      findCandidates: async () => {
        throw new RequestCapError();
      },
    }),
    quiet,
  );
  expect(run).toMatchObject({ status: 'partial', capReached: true });
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

it('searches an item with no match once a day, a retry leaving it out', async () => {
  await box();
  let searches = 0;
  const collector = fakeCollector({ findCandidates: async () => (searches++, []) });
  const today = { ...quiet, skipCollectedToday: true };
  await runCollector(db, collector, today);
  await runCollector(db, collector, today);
  expect(searches).toBe(1);
  // Asked for by hand (no skipping), and on another day.
  await runCollector(db, collector, quiet);
  expect(searches).toBe(2);
  await runCollector(db, collector, { ...today, now: new Date(Date.now() + 86_400_000) });
  expect(searches).toBe(3);
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

it('gives every listing its new sales first, held items before candidates, then older history', async () => {
  const candidate = await createProduct(db, null, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Ranked BOX',
    setName: 'RK',
  });
  await linkSource(db, candidate.id, { source: 'fake', externalId: 'C1' });
  const { product } = await box();
  await linkSource(db, product.id, { source: 'fake', externalId: 'H1' });
  const calls: string[] = [];
  let requests = 0;
  const collector = fakeCollector({
    historyPhase: true,
    collect: async (link, _p, ctx) => {
      calls.push(`${ctx.phase} ${link.externalId}`);
      // Each history pass uses up the rest of the run's requests.
      if (ctx.phase === 'history' && ++requests > 1) throw new RequestCapError();
      return { state: { phase: ctx.phase }, complete: false };
    },
  });
  const summary = await runCollector(db, collector, { ...quiet, collectOnly: true });
  expect(calls).toEqual(['fresh H1', 'fresh C1', 'history H1', 'history C1']);
  // Running out during the history is normal: it continues next run.
  expect(summary.status).toBe('ok');
  const held = (await listProductSources(db, product.id)).find((s) => s.externalId === 'H1')!;
  expect(held.state).toEqual({ phase: 'history' });
});

it('sets a listing aside after 3 nights gone, then asks for a new link; other errors never do', async () => {
  const { product } = await box();
  await linkSource(db, product.id, { source: 'fake', externalId: 'X1' });
  let error: Error = new Error('database is locked');
  const collector = fakeCollector({
    collect: async () => {
      throw error;
    },
  });
  const night = (n: number) => ({
    ...quiet,
    collectOnly: true,
    now: new Date(Date.UTC(2026, 9, 10 + n, 3)),
  });
  const link = async () =>
    (await listProductSources(db, product.id)).find((s) => s.externalId === 'X1')!;
  for (const n of [0, 1, 2, 3]) await runCollector(db, collector, night(n));
  expect((await link()).active).toBe(true);
  expect((await link()).failure).toBeNull();

  error = new ListingGoneError('item X1 not found');
  let calls = 0;
  collector.collect = async () => {
    calls++;
    throw error;
  };
  expect((await runCollector(db, collector, night(4))).status).toBe('partial');
  // A retry the same night does not count again.
  await runCollector(db, collector, night(4));
  expect((await link()).failure).toMatchObject({ nights: 1 });
  // A same-day retry leaves the gone page until tomorrow, so it is no longer partial over it.
  expect(calls).toBe(2);
  const retry = await runCollector(db, collector, { ...night(4), skipCollectedToday: true });
  expect(retry.status).toBe('ok');
  expect(calls).toBe(2);
  await runCollector(db, collector, night(5));
  const third = await runCollector(db, collector, night(6));
  expect(third.status).toBe('ok');
  expect(third.setAside).toEqual([
    expect.objectContaining({ error: expect.stringContaining('X1') }),
  ]);
  expect(await link()).toMatchObject({ active: false, failure: { nights: 3 } });
  const cards = await pendingActions(db, userId);
  expect(cards).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'source', source: 'fake', broken: expect.anything() }),
    ]),
  );
  // An admin who does not hold the item sees only that card for it.
  const admin = (
    await createUser(db, 'bob', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  expect(
    (await pendingActions(db, admin, null, { admin: true })).filter(
      (c) => 'product' in c && c.product?.id === product.id,
    ),
  ).toEqual([
    expect.objectContaining({ kind: 'source', source: 'fake', broken: expect.anything() }),
  ]);
  expect(await pendingActions(db, admin)).toEqual([]);
  // Linked again: collected as before.
  await linkSource(db, product.id, { source: 'fake', externalId: 'X1' });
  expect(await link()).toMatchObject({ active: true, failure: null });
});

describe('a listing set aside is tried again every 7 days', () => {
  const SET_ASIDE_AT = '2026-10-12T03:00:00.000+09:00';
  const failure = {
    nights: 3,
    since: '2026-10-10',
    day: '2026-10-12',
    error: 'gone',
    brokenAt: SET_ASIDE_AT,
  };
  // 03:00 in the install's zone, N days after it was set aside.
  const after = (days: number) => ({
    ...quiet,
    collectOnly: true,
    now: new Date(Date.parse(SET_ASIDE_AT) + days * 86_400_000),
  });
  const setAside = async (externalId: string, extra: object = {}) => {
    const { product } = await box();
    return setAsideOn(product.id, externalId, extra);
  };
  const setAsideOn = async (productId: string, externalId: string, extra: object = {}) => {
    const link = await linkSource(db, productId, { source: 'fake', externalId });
    await db
      .update(schema.productSources)
      .set({ active: false, failure: { ...failure, ...extra } })
      .where(eq(schema.productSources.id, link.id));
    return productId;
  };
  const unheld = (name: string) =>
    createProduct(db, null, { category: 'tcg', kind: 'booster_box', name });
  const linkOf = async (productId: string, externalId = 'X1') =>
    (await listProductSources(db, productId)).find((s) => s.externalId === externalId)!;
  const failing = (error: Error, calls: string[] = []) =>
    fakeCollector({
      collect: async (link) => {
        calls.push(link.externalId!);
        throw error;
      },
    });

  it('a failure waits another 7 days, with no alert and no repeated set aside', async () => {
    const id = await setAside('X1');
    const calls: string[] = [];
    const collector = failing(new ListingGoneError('still gone'), calls);
    expect((await runCollector(db, collector, after(6))).status).toBe('ok');
    expect(calls).toEqual([]);
    const tried = await runCollector(db, collector, after(7));
    expect(calls).toEqual(['X1']);
    expect(tried).toMatchObject({ status: 'ok', errors: [], setAside: [] });
    expect(await linkOf(id)).toMatchObject({
      active: false,
      failure: {
        nights: 3,
        day: '2026-10-12',
        brokenAt: SET_ASIDE_AT,
        error: expect.stringContaining('still gone'),
      },
    });
    // Asked once: again that day (any kind of run) and until its 7 days are up, nothing.
    await runCollector(db, collector, after(7));
    await runCollector(db, collector, after(13));
    expect(calls).toHaveLength(1);
    expect((await runCollector(db, collector, after(14))).setAside).toEqual([]);
    expect(calls).toHaveLength(2);
    // Still on Actions meanwhile.
    expect(await productsWithBrokenListings(db)).toHaveLength(1);
  });

  it('any other failure waits too, without making the run partial', async () => {
    const id = await setAside('X1');
    const run = await runCollector(db, failing(new Error('a changed page?')), after(7));
    expect(run).toMatchObject({ status: 'ok', errors: [], setAside: [] });
    expect((await linkOf(id)).failure).toMatchObject({ error: 'a changed page?' });
    expect((await linkOf(id)).active).toBe(false);
  });

  it('a success brings it back by itself: active, failure cleared, the Actions card gone', async () => {
    const id = await setAside('X1');
    expect(await pendingActions(db, userId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'source', source: 'fake' })]),
    );
    const run = await runCollector(db, fakeCollector(), after(7));
    expect(run).toMatchObject({ status: 'ok', observationsAdded: 3, setAside: [] });
    const link = await linkOf(id);
    expect(link).toMatchObject({ active: true, failure: null });
    expect(link.lastSuccessAt).toBeTruthy();
    expect(await productsWithBrokenListings(db)).toEqual([]);
    expect(
      (await pendingActions(db, userId)).filter(
        (c) => c.kind === 'source' && c.source === 'fake' && c.broken,
      ),
    ).toEqual([]);
    // From then on an ordinary listing: three more nights gone set it aside again, with an alert.
    const collector = failing(new ListingGoneError('gone again'));
    await runCollector(db, collector, after(8));
    await runCollector(db, collector, after(9));
    const third = await runCollector(db, collector, after(10));
    expect(third.setAside).toHaveLength(1);
  });

  it('a person leaving it gone during the run wins over the try', async () => {
    const id = await setAside('X1');
    const collector = fakeCollector({
      collect: async () => {
        await leaveListingGone(db, id, 'fake');
        return { state: null, complete: true };
      },
    });
    expect((await runCollector(db, collector, after(7))).status).toBe('ok');
    const link = await linkOf(id);
    expect(link).toMatchObject({ active: false, lastSuccessAt: null });
    expect(link.failure?.leftAt).toBeTruthy();
  });

  it('a person linking a new page during the run wins: never two active listings', async () => {
    const id = await setAside('X1');
    let history = 0;
    const collector = fakeCollector({
      historyPhase: true,
      collect: async (_link, _product, ctx) => {
        if (ctx.phase === 'history') history++;
        else await linkSource(db, id, { source: 'fake', externalId: 'X2' });
        return { state: null, complete: false };
      },
    });
    await runCollector(db, collector, after(7));
    expect((await linkOf(id)).active).toBe(false);
    expect((await listProductSources(db, id)).filter((s) => s.active)).toHaveLength(1);
    expect((await linkOf(id, 'X2')).active).toBe(true);
    expect(history).toBe(0);
  });

  it('an active listing of another item or source does not stop it coming back', async () => {
    const id = await setAside('X1');
    await linkSource(db, id, { source: 'other', externalId: 'O1' });
    await linkSource(db, (await unheld('Another')).id, { source: 'fake', externalId: 'X1' });
    await runCollector(db, fakeCollector(), after(7));
    expect((await linkOf(id)).active).toBe(true);
  });

  it('a refusal or the request cap is no try: it stays due', async () => {
    const id = await setAside('X1');
    const blocked = await runCollector(db, failing(new BlockedError('403')), after(7));
    expect(blocked.status).toBe('blocked');
    expect((await linkOf(id)).failure).toEqual(failure);
    const capped = await runCollector(db, failing(new RequestCapError()), after(7));
    expect(capped).toMatchObject({ status: 'partial', capReached: true });
    expect((await linkOf(id)).failure).toEqual(failure);
    await runCollector(db, fakeCollector(), after(8));
    expect(await linkOf(id)).toMatchObject({ active: true, failure: null });
  });

  it('leaves alone one a person left gone, and one whose item has a new link', async () => {
    const calls: string[] = [];
    const collector = failing(new ListingGoneError('gone'), calls);
    const left = await setAside('X1');
    expect(await leaveListingGone(db, left, 'fake')).toBe(true);
    await runCollector(db, collector, after(30));
    expect(calls).toEqual([]);

    const relinked = (await unheld('Other')).id;
    await setAsideOn(relinked, 'R1');
    await linkSource(db, relinked, { source: 'fake', externalId: 'R2' });
    await runCollector(db, collector, after(30));
    expect(calls).toEqual(['R2']);
    expect((await linkOf(relinked, 'R1')).active).toBe(false);
  });

  it("of an item's listings set aside, tries only the newest", async () => {
    const calls: string[] = [];
    const id = await setAside('X1');
    await setAsideOn(id, 'X2', { brokenAt: '2026-10-13T03:00:00.000+09:00' });
    await runCollector(db, failing(new ListingGoneError('gone'), calls), after(10));
    expect(calls).toEqual(['X2']);
  });

  it('of two set aside together, tries one, and never brings both back', async () => {
    const id = await setAside('X1');
    await setAsideOn(id, 'X2');
    const calls: string[] = [];
    const works = fakeCollector();
    const collect = works.collect;
    works.collect = (link, ...rest) => {
      calls.push(link.externalId!);
      return collect(link, ...rest);
    };
    await runCollector(db, works, after(7));
    expect(calls).toHaveLength(1);
    expect((await listProductSources(db, id)).filter((s) => s.active)).toHaveLength(1);
    await runCollector(db, works, after(14));
    expect((await listProductSources(db, id)).filter((s) => s.active)).toHaveLength(1);
  });

  it('goes in the same order as other listings: held first, then the oldest', async () => {
    const calls: string[] = [];
    const held = await setAside('OLD');
    const collected = async (productId: string, externalId: string, at: string) => {
      await db
        .update(schema.productSources)
        .set({ lastSuccessAt: at })
        .where(
          and(
            eq(schema.productSources.productId, productId),
            eq(schema.productSources.externalId, externalId),
          ),
        );
    };
    await collected(held, 'OLD', '2026-10-01T03:00:00.000+09:00');
    const { product: active } = await createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'booster_box', name: 'Active', setName: 'A' } },
      {
        quantity: 1,
        costTotalBase: 5000,
        acquiredAt: '2026-09-01T00:00:00.000+09:00',
        packagingState: 'sealed_shrink',
      },
    );
    await linkSource(db, active.id, { source: 'fake', externalId: 'NEW' });
    await collected(active.id, 'NEW', '2026-10-15T03:00:00.000+09:00');
    await setAsideOn((await unheld('Nobody tracks it')).id, 'NOBODY');
    await runCollector(db, failing(new ListingGoneError('gone'), calls), after(7));
    expect(calls).toEqual(['OLD', 'NEW', 'NOBODY']);
  });

  it('the request cap stops it like any other listing, leaving the next for the next run', async () => {
    const calls: string[] = [];
    await setAside('X1');
    await setAsideOn((await unheld('Nobody tracks it')).id, 'Y1');
    await runCollector(db, failing(new RequestCapError(), calls), after(7));
    expect(calls).toEqual(['X1']);
  });

  it('with a one-product run: only that product', async () => {
    const calls: string[] = [];
    const id = await setAside('X1');
    const collector = failing(new ListingGoneError('gone'), calls);
    await runCollector(db, collector, { ...after(7), productId: 'another' });
    expect(calls).toEqual([]);
    await runCollector(db, collector, { ...after(7), productId: id });
    expect(calls).toEqual(['X1']);
  });
});

it('leaves a gone page unlinked: no card until a new match, a pasted link still links', async () => {
  const { product } = await box();
  await linkSource(db, product.id, { source: 'fake', externalId: 'X1' });
  const failure = { nights: 3, since: '2026-10-10', day: '2026-10-12', error: 'gone' };
  await db
    .update(schema.productSources)
    .set({ active: false, failure: { ...failure, brokenAt: '2026-10-12T03:00:00.000+09:00' } })
    .where(eq(schema.productSources.productId, product.id));
  // The search offers another edition.
  let searches = 0;
  let found = [{ externalId: 'X9', title: 'BP BOX Collector', url: 'https://x/9', score: 0.8 }];
  const collector = fakeCollector({
    findCandidates: async () => {
      searches++;
      return found;
    },
    // Its page stays gone when its weekly try comes.
    collect: async () => {
      throw new ListingGoneError('item X1 not found');
    },
  });
  const sourceCards = async () =>
    (await pendingActions(db, userId)).filter((c) => c.kind === 'source' && c.source === 'fake');
  await runCollector(db, collector, quiet);
  expect(searches).toBe(1);
  const card = (await pendingActions(db, userId)).find(
    (c) => c.kind === 'source' && c.source === 'fake',
  );
  expect(card).toMatchObject({ broken: expect.anything(), candidates: [expect.anything()] });

  expect(await leaveListingGone(db, product.id, 'fake')).toBe(true);
  expect(await sourceCards()).toEqual([]);
  expect(await listPendingCandidates(db, product.id)).toEqual([]);
  expect(await productsWithBrokenListings(db)).toEqual([]);
  // Searched again: the rejected edition stays away, the page back shows as a suggestion.
  const day = (n: number) => ({ ...quiet, now: new Date(Date.now() + n * 86_400_000) });
  await runCollector(db, collector, day(1));
  expect(searches).toBe(2);
  expect(await sourceCards()).toEqual([]);
  found = [{ externalId: 'X1', title: 'BP BOX', url: 'https://x/1', score: 0.9 }];
  await runCollector(db, collector, day(2));
  expect(await sourceCards()).toEqual([
    expect.objectContaining({
      broken: null,
      candidates: [expect.objectContaining({ title: 'BP BOX' })],
    }),
  ]);
  expect((await listProductSources(db, product.id))[0]).toMatchObject({ active: false });

  await linkSource(db, product.id, { source: 'fake', externalId: 'X2' });
  expect((await listProductSources(db, product.id)).filter((s) => s.active)).toHaveLength(1);
});

it('gives a plug-in its item kept sales in its own market only', async () => {
  const { product } = await box();
  await saveSourceInfos(db, [
    { key: 'jp-a', label: 'A', market: 'jp', currency: 'JPY' },
    { key: 'jp-b', label: 'B', market: 'jp', currency: 'JPY' },
    { key: 'us', label: 'US', market: 'us', currency: 'USD' },
    { key: 'none', label: 'No market', currency: 'JPY' },
  ]);
  const sale = (source: string, price: number, currency = 'JPY') => ({
    productId: product.id,
    source,
    observationType: 'sold' as const,
    bucket: 'sealed:shrink',
    priceBase: price,
    currency,
    observedAt: '2026-10-05T12:00:00.000+09:00',
    fetchedAt: '2026-10-05T12:00:00.000+09:00',
    externalRef: `${source}|${price}`,
  });
  await insertObservations(db, [sale('jp-a', 100), sale('jp-b', 200), sale('us', 300, 'USD')]);
  const read = async (source: string) => {
    let got: { price: number }[] | undefined;
    const collector = fakeCollector({
      source,
      collect: async (_link, p, ctx) => {
        got = await ctx.keptSales?.(p.id, Date.parse('2026-10-01T00:00:00Z'));
        return { state: {}, complete: true };
      },
    });
    await linkSource(db, product.id, { source, externalId: 'X', url: 'https://x' });
    await runCollector(db, collector, { ...quiet, collectOnly: true });
    return got?.map((s) => s.price).toSorted((a, b) => a - b);
  };
  expect(await read('jp-a')).toEqual([100, 200]);
  expect(await read('jp-b')).toEqual([100, 200]);
  // Never across markets; another currency cannot be compared; no market, no read.
  expect(await read('us')).toEqual([]);
  expect(await read('none')).toEqual([]);
});

it('a history read that fails leaves the listing running, its sales unchecked', async () => {
  const { product } = await box();
  await saveSourceInfos(db, [{ key: 'jp-a', label: 'A', market: 'jp', currency: 'JPY' }]);
  await linkSource(db, product.id, { source: 'jp-a', externalId: 'X', url: 'https://x' });
  const logs: string[] = [];
  let got: unknown;
  const collector = fakeCollector({
    source: 'jp-a',
    collect: async (_link, p, ctx) => {
      await db.$client.execute('alter table item_sales rename to item_sales_away');
      got = await ctx.keptSales?.(p.id, 0);
      await db.$client.execute('alter table item_sales_away rename to item_sales');
      return { state: {}, complete: true };
    },
  });
  const summary = await runCollector(db, collector, {
    ...quiet,
    collectOnly: true,
    log: (m) => logs.push(m),
  });
  expect(got).toEqual([]);
  expect(summary).toMatchObject({ status: 'ok', errors: [] });
  expect(logs.join('\n')).toContain('far prices not checked');
});

it('records the night a source was read for a game, not for a failed link or a card (S36)', async () => {
  const { product: card } = await box();
  const game = (name: string) =>
    createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });
  const ok = await game('Hero Quest');
  const broken = await game('Broken Quest');
  const off = await game('Off Quest');
  await saveItemRules(
    db,
    off.id,
    {
      console: null,
      edition: null,
      required: [],
      excluded: [],
      boxed: false,
      boxedOf: null,
      gameRules: 0,
    },
    userId,
  );
  for (const [p, id] of [
    [card, 'C1'],
    [ok, 'G1'],
    [broken, 'G2'],
    [off, 'G3'],
  ] as const)
    await linkSource(db, p.id, { source: 'fake', externalId: id });
  const now = new Date('2026-11-10T03:00:00.000Z');
  await runCollector(
    db,
    fakeCollector({
      supports: () => true,
      collect: async (link) => {
        if (link.externalId === 'G2') throw new Error('parse error');
        return { state: null, complete: true };
      },
    }),
    { ...quiet, now },
  );
  const rows = await db.select().from(schema.saleCoverage);
  expect(rows.map((r) => [r.productId, r.source, r.nights])).toEqual([
    [ok.id, 'fake', [['2026-11-10', '2026-11-10']]],
  ]);
});

it("records a game's night only once its rows are saved: a save that throws records none", async () => {
  const g = await createProduct(db, userId, {
    category: 'game',
    kind: 'software',
    name: 'Hero Quest',
    platform: 'Alpha',
  });
  await linkSource(db, g.id, { source: 'fake', externalId: 'G1' });
  // A listing in a currency with no rate: converting it throws, so nothing of the link is stored.
  const supply = [{ bucket: 'cond:good', lowestAsk: 50, currency: 'XQZ', listings: 1 }];
  const summary = await runCollector(
    db,
    fakeCollector({
      supports: () => true,
      collect: async () => ({ state: null, complete: true, supply }),
    }),
    { ...quiet, collectOnly: true, now: new Date('2026-11-10T03:00:00.000Z') },
  );
  expect(summary.errors.length).toBe(1);
  expect(await db.select().from(schema.saleCoverage)).toEqual([]);
});

it('a tracked game no one holds or wishes: read at the identity shop on its slot night only; cards and sealed as before', async () => {
  await saveSourceInfos(db, [
    {
      key: 'fake',
      market: 'jp',
      label: 'Fake',
      priority: 10,
      roles: { game: 'reference' },
      identity: ['game'],
    },
    { key: 'other', market: 'jp', label: 'Other', priority: 20, roles: { game: 'supporting' } },
  ]);
  const { product: sealed } = await box();
  const card = await createProduct(db, userId, {
    category: 'tcg',
    kind: 'single',
    name: 'Hero Card',
  });
  const game = (name: string) =>
    createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });
  const [onSlot, offSlot, wished] = [
    await game('On slot'),
    await game('Off slot'),
    await game('Wished'),
  ];
  // 2026-11-10 is slot 5 (days since the epoch, mod 7).
  for (const [p, slot] of [
    [onSlot, 5],
    [offSlot, 6],
    [wished, 6],
  ] as const)
    await db.insert(schema.trackedGames).values({ productId: p.id, shopSlot: slot });
  await addWatch(db, userId, { productId: wished.id }, {});
  for (const source of ['fake', 'other'])
    for (const p of [sealed, card, onSlot, offSlot, wished])
      await linkSource(db, p.id, { source, externalId: `${source}-${p.id}` });
  const read = async (source: string) => {
    const got: string[] = [];
    await runCollector(
      db,
      fakeCollector({
        source,
        supports: () => true,
        collect: async (_link, product) => (
          got.push(product.name),
          { state: null, complete: true }
        ),
      }),
      { ...quiet, collectOnly: true, now: new Date('2026-11-10T12:00:00.000Z') },
    );
    return got.sort();
  };
  expect(await read('fake')).toEqual(['BP BOX', 'Hero Card', 'On slot', 'Wished']);
  expect(await read('other')).toEqual(['BP BOX', 'Hero Card', 'Wished']);
});

it('a removed tracked game: no search made, read nowhere at night; wished, read every night; tracked again (F1)', async () => {
  await saveSourceInfos(db, [
    {
      key: 'fake',
      market: 'jp',
      label: 'Fake',
      priority: 10,
      roles: { game: 'reference' },
      identity: ['game'],
    },
    { key: 'other', market: 'jp', label: 'Other', priority: 20, roles: { game: 'supporting' } },
  ]);
  const admin = (
    await createUser(
      db,
      'root',
      { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] },
      'admin',
    )
  ).user.id;
  const game = (name: string) =>
    createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });
  const [removed, unsearched] = [await game('Removed'), await game('Unsearched')];
  for (const p of [removed, unsearched]) {
    await trackGame(db, admin, p.id);
    // 2026-11-10 is slot 5 (days since the epoch, mod 7): its old slot night.
    await db
      .update(schema.trackedGames)
      .set({ shopSlot: 5 })
      .where(eq(schema.trackedGames.productId, p.id));
  }
  await linkSource(db, removed.id, { source: 'fake', externalId: 'fake-removed' });
  await createQuerySource(db, removed.id, 'other', { keywords: ['Removed'] });
  for (const p of [removed, unsearched]) await untrackGame(db, admin, p.id);
  const read = async (source: string, extra: Partial<Collector> = {}) => {
    const got: string[] = [];
    await runCollector(
      db,
      fakeCollector({
        source,
        supports: () => true,
        findCandidates: async () => [],
        collect: async (_link, product) => (
          got.push(product.name),
          { state: null, complete: true }
        ),
        ...extra,
      }),
      { ...quiet, now: new Date('2026-11-10T12:00:00.000Z') },
    );
    return got.sort();
  };
  const auto = { defaultQuery: (p: { name: string }) => ({ keywords: [p.name] }) };
  expect(await read('fake')).toEqual([]);
  expect(await read('other', auto)).toEqual([]);
  const searches = await db
    .select()
    .from(schema.productSources)
    .where(eq(schema.productSources.productId, unsearched.id));
  expect(searches).toEqual([]);
  // Wished: read as any wish, every night.
  await addWatch(db, userId, { productId: removed.id }, {});
  expect(await read('fake')).toEqual(['Removed']);
  expect(await read('other', auto)).toEqual(['Removed']);
  // Tracked again: live.
  await db.delete(schema.watches).where(eq(schema.watches.productId, removed.id));
  expect(await trackGame(db, admin, removed.id)).toBe(true);
  const [row] = await db
    .select()
    .from(schema.trackedGames)
    .where(eq(schema.trackedGames.productId, removed.id));
  expect(row!.tier).toBe('chosen');
});

it('a one-item run ("collect now") reads a tracked-only game off its slot night (F6)', async () => {
  const g = await createProduct(db, userId, {
    category: 'game',
    kind: 'software',
    name: 'Off slot',
    platform: 'Alpha',
  });
  // 2026-11-10 is slot 5; this game's slot is 6.
  await db.insert(schema.trackedGames).values({ productId: g.id, shopSlot: 6 });
  await linkSource(db, g.id, { source: 'fake', externalId: 'G1' });
  const got: string[] = [];
  const run = (productId?: string) =>
    runCollector(
      db,
      fakeCollector({
        supports: () => true,
        collect: async (_link, product) => (
          got.push(product.name),
          { state: null, complete: true }
        ),
      }),
      { ...quiet, collectOnly: true, productId, now: new Date('2026-11-10T12:00:00.000Z') },
    );
  await run();
  expect(got).toEqual([]);
  await run(g.id);
  expect(got).toEqual(['Off slot']);
});

it("an auto search renewed in a nightly run leaves only that run's night (fix round 2, item 2)", async () => {
  const g = await createProduct(db, userId, {
    category: 'game',
    kind: 'software',
    name: 'Hero Quest',
    platform: 'Alpha',
  });
  await createQuerySource(db, g.id, 'fake', { keywords: ['old'], extra: { auto: true } });
  for (const day of ['2026-11-08', '2026-11-09']) await addNight(db, g.id, 'fake', day);
  await runCollector(
    db,
    fakeCollector({
      supports: () => true,
      defaultQuery: (p) => ({ keywords: [p.name], extra: { auto: true, v: 2 } }),
      queryVersion: 2,
      collect: async () => ({ state: null, complete: true }),
    }),
    { ...quiet, now: new Date('2026-11-10T03:00:00.000Z') },
  );
  // The renewal dropped the old search's rows and the nights that rested on them.
  const rows = await db.select().from(schema.saleCoverage);
  expect(rows.map((r) => r.nights)).toEqual([[['2026-11-10', '2026-11-10']]]);
});

it("a boxed game is never offered its plain item's listing, nor searched outside the identity shop (S36)", async () => {
  await saveSourceInfos(db, [
    { key: 'shop', label: 'Shop', market: 'jp', currency: 'JPY', identity: ['game'] },
    { key: 'fake', label: 'Fake', market: 'jp', currency: 'JPY' },
  ]);
  const game = (name: string) =>
    createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });
  const plain = await game('Hero Quest');
  const boxed = await game('Hero Quest');
  await saveItemRules(
    db,
    boxed.id,
    {
      console: null,
      edition: null,
      required: [],
      excluded: [],
      boxed: true,
      boxedOf: plain.id,
      gameRules: null,
    },
    userId,
  );
  await addWatch(db, userId, { productId: boxed.id }, {});
  for (const source of ['fake', 'shop'])
    await linkSource(db, plain.id, { source, externalId: `P-${source}`, title: 'Hero Quest' });
  const searched: Record<string, string[]> = { fake: [], shop: [] };
  for (const source of ['fake', 'shop'])
    await runCollector(
      db,
      fakeCollector({
        source,
        supports: () => true,
        findCandidates: async (p) => {
          searched[source]!.push(p.id);
          return [];
        },
      }),
      { ...quiet, matchOnly: true },
    );
  // No keyword search at another source; the identity shop is asked, never with the plain page.
  expect(searched).toEqual({ fake: [], shop: [boxed.id] });
  expect(await listPendingCandidates(db, boxed.id)).toEqual([]);
});

it("stores a job's rows as the nightly save does (one save path, S36 B4)", async () => {
  const { product } = await box();
  const rows = (ref: string) => [
    {
      productId: product.id,
      source: 'fake',
      observationType: 'sold' as const,
      bucket: 'sealed:shrink',
      price: 12_340,
      currency: 'JPY',
      observedAt: '2026-10-01T03:00:00.000Z',
      fetchedAt: '2026-10-02T00:00:00.000-05:00',
      externalRef: `${ref}|1`,
      raw: { page: 1 },
    },
  ];
  await linkSource(db, product.id, { source: 'fake', externalId: 'X1' });
  await runCollector(
    db,
    fakeCollector({
      collect: async (_link, _product, ctx) => {
        await ctx.save(rows('night'));
        return { state: { mode: 'incremental' }, complete: true };
      },
    }),
    quiet,
  );
  expect(await saveObservations(db, await baseConverter(db), rows('job'))).toBe(1);
  const stored = await db
    .select()
    .from(schema.priceObservations)
    .where(eq(schema.priceObservations.productId, product.id))
    .orderBy(schema.priceObservations.externalRef);
  const same = stored.map(
    ({ id: _id, externalRef: _ref, createdAt: _c, updatedAt: _u, ...r }) => r,
  );
  expect(stored.map((r) => r.externalRef)).toEqual(['job|1', 'night|1']);
  expect(same[0]).toEqual(same[1]);
  expect(same[0]).toMatchObject({ observedAt: '2026-10-01T12:00:00.000+09:00', priceBase: 12_340 });
});

describe('a source linked by the product code (linksByCode)', () => {
  const facts = (jan: string) => ({ releaseDate: null, listPrice: null, jan, maker: null });
  async function game(name: string, jan: string | null, source = 'shop') {
    const p = await createProduct(db, userId, { category: 'game', kind: 'software', name });
    await addWatch(db, userId, { productId: p.id }, {});
    const link = await linkSource(db, p.id, { source, externalId: `S-${name}` });
    if (jan)
      await saveSourceFacts(
        db,
        { id: link.id, productId: p.id, facts: null },
        facts(jan),
        '2026-10-01T03:00:00.000+09:00',
        '2026-10-01',
      );
    return { product: p, link };
  }
  const byCode = (asked: string[]): Collector => ({
    source: 'codes',
    label: 'Codes',
    linksByCode: true,
    supports: (p) => p.category === 'game',
    findCandidates: async (product, ctx) => {
      const code = await ctx.productCode?.(product);
      asked.push(product.name);
      return code ? [{ externalId: code, title: `JAN ${code}`, url: null, score: 1 }] : [];
    },
    collect: async () => ({ state: null, complete: true }),
  });
  beforeEach(async () => {
    await saveSourceInfos(db, [
      { key: 'shop', label: 'Shop', market: 'jp', currency: 'JPY', identity: ['game'] },
      { key: 'other', label: 'Other', market: 'jp', currency: 'JPY' },
      { key: 'codes', label: 'Codes', market: 'jp', currency: 'JPY' },
    ]);
  });

  it('links an item by the code its identity shop stored, at once; none without a code', async () => {
    const withCode = await game('Hero Quest', '2012345678903');
    const without = await game('Other Quest', null);
    // A code stored by a source that is not the identity shop is not read.
    const elsewhere = await game('Third Quest', '2098765432103', 'other');
    const asked: string[] = [];
    const summary = await runCollector(db, byCode(asked), quiet);
    expect(summary.candidates).toBe(1);
    expect(
      (await listProductSources(db, withCode.product.id)).find((l) => l.source === 'codes'),
    ).toMatchObject({ externalId: '2012345678903', active: true });
    for (const p of [without.product, elsewhere.product])
      expect((await listProductSources(db, p.id)).some((l) => l.source === 'codes')).toBe(false);
    // Nothing waits for a person.
    expect(await listPendingCandidates(db, userId)).toEqual([]);
    expect(asked.sort()).toEqual(['Hero Quest', 'Other Quest', 'Third Quest']);
  });

  it('never links again an item a person unlinked at the source', async () => {
    const { product } = await game('Hero Quest', '2012345678903');
    await runCollector(db, byCode([]), quiet);
    const mine = (await listProductSources(db, product.id)).find((l) => l.source === 'codes')!;
    await unlinkSource(db, mine.id);
    const asked: string[] = [];
    await runCollector(db, byCode(asked), quiet);
    expect(asked).toEqual([]);
    const rows = (await listProductSources(db, product.id)).filter((l) => l.source === 'codes');
    expect(rows.map((l) => l.active)).toEqual([false]);
  });

  it('the stored code: active links only; null when the links disagree (S36 B5 fix 4)', async () => {
    const { product, link } = await game('Hero Quest', '2012345678903');
    expect(await storedJan(db, product.id, ['shop'])).toBe('2012345678903');
    expect(await storedJan(db, product.id, ['other'])).toBeNull();
    expect(await storedJan(db, product.id, [])).toBeNull();
    const second = await linkSource(db, product.id, { source: 'other', externalId: 'O-1' });
    const store = (jan: string) =>
      saveSourceFacts(
        db,
        { id: second.id, productId: product.id, facts: null },
        facts(jan),
        '2026-10-01T03:00:00.000+09:00',
        '2026-10-01',
      );
    // The same code on both pages: that code.
    await store('2012345678903');
    expect(await storedJan(db, product.id, ['other', 'shop'])).toBe('2012345678903');
    // Two codes: never a guess between two games, in either order of the sources.
    await store('2098765432103');
    expect(await storedJan(db, product.id, ['other', 'shop'])).toBeNull();
    expect(await storedJan(db, product.id, ['shop', 'other'])).toBeNull();
    const other = await game('Other Quest', '2098765432103');
    expect(await storedJans(db, [product.id, other.product.id, 'none'], ['shop', 'other'])).toEqual(
      new Map([
        [product.id, null],
        [other.product.id, '2098765432103'],
        ['none', null],
      ]),
    );
    await unlinkSource(db, second.id);
    expect(await storedJan(db, product.id, ['shop', 'other'])).toBe('2012345678903');
    await unlinkSource(db, link.id);
    expect(await storedJan(db, product.id, ['shop'])).toBeNull();
  });

  /** `db` with its reads of stored facts counted (the code reads select `facts`). */
  function counting() {
    const count = { reads: 0 };
    const counted = new Proxy(db, {
      get(target, key) {
        if (key === 'select')
          return (fields?: Record<string, unknown>) => {
            if (fields && 'facts' in fields) count.reads++;
            return target.select(fields as never);
          };
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { counted, count };
  }

  it('links a game behind 600 older cards in one night, with one read of the codes', async () => {
    const cards = Array.from({ length: 600 }, (_, i) => ({
      id: `card-${String(i).padStart(3, '0')}`,
      category: 'tcg',
      kind: 'single_card',
      name: `Card ${i}`,
      createdAt: '2000-01-01T00:00:00.000Z',
    }));
    await db.insert(schema.products).values(cards);
    await db
      .insert(schema.watches)
      .values(cards.map((c) => ({ userId, productId: c.id, bucket: '' })));
    const first = await game('Hero Quest', '2012345678903');
    const { counted, count } = counting();
    await runCollector(counted, byCode([]), { ...quiet, matchOnly: true });
    expect(
      (await listProductSources(db, first.product.id)).find((l) => l.source === 'codes'),
    ).toMatchObject({ externalId: '2012345678903', active: true });
    expect(count.reads).toBe(1);
    // More games, linked and not: still one read.
    await game('Other Quest', '2098765432103');
    await game('Third Quest', '2055555555558');
    count.reads = 0;
    const summary = await runCollector(counted, byCode([]), { ...quiet, matchOnly: true });
    expect(summary.candidates).toBe(2);
    expect(count.reads).toBe(1);
  });

  it('an active link follows a changed code; an unlinked one and one with no code now stay', async () => {
    const changed = await game('Hero Quest', '2012345678903');
    const unlinked = await game('Other Quest', '2012345678903');
    const lost = await game('Third Quest', '2098765432103');
    await runCollector(db, byCode([]), { ...quiet, matchOnly: true });
    const codesOf = async (id: string) =>
      (await listProductSources(db, id)).filter((l) => l.source === 'codes');
    const [before] = await codesOf(changed.product.id);
    const [mine] = await codesOf(unlinked.product.id);
    await unlinkSource(db, mine!.id);
    const recode = (link: { id: string; productId: string }, jan: string) =>
      saveSourceFacts(
        db,
        { id: link.id, productId: link.productId, facts: null },
        facts(jan),
        '2026-10-02T03:00:00.000+09:00',
        '2026-10-02',
      );
    await recode(changed.link, '2055555555558');
    await recode(unlinked.link, '2055555555558');
    // The identity page unlinked: no code now.
    await unlinkSource(db, lost.link.id);
    await runCollector(db, byCode([]), { ...quiet, matchOnly: true });
    // The same row, so the rows stored under the old code stay its history.
    expect(await codesOf(changed.product.id)).toEqual([
      expect.objectContaining({
        id: before!.id,
        externalId: '2055555555558',
        title: 'JAN 2055555555558',
        active: true,
      }),
    ]);
    expect(await codesOf(unlinked.product.id)).toEqual([
      expect.objectContaining({ id: mine!.id, externalId: '2012345678903', active: false }),
    ]);
    expect(await codesOf(lost.product.id)).toEqual([
      expect.objectContaining({ externalId: '2098765432103', active: true }),
    ]);
  });
});
