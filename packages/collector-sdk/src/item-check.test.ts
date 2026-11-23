import {
  type Db,
  type SupplyOffer,
  addNight,
  addWatch,
  askChecks,
  assertMayMarkNotItem,
  confirmations,
  createDb,
  createProduct,
  createUser,
  currentRules,
  currentSupply,
  markNotItem,
  saveConsole,
  saveItemRules,
  saveSetting,
  saveSourceInfos,
  saveSupply,
  schema,
  setGameRules,
  unmarkNotItem,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { and, asc, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CheckEntry,
  type CheckFile,
  applyRecord,
  buildSample,
  cheapestOf,
  describePlan,
  judgeBlock,
  judgeSet,
  nearestMedianOf,
  neededOf,
  parseCheckFile,
  planRecord,
  planSources,
  sampleItems,
} from './item-check';
import { appliedRulesHash } from './game-rules';
import { holdRecheckLocks } from './recheck';

// Made-up sources, console, category and titles only.
let db: Db;
let admin: string;
let member: string;
let other: string;
const dirs: string[] = [];

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-item-check-'));
  dirs.push(dir);
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    { key: 'flea', label: 'Flea', market: 'jp', currency: 'JPY' },
    { key: 'auction', label: 'Auction', market: 'jp', currency: 'JPY' },
    { key: 'closed', label: 'Closed', market: 'jp', currency: 'JPY', noAi: true },
    { key: 'abroad', label: 'Abroad', market: 'us', currency: 'USD' },
  ] as Parameters<typeof saveSourceInfos>[1]);
  // The home market is jp (by key order alone it would be the first source's, `abroad`'s).
  await saveSetting(db, 'markets', { primary: 'jp' });
  await setGameRules(db, true);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = (await createUser(db, 'a', creds, 'admin')).user.id;
  member = (await createUser(db, 'm', creds, 'member')).user.id;
  other = (await createUser(db, 'o', creds, 'member')).user.id;
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha' },
    aliases: [],
    categories: { flea: '111' },
    boxedAllowed: false,
  });
  return async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  };
});

const NOW = new Date('2026-11-20T12:00:00+09:00');
/** No source judged by the game rules here (the switch on, the item not held is all it takes). */
const OPTS = { judged: new Set<string>() };
const opts = (now: Date, judged: ReadonlySet<string> = OPTS.judged) => ({ now, judged });
const DAY = 86_400_000;
const game = (name: string) =>
  createProduct(db, admin, { category: 'game', kind: 'software', name, platform: 'Alpha' });
const card = (name: string) => createProduct(db, admin, { category: 'tcg', kind: 'single', name });

/** Kept sold rows at `source`, prices given, one a day back from NOW. */
async function sold(productId: string, prices: number[], source = 'flea', daysBack = 1) {
  await db.insert(schema.priceObservations).values(
    prices.map((price, i) => {
      const at = new Date(NOW.getTime() - (daysBack + i) * DAY).toISOString();
      return {
        productId,
        source,
        observationType: 'sold' as const,
        bucket: 'used',
        priceBase: price,
        priceOriginal: price,
        currency: 'JPY',
        observedAt: at,
        fetchedAt: at,
        externalRef: `${source}-${productId.slice(-6)}-${price}-${i}-${daysBack}`,
        title: `Hero Quest ${i}`,
        createdAt: at,
        updatedAt: at,
      };
    }),
  );
}

const offer = (ref: string, price: number, over: Partial<SupplyOffer> = {}): SupplyOffer => ({
  ref,
  title: `Hero Quest ${ref}`,
  url: `https://flea.example/${ref}`,
  priceBase: price,
  priceOriginal: price,
  currency: 'JPY',
  seller: null,
  category: '111',
  shipping: 'unknown',
  shippingPayerId: null,
  ...over,
});

/**
 * A night's stored listings of `productId` at `source`, and the night read. `updatedAt`: when the row
 * was written (`saveSupply` stamps the wall clock; set here so the test's clock holds).
 */
async function night(
  productId: string,
  day: string,
  offers: SupplyOffer[],
  source = 'flea',
  fetchedAt = `${day}T03:00:00.000+09:00`,
  updatedAt = fetchedAt,
) {
  await saveSupply(db, [
    {
      productId,
      source,
      bucket: 'used',
      day,
      lowestAskBase: offers[0]?.priceBase ?? null,
      lowestAskOriginal: offers[0]?.priceOriginal ?? null,
      currency: 'JPY',
      fxRate: null,
      listings: offers.length,
      url: offers[0]?.url ?? null,
      fetchedAt,
      offers,
    },
  ]);
  await db
    .update(schema.supply)
    .set({ updatedAt })
    .where(
      and(
        eq(schema.supply.productId, productId),
        eq(schema.supply.source, source),
        eq(schema.supply.day, day),
      ),
    );
  await addNight(db, productId, source, day);
}

const label = (file: CheckFile, fn: (e: CheckEntry, i: number) => boolean | null) => ({
  ...file,
  items: file.items.map((it) => ({
    ...it,
    checks: it.checks.map((b) => ({
      ...b,
      entries: b.entries.map((e, i) => ({ ...e, item: fn(e, i) })),
    })),
  })),
});

const rows = (n: number, item: boolean | null) => Array.from({ length: n }, () => ({ item }));

