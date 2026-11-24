// The daytime job's search and save path (S36 B3; plan-deep-read.md steps 5, 6 and 10.1, 10.3,
// 10.5) on throwaway databases. Made-up marketplaces, console and titles only.
import type { JobResult } from '@tora/core';
import {
  type Db,
  addSpan,
  createDb,
  createProduct,
  createQuerySource,
  createUser,
  insertObservations,
  mergeProducts,
  saveConsole,
  saveItemRules,
  saveSourceInfos,
  schema,
  setGameRules,
  setSourceQuery,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyItemRules } from './game-rules';
import { saveJobRows } from './job-save';
import { dropUncoveredSpans, jobSearch } from './job-search';
import { baseConverter } from './money';
import { runCollector } from './runner';
import type { Collector, PriceInput } from './types';

let db: Db;
let userId: string;
const now = new Date('2026-11-20T03:00:00.000Z');
const quiet = { log: () => {}, http: { minDelayMs: 0, maxDelayMs: 0 }, now };
const market: Collector = {
  source: 'marketa',
  label: 'Market A',
  supports: (p) => p.category === 'game',
  findCandidates: async () => [],
  collect: async () => ({ state: null, complete: true }),
  saleText: ({ title, raw }) => ({
    title: ((raw as { name?: string } | null)?.name ?? title) as string | null,
    category: ((raw as { cat?: string } | null)?.cat ?? null) as string | null,
  }),
};
const noRules = {
  console: null,
  edition: null,
  required: [] as string[],
  excluded: [] as string[],
  boxed: false,
  boxedOf: null,
  gameRules: null,
};

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-job-save-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    { key: 'marketa', label: 'Market A', market: 'jp', currency: 'JPY' },
    { key: 'marketb', label: 'Market B', market: 'jp', currency: 'JPY', noAi: true },
  ] as Parameters<typeof saveSourceInfos>[1]);
  userId = (
    await createUser(
      db,
      'alice',
      { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] },
      'admin',
    )
  ).user.id;
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha' },
    aliases: [],
    categories: { marketa: '111' },
    boxedAllowed: false,
  });
  return () => rm(dir, { recursive: true, force: true });
});

const game = (name: string) =>
  createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });
const words = (productId: string, excluded: string[]) =>
  saveItemRules(db, productId, { ...noRules, excluded }, userId);
const row = (productId: string, ref: string, name: string, excluded = false): PriceInput => ({
  productId,
  source: 'marketa',
  observationType: 'sold',
  bucket: 'used',
  price: 1000,
  currency: 'JPY',
  observedAt: '2026-11-01T12:00:00.000+09:00',
  fetchedAt: '2026-11-01T12:00:00.000+09:00',
  externalRef: ref,
  raw: { name, cat: '111' },
  ...(excluded && { excluded: true, excludedReason: 'mismatch' as const }),
});
const stored = async (productId: string) =>
  (
    await db
      .select()
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.productId, productId))
  ).toSorted((a, b) => (a.externalRef ?? '').localeCompare(b.externalRef ?? ''));
const save = async (jobId: string, product: { id: string }, rows: PriceInput[], c = market) =>
  saveJobRows(db, {
    collector: c,
    jobId,
    product: (
      await db.select().from(schema.products).where(eq(schema.products.id, product.id))
    )[0]!,
    rows,
    toBase: await baseConverter(db),
  });

/** The query the nightly read hands the plug-in, and jobSearch's for the same item. */
async function both(collector: Collector, productId: string) {
  const seen: unknown[] = [];
  await runCollector(
    db,
    {
      ...collector,
      collect: async (link) => {
        seen.push(link.query);
        return { state: null, complete: true };
      },
    },
    { ...quiet, productId },
  );
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  return { nightly: seen[0], job: (await jobSearch(db, collector, product!))?.search };
}

