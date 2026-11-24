import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ItemRulesRow } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import {
  addSuggestedConsoles,
  consolePlugins,
  consoleUseCounts,
  deleteConsole,
  listConsoles,
  saveConsole,
  saveConsolePlugins,
} from './consoles';
import {
  confirmations,
  confirmedBy,
  currentRules,
  failureStands,
  recordItemCheck,
  saveItemRules,
} from './item-rules';
import { migrateDb } from './migrate';
import { createProduct, deleteUnusedProduct, mergeProducts } from './mutations';
import {
  addNight,
  addSpan,
  coveredDays,
  coveredRanges,
  mergeRanges,
  sourceNights,
  removeSpan,
} from './sale-coverage';
import {
  itemChecks,
  itemRuleState,
  itemRules,
  notItemMarks,
  products,
  saleCoverage,
  saleSpans,
} from './schema';
import { createUser } from './users';

let db: Db;
let admin: string;
let member: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wishlist-rules-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = (await createUser(db, 'a', creds, 'admin')).user.id;
  member = (await createUser(db, 'm', creds, 'member')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

// Made-up consoles and category numbers (public test).
const alpha = {
  key: 'Alpha',
  names: { en: 'Alpha Station' },
  aliases: ['ALPHA ST'],
  categories: { market: '111' },
  boxedAllowed: true,
};

const game = (name: string, platform: string | null = 'Alpha Station') =>
  createProduct(db, admin, { category: 'game', kind: 'software', name, platform });

/** Today's hash of an item's sales checks, or of its listings checks at `source`. */
const hashOf = async (productId: string, source?: string) =>
  (await currentRules(db, productId))!.hashFor(
    source === undefined ? 'sales' : 'listings',
    source ?? '',
  );

const rules = (over: Partial<ItemRulesRow> = {}): ItemRulesRow => ({
  console: 'alpha',
  edition: null,
  required: [],
  excluded: [],
  boxed: false,
  boxedOf: null,
  gameRules: null,
  ...over,
});

describe('mergeRanges', () => {
  it('merges adjacent and overlapping ranges, keeps gaps, drops bad ones', () => {
    expect(mergeRanges([])).toEqual([]);
    expect(mergeRanges([['2026-11-01', '2026-11-01']])).toEqual([['2026-11-01', '2026-11-01']]);
    expect(
      mergeRanges([
        ['2026-11-05', '2026-11-06'],
        ['2026-11-01', '2026-11-02'],
        ['2026-11-03', '2026-11-03'],
        ['2026-11-06', '2026-11-08'],
        ['2026-11-10', '2026-11-10'],
        ['2026-11-12', '2026-11-11'],
        ['2026-02-30', '2026-03-01'],
      ]),
    ).toEqual([
      ['2026-11-01', '2026-11-03'],
      ['2026-11-05', '2026-11-08'],
      ['2026-11-10', '2026-11-10'],
    ]);
    // Across a month end.
    expect(
      mergeRanges([
        ['2026-11-30', '2026-11-30'],
        ['2026-12-01', '2026-12-01'],
      ]),
    ).toEqual([['2026-11-30', '2026-12-01']]);
  });
});

describe('sale coverage', () => {
  it('records nights as compact ranges and merges them with spans', async () => {
    const p = await game('Hero Quest');
    expect(await coveredDays(db, p.id, 'market', '2026-11-01', '2026-11-30')).toEqual([]);
    for (const d of ['2026-11-03', '2026-11-01', '2026-11-02', '2026-11-02', '2026-11-07']) {
      await addNight(db, p.id, 'market', d);
    }
    const [row] = await db.select().from(saleCoverage);
    expect(row!.nights).toEqual([
      ['2026-11-01', '2026-11-03'],
      ['2026-11-07', '2026-11-07'],
    ]);
    const job = await addSpan(db, {
      productId: p.id,
      source: 'market',
      from: '2026-10-30',
      to: '2026-11-05',
      how: 'load',
      jobId: 'job-1',
    });
    expect(job).toBeTruthy();
    expect(await coveredRanges(db, p.id, 'market', '2026-10-31', '2026-11-30')).toEqual([
      ['2026-10-31', '2026-11-05'],
      ['2026-11-07', '2026-11-07'],
    ]);
    // Another source is its own.
    expect(await coveredDays(db, p.id, 'other', '2026-11-01', '2026-11-30')).toEqual([]);
    expect(await removeSpan(db, 'job-1')).toBe(1);
    expect(await coveredDays(db, p.id, 'market', '2026-10-01', '2026-11-30')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-07',
    ]);
    expect(await coveredDays(db, p.id, 'market', '2026-11-02', '2026-11-02')).toEqual([
      '2026-11-02',
    ]);
    expect(await coveredDays(db, p.id, 'market', '2026-11-05', '2026-11-01')).toEqual([]);
    expect(await removeSpan(db, 'none')).toBe(0);
  });

  it('reads nights once and writes only an uncovered night', async () => {
    const p = await game('Hero Quest');
    await addNight(db, p.id, 'market', '2026-11-01');
    const known = (await sourceNights(db, 'market')).get(p.id)!;
    expect(known).toEqual([['2026-11-01', '2026-11-01']]);
    expect((await sourceNights(db, 'other')).size).toBe(0);
    const [before] = await db.select().from(saleCoverage);
    // Covered already: nothing written (the row's time stays).
    expect(await addNight(db, p.id, 'market', '2026-11-01', known)).toEqual(known);
    const [same] = await db.select().from(saleCoverage);
    expect(same!.updatedAt).toBe(before!.updatedAt);
    expect(await addNight(db, p.id, 'market', '2026-11-02', known)).toEqual([
      ['2026-11-01', '2026-11-02'],
    ]);
    expect((await sourceNights(db, 'market')).get(p.id)).toEqual([['2026-11-01', '2026-11-02']]);
    // Another writer changed the row since `known` was read (a merge mid-run): nothing is lost.
    await addNight(db, p.id, 'market', '2026-10-01');
    expect(await addNight(db, p.id, 'market', '2026-11-03', known)).toEqual([
      ['2026-10-01', '2026-10-01'],
      ['2026-11-01', '2026-11-03'],
    ]);
  });

  it('a row removed since its nights were read is not brought back: only the night is written', async () => {
    const p = await game('Hero Quest');
    await addNight(db, p.id, 'market', '2026-11-01');
    await addNight(db, p.id, 'market', '2026-11-02');
    const known = (await sourceNights(db, 'market')).get(p.id)!;
    // As `forgetReads` does when the item's search is saved again mid-run.
    await db.delete(saleCoverage).where(eq(saleCoverage.productId, p.id));
    expect(await addNight(db, p.id, 'market', '2026-11-03', known)).toEqual([
      ['2026-11-03', '2026-11-03'],
    ]);
    const rows = await db.select().from(saleCoverage);
    expect(rows.map((r) => r.nights)).toEqual([[['2026-11-03', '2026-11-03']]]);
  });

  it('refuses a day or span that is not one', async () => {
    const p = await game('Hero Quest');
    await expect(addNight(db, p.id, 'market', '2026-13-01')).rejects.toThrow();
    await expect(
      addSpan(db, {
        productId: p.id,
        source: 'market',
        from: '2026-11-02',
        to: '2026-11-01',
        how: 'deep',
      }),
    ).rejects.toThrow();
    expect(await db.select().from(saleSpans)).toHaveLength(0);
  });
});

