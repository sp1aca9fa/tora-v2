// Tracked games (S36 step D; spec wishlist-tracked W17) on throwaway databases. Made-up
// marketplaces (marketa, marketb), shop (shopa), consoles and titles only.
import { MARKET_JOB_KINDS, TRACKED_SLOTS, compareJobs, setAppTimeZone } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { saveConsole } from './consoles';
import { queueWeeklyReads, saveJobKinds } from './deep-reads';
import { migrateDb } from './migrate';
import { createHolding, createProduct, deleteUnusedProduct, mergeProducts } from './mutations';
import { saveSourceInfos } from './registry';
import {
  itemRules,
  marketJobs,
  productSources,
  sourceCandidates,
  trackedGames,
  wishLevels,
} from './schema';
import {
  createQuerySource,
  gameShopPage,
  productsToMatch,
  productsWithoutSource,
  trackedSkips,
  userWatchesProduct,
} from './sources';
import {
  addTrackedGames,
  adminManagesTracked,
  kindCases,
  linkPageAs,
  managesLinkAt,
  managesLinks,
  listTrackedGames,
  markTrackedOnPc,
  previewTrackedGames,
  queueTrackedReads,
  setTrackedRestOn,
  trackGame,
  trackedRestOn,
  trackedTotals,
  untrackGame,
} from './tracked-games';
import { createUser } from './users';
import { addWatch } from './watches';

let db: Db;
let admin: string;
let ann: string;
const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
// 2026-11-24 is slot 5 (days since the epoch, mod 7); the 25th slot 6.
const NOW = new Date('2026-11-24T21:00:00+09:00');
const SLOT_TONIGHT = 5;

beforeEach(async () => {
  setAppTimeZone('Asia/Tokyo');
  const dir = await mkdtemp(join(tmpdir(), 'tora-tracked-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, [
    {
      key: 'shopa',
      market: 'jp',
      label: 'Shop A',
      priority: 10,
      roles: { game: 'reference' },
      identity: ['game'],
      links: [{ pattern: 'shopa\\.test/(\\d+)', url: 'https://shopa.test/{id}' }],
    },
    {
      key: 'marketa',
      market: 'jp',
      label: 'Market A',
      priority: 20,
      roles: { game: 'supporting' },
    },
    {
      key: 'marketb',
      market: 'jp',
      label: 'Market B',
      priority: 30,
      roles: { game: 'supporting' },
    },
  ]);
  admin = (await createUser(db, 'admin', creds, 'admin')).user.id;
  ann = (await createUser(db, 'ann', creds, 'member')).user.id;
  for (const [key, name] of [
    ['alpha', 'Alpha Station'],
    ['beta', 'Beta Box'],
  ] as const)
    await saveConsole(db, {
      key,
      names: { en: name },
      aliases: [],
      categories: {},
      boxedAllowed: true,
    });
  await saveJobKinds(db, {
    marketa: ['deep', 'readback', 'tracked_weekly', 'monthly'],
    marketb: ['monthly'],
  });
  return () => rm(dir, { recursive: true, force: true });
});

const game = (name: string, platform = 'Alpha Station', franchise?: string) =>
  createProduct(db, admin, { category: 'game', kind: 'software', name, platform, franchise });
const setSlot = (id: string, shopSlot: number) =>
  db.update(trackedGames).set({ shopSlot }).where(eq(trackedGames.productId, id));
const jobsOf = (productId: string) =>
  db.select().from(marketJobs).where(eq(marketJobs.productId, productId));
const searchAt = (id: string, source: string) =>
  createQuerySource(db, id, source, { keywords: ['x'] });
const tracked = async (name: string, tier: 'chosen' | 'rest' = 'chosen') => {
  const p = await game(name);
  await trackGame(db, admin, p.id, tier);
  return p;
};

describe('the admin guard', () => {
  it('refuses a member every read and write, and a disabled admin', async () => {
    const p = await game('Guarded');
    for (const call of [
      () => listTrackedGames(db, ann),
      () => previewTrackedGames(db, ann, 'A | alpha'),
      () => addTrackedGames(db, ann, 'A | alpha', { 1: 'new' }),
      () => trackGame(db, ann, p.id),
      () => untrackGame(db, ann, p.id),
      () => markTrackedOnPc(db, ann, p.id, '2026-11-01', NOW),
      () => trackedTotals(db, ann, NOW),
      () => setTrackedRestOn(db, ann, true),
      () => listTrackedGames(db, 'nobody'),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'forbidden' });
    expect(await db.select().from(trackedGames)).toEqual([]);
  });
});

