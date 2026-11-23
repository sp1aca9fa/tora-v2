import { type EffectiveRules, effectiveRules, rulesHash } from '@tora/core';
import {
  type Db,
  createDb,
  createProduct,
  createQuerySource,
  createUser,
  currentRules,
  currentSupply,
  gameRulesOn,
  heldItemCount,
  insertObservations,
  insertObservationsWithRuleState,
  lowestAsk,
  mergeProducts,
  recordItemCheck,
  releaseHeld,
  ruleMarkCounts,
  ruleStates,
  saveConsole,
  saveItemRules,
  saveSourceInfos,
  schema,
  setGameRules,
  setObservationExcluded,
  supplyOffers,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { asc, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOLD_MIN,
  applyItemRules,
  keepStoredState,
  markNewSales,
  overlayQuery,
  withoutFailing,
} from './game-rules';
import { runCollector } from './runner';
import type { Collector, FoundListing, FoundSearch, PriceInput } from './types';

// Made-up console, category and titles only (no real marketplace category number).
const rules = (over: Partial<EffectiveRules> = {}): EffectiveRules =>
  ({
    console: 'alpha',
    region: null,
    required: [],
    excluded: [],
    categories: { flea: '111' },
    ...over,
  }) as EffectiveRules;

describe('overlayQuery', () => {
  it('adds the category only when the search has none, each required word once, no excluded word', () => {
    const q = { keywords: ['Hero Quest', 'alpha'], excludeKeywords: ['manual'] };
    const out = overlayQuery(
      q,
      rules({ required: ['alpha', 'deluxe'], excluded: ['manual', 'lot'] }),
      'flea',
    );
    // The excluded words are the marks' to apply (reversible), never the plug-in's filter's.
    expect(out).toEqual({
      keywords: ['Hero Quest', 'alpha', 'deluxe'],
      excludeKeywords: ['manual'],
      categoryId: '111',
    });
    expect(q).toEqual({ keywords: ['Hero Quest', 'alpha'], excludeKeywords: ['manual'] });
    const own = overlayQuery({ keywords: ['x'], categoryId: '222' }, rules(), 'flea');
    expect(own.categoryId).toBe('222');
  });

  it('leaves a search without keywords, or with nothing to add, as the same object', () => {
    const none = { keywords: [] };
    expect(overlayQuery(none, rules({ required: ['deluxe'] }), 'flea')).toBe(none);
    const done = { keywords: ['Hero Quest deluxe'], categoryId: '111' };
    expect(overlayQuery(done, rules({ required: ['deluxe'] }), 'flea')).toBe(done);
    const other = { keywords: ['Hero Quest'] };
    expect(overlayQuery(other, rules(), 'auction')).toBe(other);
    expect(overlayQuery(other, rules({ excluded: ['lot'] }), 'auction')).toBe(other);
  });
});

describe('markNewSales', () => {
  const text = (s: { title: string | null; raw: unknown }) => ({
    title: s.title,
    category: ((s.raw as { cat?: string } | null)?.cat ?? null) as string | null,
  });
  const row = (title: string, extra: Partial<PriceInput> = {}): PriceInput =>
    ({
      productId: 'p',
      source: 'flea',
      observationType: 'sold',
      bucket: 'used',
      price: 1000,
      observedAt: '2026-11-01T12:00:00.000+09:00',
      fetchedAt: '2026-11-01T12:00:00.000+09:00',
      externalRef: title,
      title,
      raw: { cat: '111' },
      ...extra,
    }) as PriceInput;

  it('marks kept sold rows failing the words or the category; leaves the rest', () => {
    const r = rules({ excluded: ['lot'] });
    const out = markNewSales(
      [
        row('Hero Quest'),
        row('Hero Quest lot'),
        row('Hero Quest other', { raw: { cat: '999' } }),
        row('Hero Quest nocat', { raw: {} }),
        row('Hero Quest lot ref', { raw: { reference: true } }),
        row('Hero Quest lot excluded', { excluded: true, excludedReason: 'outlier' }),
        row('Hero Quest lot ask', { observationType: 'listing' } as Partial<PriceInput>),
      ],
      r,
      'flea',
      text,
    );
    const mark = `rules:${rulesHash(r, 'flea')}`;
    expect(out.map((o) => [o.externalRef, !!o.excluded, o.ruleMark ?? null])).toEqual([
      ['Hero Quest', false, null],
      ['Hero Quest lot', true, mark],
      ['Hero Quest other', true, mark],
      ['Hero Quest nocat', false, null],
      ['Hero Quest lot ref', false, null],
      ['Hero Quest lot excluded', true, null],
      ['Hero Quest lot ask', false, null],
    ]);
    expect(out[1]!.excludedReason).toBe('mismatch');
  });
});

describe('withoutFailing', () => {
  const at = '2026-11-01T03:00:00.000Z';
  const sale = (price: number, bucket = 'used') => ({ bucket, price, observedAt: at });
  const failed = (price: number) =>
    ({ bucket: 'used', price, observedAt: '2026-11-01T12:00:00.000+09:00' }) as PriceInput;

  it('drops one recent sale per failing row of the same condition, price and time', () => {
    const recent = [sale(1000), sale(1000), sale(2000), sale(2000, 'new')];
    expect(withoutFailing(recent, [failed(1000), failed(2000)])).toEqual([
      sale(1000),
      sale(2000, 'new'),
    ]);
    expect(withoutFailing(recent, [])).toBe(recent);
  });
});

describe('keepStoredState', () => {
  it('keeps the named keys as stored, drops them when not stored, and leaves the rest', () => {
    const next = { categories: [111], lastRunAt: 'b', references: { x: 1 } };
    expect(keepStoredState(next, { categories: [5], lastRunAt: 'a' }, ['categories'])).toEqual({
      categories: [5],
      lastRunAt: 'b',
      references: { x: 1 },
    });
    expect(keepStoredState(next, null, ['categories'])).toEqual({
      lastRunAt: 'b',
      references: { x: 1 },
    });
    expect(keepStoredState(next, null, [])).toBe(next);
    expect(keepStoredState(null, { categories: [5] }, ['categories'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The closing step on a synthetic database

let db: Db;
let userId: string;
const now = new Date('2026-11-20T03:00:00.000Z');
const flea: Collector = {
  source: 'flea',
  label: 'Flea',
  supports: () => true,
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

const dirs: string[] = [];
/** A fresh install: the sources, an admin and the console (the helpers use the current `db`). */
async function newDb(): Promise<Db> {
  const dir = await mkdtemp(join(tmpdir(), 'tora-game-rules-'));
  dirs.push(dir);
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    { key: 'flea', label: 'Flea', market: 'jp', currency: 'JPY' },
    { key: 'auction', label: 'Auction', market: 'jp', currency: 'JPY' },
    { key: 'abroad', label: 'Abroad', market: 'us', currency: 'USD', noAi: true },
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
    categories: { flea: '111' },
    boxedAllowed: false,
  });
  return db;
}

beforeEach(async () => {
  await newDb();
  return async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  };
});

const game = (name: string) =>
  createProduct(db, userId, { category: 'game', kind: 'software', name, platform: 'Alpha' });

let ref = 0;
async function sales(
  productId: string,
  names: string[],
  source = 'flea',
  cat: string | null = '111',
) {
  await insertObservations(
    db,
    names.map((name) => ({
      productId,
      source,
      observationType: 'sold' as const,
      bucket: 'used',
      priceBase: 1000,
      priceOriginal: 1000,
      currency: 'JPY',
      observedAt: '2026-11-01T12:00:00.000+09:00',
      fetchedAt: '2026-11-01T12:00:00.000+09:00',
      externalRef: `s${String(ref++).padStart(6, '0')}`,
      raw: { name, ...(cat && { cat }) },
    })),
  );
  return db
    .select()
    .from(schema.priceObservations)
    .where(eq(schema.priceObservations.productId, productId))
    .orderBy(asc(schema.priceObservations.externalRef));
}
const rowsOf = (productId: string) =>
  db
    .select()
    .from(schema.priceObservations)
    .where(eq(schema.priceObservations.productId, productId))
    .then((rs) => rs.toSorted((a, b) => (a.externalRef ?? '').localeCompare(b.externalRef ?? '')));
const kept = async (productId: string) =>
  (await rowsOf(productId)).filter((r) => !r.excluded).map((r) => (r.raw as { name: string }).name);
const words = (productId: string, excluded: string[], required: string[] = []) =>
  saveItemRules(db, productId, { ...noRules, excluded, required }, userId);
const apply = () => applyItemRules(db, [flea], { now });
const auction: Collector = { ...flea, source: 'auction', label: 'Auction' };
const alpha = (categories: Record<string, string>) =>
  saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha' },
    aliases: [],
    categories,
    boxedAllowed: false,
  });

describe('applyItemRules', () => {
  it('does nothing while the switch is off (the default)', async () => {
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest lot']);
    await words(g.id, ['lot']);
    expect(await gameRulesOn(db)).toBe(false);
    expect(await apply()).toMatchObject({ on: false, judged: 0, marked: 0 });
    expect(await kept(g.id)).toEqual(['Hero Quest lot']);
  });

  it('marks on a word, restores when it goes, and a rerun with no change writes nothing', async () => {
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest lot', 'Hero Quest']);
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    const before = new Map((await rowsOf(g.id)).map((r) => [r.id, r.updatedAt]));
    expect(await apply()).toMatchObject({ judged: 1, marked: 1 });
    const marked = (await rowsOf(g.id)).find((r) => r.excluded)!;
    expect(marked).toMatchObject({ excludedReason: 'mismatch' });
    expect(marked.ruleMark).toMatch(/^rules:/);
    // Marks never touch updated_at (S30 reads a later change as a person's). Compared with the
    // row's own value before the mark: an insert's two clock reads can differ by a millisecond.
    expect(marked.updatedAt).toBe(before.get(marked.id));
    expect(await apply()).toMatchObject({ judged: 0, marked: 0, restored: 0 });

    await words(g.id, []);
    expect(await apply()).toMatchObject({ judged: 1, restored: 1 });
    expect((await rowsOf(g.id)).every((r) => !r.excluded && r.ruleMark === null)).toBe(true);
  });

  it("judges again when the console's category is fixed", async () => {
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest'], 'flea', '111');
    await sales(g.id, ['Hero Quest guide'], 'flea', '222');
    await setGameRules(db, true);
    expect(await apply()).toMatchObject({ marked: 1 });
    await saveConsole(db, {
      key: 'alpha',
      names: { en: 'Alpha' },
      aliases: [],
      categories: { flea: '222' },
      boxedAllowed: false,
    });
    expect(await apply()).toMatchObject({ judged: 1 });
    // Now the three 111 sales fail and only the 222 one passes: more than half, but fewer than
    // HOLD_MIN, so applied.
    expect(await kept(g.id)).toEqual(['Hero Quest guide']);
  });

  it('never overrides a person: an include before or after the rules, a hand exclude', async () => {
    const g = await game('Hero Quest');
    const rows = await sales(g.id, [
      'Hero Quest',
      'Hero Quest',
      'Hero Quest lot a',
      'Hero Quest lot b',
      'Hero Quest lot c',
    ]);
    // a: a person kept it (a filter row included), before the rules.
    await db
      .update(schema.priceObservations)
      .set({ raw: { name: 'Hero Quest lot a', filter: 'bundle' } })
      .where(eq(schema.priceObservations.id, rows[2]!.id));
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    await apply();
    expect(await kept(g.id)).toEqual(['Hero Quest', 'Hero Quest', 'Hero Quest lot a']);
    // b: included by a person after the mark; c: excluded by hand after the mark.
    await setObservationExcluded(db, rows[3]!.id, false);
    await setObservationExcluded(db, rows[4]!.id, true);
    await words(g.id, ['lot', 'demo']);
    await apply();
    expect(await kept(g.id)).toEqual([
      'Hero Quest',
      'Hero Quest',
      'Hero Quest lot a',
      'Hero Quest lot b',
    ]);
    // Off: the hand exclude stays, the include stays, no mark is left.
    await setGameRules(db, false);
    await apply();
    const after = await rowsOf(g.id);
    expect(after.map((r) => [!!r.excluded, r.excludedReason, r.ruleMark])).toEqual([
      [false, null, null],
      [false, null, null],
      [false, null, null],
      [false, null, null],
      [true, 'manual', null],
    ]);
  });

  it('holds an item the rules would empty, until a person releases it for these rules', async () => {
    const g = await game('Hero Quest');
    await sales(g.id, [
      ...Array.from({ length: HOLD_MIN }, () => 'Hero Quest lot'),
      ...Array.from({ length: 3 }, () => 'Hero Quest'),
    ]);
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    const s = await apply();
    expect(s.held).toEqual([{ productId: g.id, would: HOLD_MIN, kept: HOLD_MIN + 3 }]);
    expect(s.marked).toBe(0);
    expect(await heldItemCount(db)).toBe(1);
    expect(await apply()).toMatchObject({ judged: 0 });

    expect(await releaseHeld(db, g.id, userId, now)).toBe(true);
    expect(await heldItemCount(db)).toBe(0);
    expect(await apply()).toMatchObject({ judged: 1, marked: HOLD_MIN, held: [] });
    expect(await kept(g.id)).toHaveLength(3);
    // The release holds for those rules only: new rules that would empty it stop again, and a held
    // item is left unfiltered (the earlier rules' marks go too).
    await words(g.id, ['lot', 'Hero']);
    expect(await apply()).toMatchObject({ held: [{ productId: g.id }], restored: HOLD_MIN });
    expect(await kept(g.id)).toHaveLength(HOLD_MIN + 3);
    expect((await ruleMarkCounts(db)).size).toBe(0);
  });

  it('leaves cards, a game switched off and noAi sources alone, and restores a game turned off', async () => {
    const card = await createProduct(db, userId, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Hero Quest lot',
    });
    await sales(card.id, ['Hero Quest lot']);
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest lot']);
    await sales(g.id, ['Hero Quest lot'], 'abroad');
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    await apply();
    expect(await kept(card.id)).toEqual(['Hero Quest lot']);
    expect(await kept(g.id)).toEqual(['Hero Quest', 'Hero Quest', 'Hero Quest lot']);
    // ^ the last kept one is the noAi source's row.
    expect((await rowsOf(g.id)).filter((r) => r.source === 'abroad')[0]!.ruleMark).toBeNull();
    await saveItemRules(db, g.id, { ...noRules, excluded: ['lot'], gameRules: 0 }, userId);
    expect(await apply()).toMatchObject({ restored: 1 });
    expect((await ruleStates(db)).has(g.id)).toBe(false);
  });

  it('on then off leaves every row as it was', async () => {
    const a = await game('Hero Quest');
    const b = await game('Star Tale');
    await sales(
      a.id,
      ['Hero Quest', 'Hero Quest lot', 'Hero Quest', 'Hero Quest guide'],
      'flea',
      '111',
    );
    await sales(b.id, ['Star Tale', 'Star Tale'], 'flea', '333');
    await sales(b.id, ['Star Tale'], 'flea', null);
    await words(a.id, ['lot', 'guide']);
    const before = await db.select().from(schema.priceObservations);
    await setGameRules(db, true);
    expect((await apply()).marked).toBe(4);
    await setGameRules(db, false);
    expect((await apply()).restored).toBe(4);
    const after = await db.select().from(schema.priceObservations);
    const key = (r: (typeof before)[number]) => r.id;
    expect(after.toSorted((x, y) => key(x).localeCompare(key(y)))).toEqual(
      before.toSorted((x, y) => key(x).localeCompare(key(y))),
    );
    expect((await ruleMarkCounts(db)).size).toBe(0);
    expect((await ruleStates(db)).size).toBe(0);
  });

  it('keeps marks tracked when a duplicate merges into an item', async () => {
    const a = await game('Hero Quest');
    const dup = await game('Hero Quest copy');
    await sales(dup.id, ['Hero Quest copy', 'Hero Quest copy', 'Hero Quest copy lot']);
    await setGameRules(db, true);
    await words(dup.id, ['lot']);
    await apply();
    await mergeProducts(db, { id: userId, role: 'admin' }, dup.id, a.id);
    expect((await ruleStates(db)).get(a.id)).toMatchObject({ appliedHash: null });
    await setGameRules(db, false);
    expect(await apply()).toMatchObject({ restored: 1 });
    expect((await ruleMarkCounts(db)).size).toBe(0);
  });

  it("is not judged again when a source it does not judge changes its console's category", async () => {
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest lot']);
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    expect(await apply()).toMatchObject({ judged: 1, marked: 1 });
    await alpha({ flea: '111', auction: '9' });
    expect(await apply()).toMatchObject({ judged: 0, marked: 0, restored: 0 });
  });

  it('judges a source that starts reading sales, and takes back the marks of one that stops', async () => {
    const g = await game('Hero Quest');
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest lot']);
    await sales(g.id, ['Hero Quest', 'Hero Quest', 'Hero Quest lot'], 'auction', null);
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    expect(await apply()).toMatchObject({ judged: 1, marked: 1 });
    // The auction plug-in now says how to read a sale: judged the next night.
    const both = () => applyItemRules(db, [flea, { ...auction }], { now });
    expect(await both()).toMatchObject({ judged: 1, marked: 1 });
    expect((await rowsOf(g.id)).filter((r) => r.ruleMark).map((r) => r.source)).toEqual([
      'flea',
      'auction',
    ]);
    expect(await both()).toMatchObject({ judged: 0 });
    // It stops (its saleText is gone): its marks are taken back, the flea's stay.
    expect(await apply()).toMatchObject({ judged: 1, marked: 0, restored: 1 });
    expect((await rowsOf(g.id)).filter((r) => r.ruleMark).map((r) => r.source)).toEqual(['flea']);
    // Judged again, then made noAi: taken back by SQL, its rows never read.
    await both();
    await saveSourceInfos(db, [
      { key: 'auction', label: 'Auction', market: 'jp', currency: 'JPY', noAi: true },
    ] as Parameters<typeof saveSourceInfos>[1]);
    expect(await both()).toMatchObject({ judged: 1, restored: 1 });
    expect((await rowsOf(g.id)).filter((r) => r.ruleMark).map((r) => r.source)).toEqual(['flea']);
  });

  it('takes back marks a collect saved after the switch went off and its states were removed', async () => {
    const g = await game('Hero Quest');
    await createQuerySource(db, g.id, 'flea', { keywords: ['Hero Quest'] });
    await sales(g.id, ['Hero Quest', 'Hero Quest']);
    await setGameRules(db, true);
    await words(g.id, ['lot']);
    await apply();
    const collector: Collector = {
      ...flea,
      supports: (p) => p.category === 'game',
      collect: async (_link, product, ctx) => {
        // Another collect's closing step runs meanwhile with the switch off.
        await setGameRules(db, false);
        await apply();
        expect((await ruleStates(db)).size).toBe(0);
        await ctx.save([soldRow(product.id, 'late-0', 'Hero Quest lot', ctx.now)]);
        return { state: null, complete: true };
      },
    };
    await runCollector(db, collector, quiet);
    const late = (await rowsOf(g.id)).find((r) => r.externalRef === 'late-0')!;
    expect(late).toMatchObject({ excluded: true, excludedReason: 'mismatch' });
    expect((await ruleStates(db)).has(g.id)).toBe(true);
    expect(await apply()).toMatchObject({ on: false, restored: 1 });
    expect((await ruleMarkCounts(db)).size).toBe(0);
    expect((await ruleStates(db)).size).toBe(0);
  });
});

const quiet = { log: () => {}, http: { minDelayMs: 0, maxDelayMs: 0 }, now };
const soldRow = (productId: string, ref: string, name: string, at: Date, cat = '111') => ({
  productId,
  source: 'flea',
  observationType: 'sold' as const,
  bucket: 'used',
  price: 1000,
  currency: 'JPY',
  observedAt: '2026-11-01T12:00:00.000+09:00',
  fetchedAt: at.toISOString(),
  externalRef: ref,
  raw: { name, cat },
});

describe('a collect with the switch on', () => {
  it('runs the overlaid search, never stores it, and marks new sales once the hash is applied', async () => {
    const g = await game('Hero Quest');
    await createQuerySource(db, g.id, 'flea', { keywords: ['Hero Quest'] });
    await words(g.id, ['lot']);
    await setGameRules(db, true);
    const seen: unknown[] = [];
    let n = 0;
    const collector: Collector = {
      ...flea,
      supports: (p) => p.category === 'game',
      collect: async (link, product, ctx) => {
        seen.push({ query: link.query, rules: ctx.itemRules?.hash ?? null });
        n++;
        await ctx.save(
          ['Hero Quest', 'Hero Quest lot'].map((name, i) =>
            soldRow(product.id, `run${n}-${i}`, name, ctx.now),
          ),
        );
        return { state: null, complete: true, query: link.query ?? undefined };
      },
    };
    await runCollector(db, collector, quiet);
    const hash = rulesHash(
      effectiveRules({ platform: 'Alpha', region: null }, { ...noRules, excluded: ['lot'] }, [
        { key: 'alpha', names: {}, aliases: [], categories: { flea: '111' }, boxedAllowed: false },
      ]),
      'flea',
    );
    expect(seen[0]).toEqual({
      query: { keywords: ['Hero Quest'], categoryId: '111' },
      rules: hash,
    });
    const [stored] = await db
      .select()
      .from(schema.productSources)
      .where(eq(schema.productSources.productId, g.id));
    expect(stored!.query).toEqual({ keywords: ['Hero Quest'] });
    // Before the closing step: new sales saved as the plug-in kept them.
    expect((await rowsOf(g.id)).filter((r) => r.ruleMark)).toHaveLength(0);
    await apply();
    expect(await kept(g.id)).toEqual(['Hero Quest']);
    await db.update(schema.productSources).set({ lastSuccessAt: null, nextRunAt: null } as never);
    await runCollector(db, collector, { ...quiet, now: new Date(now.getTime() + 86_400_000) });
    const fresh = (await rowsOf(g.id)).filter((r) => r.externalRef?.startsWith('run2'));
    expect(fresh.map((r) => [!!r.excluded, r.ruleMark])).toEqual([
      [false, null],
      [true, `rules:${hash}`],
    ]);
  });

  it('on then off leaves the sales, the listing and the rule states as a collect with it off', async () => {
    // A plug-in like the marketplaces': its own filter on the excluded keywords (stored excluded,
    // no rules mark), recent sales from the rows it kept, a state that learns the search's category.
    const SALES = [
      { ref: 'a', name: 'Hero Quest', cat: '111' },
      { ref: 'b', name: 'Hero Quest lot', cat: '111' },
      { ref: 'c', name: 'Hero Quest manual', cat: '111' },
      { ref: 'd', name: 'Hero Quest', cat: '999' },
    ];
    const recentOf: unknown[][] = [];
    const plugin: Collector = {
      ...flea,
      supports: (p) => p.category === 'game',
      collect: async (link, product, ctx) => {
        const q = link.query!;
        const rows = SALES.filter((s) => !q.categoryId || s.cat === q.categoryId).map((s) => {
          const hit = (q.excludeKeywords ?? []).some((w) => s.name.includes(w));
          return {
            ...soldRow(product.id, s.ref, s.name, ctx.now, s.cat),
            observedAt: `2026-11-0${s.ref.charCodeAt(0) - 96}T12:00:00.000+09:00`,
            excluded: hit,
            excludedReason: hit ? ('mismatch' as const) : null,
          };
        });
        await ctx.save(rows);
        const kept = rows.filter((r) => !r.excluded);
        const prev = (link.state ?? {}) as { categories?: string[] };
        const recentSales = kept.map((r) => ({
          bucket: r.bucket,
          price: r.price,
          observedAt: new Date(r.observedAt).toISOString(),
          approximate: false,
        }));
        recentOf.push(recentSales);
        return {
          state: {
            categories: [
              ...new Set([...(prev.categories ?? []), ...(q.categoryId ? [q.categoryId] : [])]),
            ],
            runs: ((link.state as { runs?: number } | null)?.runs ?? 0) + 1,
          },
          complete: true,
          title: `"${(q.keywords ?? []).join(' ')}"`,
          url: `https://example.test/search?q=${(q.keywords ?? []).join('+')}&c=${q.categoryId ?? ''}`,
          recentSales,
        };
      },
    };
    const withPlugin = { ...plugin, overlayKeeps: ['categories'] };
    const setUp = async () => {
      const g = await game('Hero Quest');
      await createQuerySource(db, g.id, 'flea', {
        keywords: ['Hero Quest'],
        excludeKeywords: ['manual'],
      });
      await words(g.id, ['lot'], ['Quest']);
      return g.id;
    };
    const again = () =>
      db.update(schema.productSources).set({ lastSuccessAt: null, nextRunAt: null } as never);
    const tables = async (productId: string) => {
      const clock = new Set([
        'id',
        'productId',
        'createdAt',
        'updatedAt',
        'lastSuccessAt',
        'nextRunAt',
      ]);
      const strip = (r: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => !clock.has(k)));
      return {
        sales: (await rowsOf(productId)).map(strip),
        listing: (
          await db
            .select()
            .from(schema.productSources)
            .where(eq(schema.productSources.productId, productId))
        ).map(strip),
        states: await db.select().from(schema.itemRuleState),
      };
    };

    // With it off: one collect.
    const off = await setUp();
    await runCollector(db, withPlugin, quiet);
    const expected = await tables(off);
    expect(expected.sales.filter((r) => r.excluded).map((r) => r.externalRef)).toEqual(['c']);

    // A second install: on (a collect, its closing step, another collect), then off.
    db = await newDb();
    const g = await setUp();
    await setGameRules(db, true);
    await runCollector(db, withPlugin, quiet);
    // The plug-in's filter saw no rule word: the lot sale is stored kept, judged by the marks.
    expect((await rowsOf(g)).find((r) => r.externalRef === 'b')).toMatchObject({ excluded: false });
    // Stored kept (the closing step has not judged the item yet), so it is still a recent sale.
    const listingOf = async () =>
      (
        await db.select().from(schema.productSources).where(eq(schema.productSources.productId, g))
      )[0]!;
    const listing = await listingOf();
    expect(recentOf.at(-1)).toHaveLength(2);
    expect(listing.recentSales).toHaveLength(2);
    // The narrowed search's title, address and learned category were not stored.
    expect(listing).toMatchObject({ title: null, url: null });
    expect(listing.state).toEqual({ runs: 1 });
    await apply();
    expect((await rowsOf(g)).find((r) => r.externalRef === 'b')).toMatchObject({
      excluded: true,
      excludedReason: 'mismatch',
    });
    await again();
    await runCollector(db, withPlugin, { ...quiet, now: new Date(now.getTime() + 3_600_000) });
    // The recent sales leave out the sale stored excluded by the rules.
    expect(recentOf.at(-1)).toHaveLength(2);
    expect((await listingOf()).recentSales).toHaveLength(1);
    // A person keeps that sale: it comes back from the search every night and stays a recent sale.
    const lot = (await rowsOf(g)).find((r) => r.externalRef === 'b')!;
    await setObservationExcluded(db, lot.id, false);
    await again();
    await runCollector(db, withPlugin, { ...quiet, now: new Date(now.getTime() + 7_200_000) });
    expect((await listingOf()).recentSales).toHaveLength(2);
    await setGameRules(db, false);
    await apply();
    await again();
    await runCollector(db, withPlugin, quiet);
    const after = await tables(g);
    // The only differences a collect makes by itself: how many runs the plug-in counted.
    expect(
      after.listing.map((l) => ({ ...l, state: { ...(l.state as object), runs: 1 } })),
    ).toEqual(expected.listing);
    expect(after.sales).toEqual(expected.sales);
    expect(after.states).toEqual([]);
    expect(expected.states).toEqual([]);
  });

  it('sends an item back to the closing step when a run marks under rules no longer applied', async () => {
    const g = await game('Hero Quest');
    await words(g.id, ['lot']);
    const { price, currency: _currency, ...sold } = soldRow(g.id, 'x', 'Hero Quest lot', now);
    const row = (ref: string) => ({
      ...sold,
      externalRef: ref,
      priceBase: price,
      excluded: true,
      excludedReason: 'mismatch' as const,
      ruleMark: 'rules:old',
    });
    const state = async () =>
      (
        await db.select().from(schema.itemRuleState).where(eq(schema.itemRuleState.productId, g.id))
      )[0];
    const base = { productId: g.id, appliedAt: null, held: null };
    // The same rules as applied: the state stays.
    await db.insert(schema.itemRuleState).values({ ...base, appliedHash: 'flea=old other=x' });
    await insertObservationsWithRuleState(db, [row('m1')]);
    expect((await state())!.appliedHash).toBe('flea=old other=x');
    // Judged under other rules since the run began: judged again in full.
    await db.update(schema.itemRuleState).set({ appliedHash: 'flea=new other=x' });
    await insertObservationsWithRuleState(db, [row('m2')]);
    expect((await state())!.appliedHash).toBeNull();
    // Held since the run began: judged again (which restores every mark of a held item).
    await db
      .update(schema.itemRuleState)
      .set({ appliedHash: 'flea=old', held: { hash: 'flea=old', at: 'x', would: 12, kept: 20 } });
    await insertObservationsWithRuleState(db, [row('m3')]);
    expect((await state())!.appliedHash).toBeNull();
  });

  it('gives a card no rules and its stored search as it is', async () => {
    const card = await createProduct(db, userId, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box',
    });
    await createQuerySource(db, card.id, 'flea', { keywords: ['Box'] });
    await setGameRules(db, true);
    const seen: unknown[] = [];
    await runCollector(
      db,
      {
        ...flea,
        collect: async (link, _p, ctx) => {
          seen.push([link.query, ctx.itemRules]);
          return { state: null, complete: true };
        },
      },
      { log: () => {}, http: { minDelayMs: 0, maxDelayMs: 0 }, now },
    );
    expect(seen).toEqual([[{ keywords: ['Box'] }, undefined]]);
  });
});

describe('stored listings (S36 A2, A4)', () => {
  const found = (n: number): FoundListing[] =>
    Array.from({ length: n }, (_, i) => ({
      ref: `L${String(i).padStart(2, '0')}`,
      title: i === 0 ? 'Hero Quest lot' : 'Hero Quest',
      url: `https://flea.example/L${i}`,
      price: 1000 + i * 10,
      currency: 'JPY',
      seller: i === 1 ? 's1' : null,
      category: '111',
      shippingPayerId: i === 1 ? '2' : null,
    }));
  const plain = {
    bucket: 'used',
    lowestAsk: 500,
    currency: 'JPY',
    listings: 7,
    url: 'https://flea.example/plain',
    raw: { more: true },
  };
  // A plug-in giving its own rows and, beside them, its found listings for any item: the SDK
  // decides which are stored.
  const lister = (buckets: FoundSearch['buckets'], supply = [plain]): Collector => ({
    ...flea,
    collect: async () => ({
      state: null,
      complete: true,
      supply,
      found: { buckets, foundCapped: true, currency: 'JPY', raw: { more: true } },
    }),
  });
  const twentyFive = lister([{ bucket: 'used', found: found(25), foundFloor: 1010 }]);
  const supplyOf = (productId: string) =>
    db
      .select()
      .from(schema.supply)
      .where(eq(schema.supply.productId, productId))
      .orderBy(asc(schema.supply.day), asc(schema.supply.bucket));
  const again = (hours: number) =>
    db
      .update(schema.productSources)
      .set({ lastSuccessAt: null, nextRunAt: null } as never)
      .then(() => ({ ...quiet, now: new Date(now.getTime() + hours * 3_600_000) }));
  const onGame = async () => {
    const g = await game('Hero Quest');
    await createQuerySource(db, g.id, 'flea', { keywords: ['Hero Quest'] });
    await words(g.id, ['lot']);
    await setGameRules(db, true);
    return g;
  };

  it('a game with the switch on stores the cheapest 20 that pass, the ask and count from them', async () => {
    const g = await onGame();
    await runCollector(db, twentyFive, quiet);
    const [row, ...rest] = await supplyOf(g.id);
    expect(rest).toEqual([]);
    const offers = supplyOffers(row!)!;
    // L00 fails the words; L01 (1010) is on the line and passes.
    expect(offers).toHaveLength(20);
    expect(offers[0]).toEqual({
      ref: 'L01',
      title: 'Hero Quest',
      url: 'https://flea.example/L1',
      priceBase: 1010,
      priceOriginal: 1010,
      currency: 'JPY',
      seller: 's1',
      category: '111',
      shipping: 'unknown',
      shippingPayerId: '2',
    });
    expect([
      row!.lowestAskBase,
      row!.lowestAskOriginal,
      row!.listings,
      row!.listingsCapped,
    ]).toEqual([1010, 1010, 24, 1]);
    expect(row!.url).toBe('https://flea.example/L1');
    expect(row!.raw).toEqual({ more: true });
  });

  it('once confirmed, 5; marked "not the item" refs are left out', async () => {
    const g = await onGame();
    const current = (await currentRules(db, g.id))!;
    await recordItemCheck(db, {
      productId: g.id,
      kind: 'listings',
      source: 'flea',
      outcome: 'passed',
      by: 'check',
      rulesHash: current.hashFor('listings', 'flea'),
    });
    await db.insert(schema.notItemMarks).values(
      ['L01', 'L02', 'L03', 'L04', 'L05'].map((externalRef) => ({
        productId: g.id,
        source: 'flea',
        externalRef,
        userId,
        at: '2026-11-19T12:00:00.000+09:00',
      })),
    );
    await runCollector(db, twentyFive, quiet);
    const [row] = await supplyOf(g.id);
    expect(supplyOffers(row!)!.map((o) => o.ref)).toEqual(['L06', 'L07', 'L08', 'L09', 'L10']);
    expect([row!.lowestAskOriginal, row!.listings]).toEqual([1060, 19]);
  });

  const asGiven = (r: typeof schema.supply.$inferSelect) => [
    r.bucket,
    r.lowestAskOriginal,
    r.listings,
    r.url,
    r.raw,
    r.offers,
    r.listingsCapped,
  ];
  const givenRow = ['used', 500, 7, 'https://flea.example/plain', { more: true }, null, null];

  it("a card, or a game with the switch off, stores the plug-in's own rows, no offers", async () => {
    const card = await createProduct(db, userId, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box',
    });
    await createQuerySource(db, card.id, 'flea', { keywords: ['Box'] });
    const g = await onGame();
    await runCollector(db, twentyFive, quiet);
    expect((await supplyOf(card.id)).map(asGiven)).toEqual([givenRow]);
    // Off again: the same day's second collect takes the game's listings out of its row.
    await setGameRules(db, false);
    await runCollector(db, twentyFive, await again(1));
    expect((await supplyOf(g.id)).map(asGiven)).toEqual([givenRow]);
  });

  it("a held item stores the plug-in's own rows, no offers", async () => {
    const g = await onGame();
    await db.insert(schema.itemRuleState).values({
      productId: g.id,
      appliedAt: null,
      appliedHash: null,
      held: { hash: 'flea=x', at: 'x', would: 12, kept: 20 },
    });
    await runCollector(db, twentyFive, quiet);
    expect((await supplyOf(g.id)).map(asGiven)).toEqual([givenRow]);
  });

  it('a condition where nothing passed is written with no ask and an unknown count', async () => {
    const g = await onGame();
    const lots = found(3).map((l) => ({ ...l, title: 'Hero Quest lot' }));
    await runCollector(db, lister([{ bucket: 'used', found: lots, foundFloor: null }]), quiet);
    const rows = await supplyOf(g.id);
    // The search was capped: real copies may sit past what was read, so the count is not 0.
    expect(rows.map((r) => [r.bucket, r.lowestAskBase, r.lowestAskOriginal, r.listings])).toEqual([
      ['used', null, null, null],
    ]);
    expect([supplyOffers(rows[0]!), rows[0]!.url, rows[0]!.listingsCapped]).toEqual([[], null, 1]);
  });

  it('writes a row only for the conditions tonight found listings in, night after night', async () => {
    const g = await onGame();
    const used = { bucket: 'used', found: found(3), foundFloor: null };
    const boxed = { bucket: 'boxed', found: found(2), foundFloor: null };
    const days = async () =>
      (await supplyOf(g.id)).map((r) => [r.day.slice(8), r.bucket, r.lowestAskOriginal]);
    await runCollector(db, lister([used, boxed]), quiet);
    // The next nights find nothing boxed: no row for it, on the second night or the third.
    await runCollector(db, lister([used]), await again(24));
    await runCollector(db, lister([used]), await again(48));
    const rows = await days();
    expect(rows.filter((r) => r[1] === 'boxed')).toHaveLength(1);
    expect(rows.filter((r) => r[1] === 'used')).toHaveLength(3);
    // What a reader sees: the last night's report, where boxed is not for sale.
    const current = (await currentSupply(db, [g.id], new Date(now.getTime() + 48 * 3_600_000))).get(
      g.id,
    )!;
    expect(current.map((r) => r.bucket)).toEqual(['used']);
    expect(lowestAsk(current, 'boxed')).toBeNull();
  });
});