describe('consoles', () => {
  it('saves, lists and deletes only an unused console, saying what uses it', async () => {
    expect(await saveConsole(db, alpha)).toBe(true);
    expect(await saveConsole(db, { ...alpha, key: '' })).toBe(false);
    expect(await saveConsole(db, { ...alpha, key: 'x', categories: { market: '1 1' } })).toBe(
      false,
    );
    expect(await listConsoles(db)).toMatchObject([{ key: 'alpha', categories: { market: '111' } }]);
    const p = await game('Hero Quest', 'alpha st');
    expect(await deleteConsole(db, 'alpha')).toEqual({
      deleted: false,
      use: { rules: 0, products: 1 },
    });
    await saveConsole(db, { ...alpha, key: 'beta', names: {}, aliases: [] });
    const q = await game('Other', null);
    await saveItemRules(db, q.id, rules({ console: 'beta' }), admin);
    expect(await deleteConsole(db, 'beta')).toEqual({
      deleted: false,
      use: { rules: 1, products: 0 },
    });
    await deleteUnusedProduct(db, q.id);
    expect(await deleteConsole(db, 'beta')).toEqual({ deleted: true });
    expect(await deleteConsole(db, 'beta')).toEqual({ deleted: false, use: null });
    expect(p.id).toBeTruthy();
  });

  it('counts the items using each console once, by platform or rules', async () => {
    await saveConsole(db, alpha);
    await saveConsole(db, { ...alpha, key: 'beta', names: { en: 'Beta' }, aliases: [] });
    expect(await consoleUseCounts(db)).toEqual(new Map());
    await game('One', 'alpha st');
    const two = await game('Two', 'Alpha Station');
    await saveItemRules(db, two.id, rules({ console: 'alpha' }), admin);
    const three = await game('Three', 'Alpha Station');
    await saveItemRules(db, three.id, rules({ console: 'beta' }), admin);
    await game('Four', 'Gamma');
    await game('Five', null);
    expect(await consoleUseCounts(db)).toEqual(
      new Map([
        ['alpha', 3],
        ['beta', 1],
      ]),
    );
  });

  it('keeps only https search templates that carry the slot', async () => {
    await saveConsolePlugins(db, {
      suggested: [],
      searchSources: ['market'],
      categoryUrls: {
        market: 'https://market.example/search?c=TORA_CATEGORY_ID',
        plain: 'https://plain.example/search',
        bad: 'javascript:TORA_CATEGORY_ID',
      },
    });
    expect((await consolePlugins(db)).categoryUrls).toEqual({
      market: 'https://market.example/search?c=TORA_CATEGORY_ID',
    });
  });

  it('adds the suggested consoles only when asked, never over a row that exists', async () => {
    await saveConsolePlugins(db, {
      suggested: [
        { ...alpha, categories: { market: '999' } },
        { key: 'gamma', names: { en: 'Gamma' }, aliases: [], categories: {}, boxedAllowed: false },
      ],
      searchSources: ['market', 'market'],
    });
    expect(await listConsoles(db)).toHaveLength(0);
    expect((await consolePlugins(db)).searchSources).toEqual(['market']);
    await saveConsole(db, alpha);
    expect(await addSuggestedConsoles(db)).toEqual(['gamma']);
    expect((await listConsoles(db)).find((c) => c.key === 'alpha')!.categories).toEqual({
      market: '111',
    });
    expect(await addSuggestedConsoles(db)).toEqual([]);
  });
});