describe('judging', () => {
  it('18 of 20 pass, 17 fail; 19 read need 18; 9 read are not judged', () => {
    expect(neededOf(20)).toBe(18);
    expect(neededOf(19)).toBe(18);
    expect(neededOf(10)).toBe(9);
    expect(neededOf(9)).toBeNull();
    expect(judgeSet([...rows(18, true), ...rows(2, false)]).outcome).toBe('passed');
    expect(judgeSet([...rows(17, true), ...rows(3, false)]).outcome).toBe('failed');
    expect(judgeSet([...rows(18, true), ...rows(1, false)]).outcome).toBe('passed');
    expect(judgeSet([...rows(17, true), ...rows(2, false)]).outcome).toBe('failed');
    expect(judgeSet(rows(9, true))).toMatchObject({ outcome: 'not_judged', needed: null });
    expect(judgeSet([...rows(19, true), ...rows(1, null)])).toMatchObject({
      outcome: 'not_judged',
      unlabeled: 1,
    });
  });

  it('sales pass only when both sets pass; a failed set fails them', () => {
    const e = (item: boolean | null, sets: ('cheap' | 'median')[]) =>
      ({ item, sets }) as unknown as CheckEntry;
    const both = [...Array.from({ length: 20 }, () => e(true, ['cheap', 'median']))];
    expect(judgeBlock({ kind: 'sales', entries: both }).outcome).toBe('passed');
    const cheapBad = [
      ...Array.from({ length: 17 }, () => e(true, ['cheap'])),
      ...Array.from({ length: 3 }, () => e(false, ['cheap'])),
      ...Array.from({ length: 20 }, () => e(true, ['median'])),
    ];
    expect(judgeBlock({ kind: 'sales', entries: cheapBad }).outcome).toBe('failed');
    const medianOpen = [
      ...Array.from({ length: 20 }, () => e(true, ['cheap'])),
      ...Array.from({ length: 20 }, () => e(null, ['median'])),
    ];
    expect(judgeBlock({ kind: 'sales', entries: medianOpen }).outcome).toBe('not_judged');
  });

  it('cheapest and nearest the median, deterministic on ties; fewer than 20: all', () => {
    const r = (price: number, ref: string) => ({ price, source: 's', ref });
    const list = Array.from({ length: 30 }, (_, i) => r(1000 + i * 100, `r${i}`));
    expect(cheapestOf(list).map((x) => x.ref)).toEqual(list.slice(0, 20).map((x) => x.ref));
    // Median 2450: the 20 nearest are r5..r24.
    expect(
      nearestMedianOf(list)
        .map((x) => x.ref)
        .toSorted(),
    ).toEqual(
      list
        .slice(5, 25)
        .map((x) => x.ref)
        .toSorted(),
    );
    expect(nearestMedianOf(list.slice(0, 7))).toHaveLength(7);
    expect(cheapestOf([r(5, 'b'), r(5, 'a')]).map((x) => x.ref)).toEqual(['a', 'b']);
  });
});

describe('sample', () => {
  it('sales: kept, last 12 months, home market, never noAi; sets overlap', async () => {
    const g = await game('Hero Quest');
    await sold(
      g.id,
      Array.from({ length: 30 }, (_, i) => 1000 + i * 100),
    );
    await sold(g.id, [10], 'flea', 400); // older than 12 months
    await sold(g.id, [20], 'closed'); // noAi
    await sold(g.id, [30], 'abroad'); // another market
    await sold(g.id, [40]);
    await db
      .update(schema.priceObservations)
      .set({ excluded: true, excludedReason: 'manual' })
      .where(eq(schema.priceObservations.priceBase, 40));
    const file = await buildSample(db, 'sales', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    const [block] = file.items[0]!.checks;
    expect(block!.hash).toBe((await currentRules(db, g.id))!.hashFor('sales', ''));
    expect(block!.entries.map((e) => e.price).filter((p) => p < 1000)).toEqual([]);
    expect(block!.entries.filter((e) => e.sets.includes('cheap'))).toHaveLength(20);
    expect(block!.entries.filter((e) => e.sets.includes('median'))).toHaveLength(20);
    // 1000..2900 cheap, 1500..3400 median: 15 shared, 25 distinct entries.
    expect(block!.entries).toHaveLength(25);
    expect(block!.entries.every((e) => e.item === null && e.currency === 'JPY')).toBe(true);
  });

  it('cards and sealed are never sampled: explicit ids and --wished name them', async () => {
    const g = await game('Hero Quest');
    const c = await card('Blue Dragon');
    await addWatch(db, member, { productId: c.id }, {});
    await addWatch(db, member, { productId: g.id }, {});
    const explicit = await sampleItems(db, { ids: [g.id, c.id, 'nope'] });
    expect(explicit.games.map((x) => x.id)).toEqual([g.id]);
    expect(explicit.refused).toEqual([`Blue Dragon (${c.id})`]);
    expect(explicit.unknown).toEqual(['nope']);
    const wished = await sampleItems(db, { ids: 'wished' });
    expect(wished.games.map((x) => x.id)).toEqual([g.id]);
    expect(wished.refused).toEqual([`Blue Dragon (${c.id})`]);
  });

  it('listings: distinct listings counted once over the nights; too few nights named', async () => {
    const g = await game('Hero Quest');
    for (let d = 1; d <= 7; d++)
      await night(g.id, `2026-11-0${d}`, [
        offer('L1', 900 + d), // the same listing every night, its price moving
        offer(`N${d}`, 1500 + d),
        offer('BAD', 500, { category: '999' }), // not the console's category
      ]);
    await night(g.id, '2026-11-01', [offer('A1', 800)], 'auction');
    // A source the registry does not know: its listings are never sampled.
    for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, [offer('U1', 100)], 'mystery');
    await db.insert(schema.notItemMarks).values({
      productId: g.id,
      source: 'flea',
      externalRef: 'N1',
      userId: member,
      at: '2026-11-08T00:00:00.000+09:00',
    });
    const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    expect(file.items[0]!.checks.map((b) => b.source)).toEqual(['auction', 'flea']);
    const [auction, flea] = file.items[0]!.checks;
    expect(auction).toMatchObject({
      source: 'auction',
      nights: 1,
      tooFewNights: true,
      entries: [],
    });
    expect(flea!.nights).toBe(7);
    expect(flea!.hash).toBe((await currentRules(db, g.id))!.hashFor('listings', 'flea'));
    // L1 once, at its last night's price; N1 marked; BAD fails the rules.
    expect(flea!.entries.map((e) => [e.ref, e.price, e.day])).toEqual([
      ['L1', 907, '2026-11-07'],
      ['N2', 1502, '2026-11-02'],
      ['N3', 1503, '2026-11-03'],
      ['N4', 1504, '2026-11-04'],
      ['N5', 1505, '2026-11-05'],
      ['N6', 1506, '2026-11-06'],
      ['N7', 1507, '2026-11-07'],
    ]);
  });

  it("listings: the identity shop's own copy and outside seller are never sampled (S36 A6)", async () => {
    const g = await game('Hero Quest');
    for (let d = 1; d <= 7; d++) {
      await night(g.id, `2026-11-0${d}`, [offer('L1', 900)]);
      await night(
        g.id,
        `2026-11-0${d}`,
        [
          offer('S|outside|used', 700, { own: 'outside', count: 3, condition: 'used' }),
          offer('S|own|used', 800, { own: 'own', stock: null }),
        ],
        'auction',
      );
    }
    const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    expect(file.items[0]!.checks.map((b) => b.source)).toEqual(['flea']);
  });
});