describe('jobSearch', () => {
  it('is the search the nightly read sends, in each case', async () => {
    const versioned: Collector = {
      ...market,
      queryVersion: 2,
      defaultQuery: (p) => ({ keywords: [p.name, 'new'], extra: { auto: true, v: 2 } }),
    };
    // A stored search, the switch off.
    const a = await game('Hero Quest');
    await createQuerySource(db, a.id, 'marketa', { keywords: ['Hero Quest'] });
    let got = await both(market, a.id);
    expect(got.job).toEqual(got.nightly);
    expect(got.job).toEqual({ keywords: ['Hero Quest'] });
    // An edited search under a newer plug-in version: kept as it is.
    const b = await game('Hero Saga');
    const edited = { keywords: ['Saga'], extra: { edited: true, v: 1 } };
    await createQuerySource(db, b.id, 'marketa', edited);
    got = await both(versioned, b.id);
    expect(got.job).toEqual(got.nightly);
    expect(got.job).toEqual(edited);
    // An outdated auto search: renewed with the pasted listings kept; the job never writes it.
    const c = await game('Hero Tale');
    const old = { keywords: ['Tale'], extra: { auto: true, v: 1, references: ['x1'] } };
    await createQuerySource(db, c.id, 'marketa', old);
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, c.id));
    const job = (await jobSearch(db, versioned, product!))?.search;
    const link = async () =>
      (
        await db
          .select()
          .from(schema.productSources)
          .where(eq(schema.productSources.productId, c.id))
      )[0]!.query;
    expect(await link()).toEqual(old);
    got = await both(versioned, c.id);
    expect(job).toEqual(got.nightly);
    expect(job).toEqual({
      keywords: ['Hero Tale', 'new'],
      extra: { references: ['x1'], auto: true, v: 2 },
    });
    // The switch on: the rules laid over it, with or without the item's own rules row.
    await setGameRules(db, true);
    await words(a.id, ['lot']);
    for (const id of [a.id, b.id]) {
      got = await both(market, id);
      expect(got.job).toEqual(got.nightly);
      expect((got.job as { categoryId?: string }).categoryId).toBe('111');
    }
  });

  it('lays the rules over a held item too, and has none without an active search', async () => {
    const g = await game('Hero Quest');
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Hero Quest'] });
    await setGameRules(db, true);
    await db.insert(schema.itemRuleState).values({
      productId: g.id,
      appliedAt: null,
      appliedHash: null,
      held: { hash: 'marketa=x', at: 'x', would: 12, kept: 20 },
    });
    const got = await both(market, g.id);
    expect(got.job).toEqual(got.nightly);
    expect(got.job).toEqual({ keywords: ['Hero Quest'], categoryId: '111' });
    const other = await game('Hero Saga');
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, other.id));
    expect(await jobSearch(db, market, p!)).toBeNull();
  });
});

describe('saveJobRows', () => {
  it('stamps the job, marks as the nightly does, and a stale hash marks nothing', async () => {
    const g = await game('Hero Quest');
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Hero Quest'] });
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    await applyItemRules(db, [market], { now });
    const found = await save('job-1', g, [
      row(g.id, 'r1', 'Hero Quest'),
      row(g.id, 'r2', 'Hero Quest lot'),
    ]);
    expect(found).toMatchObject({ added: 2, notItem: 0, undoneHere: [] });
    const rows = await stored(g.id);
    expect(rows.map((r) => [r.externalRef, !!r.excluded, r.ruleMark?.slice(0, 6) ?? null])).toEqual(
      [
        ['r1', false, null],
        ['r2', true, 'rules:'],
      ],
    );
    expect(rows.every((r) => (r.raw as { job?: string }).job === 'job-1')).toBe(true);
    // The rules changed and not applied yet: new rows go in unmarked (the closing step judges).
    await words(g.id, ['lot', 'box']);
    await save('job-1', g, [row(g.id, 'r3', 'Hero Quest lot')]);
    expect((await stored(g.id)).find((r) => r.externalRef === 'r3')).toMatchObject({
      excluded: false,
      ruleMark: null,
    });
    // A noAi marketplace is never judged.
    const b: Collector = { ...market, source: 'marketb' };
    await save('job-2', g, [{ ...row(g.id, 'b1', 'Hero Quest lot'), source: 'marketb' }], b);
    expect((await stored(g.id)).find((r) => r.externalRef === 'b1')?.ruleMark).toBeNull();
  });

  it('leaves a sale stored under another item there: blocking when kept, apart when not', async () => {
    const g = await game('Hero Quest');
    const look = await game('Hero Quest Look-alike');
    await insertObservations(db, [
      { ...row(look.id, 'x1', 'Hero Quest'), priceBase: 1000 },
      { ...row(look.id, 'x2', 'Hero Quest'), priceBase: 1000 },
    ] as Parameters<typeof insertObservations>[1]);
    const lookBefore = await stored(look.id);
    const found = await save('job-1', g, [
      row(g.id, 'x1', 'Hero Quest'),
      row(g.id, 'x2', 'Hero Quest', true),
      row(g.id, 'n1', 'Hero Quest'),
    ]);
    expect(found.added).toBe(1);
    expect([...found.elsewhere]).toEqual([['x1', look.id]]);
    expect(found.notItem).toBe(1);
    expect(await stored(look.id)).toEqual(lookBefore);
    expect((await stored(g.id)).map((r) => r.externalRef)).toEqual(['n1']);
    // A sale stored here already adds nothing.
    expect((await save('job-1', g, [row(g.id, 'n1', 'Hero Quest')])).added).toBe(0);
  });

  it('lists a sale undone here by a load that this item would keep', async () => {
    const g = await game('Hero Quest');
    await insertObservations(db, [
      { ...row(g.id, 'u1', 'Hero Quest'), priceBase: 1000 },
    ] as Parameters<typeof insertObservations>[1]);
    await db
      .update(schema.priceObservations)
      .set({ excluded: true, excludedReason: 'mismatch', ruleMark: 'undone:load-1' });
    const before = await stored(g.id);
    const found = await save('job-1', g, [row(g.id, 'u1', 'Hero Quest')]);
    expect(found).toMatchObject({ added: 0, undoneHere: ['u1'] });
    expect(await stored(g.id)).toEqual(before);
  });
});