describe('confirmations', () => {
  const check = (
    productId: string,
    hash: string,
    over: Partial<Parameters<typeof recordItemCheck>[1]> = {},
  ) =>
    recordItemCheck(db, {
      productId,
      kind: 'sales',
      source: '',
      outcome: 'passed',
      by: 'check',
      rulesHash: hash,
      ...over,
    });

  it('holds while the rules hash is today, and goes without deleting a row when words or the category change', async () => {
    await saveConsole(db, alpha);
    const p = await game('Hero Quest');
    const h1 = await hashOf(p.id);
    await check(p.id, h1, { at: '2026-11-01T00:00:00.000+09:00' });
    expect((await confirmations(db, p.id))!.isConfirmed('sales', '')).toBe(true);
    // Listings at a source are their own.
    expect((await confirmations(db, p.id))!.isConfirmed('listings', 'market')).toBe(false);

    await saveConsole(db, { ...alpha, categories: { market: '112' } });
    expect((await confirmations(db, p.id))!.isConfirmed('sales', '')).toBe(false);
    await saveConsole(db, alpha);
    expect((await confirmations(db, p.id))!.isConfirmed('sales', '')).toBe(true);

    await saveItemRules(db, p.id, rules({ required: ['gold'] }), admin);
    const c = (await confirmations(db, p.id))!;
    expect(c.isConfirmed('sales', '')).toBe(false);
    expect(c.hashFor('sales', '')).not.toBe(h1);
    expect(await db.select().from(itemChecks)).toHaveLength(1);
    // A check made under the old rules is refused.
    await expect(check(p.id, h1)).rejects.toThrow('invalid_input');
  });

  it('after a failed check only an admin confirms; a person is refused', async () => {
    const p = await game('Hero Quest');
    const h = await hashOf(p.id, 'market');
    const hs = await hashOf(p.id);
    await check(p.id, h, {
      kind: 'listings',
      source: 'market',
      outcome: 'failed',
      at: '2026-11-01T00:00:00.000+09:00',
    });
    await expect(
      check(p.id, h, {
        kind: 'listings',
        source: 'market',
        outcome: 'confirmed',
        by: 'person',
        userId: member,
      }),
    ).rejects.toThrow('forbidden');
    await expect(
      check(p.id, h, {
        kind: 'listings',
        source: 'market',
        outcome: 'confirmed',
        by: 'admin',
        userId: member,
      }),
    ).rejects.toThrow('forbidden');
    expect((await confirmations(db, p.id))!.isConfirmed('listings', 'market')).toBe(false);
    await check(p.id, h, {
      kind: 'listings',
      source: 'market',
      outcome: 'confirmed',
      by: 'admin',
      userId: admin,
      at: '2026-11-02T00:00:00.000+09:00',
    });
    expect((await confirmations(db, p.id))!.isConfirmed('listings', 'market')).toBe(true);
    // A person's confirmation with no failure before it counts.
    await check(p.id, hs, { outcome: 'confirmed', by: 'person', userId: member });
    expect((await confirmations(db, p.id))!.isConfirmed('sales', '')).toBe(true);
    // Sales need source '', listings a source; each kind its own hash.
    await expect(check(p.id, hs, { source: 'market' })).rejects.toThrow('invalid_input');
    await expect(check(p.id, hs, { kind: 'listings' })).rejects.toThrow('invalid_input');
    await expect(check(p.id, h)).rejects.toThrow('invalid_input');
  });

  it('allows only the outcomes each maker may write', async () => {
    const p = await game('Hero Quest');
    const h = await hashOf(p.id);
    for (const over of [
      { outcome: 'confirmed', by: 'check' },
      { outcome: 'passed', by: 'person', userId: member },
      { outcome: 'not_judged', by: 'person', userId: member },
      { outcome: 'passed', by: 'admin', userId: admin },
      { outcome: 'maybe', by: 'check' },
      { outcome: 'passed', by: 'robot' },
    ] as const) {
      await expect(check(p.id, h, over as Parameters<typeof check>[2])).rejects.toThrow(
        'invalid_input',
      );
    }
    await check(p.id, h, { outcome: 'failed', by: 'person', userId: member });
    expect(await db.select().from(itemChecks)).toHaveLength(1);
  });

  it('refuses a person exactly when the read would not count them', async () => {
    const p = await game('Hero Quest');
    const h = await hashOf(p.id);
    const at = (d: number) => `2026-11-0${d}T00:00:00.000+09:00`;
    const person = { outcome: 'confirmed', by: 'person', userId: member } as const;
    const isConfirmed = async () => (await confirmations(db, p.id))!.isConfirmed('sales', '');
    // failed, admin confirmed, person confirmed: the person's counts and keeps it confirmed.
    await check(p.id, h, { outcome: 'failed', at: at(1) });
    await check(p.id, h, { outcome: 'confirmed', by: 'admin', userId: admin, at: at(2) });
    await check(p.id, h, { ...person, at: at(3) });
    expect(await isConfirmed()).toBe(true);
    // failed, not judged, person confirmed: refused, and not confirmed.
    await check(p.id, h, { outcome: 'failed', at: at(4) });
    await check(p.id, h, { outcome: 'not_judged', at: at(5) });
    await expect(check(p.id, h, { ...person, at: at(6) })).rejects.toThrow('forbidden');
    expect(await isConfirmed()).toBe(false);
    // A later pass by the check does not lift the failure under the same rules either (S36 Terms
    // "Confirmed": after a failed labeled check only an admin confirms).
    await check(p.id, h, { outcome: 'passed', at: at(7) });
    expect(await isConfirmed()).toBe(false);
    await check(p.id, h, { outcome: 'failed', at: at(8) });
    await expect(check(p.id, h, { ...person, at: at(9) })).rejects.toThrow('forbidden');
    expect(await db.select().from(itemChecks)).toHaveLength(7);
  });

  it('does not count a person confirming right after a failure, however it was written', () => {
    const row = (outcome: string, by = 'check') =>
      ({ outcome, by, rulesHash: 'h' }) as Parameters<typeof confirmedBy>[0][number];
    expect(confirmedBy([], 'h')).toBe(false);
    expect(confirmedBy([row('failed'), row('confirmed', 'person')], 'h')).toBe(false);
    expect(confirmedBy([row('failed'), row('passed'), row('confirmed', 'person')], 'h')).toBe(
      false,
    );
    // The check's pass, by order: alone it confirms; after a failure under the same rules it does
    // not, until an admin confirms; a later failure unconfirms; other rules' failure does not count.
    expect(confirmedBy([row('passed')], 'h')).toBe(true);
    expect(confirmedBy([row('failed'), row('passed')], 'h')).toBe(false);
    expect(failureStands([row('failed'), row('passed')], 'h')).toBe(true);
    expect(confirmedBy([row('passed'), row('failed')], 'h')).toBe(false);
    expect(confirmedBy([row('failed'), row('confirmed', 'admin'), row('passed')], 'h')).toBe(true);
    expect(
      confirmedBy([row('failed'), row('confirmed', 'admin'), row('failed'), row('passed')], 'h'),
    ).toBe(false);
    expect(
      confirmedBy(
        [
          { ...row('failed'), rulesHash: 'old' } as Parameters<typeof confirmedBy>[0][number],
          row('passed'),
        ],
        'h',
      ),
    ).toBe(true);
    expect(confirmedBy([row('failed'), row('confirmed', 'admin')], 'h')).toBe(true);
    // A check that could not judge never undoes a confirmation (re-review).
    expect(confirmedBy([row('passed'), row('not_judged')], 'h')).toBe(true);
    expect(confirmedBy([row('confirmed', 'person'), row('not_judged')], 'h')).toBe(true);
    expect(confirmedBy([row('not_judged')], 'h')).toBe(false);
    // Rules fixed after a failed check: the failure was under other rules, so a person may confirm.
    const old = { outcome: 'failed', by: 'check', rulesHash: 'old' } as Parameters<
      typeof confirmedBy
    >[0][number];
    expect(confirmedBy([old, row('confirmed', 'person')], 'h')).toBe(true);
    expect(failureStands([old], 'h')).toBe(false);
    // A person's own "not my item" does not lock them out.
    expect(confirmedBy([row('failed', 'person'), row('confirmed', 'person')], 'h')).toBe(true);
    // Rules changed and changed back: the confirmation made under them counts again.
    expect(confirmedBy([row('confirmed', 'person'), old], 'h')).toBe(true);
    expect(confirmedBy([row('passed')], 'other')).toBe(false);
    // The pair from the review: an admin's confirmation stands over the failure before a person's.
    expect(
      confirmedBy([row('failed'), row('confirmed', 'admin'), row('confirmed', 'person')], 'h'),
    ).toBe(true);
    expect(confirmedBy([row('failed'), row('not_judged'), row('confirmed', 'person')], 'h')).toBe(
      false,
    );
    expect(
      confirmedBy([row('failed'), row('confirmed', 'person'), row('confirmed', 'person')], 'h'),
    ).toBe(false);
    // Pairs a maker may not write never confirm.
    expect(confirmedBy([row('confirmed', 'check')], 'h')).toBe(false);
    expect(confirmedBy([row('passed', 'person')], 'h')).toBe(false);
    expect(failureStands([], 'h')).toBe(false);
    expect(failureStands([row('failed'), row('not_judged')], 'h')).toBe(true);
    expect(failureStands([row('failed'), row('confirmed', 'admin')], 'h')).toBe(false);
  });

  it('keeps listings confirmations at other sources when a category is added', async () => {
    await saveConsole(db, { ...alpha, categories: { other: '5' } });
    const p = await game('Hero Quest');
    for (const source of ['market', 'other'])
      await check(p.id, await hashOf(p.id, source), { kind: 'listings', source });
    await check(p.id, await hashOf(p.id));
    let c = (await confirmations(db, p.id))!;
    expect([c.isConfirmed('listings', 'market'), c.isConfirmed('listings', 'other')]).toEqual([
      true,
      true,
    ]);
    // Adding a category at "market" keeps "other"'s; drops market's and the sales one.
    await saveConsole(db, { ...alpha, categories: { other: '5', market: '111' } });
    c = (await confirmations(db, p.id))!;
    expect(c.isConfirmed('listings', 'other')).toBe(true);
    expect(c.isConfirmed('listings', 'market')).toBe(false);
    expect(c.isConfirmed('sales', '')).toBe(false);
  });

  it("changes with the item's region", async () => {
    const p = await game('Hero Quest');
    const before = await hashOf(p.id);
    await db.update(products).set({ region: 'jp' }).where(eq(products.id, p.id));
    expect(await hashOf(p.id)).not.toBe(before);
  });
});

