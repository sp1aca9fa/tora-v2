import {
  type Db,
  addGameWish,
  addWatch,
  createDb,
  createProduct,
  createUser,
  currentRules,
  deleteUnusedProduct,
  mergeProducts,
  nextDay,
  recordAddedCostSample,
  recordItemCheck,
  removeWatch,
  saveConsole,
  saveWishRules,
  saveSetting,
  saveSourceInfos,
  schema,
  setGameRules,
  wishLevelsOf,
  wishRecordShown,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq, inArray } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appliedRulesHash } from './game-rules';
import type { Collector } from './types';
import { refreshWishLevels } from './wish-levels';

// Made-up sources, console and titles only.
let db: Db;
let admin: { id: string; role: 'admin' };
let ann: { id: string; role: 'member' };

const LAST = '2026-06-30';
const NOW = new Date(`${LAST}T23:00:00+09:00`);
const saleText = ({ title }: { title: string | null }) => ({ title, category: null });
const plugin = (source: string, addedCost?: Collector['addedCost']) =>
  ({ source, label: source, saleText, addedCost }) as unknown as Collector;
/** marketa's prices include shipping; marketb does not say; abroad is outside the home market. */
const COLLECTORS = [
  plugin('marketa', { sales: 'included', listings: 'unknown' }),
  plugin('marketb'),
  plugin('abroad', { sales: 'included', listings: 'included' }),
];
const JUDGED = ['abroad', 'marketa', 'marketb'];

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wish-levels-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    { key: 'marketa', label: 'Market A', market: 'jp', currency: 'JPY' },
    { key: 'marketb', label: 'Market B', market: 'jp', currency: 'JPY' },
    { key: 'abroad', label: 'Abroad', market: 'us', currency: 'USD' },
  ] as Parameters<typeof saveSourceInfos>[1]);
  await saveSetting(db, 'markets', { primary: 'jp' });
  await setGameRules(db, true);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = { id: (await createUser(db, 'a', creds, 'admin')).user.id, role: 'admin' };
  ann = { id: (await createUser(db, 'ann', creds, 'member')).user.id, role: 'member' };
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha Station' },
    aliases: [],
    categories: {},
    boxedAllowed: true,
  });
  return () => rm(dir, { recursive: true, force: true });
});

let n = 0;
/** Kept sold rows, one a day back from `last`, at noon in Tokyo. */
async function sold(
  productId: string,
  bucket: string,
  prices: number[],
  over: { source?: string; last?: string; title?: string; quantityInferred?: boolean } = {},
) {
  const last = Date.parse(`${over.last ?? LAST}T12:00:00+09:00`);
  await db.insert(schema.priceObservations).values(
    prices.map((price, i) => {
      const at = new Date(last - i * 86_400_000).toISOString();
      return {
        productId,
        source: over.source ?? 'marketa',
        observationType: 'sold' as const,
        bucket,
        priceBase: price,
        priceOriginal: price,
        currency: 'JPY',
        observedAt: at,
        fetchedAt: at,
        externalRef: `r${++n}`,
        title: over.title ?? 'Star Rover',
        quantityInferred: over.quantityInferred ?? false,
        createdAt: at,
        updatedAt: at,
      };
    }),
  );
}

/**
 * The sales of `from`..`to` read by nights: a collect dated D reads D-1 (Terms "Covered day"), so the
 * nights are stamped the day after each.
 */
const covered = (productId: string, source: string, from: string, to = LAST) =>
  db.insert(schema.saleCoverage).values({
    productId,
    source,
    nights: [[nextDay(from), nextDay(to)]],
    updatedAt: `${nextDay(to)}T03:00:00.000+09:00`,
  });

/** The item's rules applied to its stored sales at every judged source (what the closing step does). */
async function applied(productId: string) {
  const rules = (await currentRules(db, productId))!.rules;
  await db
    .insert(schema.itemRuleState)
    .values({ productId, appliedHash: appliedRulesHash(rules, JUDGED) })
    .onConflictDoUpdate({
      target: schema.itemRuleState.productId,
      set: { appliedHash: appliedRulesHash(rules, JUDGED) },
    });
}