describe('adding from pasted lines', () => {
  it('previews without writing, then adds new and reused items; errors and bad choices are reported', async () => {
    const old = await game('Old Quest');
    const text = 'New Quest | alpha\nOld Quest | Alpha Station\nLost | gamma\nOther | beta';
    const preview = await previewTrackedGames(db, admin, text);
    expect(preview.tooMany).toBe(false);
    expect(preview.lines.map((l) => [l.name, l.error])).toEqual([
      ['New Quest', null],
      ['Old Quest', null],
      ['Lost', 'console'],
      ['Other', null],
    ]);
    expect(preview.lines[1]!.lookAlikes).toEqual([
      expect.objectContaining({ id: old.id, tracked: false }),
    ]);
    expect(await db.select().from(trackedGames)).toEqual([]);

    const out = await addTrackedGames(db, admin, text, { 1: 'new', 2: old.id, 3: 'new' });
    expect(out.map((o) => (o.ok ? [o.line, o.reused, o.already] : [o.line, o.error]))).toEqual([
      [1, false, false],
      [2, true, false],
      [3, 'console'],
      [4, 'choice'],
    ]);
    const list = await listTrackedGames(db, admin);
    expect(list.map((g) => [g.name, g.console, g.tier, g.wished, g.lastWeeklyRead])).toEqual([
      ['New Quest', 'alpha', 'chosen', false, null],
      ['Old Quest', 'alpha', 'chosen', false, null],
    ]);
    // A wish's item stays unwatched and unheld; a second add says it was tracked already.
    const again = await addTrackedGames(db, admin, 'Old Quest | alpha', { 1: old.id }, 'rest');
    expect(again[0]).toMatchObject({ ok: true, already: true });
    expect(
      (await previewTrackedGames(db, admin, 'Old Quest | alpha')).lines[0]!.lookAlikes,
    ).toEqual([expect.objectContaining({ tracked: true })]);
  });

  it('takes at most 100 lines a paste, writing nothing past it', async () => {
    const text = (n: number) => Array.from({ length: n }, (_, i) => `Game ${i} | alpha`).join('\n');
    expect((await previewTrackedGames(db, admin, text(100))).tooMany).toBe(false);
    expect((await previewTrackedGames(db, admin, text(101))).tooMany).toBe(true);
    await expect(addTrackedGames(db, admin, text(101), { 1: 'new' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(await db.select().from(trackedGames)).toEqual([]);
  });

  it('refuses cards, sealed items and a boxed item; a game the rules turn off too', async () => {
    const card = await createProduct(db, admin, { category: 'tcg', kind: 'single', name: 'Card' });
    const box = await createProduct(db, admin, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box',
    });
    const console_ = await createProduct(db, admin, {
      category: 'game',
      kind: 'console',
      name: 'Console',
    });
    for (const p of [card, box, console_])
      await expect(trackGame(db, admin, p.id)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(trackGame(db, admin, 'missing')).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.select().from(trackedGames)).toEqual([]);
  });

  it('spreads chosen games evenly over the 7 slots; the rest takes no slot of its own', async () => {
    for (let i = 0; i < 17; i++) await tracked(`Game ${i}`);
    await tracked('Rest game', 'rest');
    const rows = await db.select().from(trackedGames).where(eq(trackedGames.tier, 'chosen'));
    const counts = Array<number>(TRACKED_SLOTS).fill(0);
    for (const r of rows) counts[r.shopSlot]!++;
    expect(counts).toEqual([3, 3, 3, 2, 2, 2, 2]);
  });
});

describe('remove, on PC, merge and delete', () => {
  it('untracking keeps the row as a removed mark: tracked nowhere, still left out of the nightly collect (F1)', async () => {
    const p = await tracked('Gone');
    await searchAt(p.id, 'marketa');
    await setSlot(p.id, SLOT_TONIGHT);
    expect((await queueTrackedReads(db, NOW)).queued).toBe(1);
    expect(await untrackGame(db, admin, p.id)).toBe(true);
    expect(await untrackGame(db, admin, p.id)).toBe(false);
    expect((await jobsOf(p.id)).map((j) => [j.status, j.error])).toEqual([
      ['stopped', 'untracked'],
    ]);
    expect(
      await db.select().from(productSources).where(eq(productSources.productId, p.id)),
    ).toHaveLength(1);
    expect((await db.select().from(trackedGames)).map((r) => r.tier)).toEqual(['removed']);
    // Counted nowhere as tracked.
    expect(await listTrackedGames(db, admin)).toEqual([]);
    expect((await trackedTotals(db, admin, NOW)).weekly[0]!.games).toBe(0);
    expect(await markTrackedOnPc(db, admin, p.id, '2026-11-01', NOW)).toBe(false);
    expect(await adminManagesTracked(db, admin, p.id)).toBe(false);
    expect((await previewTrackedGames(db, admin, 'Gone | alpha')).lines[0]!.lookAlikes).toEqual([
      expect.objectContaining({ tracked: false }),
    ]);
    expect((await kindCases(db, (await game('Kin')).id)).cases).toEqual([]);
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    const searchless = await tracked('Searchless');
    await untrackGame(db, admin, searchless.id);
    const toSearch = await productsWithoutSource(db, 'marketa', { trackedGames: true });
    expect(toSearch.map((x) => x.id)).not.toContain(searchless.id);
    expect((await productsToMatch(db, 'shopa', { now: NOW })).map((x) => x.id)).toEqual([]);
    // Still left out of the nightly collect everywhere, even on its old slot night at the shop.
    expect(await trackedSkips(db, 'shopa', NOW)).toContain(p.id);
    expect(await trackedSkips(db, 'marketa', NOW)).toContain(p.id);
    // Tracked again: its tier back and a slot as for a new game; its first day stays.
    const before = (
      await db.select().from(trackedGames).where(eq(trackedGames.productId, p.id))
    )[0]!;
    expect(await trackGame(db, admin, p.id, 'chosen')).toBe(true);
    expect(await trackGame(db, admin, p.id, 'chosen')).toBe(false);
    const [again] = await listTrackedGames(db, admin);
    expect(again).toMatchObject({ productId: p.id, tier: 'chosen', addedAt: before.addedAt });
    const out = await addTrackedGames(
      db,
      admin,
      'Searchless | alpha',
      { 1: searchless.id },
      'rest',
    );
    expect(out[0]).toMatchObject({ ok: true, already: false });
    expect((await listTrackedGames(db, admin)).map((g) => [g.name, g.tier])).toEqual([
      ['Gone', 'chosen'],
      ['Searchless', 'rest'],
    ]);
  });

  it('marks a game on PC from a real day not after today, or clears it', async () => {
    const p = await tracked('Ported');
    for (const bad of ['2026-02-30', '2026-11-25', '24/11/2026', ''])
      await expect(markTrackedOnPc(db, admin, p.id, bad, NOW)).rejects.toMatchObject({
        code: 'invalid_input',
      });
    expect(await markTrackedOnPc(db, admin, p.id, '2026-11-24', NOW)).toBe(true);
    expect((await listTrackedGames(db, admin))[0]).toMatchObject({
      onPc: true,
      onPcAt: '2026-11-24',
    });
    expect(await markTrackedOnPc(db, admin, p.id, null, NOW)).toBe(true);
    expect((await listTrackedGames(db, admin))[0]).toMatchObject({ onPc: false, onPcAt: null });
    expect(await markTrackedOnPc(db, admin, (await game('Untracked')).id, null, NOW)).toBe(false);
  });

  it('a merge moves the row to the target (or the target keeps its own); a delete drops it', async () => {
    const dup = await tracked('Dup');
    const into = await game('Into');
    await mergeProducts(db, { id: admin, role: 'admin' }, dup.id, into.id);
    expect((await db.select().from(trackedGames)).map((r) => r.productId)).toEqual([into.id]);
    const dup2 = await tracked('Dup 2', 'rest');
    await mergeProducts(db, { id: admin, role: 'admin' }, dup2.id, into.id);
    expect((await db.select().from(trackedGames)).map((r) => [r.productId, r.tier])).toEqual([
      [into.id, 'chosen'],
    ]);
    expect(await deleteUnusedProduct(db, into.id)).toBe(true);
    expect(await db.select().from(trackedGames)).toEqual([]);
  });

  it('a merge: a removed row never overwrites a live one; a live one replaces a removed target row (F1)', async () => {
    const actor = { id: admin, role: 'admin' as const };
    const rows = async () =>
      (await db.select().from(trackedGames)).map((r) => [r.productId, r.tier]).sort();
    const removed = await tracked('Removed dup');
    await untrackGame(db, admin, removed.id);
    const live = await tracked('Live into', 'rest');
    await mergeProducts(db, actor, removed.id, live.id);
    expect(await rows()).toEqual([[live.id, 'rest']]);
    const liveDup = await tracked('Live dup');
    await untrackGame(db, admin, live.id);
    await mergeProducts(db, actor, liveDup.id, live.id);
    expect(await rows()).toEqual([[live.id, 'chosen']]);
    // A removed mark never moves onto an item with no row: that item is read as it was.
    const gone = await tracked('Removed dup 2');
    await untrackGame(db, admin, gone.id);
    const plain = await game('Never tracked');
    await mergeProducts(db, actor, gone.id, plain.id);
    expect(await rows()).toEqual([[live.id, 'chosen']]);
  });

  it('a one-item match ("collect now") asks the shop for a chosen game off its slot night', async () => {
    const p = await tracked('Off slot now');
    await setSlot(p.id, SLOT_TONIGHT + 1);
    const ids = async (productId?: string) =>
      (await productsToMatch(db, 'shopa', { now: NOW, productId })).map((x) => x.id);
    expect(await ids()).not.toContain(p.id);
    expect(await ids(p.id)).toEqual([p.id]);
  });

  it('a rest game is never looked for at the shop: the list says so', async () => {
    const rest = await tracked('Rest unlinked', 'rest');
    const chosen = await tracked('Chosen unlinked');
    const shops = async () =>
      (await listTrackedGames(db, admin)).map((g) => [g.productId, g.shop]).sort();
    expect(await shops()).toEqual(
      [
        [rest.id, 'rest'],
        [chosen.id, 'none'],
      ].sort(),
    );
  });
});

describe('the identity shop page of a tracked game (F2)', () => {
  it('an admin manages the links of a live tracked game; a member or an untracked item: no', async () => {
    const p = await tracked('Managed');
    const plain = await game('Not tracked');
    expect(await adminManagesTracked(db, admin, p.id)).toBe(true);
    expect(await adminManagesTracked(db, ann, p.id)).toBe(false);
    expect(await adminManagesTracked(db, admin, plain.id)).toBe(false);
    expect(await adminManagesTracked(db, 'nobody', p.id)).toBe(false);
  });

  it('lists the shop page as linked, to check (with the count) or not found; the nightly counts only linked games', async () => {
    const linked = await tracked('Linked');
    const pending = await tracked('Pending');
    await tracked('None');
    const rest = await tracked('Rest linked', 'rest');
    for (const p of [linked, rest])
      await db
        .insert(productSources)
        .values({ productId: p.id, source: 'shopa', externalId: `s-${p.id}` });
    for (const x of ['1', '2'])
      await db.insert(sourceCandidates).values({
        productId: pending.id,
        source: 'shopa',
        externalId: `c-${x}`,
        title: `Pending ${x}`,
      });
    expect((await listTrackedGames(db, admin)).map((g) => [g.name, g.shop, g.toCheck])).toEqual([
      ['Linked', 'linked', 0],
      ['None', 'none', 0],
      ['Pending', 'pending', 2],
      ['Rest linked', 'linked', 0],
    ]);
    expect((await trackedTotals(db, admin, NOW)).nightly).toEqual({
      source: 'shopa',
      games: 1,
      toConfirm: 1,
      minutes: null,
    });
  });
});

describe('the shop page of a wished game', () => {
  it('a person who watches an item, or a boxed item of it, manages its links; others do not', async () => {
    const p = await game('Wished only');
    const other = await game('Someone else');
    await addWatch(db, ann, { productId: p.id }, {});
    expect(await userWatchesProduct(db, ann, p.id)).toBe(true);
    expect(await userWatchesProduct(db, admin, p.id)).toBe(false);
    expect(await userWatchesProduct(db, ann, other.id)).toBe(false);
    // A boxed wish reads its plain item's searches: its person manages the plain item's links too.
    const boxed = await game('Someone else (boxed)');
    await db
      .insert(itemRules)
      .values({ productId: boxed.id, required: [], excluded: [], boxed: true, boxedOf: other.id });
    await addWatch(db, ann, { productId: boxed.id }, {});
    expect(await userWatchesProduct(db, ann, other.id)).toBe(true);
    expect(await userWatchesProduct(db, admin, other.id)).toBe(false);
  });

  it('link management: a holder any link; a watcher or the admin of a tracked game only the page at the identity shop, never a search', async () => {
    const p = await game('Shared game');
    await createHolding(
      db,
      ann,
      { productId: p.id },
      { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-11-01' },
    );
    const bob = (await createUser(db, 'bob', creds, 'member')).user.id;
    const cat = (await createUser(db, 'cat', creds, 'member')).user.id;
    await addWatch(db, bob, { productId: p.id }, {});
    const page = { source: 'shopa', externalId: '123', query: null };
    const search = { source: 'shopa', externalId: 'search', query: null };
    const asked = { source: 'shopa', externalId: '9', query: { keywords: ['x'] } };
    const market = { source: 'marketa', externalId: 'x123', query: null };
    for (const link of [page, search, asked, market])
      expect(await managesLinks(db, ann, p.id, link)).toBe(true);
    expect(await managesLinks(db, bob, p.id, page)).toBe(true);
    for (const link of [search, asked, market])
      expect(await managesLinks(db, bob, p.id, link)).toBe(false);
    expect(await managesLinks(db, cat, p.id, page)).toBe(false);
    // An admin: a live tracked game only, and only its page at the shop.
    expect(await managesLinks(db, admin, p.id, page)).toBe(false);
    await trackGame(db, admin, p.id);
    expect(await managesLinks(db, admin, p.id, page)).toBe(true);
    for (const link of [search, market])
      expect(await managesLinks(db, admin, p.id, link)).toBe(false);
    await untrackGame(db, admin, p.id);
    expect(await managesLinks(db, admin, p.id, page)).toBe(false);
  });

  it('linking an address: the guard and the write together', async () => {
    const p = await game('Linked by address');
    await createHolding(
      db,
      ann,
      { productId: p.id },
      { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-11-01' },
    );
    const bob = (await createUser(db, 'bob', creds, 'member')).user.id;
    await addWatch(db, bob, { productId: p.id }, {});
    const links = async () =>
      (await db.select().from(productSources).where(eq(productSources.productId, p.id)))
        .map((l) => `${l.source}|${l.externalId}|${l.active}`)
        .sort();
    // A watcher: no page at a marketplace (any link there is read as a search), no search's id.
    expect(await linkPageAs(db, bob, p.id, { source: 'marketa', externalId: 'x123' })).toBe(false);
    expect(await linkPageAs(db, bob, p.id, { source: 'shopa', externalId: 'search' })).toBe(false);
    expect(await links()).toEqual([]);
    // The holder's search, turned off: a watcher's address never turns it on again; no one's does.
    await searchAt(p.id, 'marketa');
    await db
      .update(productSources)
      .set({ active: false })
      .where(eq(productSources.productId, p.id));
    expect(await linkPageAs(db, bob, p.id, { source: 'marketa', externalId: 'search' })).toBe(
      false,
    );
    expect(await linkPageAs(db, ann, p.id, { source: 'marketa', externalId: 'search' })).toBe(
      false,
    );
    expect(await links()).toEqual(['marketa|search|false']);
    // A page the collect wrote a query onto is a search: the holders' only.
    await db
      .insert(productSources)
      .values({ productId: p.id, source: 'shopa', externalId: '77', query: { keywords: ['x'] } });
    await db
      .update(productSources)
      .set({ active: false })
      .where(eq(productSources.externalId, '77'));
    expect(await linkPageAs(db, bob, p.id, { source: 'shopa', externalId: '77' })).toBe(false);
    expect(await managesLinkAt(db, bob, p.id, { source: 'shopa', externalId: '77' })).toBe(false);
    // The shop's page: the watcher links it; the holder any page.
    expect(await linkPageAs(db, bob, p.id, { source: 'shopa', externalId: '123' })).toBe(true);
    expect(await linkPageAs(db, ann, p.id, { source: 'marketa', externalId: 'x123' })).toBe(true);
    expect(await links()).toEqual([
      'marketa|search|false',
      'marketa|x123|true',
      'shopa|123|true',
      'shopa|77|false',
    ]);
  });

  it('says linked, how many candidates wait, or none; candidates at another source do not count', async () => {
    const p = await game('Shop page');
    expect(await gameShopPage(db, p.id)).toEqual({ state: 'none', pending: 0 });
    await db
      .insert(sourceCandidates)
      .values({ productId: p.id, source: 'marketa', externalId: 'm-1', title: 'Elsewhere' });
    expect(await gameShopPage(db, p.id)).toEqual({ state: 'none', pending: 0 });
    for (const x of ['1', '2'])
      await db
        .insert(sourceCandidates)
        .values({ productId: p.id, source: 'shopa', externalId: `c-${x}`, title: `Page ${x}` });
    expect(await gameShopPage(db, p.id)).toEqual({ state: 'pending', pending: 2 });
    const [link] = await db
      .insert(productSources)
      .values({ productId: p.id, source: 'shopa', externalId: 'c-1', active: false })
      .returning();
    expect((await gameShopPage(db, p.id)).state).toBe('pending');
    await db.update(productSources).set({ active: true }).where(eq(productSources.id, link!.id));
    expect(await gameShopPage(db, p.id)).toEqual({ state: 'linked', pending: 0 });
  });
});

describe('the nightly scope and the jobs', () => {
  it('reads a tracked-only game at the identity shop on its slot night only; a wished or held one every night', async () => {
    const onSlot = await tracked('On slot');
    const offSlot = await tracked('Off slot');
    const rest = await tracked('Rest', 'rest');
    const wished = await tracked('Wished');
    const held = await tracked('Held');
    await setSlot(onSlot.id, SLOT_TONIGHT);
    for (const p of [offSlot, wished, held]) await setSlot(p.id, SLOT_TONIGHT + 1);
    await addWatch(db, ann, { productId: wished.id }, {});
    await createHolding(
      db,
      ann,
      { productId: held.id },
      { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-11-01' },
    );
    expect([...(await trackedSkips(db, 'shopa', NOW))].sort()).toEqual(
      [offSlot.id, rest.id].sort(),
    );
    expect([...(await trackedSkips(db, 'marketa', NOW))].sort()).toEqual(
      [onSlot.id, offSlot.id, rest.id].sort(),
    );
    // The identity shop matches the slot's chosen games, never the others (no request: a candidate).
    const toMatch = (await productsToMatch(db, 'shopa', { now: NOW })).map((p) => p.id);
    expect(toMatch).toContain(onSlot.id);
    expect(toMatch).not.toContain(offSlot.id);
  });

  it('queues a weekly read on the slot night, reads back 2 weeks, once; none for a wished game', async () => {
    const p = await tracked('Weekly');
    const w = await tracked('Then wished');
    const later = await tracked('Later');
    for (const g of [p, w, later]) await searchAt(g.id, 'marketa');
    await setSlot(p.id, SLOT_TONIGHT);
    await setSlot(w.id, SLOT_TONIGHT);
    await setSlot(later.id, SLOT_TONIGHT + 1);
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 2, stopped: 0 });
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect((await jobsOf(p.id)).map((j) => [j.source, j.kind, j.wantedFrom])).toEqual([
      ['marketa', 'tracked_weekly', '2026-11-10'],
    ]);
    expect(await jobsOf(later.id)).toEqual([]);
    // Wished: its weekly read stops; it gets the wish's deep read instead.
    await addWatch(db, ann, { productId: w.id }, {});
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 1 });
    await queueWeeklyReads(db, NOW);
    const kinds = (await jobsOf(w.id)).map((j) => [j.kind, j.status]);
    expect(kinds).toContainEqual(['deep', 'waiting']);
    expect(kinds).toContainEqual(['tracked_weekly', 'stopped']);
  });

  it('catches up a missed slot night after 2 weeks for a game tracked a week', async () => {
    const p = await tracked('Missed');
    await searchAt(p.id, 'marketa');
    await setSlot(p.id, SLOT_TONIGHT + 1);
    expect((await queueTrackedReads(db, NOW)).queued).toBe(0);
    await db
      .update(trackedGames)
      .set({ addedAt: '2026-11-10T09:00:00+09:00' })
      .where(eq(trackedGames.productId, p.id));
    expect((await queueTrackedReads(db, NOW)).queued).toBe(1);
    const [job] = await jobsOf(p.id);
    await db
      .update(marketJobs)
      .set({ status: 'done', createdAt: '2026-11-15T21:00:00+09:00' })
      .where(eq(marketJobs.id, job!.id));
    expect((await queueTrackedReads(db, NOW)).queued).toBe(0);
  });

  it('the rest is off by default; on, one monthly page a month at the first marketplace with its search', async () => {
    expect(await trackedRestOn(db)).toBe(false);
    const r = await tracked('Rest game', 'rest');
    await searchAt(r.id, 'marketb');
    await setSlot(r.id, SLOT_TONIGHT);
    expect((await queueTrackedReads(db, NOW)).queued).toBe(0);
    await setTrackedRestOn(db, admin, true);
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect((await jobsOf(r.id)).map((j) => [j.source, j.kind, j.wantedFrom])).toEqual([
      ['marketb', 'monthly', null],
    ]);
    await setTrackedRestOn(db, admin, false);
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 1 });
  });

  it('a held tracked game gets no weekly read and its waiting one stops; totals leave it out (F3)', async () => {
    const p = await tracked('Held later');
    const other = await tracked('Still tracked-only');
    for (const g of [p, other]) {
      await searchAt(g.id, 'marketa');
      await setSlot(g.id, SLOT_TONIGHT);
    }
    expect((await queueTrackedReads(db, NOW)).queued).toBe(2);
    await createHolding(
      db,
      ann,
      { productId: p.id },
      { quantity: 1, costTotalBase: 1000, acquiredAt: '2026-11-01' },
    );
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 1 });
    expect((await jobsOf(p.id)).map((j) => [j.status, j.error])).toEqual([['stopped', 'held']]);
    await db.update(marketJobs).set({ createdAt: '2026-10-01T00:00:00+09:00' });
    expect(await queueTrackedReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect((await trackedTotals(db, admin, NOW)).weekly[0]!.games).toBe(1);
  });

  it("the shop's match takes people's items first, as before; slot games only fill what is left (F4)", async () => {
    // Slot games first, so they are the oldest items (the order is oldest first).
    const slotGames = [];
    for (let i = 0; i < 3; i++) slotGames.push(await game(`Slot ${i}`));
    for (let i = 0; i < 51; i++) {
      const p = await game(`Wished ${String(i).padStart(2, '0')}`);
      await addWatch(db, ann, { productId: p.id }, {});
    }
    const sealed = await createProduct(db, admin, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Sealed box',
    });
    await addWatch(db, ann, { productId: sealed.id }, {});
    const before = (await productsToMatch(db, 'shopa', { now: NOW })).map((p) => p.id);
    expect(before).toHaveLength(52);
    expect(before).toContain(sealed.id);
    for (const p of slotGames) {
      await trackGame(db, admin, p.id);
      await setSlot(p.id, SLOT_TONIGHT);
    }
    const after = (await productsToMatch(db, 'shopa', { now: NOW })).map((p) => p.id);
    expect(after.slice(0, 52)).toEqual(before);
    expect(after.slice(52).sort()).toEqual(slotGames.map((p) => p.id).sort());
    expect(await productsToMatch(db, 'shopa', { now: NOW, limit: 52 })).toHaveLength(52);
  });

  it("orders tracked jobs after wishes' jobs", () => {
    const job = (kind: string, createdAt: string) => ({ kind, createdAt, id: kind, failures: 0 });
    const sorted = [
      job('monthly', '2026-11-01T00:00:00Z'),
      job('tracked_weekly', '2026-11-01T00:00:00Z'),
      job('deep', '2026-11-20T00:00:00Z'),
      job('readback', '2026-11-20T00:00:00Z'),
    ].sort(compareJobs);
    expect(sorted.map((j) => j.kind)).toEqual(['readback', 'deep', 'tracked_weekly', 'monthly']);
    expect(MARKET_JOB_KINDS).toContain('tracked_weekly');
  });
});