describe('merge and delete', () => {
  it('moves checks, marks, nights and spans; the target keeps its rules; B confirms A only under equal rules', async () => {
    await saveConsole(db, alpha);
    const a = await game('Hero Quest');
    const b = await game('Hero Quest ');
    const c = await game('Hero Quest Box');
    await saveItemRules(db, c.id, rules({ boxed: true, boxedOf: b.id }), admin);
    const hb = await hashOf(b.id);
    expect(await hashOf(a.id)).toBe(hb);
    await recordItemCheck(db, {
      productId: b.id,
      kind: 'sales',
      source: '',
      outcome: 'passed',
      by: 'check',
      rulesHash: hb,
    });
    await db.insert(notItemMarks).values([
      { productId: a.id, source: 'market', externalRef: 'm1', at: 'x' },
      { productId: b.id, source: 'market', externalRef: 'm1', at: 'x' },
      { productId: b.id, source: 'market', externalRef: 'm2', at: 'x' },
    ]);
    await addNight(db, a.id, 'market', '2026-11-01');
    await addNight(db, b.id, 'market', '2026-11-02');
    await addNight(db, b.id, 'other', '2026-11-05');
    await addSpan(db, {
      productId: b.id,
      source: 'market',
      from: '2026-10-01',
      to: '2026-10-03',
      how: 'deep',
    });
    await db.insert(itemRuleState).values([
      { productId: b.id, appliedHash: hb },
      { productId: a.id, appliedHash: hb, held: { why: 'x' } },
    ]);
    // A has its own row (the same rules as its platform alone): it stays A's.
    await saveItemRules(db, a.id, rules(), admin);
    await saveItemRules(db, b.id, rules({ required: ['other'] }), admin);
    // B's own rules now differ: its earlier check stays under the shared hash.
    await mergeProducts(db, { id: admin, role: 'admin' }, b.id, a.id);

    expect((await db.select().from(itemChecks)).map((r) => r.productId)).toEqual([a.id]);
    expect((await confirmations(db, a.id))!.isConfirmed('sales', '')).toBe(true);
    expect(
      (await db.select().from(notItemMarks))
        .map((m) => `${m.productId}|${m.externalRef}`)
        .toSorted(),
    ).toEqual([`${a.id}|m1`, `${a.id}|m2`].toSorted());
    expect(await coveredDays(db, a.id, 'market', '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(await coveredDays(db, a.id, 'other', '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-05',
    ]);
    expect(await db.select().from(saleCoverage).where(eq(saleCoverage.productId, b.id))).toEqual(
      [],
    );
    expect(await db.select().from(itemRules).where(eq(itemRules.productId, b.id))).toEqual([]);
    // A's sales are judged again: its applied hash is cleared, its hold kept; B's state is gone.
    expect(await db.select().from(itemRuleState)).toMatchObject([
      { productId: a.id, appliedHash: null, held: { why: 'x' } },
    ]);
    const [kept] = await db.select().from(itemRules).where(eq(itemRules.productId, a.id));
    expect(kept!.required).toEqual([]);
    const [boxed] = await db.select().from(itemRules).where(eq(itemRules.productId, c.id));
    expect(boxed!.boxedOf).toBe(a.id);

    // Delete: every row goes.
    await deleteUnusedProduct(db, a.id);
    for (const t of [itemChecks, notItemMarks, saleCoverage, saleSpans]) {
      expect(await db.select().from(t)).toEqual([]);
    }
    const [after] = await db.select().from(itemRules).where(eq(itemRules.productId, c.id));
    expect(after!.boxedOf).toBeNull();
  });

  it("moves the duplicate's rules to a target without its own", async () => {
    await saveConsole(db, alpha);
    const a = await game('Hero Quest');
    const b = await game('Hero Quest Gold');
    await saveItemRules(db, b.id, rules({ required: ['gold'] }), admin);
    const hb = await hashOf(b.id);
    await recordItemCheck(db, {
      productId: b.id,
      kind: 'sales',
      source: '',
      outcome: 'passed',
      by: 'check',
      rulesHash: hb,
    });
    await mergeProducts(db, { id: admin, role: 'admin' }, b.id, a.id);
    expect(await db.select().from(itemChecks)).toHaveLength(1);
    // A had no row: B's moved to it, so B's check (made under the same rules) confirms A.
    const [moved] = await db.select().from(itemRules).where(eq(itemRules.productId, a.id));
    expect(moved!.required).toEqual(['gold']);
    expect((await confirmations(db, a.id))!.isConfirmed('sales', '')).toBe(true);
  });

  it("does not confirm the target by the duplicate's checks when the target's rules differ", async () => {
    await saveConsole(db, alpha);
    const a = await game('Hero Quest');
    const b = await game('Hero Quest Gold');
    await saveItemRules(db, a.id, rules({ required: ['plain'] }), admin);
    await saveItemRules(db, b.id, rules({ required: ['gold'], boxedOf: a.id }), admin);
    const hb = await hashOf(b.id);
    await recordItemCheck(db, {
      productId: b.id,
      kind: 'sales',
      source: '',
      outcome: 'passed',
      by: 'check',
      rulesHash: hb,
    });
    await mergeProducts(db, { id: admin, role: 'admin' }, b.id, a.id);
    expect((await confirmations(db, a.id))!.isConfirmed('sales', '')).toBe(false);
    const rows = await db.select().from(itemRules);
    expect(rows.map((r) => [r.productId, r.required, r.boxedOf])).toEqual([
      [a.id, ['plain'], null],
    ]);
  });

  it('a moved row naming the target as its plain item names none', async () => {
    const a = await game('Hero Quest');
    const b = await game('Hero Quest Box');
    await saveItemRules(db, b.id, rules({ boxed: true, boxedOf: a.id }), admin);
    await mergeProducts(db, { id: admin, role: 'admin' }, b.id, a.id);
    const [row] = await db.select().from(itemRules);
    expect([row!.productId, row!.boxed, row!.boxedOf]).toEqual([a.id, true, null]);
  });
});