/** A confirmed game wish in like-new condition, released long ago, its rules applied. */
async function wish(name = 'Star Rover', boxed = false) {
  const made = await addGameWish(db, ann.id, {
    name,
    console: 'alpha',
    boxed,
    watch: { condition: 'like_new' },
  });
  await db
    .update(schema.products)
    .set({ releaseDate: '2024-01-15' })
    .where(eq(schema.products.id, made.product.id));
  // A person's confirmation at the registration check (S36 B1), as `confirmWish` stores it.
  await recordItemCheck(db, {
    productId: made.product.id,
    kind: 'sales',
    source: '',
    outcome: 'confirmed',
    by: 'person',
    userId: ann.id,
    rulesHash: (await currentRules(db, made.product.id))!.hashFor('sales', ''),
  });
  await applied(made.plain.id);
  return made;
}

const run = () => refreshWishLevels(db, COLLECTORS, { now: NOW });
const levelOf = async (productId: string, bucket: string) =>
  (await wishLevelsOf(db, [{ productId, bucket }])).get(`${productId}|${bucket}`);
const steps = (k: number, from = 1000) => Array.from({ length: k }, (_, i) => from + i * 1000);

describe('refreshWishLevels (S36 Terms "Level", W14)', () => {
  it('stores the level of a confirmed wish, and a night with no change writes nothing', async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(12));
    await covered(product.id, 'marketa', '2026-01-01');
    expect(await run()).toEqual({ written: 1, unchanged: 0, removed: 0 });
    const level = (await levelOf(product.id, watch.bucket))!;
    // 12 sales 1000..12000: position 2.75, 3000 + 0.75 * 1000 = 3750.
    expect(level.series.at(-1)).toEqual({
      day: LAST,
      level: 3750,
      n: 12,
      window: 30,
      sources: ['marketa'],
      // marketb says nothing of its added cost and has no sample.
      left: { marketb: 'cost_unknown' },
    });
    expect(level.series[0]!.day).toBe('2026-01-01');
    expect(level.bornOn).toBe('2024-01-15');
    expect(level.record).toMatchObject({ window: 30 });
    expect(await run()).toEqual({ written: 0, unchanged: 1, removed: 0 });
    // A new covered night changes the inputs.
    await db
      .update(schema.saleCoverage)
      .set({ nights: [['2026-01-02', '2026-07-02']] })
      .where(eq(schema.saleCoverage.productId, product.id));
    expect((await run()).written).toBe(1);
    expect(await wishRecordShown(db)).toBe(false);
  });

  it('stores no level for a wish with no condition, and removes the one it had (item 8)', async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(12));
    await covered(product.id, 'marketa', '2026-01-01');
    expect((await run()).written).toBe(1);
    await db
      .update(schema.watches)
      .set({ condition: null, bucket: '' })
      .where(eq(schema.watches.id, watch.id));
    expect(await run()).toEqual({ written: 0, unchanged: 0, removed: 1 });
    expect(await levelOf(product.id, '')).toBeUndefined();
    expect(await levelOf(product.id, watch.bucket)).toBeUndefined();
  });

  it('leaves out unknown added cost, other markets, other buckets and unreported units', async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(9));
    await sold(product.id, watch.bucket, Array(10).fill(100), { source: 'marketb' });
    await sold(product.id, watch.bucket, Array(10).fill(100), { source: 'abroad' });
    await sold(product.id, 'cond:new', Array(10).fill(100));
    await sold(product.id, watch.bucket, [100], { quantityInferred: true });
    for (const s of ['marketa', 'marketb', 'abroad']) await covered(product.id, s, '2026-01-01');
    await run();
    expect((await levelOf(product.id, watch.bucket))!.series.at(-1)).toMatchObject({
      level: null,
      n: 9,
      unknownCost: 10,
      reason: 'cost_unknown',
      low: 1000,
    });
    // The owner's sample of marketb (97 of 100 included) lets its sales count.
    expect(
      await recordAddedCostSample(db, 'marketb', { counted: 100, included: 97, how: 'hand' }),
    ).toBe(true);
    expect((await run()).written).toBe(1);
    expect((await levelOf(product.id, watch.bucket))!.series.at(-1)).toMatchObject({
      n: 19,
      sources: ['marketa', 'marketb'],
    });
    // Read per row since (fix round 1, item 5): a marketb row whose raw says the buyer pays, with no
    // amount, stays out.
    await db
      .update(schema.priceObservations)
      .set({ raw: { shipping: 'buyer' } })
      .where(eq(schema.priceObservations.source, 'marketb'));
    expect((await run()).written).toBe(1);
    expect((await levelOf(product.id, watch.bucket))!.series.at(-1)).toMatchObject({
      level: null,
      n: 9,
      sources: ['marketa', 'marketb'],
      rowsUnknown: { marketb: 10 },
    });
  });

  it('a failed night leaves the day before it uncovered: the last level day is the one before', async () => {
    const { product, watch } = await wish();
    const D = LAST;
    await sold(product.id, watch.bucket, steps(12));
    // Nights of D-2, D-1 and D ran (with every night since January); the night of D+1 failed.
    await db.insert(schema.saleCoverage).values({
      productId: product.id,
      source: 'marketa',
      nights: [['2026-01-02', D]],
      updatedAt: `${D}T03:00:00.000+09:00`,
    });
    await refreshWishLevels(db, COLLECTORS, { now: new Date(`${nextDay(D)}T09:00:00+09:00`) });
    const { series } = (await levelOf(product.id, watch.bucket))!;
    // D is not covered: the series ends on D-1 with a whole 30-day window (11 of the sales:
    // 2000..12000, position 2.5, 4000 + 0.5 * 1000 = 4500).
    expect(series.at(-1)).toMatchObject({
      day: '2026-06-29',
      level: 4500,
      n: 11,
      window: 30,
      sources: ['marketa'],
    });
    expect(series.some((d) => d.day === D)).toBe(false);
  });

  it("a deep read's span and the nights after it join with no hole", async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(12));
    // A deep read whose first page was read on 2026-06-20 covers up to 2026-06-19; the nights from
    // 2026-06-21 read 2026-06-20 onwards.
    await db.insert(schema.saleSpans).values({
      productId: product.id,
      source: 'marketa',
      fromDay: '2026-01-01',
      toDay: '2026-06-19',
      how: 'deep',
    });
    await db.insert(schema.saleCoverage).values({
      productId: product.id,
      source: 'marketa',
      nights: [['2026-06-21', nextDay(LAST)]],
      updatedAt: `${nextDay(LAST)}T03:00:00.000+09:00`,
    });
    await run();
    const { series } = (await levelOf(product.id, watch.bucket))!;
    expect(series[0]!.day).toBe('2026-01-01');
    expect(series.at(-1)).toMatchObject({ day: LAST, level: 3750, window: 30 });
    // Every day whose 30-day window starts on or after the span's first day is whole.
    expect(
      series.filter((d) => d.day >= '2026-01-30' && d.level === null && d.reason === 'not_covered'),
    ).toEqual([]);
  });

  it('reads in batches: as many queries for 50 wishes as for 1 (S19)', async () => {
    const queries = async (k: number) => {
      for (let i = 0; i < k; i++) {
        const { product, watch } = await wish(`Rover ${k}-${i}`);
        await sold(product.id, watch.bucket, steps(12));
        await covered(product.id, 'marketa', '2026-01-01');
      }
      await run();
      const spy = vi.spyOn(db.$client, 'execute');
      expect((await run()).unchanged).toBe(k);
      // The source registry and settings are cached for 5 s of wall time (registry.ts): a read of
      // them depends on the clock, never on the wishes, so they are not counted.
      const count = spy.mock.calls.filter(([q]) => {
        const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
        return !/^select .* from "(sources|app_settings)"/.test(sql);
      }).length;
      spy.mockRestore();
      await db.delete(schema.watches);
      await run();
      return count;
    };
    const one = await queries(1);
    const fifty = await queries(50);
    // 12 for both when written, plus 2 to 4 reads of the registry and settings (fix round 1, item 7).
    expect(one).toBeGreaterThan(0);
    expect(fifty).toBe(one);
    // 50 wishes to set up: slower than the default 5 s when the whole suite runs at once.
  }, 60_000);

  it('a sale excluded by a rule mark leaves the level and comes back when restored', async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(12));
    await covered(product.id, 'marketa', '2026-01-01');
    await run();
    const before = (await levelOf(product.id, watch.bucket))!;
    const cheap = await db
      .select({ id: schema.priceObservations.id })
      .from(schema.priceObservations)
      .where(inArray(schema.priceObservations.priceBase, [1000, 2000]));
    const ids = cheap.map((c) => c.id);
    await db
      .update(schema.priceObservations)
      .set({ excluded: true, excludedReason: 'mismatch', ruleMark: 'rules:x' })
      .where(inArray(schema.priceObservations.id, ids));
    expect((await run()).written).toBe(1);
    const after = (await levelOf(product.id, watch.bucket))!;
    // 10 sales 3000..12000: position 2.25, 5000 + 0.25 * 1000 = 5250; the record follows.
    expect(after.series.at(-1)!.level).toBe(5250);
    expect(after.record!.level).toBeGreaterThan(before.record!.level);
    await db
      .update(schema.priceObservations)
      .set({ excluded: false, excludedReason: null, ruleMark: null })
      .where(inArray(schema.priceObservations.id, ids));
    await run();
    expect(await levelOf(product.id, watch.bucket)).toMatchObject({
      series: before.series,
      record: before.record,
    });
  });

  it('a boxed item reads only its plain item rows with boxed titles', async () => {
    const { product, plain, watch } = await wish('Star Rover', true);
    await sold(plain.id, watch.bucket, steps(10, 5000), { title: 'Star Rover 箱付' });
    await sold(plain.id, watch.bucket, Array(10).fill(100), { title: 'Star Rover loose' });
    await covered(plain.id, 'marketa', '2026-01-01');
    await run();
    // 10 boxed sales 5000..14000: position 2.25, 7000 + 0.25 * 1000 = 7250.
    expect((await levelOf(product.id, watch.bucket))!.series.at(-1)).toMatchObject({
      level: 7250,
      n: 10,
    });
  });

  it('gives no row to a wish not confirmed, not applied, or not a game, and removes one', async () => {
    const { product, watch } = await wish();
    await sold(product.id, watch.bucket, steps(12));
    await covered(product.id, 'marketa', '2026-01-01');
    const card = await createProduct(db, admin.id, {
      category: 'tcg',
      kind: 'single',
      name: 'Card',
    });
    await addWatch(db, ann.id, { productId: card.id }, {});
    const box = await createProduct(db, admin.id, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box',
    });
    await addWatch(db, ann.id, { productId: box.id }, {});
    expect((await run()).written).toBe(1);
    expect(await db.select().from(schema.wishLevels)).toHaveLength(1);
    // The rules switch off: not applied, the row goes.
    await setGameRules(db, false);
    expect(await run()).toEqual({ written: 0, unchanged: 0, removed: 1 });
    await setGameRules(db, true);
    expect((await run()).written).toBe(1);
    // A rule change takes the confirmation away: "check needed", the row goes.
    await saveWishRules(db, ann, {
      wishId: watch.id,
      required: 'limited',
      excluded: '',
      edition: '',
    });
    expect((await run()).removed).toBe(1);
    expect(await db.select().from(schema.wishLevels)).toEqual([]);
  });

  it('a removed wish loses its row; merging and deleting items drop them', async () => {
    const one = await wish('Star Rover');
    await sold(one.product.id, one.watch.bucket, steps(12));
    await covered(one.product.id, 'marketa', '2026-01-01');
    const two = await wish('Moon Rover');
    await run();
    expect(await db.select().from(schema.wishLevels)).toHaveLength(2);
    await mergeProducts(db, admin, two.product.id, one.product.id);
    expect(await db.select().from(schema.wishLevels)).toEqual([]);
    // The merged item's rules are judged again before its level is (its applied hash was cleared).
    await run();
    expect(await db.select().from(schema.wishLevels)).toEqual([]);
    await applied(one.product.id);
    await run();
    expect(await db.select().from(schema.wishLevels)).toHaveLength(1);
    await removeWatch(db, ann.id, one.watch.id);
    expect((await run()).removed).toBe(1);
    expect(await deleteUnusedProduct(db, one.product.id)).toBe(true);
    expect(await db.select().from(schema.wishLevels)).toEqual([]);
  });
});