describe('dropUncoveredSpans', () => {
  /** A deep read done with its span, having read `read` (none: a job that did not record it). */
  const doneRead = async (productId: string, read?: JobResult['read'], source = 'marketa') => {
    const span = { from: '2025-12-01', to: '2026-11-30' };
    const [job] = await db
      .insert(schema.marketJobs)
      .values({
        source,
        productId,
        kind: 'deep',
        status: 'done',
        result: { added: 1, ...(read && { read }), span },
      })
      .returning();
    await addSpan(db, { productId, source, ...span, how: 'deep', jobId: job!.id });
    return job!;
  };
  const spansOf = async (productId: string) =>
    (await db.select().from(schema.saleSpans).where(eq(schema.saleSpans.productId, productId)))
      .map((s) => s.jobId)
      .sort();
  const linkOf = async (productId: string) =>
    (
      await db
        .select()
        .from(schema.productSources)
        .where(eq(schema.productSources.productId, productId))
    )[0]!;
  const resultOf = async (jobId: string) =>
    (await db.select().from(schema.marketJobs).where(eq(schema.marketJobs.id, jobId)))[0]!.result;

  it("keeps a span while its search reads at least today's; a category corrected takes it back", async () => {
    const g = await game('Made-up Quest');
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Made-up Quest'], categoryId: '5' });
    const job = await doneRead(g.id, { keyword: 'Made-up Quest', categoryId: '5' });
    expect(await dropUncoveredSpans(db, [market])).toBe(0);
    expect(await spansOf(g.id)).toEqual([job.id]);
    await setSourceQuery(db, (await linkOf(g.id)).id, {
      keywords: ['Made-up Quest'],
      categoryId: '6',
    });
    expect(await dropUncoveredSpans(db, [market])).toBe(1);
    expect(await spansOf(g.id)).toEqual([]);
    expect(await resultOf(job.id)).toEqual({
      added: 1,
      read: { keyword: 'Made-up Quest', categoryId: '5' },
      why: 'narrower_search',
    });
  });

  it('takes it back when the rules switch off drops a required word, or nothing was recorded', async () => {
    const g = await game('Made-up Saga');
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Made-up Saga'] });
    await setGameRules(db, true);
    await saveItemRules(db, g.id, { ...noRules, required: ['Gold'] }, userId);
    const job = await doneRead(g.id, { keyword: 'Made-up Saga Gold', categoryId: '111' });
    // No search recorded: gone. The search off, or a marketplace without its plug-in: kept.
    const t = await game('Made-up Tale');
    await createQuerySource(db, t.id, 'marketa', { keywords: ['Made-up Tale'] });
    const unknown = await doneRead(t.id);
    const elsewhere = await doneRead(t.id, undefined, 'marketb');
    const off = await game('Made-up Land');
    await createQuerySource(db, off.id, 'marketa', { keywords: ['Made-up Land'] });
    await db
      .update(schema.productSources)
      .set({ active: false })
      .where(eq(schema.productSources.productId, off.id));
    const offJob = await doneRead(off.id, { keyword: 'Another Word', categoryId: null });
    expect(await dropUncoveredSpans(db, [market])).toBe(1);
    expect(await resultOf(unknown.id)).toMatchObject({ why: 'narrower_search' });
    expect(await spansOf(t.id)).toEqual([elsewhere.id]);
    expect(await spansOf(off.id)).toEqual([offJob.id]);
    expect(await spansOf(g.id)).toEqual([job.id]);
    await setGameRules(db, false);
    expect(await dropUncoveredSpans(db, [market])).toBe(1);
    expect(await spansOf(g.id)).toEqual([]);
  });

  it("takes back a merged item's span its new item's search does not cover", async () => {
    const a = await game('Made-up Quest');
    const b = await game('Made-up Quest Gold');
    await createQuerySource(db, a.id, 'marketa', { keywords: ['Made-up Quest'] });
    await createQuerySource(db, b.id, 'marketa', { keywords: ['Made-up Quest Gold'] });
    const ja = await doneRead(a.id, { keyword: 'Made-up Quest', categoryId: null });
    const jb = await doneRead(b.id, { keyword: 'Made-up Quest Gold', categoryId: null });
    expect(await dropUncoveredSpans(db, [market])).toBe(0);
    await mergeProducts(db, { id: userId, role: 'admin' }, b.id, a.id);
    expect(await spansOf(a.id)).toEqual([ja.id, jb.id].sort());
    expect(await dropUncoveredSpans(db, [market])).toBe(1);
    expect(await spansOf(a.id)).toEqual([ja.id]);
    expect(await resultOf(jb.id)).toMatchObject({ why: 'narrower_search' });
  });
});