describe('record', () => {
  async function salesFile(n = 20) {
    const g = await game('Hero Quest');
    await sold(
      g.id,
      Array.from({ length: n }, (_, i) => 1000 + i * 10),
    );
    const file = await buildSample(db, 'sales', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    return { g, file };
  }
  const obs = (productId: string) =>
    db
      .select()
      .from(schema.priceObservations)
      .where(eq(schema.priceObservations.productId, productId))
      .orderBy(asc(schema.priceObservations.priceBase));
  const checksOf = (productId: string) =>
    db.select().from(schema.itemChecks).where(eq(schema.itemChecks.productId, productId));

  it('passes at 18 of 20, excludes the 2 by hand (raw rows stay); twice writes nothing new', async () => {
    const { g, file } = await salesFile();
    const labeled = label(file, (_e, i) => i >= 2);
    const plans = await planRecord(db, labeled, OPTS);
    expect(plans[0]!.blocks[0]).toMatchObject({ outcome: 'passed', recorded: false });
    expect(plans[0]!.blocks[0]!.exclude).toHaveLength(2);
    expect(describePlan(plans).join('\n')).not.toContain('Hero Quest 0');
    expect(await applyRecord(db, plans)).toEqual({ checks: 1, excluded: 2, marked: 0 });
    const after = await obs(g.id);
    expect(after).toHaveLength(20);
    expect(after.slice(0, 2).map((r) => [r.excluded, r.excludedReason])).toEqual([
      [true, 'manual'],
      [true, 'manual'],
    ]);
    expect(after.slice(2).every((r) => !r.excluded)).toBe(true);
    const [check] = await checksOf(g.id);
    expect(check).toMatchObject({ kind: 'sales', source: '', outcome: 'passed', by: 'check' });
    expect((await confirmations(db, g.id))!.isConfirmed('sales', '')).toBe(true);
    // The same file again: nothing new.
    const again = await planRecord(db, labeled, OPTS);
    expect(again[0]!.blocks[0]).toMatchObject({ recorded: true, exclude: [] });
    expect(again[0]!.blocks[0]!.already).toHaveLength(2);
    expect(await applyRecord(db, again)).toEqual({ checks: 0, excluded: 0, marked: 0 });
    expect(await checksOf(g.id)).toHaveLength(1);
  });

  it('fails at 17 of 20 and still excludes; 9 sales are not judged', async () => {
    const { g, file } = await salesFile();
    const plans = await planRecord(
      db,
      label(file, (_e, i) => i >= 3),
      OPTS,
    );
    expect(plans[0]!.blocks[0]!.outcome).toBe('failed');
    await applyRecord(db, plans);
    expect((await obs(g.id)).filter((r) => r.excluded)).toHaveLength(3);
    expect((await checksOf(g.id))[0]!.outcome).toBe('failed');

    const few = await game('Moon Gate');
    await sold(
      few.id,
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => p * 100),
    );
    const small = await buildSample(db, 'sales', [{ id: few.id, name: 'Moon Gate' }], opts(NOW));
    const p2 = await planRecord(
      db,
      label(small, () => true),
      OPTS,
    );
    expect(p2[0]!.blocks[0]!.outcome).toBe('not_judged');
  });

  it('refuses an item whose rules changed since the sample', async () => {
    const { g, file } = await salesFile();
    await saveItemRules(
      db,
      g.id,
      {
        console: 'alpha',
        edition: null,
        required: [],
        excluded: ['manual'],
        boxed: false,
        boxedOf: null,
        gameRules: null,
      },
      admin,
    );
    const plans = await planRecord(
      db,
      label(file, () => false),
      OPTS,
    );
    expect(plans[0]!.refused).toBe('rules changed since the sample: sample again');
    expect(await applyRecord(db, plans)).toEqual({ checks: 0, excluded: 0, marked: 0 });
    expect((await obs(g.id)).some((r) => r.excluded)).toBe(false);
  });

  it('lists a person include as a conflict, never overturned', async () => {
    const { g, file } = await salesFile();
    const labeled = label(file, (_e, i) => i >= 2);
    // The second cheapest was included by a person after its insert.
    const [, second] = await obs(g.id);
    await db
      .update(schema.priceObservations)
      .set({ updatedAt: new Date(NOW.getTime()).toISOString() })
      .where(eq(schema.priceObservations.id, second!.id));
    const [plan] = await planRecord(db, labeled, OPTS);
    expect(plan!.refused).toBeNull();
    expect(plan!.blocks[0]!.conflicts).toEqual([
      { ref: `flea ${second!.externalRef}`, why: 'touched later' },
    ]);
    expect(plan!.blocks[0]!.exclude.map((x) => x.ref)).toHaveLength(1);
    await applyRecord(db, [plan!]);
    expect((await obs(g.id)).filter((r) => r.excluded).map((r) => r.id)).not.toContain(second!.id);
  });

  describe('the file is checked against the sample the database gives', () => {
    const refusedOf = async (f: CheckFile) => {
      const plans = await planRecord(db, f, OPTS);
      expect(await applyRecord(db, plans)).toEqual({
        checks: 0,
        excluded: 0,
        marked: 0,
      });
      return plans[0]!.refused;
    };
    const entriesOf = (f: CheckFile) => f.items[0]!.checks[0]!.entries;

    it('refuses entries removed (3 failing ones dropped would pass)', async () => {
      const { g, file } = await salesFile();
      const labeled = label(file, (_e, i) => i >= 3);
      const dropped = entriesOf(labeled).slice(0, 3);
      labeled.items[0]!.checks[0]!.entries = entriesOf(labeled).slice(3);
      const why = await refusedOf(labeled);
      expect(why).toContain(`left out ${dropped.map((e) => `flea ${e.ref}`).join(', ')}`);
      expect(why).toContain('Sample again');
      expect((await obs(g.id)).some((r) => r.excluded)).toBe(false);
      expect(await checksOf(g.id)).toEqual([]);
    });

    it('refuses entries added, made-up refs labeled true, and a moved set', async () => {
      const { g, file } = await salesFile(30);
      const all = await obs(g.id);
      const inFile = new Set(entriesOf(file).map((e) => e.ref));
      const outside = all.find((r) => !inFile.has(r.externalRef))!;
      const extra = label(file, () => true);
      entriesOf(extra).push({ ...entriesOf(extra)[0]!, ref: outside.externalRef, sets: ['cheap'] });
      expect(await refusedOf(extra)).toContain(`not in the sample flea ${outside.externalRef}`);
      const madeUp = label(file, (_e, i) => i >= 3);
      for (let i = 0; i < 3; i++)
        entriesOf(madeUp)[i] = { ...entriesOf(madeUp)[i]!, ref: `fake-${i}`, item: true };
      expect(await refusedOf(madeUp)).toContain(
        'not in the sample flea fake-0, flea fake-1, flea fake-2',
      );
      const moved = label(file, () => true);
      const cheapOnly = entriesOf(moved).find((e) => e.sets.join() === 'cheap')!;
      cheapOnly.sets = ['median'];
      expect(await refusedOf(moved)).toContain(`other sets flea ${cheapOnly.ref}`);
      expect(await checksOf(g.id)).toEqual([]);
    });

    it('refuses a block for a source never sampled, and too few nights flipped', async () => {
      const g = await game('Hero Quest');
      const offers = Array.from({ length: 20 }, (_, i) => offer(`L${i + 10}`, 1000 + i));
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, offers);
      await night(g.id, '2026-11-01', [offer('A1', 800)], 'auction');
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      const hash = (await currentRules(db, g.id))!.hashFor('listings', 'abroad');
      const extra = label(file, () => true);
      extra.items[0]!.checks.push({
        kind: 'listings',
        source: 'abroad',
        hash,
        entries: entriesOf(extra).map((e) => ({ ...e, source: 'abroad' })),
      });
      expect(await refusedOf(extra)).toContain('listings at abroad was never sampled here');
      // `auction` was read on 1 night; a file saying otherwise, with labels, is refused.
      const flipped = label(file, () => true);
      const auction = flipped.items[0]!.checks.find((b) => b.source === 'auction')!;
      delete auction.tooFewNights;
      auction.entries = [{ ...entriesOf(flipped)[0]!, source: 'auction', ref: 'A1' }];
      expect(await refusedOf(flipped)).toContain(
        'listings at auction: too few nights is true here',
      );
      // A block left out of the file.
      const fewer = label(file, () => true);
      fewer.items[0]!.checks = fewer.items[0]!.checks.filter((b) => b.source !== 'auction');
      expect(await refusedOf(fewer)).toContain('listings at auction is left out of the file');
      expect(await db.select().from(schema.notItemMarks)).toEqual([]);
    });

    it('refuses an item twice in a file, and a sample time later than now', () => {
      const base = {
        kind: 'tora-item-check',
        version: 1,
        check: 'sales',
        sample: 'x',
        sampledAt: NOW.toISOString(),
      };
      const item = { productId: 'p', checks: [] };
      expect(parseCheckFile({ ...base, items: [item, item] }, NOW)).toEqual({
        invalid: 'items[1]: an item twice',
      });
      expect(
        parseCheckFile(
          { ...base, sampledAt: new Date(NOW.getTime() + DAY).toISOString(), items: [] },
          NOW,
        ),
      ).toEqual({ invalid: 'sampledAt' });
      expect(parseCheckFile({ ...base, sampledAt: 'soon', items: [] }, NOW)).toEqual({
        invalid: 'sampledAt',
      });
    });
  });

  it('not judged writes only its row; completed, it is judged and excludes; a relabel refused', async () => {
    const { g, file } = await salesFile();
    // First recorded with one entry not labeled and 2 false: not judged, nothing excluded.
    const partial = label(file, (_e, i) => (i === 19 ? null : i >= 2));
    const first = await planRecord(db, partial, OPTS);
    expect(first[0]!.blocks[0]).toMatchObject({ outcome: 'not_judged', exclude: [] });
    expect(describePlan(first).join('\n')).toContain(
      'not judged: nothing excluded or marked; complete the labels and record again',
    );
    expect(await applyRecord(db, first)).toEqual({ checks: 1, excluded: 0, marked: 0 });
    expect((await obs(g.id)).some((r) => r.excluded)).toBe(false);
    // Finished labels: judged and recorded, the 2 excluded.
    const done = label(file, (_e, i) => i >= 2);
    const second = await planRecord(db, done, OPTS);
    expect(second[0]!.refused).toBeNull();
    expect(second[0]!.blocks[0]!.outcome).toBe('passed');
    expect(await applyRecord(db, second)).toEqual({ checks: 1, excluded: 2, marked: 0 });
    // Relabeled after the pass (false to true, under another sample id): refused, nothing written.
    const relabeled = { ...label(file, () => true), sample: 'another-id' };
    const third = await planRecord(db, relabeled, OPTS);
    expect(third[0]!.refused).toBe('this sample was recorded with other labels');
    expect(await applyRecord(db, third)).toEqual({ checks: 0, excluded: 0, marked: 0 });
    expect((await checksOf(g.id)).map((c) => c.outcome)).toEqual(['not_judged', 'passed']);
    expect((await obs(g.id)).filter((r) => r.excluded)).toHaveLength(2);
  });

  it('a pass after a failure under the same rules does not confirm; the dry run says so', async () => {
    const { g, file } = await salesFile(30);
    expect(
      await applyRecord(
        db,
        await planRecord(
          db,
          label(file, (_e, i) => i >= 4),
          OPTS,
        ),
      ),
    ).toMatchObject({
      checks: 1,
      excluded: 4,
    });
    expect((await checksOf(g.id))[0]!.outcome).toBe('failed');
    // Sampled again with the wrong ones excluded: all the item, a pass that does not confirm.
    const again = await buildSample(
      db,
      'sales',
      [{ id: g.id, name: 'Hero Quest' }],
      opts(new Date()),
    );
    const plans = await planRecord(
      db,
      label(again, () => true),
      OPTS,
    );
    expect(plans[0]!.blocks[0]).toMatchObject({ outcome: 'passed', failureStands: true });
    expect(describePlan(plans).join('\n')).toContain(
      'a failed check stands for these rules: only an admin can confirm',
    );
    await applyRecord(db, plans);
    expect((await checksOf(g.id)).map((c) => c.outcome)).toEqual(['failed', 'passed']);
    expect((await confirmations(db, g.id))!.isConfirmed('sales', '')).toBe(false);
  });

  it('excludes the sales of several items in one batched run', async () => {
    const a = await salesFile();
    const b = await game('Moon Gate');
    await sold(
      b.id,
      Array.from({ length: 20 }, (_, i) => 2000 + i * 10),
    );
    const fileB = await buildSample(db, 'sales', [{ id: b.id, name: 'Moon Gate' }], opts(NOW));
    const both = { ...a.file, items: [...a.file.items, ...fileB.items] };
    const plans = await planRecord(
      db,
      label(both, (_e, i) => i >= 2),
      OPTS,
    );
    expect(planSources(plans)).toEqual(['flea']);
    // `record --apply` takes these locks first: one it cannot take stops it, nothing written.
    const state = dirs[0]!;
    expect(await holdRecheckLocks(db, planSources(plans), { state, locks: state })).toEqual({
      refused: 'The state folder holds no collect.log: it is not the one collects use.',
    });
    expect(await applyRecord(db, plans)).toEqual({ checks: 2, excluded: 4, marked: 0 });
    for (const id of [a.g.id, b.id])
      expect((await obs(id)).filter((r) => r.excluded).map((r) => r.excludedReason)).toEqual([
        'manual',
        'manual',
      ]);
  });

  describe('sales wait for the game rules to be applied', () => {
    it('switch off, held, or the hash not applied at a judged source: not sampled, refused', async () => {
      const { g, file } = await salesFile();
      const labeled = label(file, () => true);
      const judged = new Set(['flea']);
      const rules = (await currentRules(db, g.id))!.rules;
      const state = (appliedHash: string | null, held: Record<string, unknown> | null = null) =>
        db
          .insert(schema.itemRuleState)
          .values({ productId: g.id, appliedHash, held })
          .onConflictDoUpdate({
            target: schema.itemRuleState.productId,
            set: { appliedHash, held },
          });
      const skipped = async (j: ReadonlySet<string> = OPTS.judged) => {
        const f = await buildSample(db, 'sales', [{ id: g.id, name: 'Hero Quest' }], opts(NOW, j));
        return [f.items.length, f.skipped];
      };
      const refused = async (j: ReadonlySet<string> = OPTS.judged) =>
        (await planRecord(db, labeled, { judged: j }))[0]!.refused;
      const notApplied = [
        0,
        [{ productId: g.id, name: 'Hero Quest', why: 'rules not applied yet' }],
      ];
      // Judged at flea, never applied: waits.
      expect(await skipped(judged)).toEqual(notApplied);
      expect(await refused(judged)).toBe('rules not applied yet');
      // Applied under other rules at flea: waits.
      await state('flea=other');
      expect(await refused(judged)).toBe('rules not applied yet');
      // Applied under today's: sampled and recorded.
      await state(appliedRulesHash(rules, ['flea']));
      expect(await skipped(judged)).toEqual([1, []]);
      expect(await refused(judged)).toBeNull();
      // Held: waits; released: goes on.
      const hold = { would: 12, kept: 20, at: NOW.toISOString(), hash: 'h' };
      await state(appliedRulesHash(rules, ['flea']), hold);
      expect(await skipped(judged)).toEqual(notApplied);
      expect(await refused(judged)).toBe('rules not applied yet');
      await state(appliedRulesHash(rules, ['flea']), { ...hold, releasedAt: NOW.toISOString() });
      expect(await refused(judged)).toBeNull();
      // The switch off: waits, whatever the state.
      await setGameRules(db, false);
      expect(await skipped()).toEqual(notApplied);
      expect(await refused()).toBe('rules not applied yet');
      expect(await checksOf(g.id)).toEqual([]);
    });
  });

  it('a listings hash change at one source: that source only is unconfirmed; an older file refused', async () => {
    const g = await game('Hero Quest');
    const offers = Array.from({ length: 20 }, (_, i) => offer(`L${i + 10}`, 1000 + i));
    for (let d = 1; d <= 7; d++) {
      await night(g.id, `2026-11-0${d}`, offers);
      await night(g.id, `2026-11-0${d}`, offers, 'auction');
    }
    const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    const later = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    expect(
      await applyRecord(
        db,
        await planRecord(
          db,
          label(file, () => true),
          OPTS,
        ),
      ),
    ).toMatchObject({
      checks: 2,
    });
    const confirmed = async () => {
      const c = (await confirmations(db, g.id))!;
      return [c.isConfirmed('listings', 'auction'), c.isConfirmed('listings', 'flea')];
    };
    expect(await confirmed()).toEqual([true, true]);
    await saveConsole(db, {
      key: 'alpha',
      names: { en: 'Alpha' },
      aliases: [],
      categories: { flea: '111', auction: '222' },
      boxedAllowed: false,
    });
    expect(await confirmed()).toEqual([false, true]);
    const plans = await planRecord(
      db,
      label(later, () => true),
      OPTS,
    );
    expect(plans[0]!.refused).toBe('rules changed since the sample: sample again');
  });

  it('refuses cards by name and files of another shape', async () => {
    const c = await card('Blue Dragon');
    const file: CheckFile = {
      kind: 'tora-item-check',
      version: 1,
      check: 'sales',
      sample: 'x',
      sampledAt: NOW.toISOString(),
      items: [{ productId: c.id, name: 'Blue Dragon', checks: [] }],
    };
    expect((await planRecord(db, file, OPTS))[0]!.refused).toBe('not a game: never checked');
    const entry = { source: 'flea', ref: 'r', sets: ['cheap'], item: 'yes' };
    const bad = (entries: unknown[]) =>
      parseCheckFile({
        ...file,
        items: [{ productId: 'p', checks: [{ kind: 'sales', source: '', hash: 'h', entries }] }],
      });
    expect(bad([entry])).toEqual({ invalid: 'items[0].checks[0].entries[0].item' });
    expect(
      bad([
        { ...entry, item: true },
        { ...entry, item: false },
      ]),
    ).toEqual({
      invalid: 'items[0].checks[0].entries[1]: listed twice',
    });
    expect(bad([{ ...entry, item: null, sets: ['other'] }])).toMatchObject({
      invalid: expect.any(String),
    });
    expect('file' in bad([{ ...entry, item: null }])).toBe(true);
    expect(parseCheckFile({ ...file, kind: 'other' })).toMatchObject({
      invalid: expect.any(String),
    });
  });

  it('listings: a pass confirms that source (ask checked), marks the "not the item" ones', async () => {
    const g = await game('Hero Quest');
    const offers = Array.from({ length: 20 }, (_, i) => offer(`L${i + 10}`, 1000 + i));
    for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, offers);
    const today = new Date().toISOString().slice(0, 10);
    const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
    const labeled = label(file, (e) => e.ref !== 'L10' && e.ref !== 'L11');
    const before = await askChecks(db, [g]);
    expect(before.status({ productId: g.id, source: 'flea' })).toBe('unverified');
    const plans = await planRecord(db, labeled, OPTS);
    expect(plans[0]!.blocks[0]).toMatchObject({ outcome: 'passed', mark: ['L10', 'L11'] });
    expect(await applyRecord(db, plans)).toEqual({ checks: 1, excluded: 0, marked: 2 });
    const after = await askChecks(db, [g]);
    expect(after.status({ productId: g.id, source: 'flea' })).toBe('checked');
    const marks = await db.select().from(schema.notItemMarks);
    expect(marks.map((m) => [m.externalRef, m.userId])).toEqual([
      ['L10', null],
      ['L11', null],
    ]);
    expect(await applyRecord(db, await planRecord(db, labeled, OPTS))).toEqual({
      checks: 0,
      excluded: 0,
      marked: 0,
    });
    // What is for sale now leaves them out.
    await night(g.id, today, offers);
    const [row] = (await currentSupply(db, [g.id])).get(g.id)!;
    expect([row!.lowestAskBase, row!.listings, row!.markedOffers?.map((o) => o.ref)]).toEqual([
      1002,
      18,
      ['L10', 'L11'],
    ]);
  });

  describe('fix round 2', () => {
    const fleaOffers = Array.from({ length: 20 }, (_, i) => offer(`L${i + 10}`, 1000 + i));
    const marksOf = async () =>
      (await db.select().from(schema.notItemMarks)).map((m) => m.externalRef).toSorted();

    it('a sample is as of the database newest write: rows written later rebuild the same', async () => {
      const { g, file } = await salesFile();
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      const listings = await buildSample(
        db,
        'listings',
        [{ id: g.id, name: 'Hero Quest' }],
        opts(new Date()),
      );
      // The newest write (the latest sale stored), not the wall clock.
      const newest = new Date(NOW.getTime() - DAY).toISOString();
      expect([file.sampledAt, listings.sampledAt]).toEqual([newest, newest]);
      // Written after: a sale of an earlier day, a cheaper listing on the sample's own day and a read
      // night, a mark.
      const later = new Date(NOW.getTime() - DAY / 2).toISOString();
      await db.insert(schema.priceObservations).values({
        productId: g.id,
        source: 'flea',
        observationType: 'sold',
        bucket: 'used',
        priceBase: 500,
        priceOriginal: 500,
        currency: 'JPY',
        observedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
        fetchedAt: later,
        externalRef: 'late-sale',
        title: 'Hero Quest late',
        createdAt: later,
        updatedAt: later,
      });
      await night(g.id, '2026-11-19', [offer('NEW', 100)], 'flea', '2026-11-19T22:00:00.000+09:00');
      await db.insert(schema.notItemMarks).values({
        productId: g.id,
        source: 'flea',
        externalRef: 'L12',
        userId: member,
        at: later,
      });
      for (const f of [file, listings]) {
        const [plan] = await planRecord(
          db,
          label(f, () => true),
          OPTS,
        );
        expect(plan!.refused).toBeNull();
      }
    });

    it('nights are counted as of the sample: one read after it leaves "too few nights"', async () => {
      const g = await game('Hero Quest');
      for (let d = 2; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      // The newest write: a mark just after midnight, before the 8th's read.
      await db.insert(schema.notItemMarks).values({
        productId: g.id,
        source: 'flea',
        externalRef: 'ZZ',
        userId: null,
        at: '2026-11-08T00:30:00.000+09:00',
      });
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      expect(file.items[0]!.checks[0]).toMatchObject({ nights: 6, tooFewNights: true });
      await night(g.id, '2026-11-08', fleaOffers);
      const [plan] = await planRecord(db, file, OPTS);
      expect(plan!.refused).toBeNull();
      expect(plan!.blocks[0]!.tooFewNights).toBe(6);
      expect(describePlan([plan!]).join('\n')).toContain('too few nights (6), nothing recorded');
    });

    it('a recorded block is not marked again: a mark an admin took back stays back', async () => {
      const g = await game('Hero Quest');
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      const labeled = label(file, (e) => e.ref !== 'L10' && e.ref !== 'L11');
      await applyRecord(db, await planRecord(db, labeled, OPTS));
      expect(await marksOf()).toEqual(['L10', 'L11']);
      expect(
        await unmarkNotItem(
          db,
          { id: admin, role: 'admin' },
          { productId: g.id, source: 'flea', ref: 'L10' },
        ),
      ).toBe(true);
      const again = await planRecord(db, labeled, OPTS);
      expect(again[0]!.blocks[0]).toMatchObject({ recorded: true, mark: [], marksLeft: true });
      expect(describePlan(again).join('\n')).toContain('recorded already, marks left as they are');
      expect(await applyRecord(db, again)).toEqual({
        checks: 0,
        excluded: 0,
        marked: 0,
      });
      expect(await marksOf()).toEqual(['L11']);
    });

    it('listings: not judged marks nothing; completed, it marks; a relabel refused', async () => {
      const g = await game('Hero Quest');
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      const first = await planRecord(
        db,
        label(file, (e) => (e.ref === 'L10' ? false : e.ref === 'L11' ? null : true)),
        OPTS,
      );
      expect(first[0]!.blocks[0]).toMatchObject({ outcome: 'not_judged', mark: [] });
      expect(await applyRecord(db, first)).toEqual({ checks: 1, excluded: 0, marked: 0 });
      expect(await marksOf()).toEqual([]);
      const done = label(file, (e) => e.ref !== 'L10');
      const second = await planRecord(db, done, OPTS);
      expect(second[0]!.blocks[0]).toMatchObject({ outcome: 'passed', mark: ['L10'] });
      expect(await applyRecord(db, second)).toEqual({ checks: 1, excluded: 0, marked: 1 });
      expect(await marksOf()).toEqual(['L10']);
      const third = await planRecord(
        db,
        label(file, () => true),
        OPTS,
      );
      expect(third[0]!.refused).toBe('this sample was recorded with other labels');
      expect(await marksOf()).toEqual(['L10']);
    });

    it('a run stopped at the check row leaves none of the block: no mark without its row', async () => {
      const g = await game('Hero Quest');
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      const labeled = label(file, (e) => e.ref !== 'L10' && e.ref !== 'L11');
      const bound = <T extends object>(t: T, k: string | symbol) => {
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      };
      // The block's writes are one transaction: the row's insert fails inside it.
      const stops = new Proxy(db, {
        get: (t, k) =>
          k === 'transaction'
            ? (fn: (tx: unknown) => Promise<unknown>) =>
                t.transaction((tx) =>
                  fn(
                    new Proxy(tx, {
                      get: (tt, kk) =>
                        kk === 'insert'
                          ? (table: unknown) => {
                              if (table === schema.itemChecks) throw new Error('stopped');
                              return tt.insert(table as typeof schema.notItemMarks);
                            }
                          : bound(tt, kk),
                    }),
                  ),
                )
            : bound(t, k),
      });
      await expect(applyRecord(stops, await planRecord(db, labeled, OPTS))).rejects.toThrow(
        'stopped',
      );
      expect(await marksOf()).toEqual([]);
      expect(await checksOf(g.id)).toEqual([]);
      // A rerun with other labels meets nothing of the stopped run.
      const other = await planRecord(
        db,
        label(file, () => true),
        OPTS,
      );
      expect(other[0]!.blocks[0]).toMatchObject({ outcome: 'passed', recorded: false, mark: [] });
      expect(other[0]!.blocks[0]!.already).toEqual([]);
      expect(await applyRecord(db, other)).toEqual({ checks: 1, excluded: 0, marked: 0 });
      expect(await marksOf()).toEqual([]);
      expect((await checksOf(g.id)).map((c) => c.outcome)).toEqual(['passed']);
    });

    it('listings are as of their write time: rows written later with an earlier fetch are left out', async () => {
      const g = await game('Hero Quest');
      const h = await game('Moon Gate');
      for (let d = 1; d <= 7; d++) await night(g.id, `2026-11-0${d}`, fleaOffers);
      // A collect started at 03:00 on the 8th writes Moon Gate at 03:05; the sample is taken then.
      const start = '2026-11-08T03:00:00.000+09:00';
      await night(h.id, '2026-11-08', fleaOffers, 'flea', start, '2026-11-08T03:05:00.000+09:00');
      const file = await buildSample(db, 'listings', [{ id: g.id, name: 'Hero Quest' }], opts(NOW));
      expect(file.sampledAt).toBe(new Date('2026-11-08T03:05:00.000+09:00').toISOString());
      expect(file.items[0]!.checks[0]).toMatchObject({ nights: 7 });
      // The same run writes Hero Quest at 03:10, with a cheaper listing, its fetch time 03:00.
      await night(
        g.id,
        '2026-11-08',
        [offer('LATE', 100), ...fleaOffers],
        'flea',
        start,
        '2026-11-08T03:10:00.000+09:00',
      );
      const [plan] = await planRecord(
        db,
        label(file, () => true),
        OPTS,
      );
      expect(plan!.refused).toBeNull();
      expect(plan!.blocks[0]!.outcome).toBe('passed');
    });

    it('a run stopped after its exclusions: the rerun clears and refreshes the item', async () => {
      const { g, file } = await salesFile();
      const at = NOW.toISOString();
      await db
        .insert(schema.bucketValues)
        .values({ productId: g.id, bucket: 'used', computedAt: at, value: { mid: 1 } });
      const labeled = label(file, (_e, i) => i >= 2);
      // Stopped at the clear of values (after the check row and the exclusions).
      const stops = new Proxy(db, {
        get: (t, k) => {
          if (k === 'delete')
            return () => {
              throw new Error('stopped');
            };
          const v = Reflect.get(t, k);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      await expect(applyRecord(stops, await planRecord(db, labeled, OPTS))).rejects.toThrow(
        'stopped',
      );
      expect((await obs(g.id)).filter((r) => r.excluded)).toHaveLength(2);
      expect(await db.select().from(schema.bucketValues)).toHaveLength(1);
      const rerun = await planRecord(db, labeled, OPTS);
      expect(rerun[0]!.blocks[0]).toMatchObject({ recorded: true, excludedBefore: 2 });
      expect(await applyRecord(db, rerun)).toEqual({
        checks: 0,
        excluded: 0,
        marked: 0,
      });
      expect(await db.select().from(schema.bucketValues)).toEqual([]);
      expect(await checksOf(g.id)).toHaveLength(1);
    });
  });
});

describe('"not the item" marks by a person', () => {
  async function shown() {
    const g = await game('Hero Quest');
    const h = await game('Moon Gate');
    const today = new Date().toISOString().slice(0, 10);
    await night(g.id, today, [offer('X1', 1000), offer('X2', 1100)]);
    await night(g.id, today, [offer('X1', 900)], 'auction');
    await night(h.id, today, [offer('X1', 1200)]);
    return { g, h };
  }
  const who = (id: string, role: 'admin' | 'member' = 'member') => ({ id, role });

  it('a wisher or an admin may mark; anyone else is refused; cards never', async () => {
    const { g } = await shown();
    await addWatch(db, member, { productId: g.id }, {});
    await expect(
      markNotItem(db, who(other), { productId: g.id, source: 'flea', ref: 'X1' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await markNotItem(db, who(member), { productId: g.id, source: 'flea', ref: 'X1' })).toBe(
      true,
    );
    expect(
      await markNotItem(db, who(admin, 'admin'), { productId: g.id, source: 'flea', ref: 'X2' }),
    ).toBe(true);
    // A ref never shown is not marked.
    await expect(
      markNotItem(db, who(member), { productId: g.id, source: 'flea', ref: 'X9' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const c = await card('Blue Dragon');
    await expect(assertMayMarkNotItem(db, who(admin, 'admin'), c.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const marks = await db.select().from(schema.notItemMarks);
    expect(marks.map((m) => [m.externalRef, m.userId])).toEqual([
      ['X1', member],
      ['X2', admin],
    ]);
  });

  it("refuses a mark on the identity shop's entries (S36 A6); the row's ask stays", async () => {
    const g = await game('Hero Quest');
    const today = new Date().toISOString().slice(0, 10);
    await night(
      g.id,
      today,
      [
        offer('S|outside|used', 700, { own: 'outside', count: 3, condition: 'used' }),
        offer('S|own|used', 800, { own: 'own', stock: null }),
      ],
      'auction',
    );
    for (const ref of ['S|outside|used', 'S|own|used'])
      await expect(
        markNotItem(db, who(admin, 'admin'), { productId: g.id, source: 'auction', ref }),
      ).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.select().from(schema.notItemMarks)).toEqual([]);
    const [row] = (await currentSupply(db, [g.id])).get(g.id)!;
    expect([row!.lowestAskBase, row!.listings, row!.markedOffers]).toEqual([700, 2, undefined]);
  });

  it('a mark is scoped to (item, source, ref), and only its maker or an admin undoes it', async () => {
    const { g, h } = await shown();
    await addWatch(db, member, { productId: g.id }, {});
    await addWatch(db, other, { productId: g.id }, {});
    await markNotItem(db, who(member), { productId: g.id, source: 'flea', ref: 'X1' });
    const now = await currentSupply(db, [g.id, h.id]);
    const flea = now.get(g.id)!.find((r) => r.source === 'flea')!;
    const auction = now.get(g.id)!.find((r) => r.source === 'auction')!;
    expect([flea.lowestAskBase, flea.url]).toEqual([1100, 'https://flea.example/X2']);
    expect([auction.lowestAskBase, auction.markedOffers]).toEqual([900, undefined]);
    expect(now.get(h.id)![0]!.lowestAskBase).toBe(1200);
    const target = { productId: g.id, source: 'flea', ref: 'X1' };
    expect(await unmarkNotItem(db, who(other), target)).toBe(false);
    expect(await unmarkNotItem(db, who(member), target)).toBe(true);
    await markNotItem(db, who(member), target);
    expect(await unmarkNotItem(db, who(admin, 'admin'), target)).toBe(true);
  });

  it('the maker undoes their mark after removing their wish; a check mark only an admin', async () => {
    const { g } = await shown();
    await addWatch(db, member, { productId: g.id }, {});
    const target = { productId: g.id, source: 'flea', ref: 'X1' };
    await markNotItem(db, who(member), target);
    await db.delete(schema.watches).where(eq(schema.watches.userId, member));
    // Without the wish they may no longer mark, but may take their own mark back.
    await expect(markNotItem(db, who(member), { ...target, ref: 'X2' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await unmarkNotItem(db, who(member), target)).toBe(true);
    // The labeled check's mark (no user): a wisher cannot take it back, an admin can.
    await db.insert(schema.notItemMarks).values({
      productId: g.id,
      source: 'flea',
      externalRef: 'X2',
      userId: null,
      at: '2026-11-08T00:00:00.000+09:00',
    });
    await addWatch(db, other, { productId: g.id }, {});
    const check = { ...target, ref: 'X2' };
    expect(await unmarkNotItem(db, who(other), check)).toBe(false);
    expect(await unmarkNotItem(db, who(member), check)).toBe(false);
    expect(await unmarkNotItem(db, who(admin, 'admin'), check)).toBe(true);
    // Not a game: refused even for the maker.
    const c = await card('Blue Dragon');
    await expect(
      unmarkNotItem(db, who(member), { productId: c.id, source: 'flea', ref: 'X1' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a target that is not three strings as invalid input', async () => {
    const { g } = await shown();
    for (const bad of [
      { productId: g.id, source: 7, ref: 'X1' },
      { productId: g.id, source: 'flea', ref: ['X1'] },
      { productId: null, source: 'flea', ref: 'X1' },
      { productId: g.id, source: 'flea', ref: '  ' },
      { productId: g.id, source: 'flea', ref: 'x'.repeat(201) },
    ]) {
      const t = bad as unknown as Parameters<typeof markNotItem>[2];
      await expect(markNotItem(db, who(admin, 'admin'), t)).rejects.toMatchObject({
        code: 'invalid_input',
      });
      await expect(unmarkNotItem(db, who(admin, 'admin'), t)).rejects.toMatchObject({
        code: 'invalid_input',
      });
    }
  });
});