describe('totals', () => {
  it('counts the weekly requests a day and the nightly minutes; unknown pace stays unknown', async () => {
    for (let i = 0; i < 14; i++) {
      const p = await tracked(`Game ${i}`);
      await db
        .insert(productSources)
        .values({ productId: p.id, source: 'shopa', externalId: `s-${p.id}` });
    }
    const totals = await trackedTotals(db, admin, NOW);
    expect(totals.weekly).toEqual([
      { source: 'marketa', games: 14, perDayNeeded: 2, atLeast: true, perDay: 200, usedToday: 0 },
    ]);
    expect(totals.nightly).toEqual({ source: 'shopa', games: 14, toConfirm: 0, minutes: null });
  });
});

describe('kindCases', () => {
  const facts = (productId: string, maker: string | null, releaseDate: string, amount = 5000) =>
    db.insert(productSources).values({
      productId,
      source: 'shopa',
      externalId: `s-${productId}`,
      url: 'https://shopa.test/1',
      facts: { maker, releaseDate, listPrice: { amount, currency: 'JPY', tax: 'included' } },
    });
  const level = (productId: string, days: [string, number | null][]) =>
    db.insert(wishLevels).values({
      productId,
      bucket: 'cond:good',
      series: days.map(([day, level]) => ({ day, level, n: 3 })) as never,
      inputsHash: 'h',
      computedAt: '2026-11-24T00:00:00+09:00',
    });

  it('takes the same console and maker or series, with levels 3, 6 and 12 months after release', async () => {
    const wished = await game('Wished', 'Alpha Station', 'Saga');
    await facts(wished.id, 'Maker One', '2026-01-10');
    const sameMaker = await tracked('Same maker');
    await facts(sameMaker.id, 'ＭＡＫＥＲ ONE', '2025-01-31');
    await level(sameMaker.id, [
      ['2025-04-30', 3000],
      ['2025-07-31', null],
      ['2026-01-31', 2500],
    ]);
    const sameSeries = await game('Same series', 'Alpha Station', 'saga');
    await trackGame(db, admin, sameSeries.id);
    const other = await tracked('Other maker');
    await facts(other.id, 'Maker Two', '2025-01-01');
    const otherConsole = await game('Other console', 'Beta Box', 'Saga');
    await trackGame(db, admin, otherConsole.id);

    const { basis, console, cases, counts } = await kindCases(db, wished.id);
    expect([basis, console]).toEqual(['kind', 'alpha']);
    expect(cases.map((c) => c.name)).toEqual(['Same maker', 'Same series']);
    expect(cases[0]!.at).toEqual([
      { months: 3, day: '2025-04-30', level: 3000, ofList: 0.6 },
      { months: 6, day: '2025-07-31', level: null, ofList: null },
      { months: 12, day: '2026-01-31', level: 2500, ofList: 0.5 },
    ]);
    // No release date: no day, so no level.
    expect(cases[1]!.at.every((a) => a.day === null && a.level === null)).toBe(true);
    expect(counts).toEqual({ 3: 1, 6: 0, 12: 1 });
  });

  it('falls back to the console when the wished game has no maker or series; none for an unknown console', async () => {
    const wished = await game('Plain');
    const a = await tracked('Any');
    const unknown = await game('Unknown', 'Gamma Pad');
    expect(await kindCases(db, wished.id)).toMatchObject({
      basis: 'console',
      cases: [{ productId: a.id }],
    });
    expect(await kindCases(db, unknown.id)).toEqual({
      basis: null,
      console: null,
      cases: [],
      counts: { 3: 0, 6: 0, 12: 0 },
    });
  });

  it('falls back to the console when no tracked game of it shares the maker or series (F5)', async () => {
    const wished = await game('Lonely', 'Alpha Station', 'Own saga');
    await facts(wished.id, 'Maker Three', '2026-01-10');
    const a = await tracked('Unrelated');
    await facts(a.id, 'Maker Four', '2025-01-01');
    const otherConsole = await game('Same saga elsewhere', 'Beta Box', 'Own saga');
    await trackGame(db, admin, otherConsole.id);
    expect(await kindCases(db, wished.id)).toMatchObject({
      basis: 'console',
      console: 'alpha',
      cases: [{ productId: a.id }],
    });
  });

  it('gives no ratio when the list price is in another currency', async () => {
    const wished = await game('Wished');
    const usd = await tracked('Priced abroad');
    await db.insert(productSources).values({
      productId: usd.id,
      source: 'shopa',
      externalId: 's-usd',
      facts: { releaseDate: '2025-01-15', listPrice: { amount: 50, currency: 'USD' } },
    });
    await level(usd.id, [['2025-04-15', 4000]]);
    const [c] = (await kindCases(db, wished.id)).cases;
    expect(c!.listPrice).toEqual({ amount: 50, currency: 'USD' });
    expect(c!.at[0]).toEqual({ months: 3, day: '2025-04-15', level: 4000, ofList: null });
  });
});
