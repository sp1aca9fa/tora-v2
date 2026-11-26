import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourceInfo, WishAlertState } from '@tora/core';
import { type SQL, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AlertContext, addDiscordChannel, sendWatchAlerts } from './alerts';
import { type Db, createDb } from './client';
import { saveConsole } from './consoles';
import { currentRules, recordItemCheck } from './item-rules';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { saveSourceInfos } from './registry';
import { addNight } from './sale-coverage';
import { appSettings, collectorRuns, productSources, watches } from './schema';
import { type SupplyOffer, type SupplyRow, saveSupply } from './supply';
import { createUser } from './users';
import { addWatch, updateWatch } from './watches';
import { WISH_LEASE_KEY, WISH_LEASE_MS, nightAlerts, sendWishAlerts } from './wish-alerts';
import { setWishCondition, setWishTarget, wishViews } from './wish-view';
import { addGameWish } from './wishes';

// Made-up sources and console (public test), as in wish-view.test.ts.
const SOURCES: SourceInfo[] = [
  {
    key: 'shop',
    market: 'jp',
    label: 'Shop',
    priority: 10,
    roles: { game: 'reference' },
    identity: ['game'],
    links: [{ pattern: 'shop\\.test/item/(\\w+)', url: 'https://shop.test/item/{id}' }],
  },
  { key: 'marketa', market: 'jp', label: 'Market A', priority: 20, roles: { game: 'supporting' } },
  { key: 'marketb', market: 'jp', label: 'Market B', priority: 30, roles: { game: 'supporting' } },
];
const SECRET = 'test-secret-0123456789abcdef0123456789';
const hook = (n: number) => `https://discord.com/api/webhooks/${100 + n}/fake`;
const TEXTS: Record<string, string> = {
  wishTitle: 'wish',
  wishCopy: '{title}: {price} from {seller}',
  wishPlusShipping: 'plus shipping',
  wishOnly: 'only one under {target}; next {next}',
  wishOnlyAlone: 'only one under {target}',
  wishSellers: 'sellers: {list}',
  wishCheapest: 'cheapest: {list}',
  buyTitle: 'buy',
  buyTarget: '{name}: ask {price} {source} under {target}',
  storeOpen: 'post',
};

const N1 = '2026-06-15';
const N2 = '2026-06-16';
const N3 = '2026-06-17';
/** The closing step's time: 02:00 in the app's zone, right after the night's collect. */
const at = (day: string) => new Date(`${day}T02:00:00+09:00`);

let db: Db;
let ann: string;
let bob: string;
/** What each webhook got; `fail`: those that answer 500; `onPost`: run before a post answers. */
let posts: { hook: string; text: string }[];
let fail: Set<string>;
let onPost: (() => Promise<void>) | null;
let ctx: AlertContext;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wish-alerts-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  ann = (await createUser(db, 'ann', creds, 'member')).user.id;
  bob = (await createUser(db, 'bob', creds, 'member')).user.id;
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha Station' },
    aliases: [],
    categories: {},
    boxedAllowed: true,
  });
  await saveSourceInfos(db, SOURCES);
  posts = [];
  fail = new Set();
  onPost = null;
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input).split('?')[0]!;
    if (!init?.method) return Response.json({ name: 'test' });
    if (fail.has(url)) return new Response('down', { status: 500 });
    if (onPost) await onPost();
    const body = JSON.parse(String(init.body)) as {
      content?: string;
      embeds?: { title?: string; description?: string }[];
    };
    const text = [body.content, ...(body.embeds ?? []).flatMap((e) => [e.title, e.description])];
    posts.push({ hook: url, text: text.filter(Boolean).join('\n') });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  ctx = { secret: SECRET, texts: () => TEXTS, fetch: fake };
  await addDiscordChannel(db, ann, hook(1), SECRET, fake);
  await addDiscordChannel(db, bob, hook(2), SECRET, fake);
  return () => rm(dir, { recursive: true, force: true });
});

const offer = (ref: string, price: number, over: Partial<SupplyOffer> = {}): SupplyOffer => ({
  ref,
  title: `Star Rover ${ref}`,
  url: `https://example.test/${ref}`,
  priceBase: price,
  priceOriginal: price,
  currency: 'JPY',
  seller: `seller-${ref}`,
  category: null,
  shipping: 'included',
  shippingPayerId: null,
  ...over,
});

const row = (
  productId: string,
  source: string,
  day: string,
  offers: SupplyOffer[],
  bucket = 'cond:good',
): SupplyRow => ({
  productId,
  source,
  bucket,
  day,
  lowestAskBase: offers.length ? Math.min(...offers.map((o) => o.priceBase)) : null,
  lowestAskOriginal: null,
  currency: 'JPY',
  fxRate: null,
  listings: offers.length,
  fetchedAt: `${day}T00:30:00+09:00`,
  offers,
});

/** The night's collect ran (N is its day). */
const ran = (day: string) =>
  db
    .insert(collectorRuns)
    .values({ source: 'marketa', startedAt: `${day}T00:10:00+09:00`, status: 'ok' });

/** A game wish, its sales confirmed (or not), linked at the shop and at market A by page. */
async function gameWish(userId: string, price: number | null, confirmed = true, reuse?: string) {
  const { watch, product } = await addGameWish(db, userId, {
    name: 'Star Rover',
    console: 'alpha',
    ...(reuse && { reuse }),
    watch: { targetPriceBase: price },
  });
  if (!reuse) {
    await db.insert(productSources).values([
      { productId: product.id, source: 'shop', externalId: 'g1', url: 'https://shop.test/item/g1' },
      { productId: product.id, source: 'marketa', externalId: 'p1', url: 'https://a.test/p1' },
    ]);
    if (confirmed) {
      const hash = (await currentRules(db, product.id))!.hashFor('sales', '');
      await recordItemCheck(db, {
        productId: product.id,
        kind: 'sales',
        source: '',
        outcome: 'confirmed',
        by: 'person',
        rulesHash: hash,
        userId,
      });
    }
  }
  return { watch, product };
}

const stored = async (id: string) =>
  (await db.select().from(watches).where(eq(watches.id, id)))[0]!;
const rawOf = async (id: string) =>
  (
    await db
      .select({ raw: sql<string | null>`${watches.alertState}` })
      .from(watches)
      .where(eq(watches.id, id))
  )[0]!.raw;
const wishOf = async (id: string) => (await stored(id)).alertState?.wish as WishAlertState;
const pass = (day: string) => nightAlerts(db, ctx, at(day));

describe('sendWishAlerts (S36 C3)', () => {
  it('alerts the cheapest copy at or under the price once, with its seller and the next up', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [
      row(product.id, 'marketa', N1, [offer('a1', 9500), offer('a2', 10_500)]),
    ]);
    expect((await pass(N1)).wish).toMatchObject({ alerts: 1, sent: 1, lost: 0, status: 'done' });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.hook).toBe(hook(1));
    expect(posts[0]!.text).toContain('Star Rover a1: ¥9,500 from Market A, seller-a1');
    expect(posts[0]!.text).toContain('only one under ¥10,000; next ¥10,500');
    // The same night again: nothing sent, nothing written.
    const raw = await rawOf(watch.id);
    expect((await pass(N1)).wish).toMatchObject({ alerts: 0, sent: 0 });
    expect(posts).toHaveLength(1);
    expect(await rawOf(watch.id)).toBe(raw);
    expect((await wishOf(watch.id)).alerted).toEqual({ 'marketa|a1': 9500 });
    // The next night, still listed: nothing.
    await ran(N2);
    await saveSupply(db, [row(product.id, 'marketa', N2, [offer('a1', 9500)])]);
    await pass(N2);
    expect(posts).toHaveLength(1);
    expect(await wishOf(watch.id)).toMatchObject({ reads: 2, in: true, lastIn: 2 });
  });

  it('the raw select reads the stored text, not the parsed value', async () => {
    const { watch } = await gameWish(ann, 10_000);
    await db
      .update(watches)
      .set({ alertState: { zone: { on: true } } })
      .where(eq(watches.id, watch.id));
    expect(await rawOf(watch.id)).toBe('{"zone":{"on":true}}');
  });

  it('a source not read on N keeps its copy for in/out, never names it; read again, it alerts', async () => {
    const { watch, product } = await gameWish(ann, 9500);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9800)])]);
    await pass(N1);
    expect(await wishOf(watch.id)).toMatchObject({ in: false, reads: 1 });
    await updateWatch(db, ann, watch.id, {
      condition: 'no_noticeable_damage',
      targetPriceBase: 10_000,
    });
    // N2: only the shop read (over the price); market A's a1 is kept from N1.
    await ran(N2);
    await saveSupply(db, [
      row(product.id, 'shop', N2, [offer('s1', 12_000, { own: 'own', stock: 1 })]),
    ]);
    const view = (await wishViews(db, ann, [watch.id], { now: at(N2), alerts: true })).get(
      watch.id,
    )!;
    expect(view.alert!.read).toEqual(['shop']);
    expect(view.alert!.kept.map((c) => c.slot)).toEqual(['marketa|a1']);
    await pass(N2);
    expect(posts).toHaveLength(0);
    expect(await wishOf(watch.id)).toMatchObject({ in: true, reads: 2 });
    // N3: market A read, a1 still there: named now.
    await ran(N3);
    await saveSupply(db, [row(product.id, 'marketa', N3, [offer('a1', 9800)])]);
    await pass(N3);
    expect(posts.map((p) => p.text.includes('Star Rover a1'))).toEqual([true]);
  });

  it('a read night needs a source with stored asks: its nights alone (sales only) count none', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    await pass(N1);
    expect(await wishOf(watch.id)).toMatchObject({ reads: 1, in: true });
    // N2: only market B read the item, and it never stored an ask for it (W15's listed sources).
    await ran(N2);
    await addNight(db, product.id, 'marketb', N2);
    const raw = await rawOf(watch.id);
    await pass(N2);
    expect(await rawOf(watch.id)).toBe(raw);
    // N3: market A read again, nothing found (no row of N3): a read night, out.
    await ran(N3);
    await addNight(db, product.id, 'marketa', N3);
    await pass(N3);
    expect(await wishOf(watch.id)).toMatchObject({ reads: 2, in: false, night: N3 });
  });

  it('the cheapest on the list is the cheapest copy an alert may name', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [
      row(product.id, 'marketa', N1, [
        offer('a1', 3200),
        offer('a2', 2900, { shipping: 'unknown' }),
      ]),
      row(product.id, 'shop', N1, [
        offer('own', 3000, { own: 'own', stock: 1 }),
        offer('out', 3100, { own: 'outside', count: 1, condition: 'used' }),
      ]),
      row(product.id, 'marketa', '2026-06-13', [offer('old', 1000)]),
    ]);
    const view = (await wishViews(db, ann, [watch.id], { now: at(N1), alerts: true })).get(
      watch.id,
    )!;
    const costs = view.alert!.tonight.map((c) => (c.paid.known ? c.paid.amount : c.price));
    expect(view.cheapest!.counted).toBe(Math.min(...costs));
    expect(view.alert!.kept).toEqual([]);
  });

  it('a failed channel leaves the stored text as it was; the rerun sends it', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    const raw = await rawOf(watch.id);
    fail.add(hook(1));
    expect((await pass(N1)).wish).toMatchObject({ alerts: 1, sent: 0 });
    expect(await rawOf(watch.id)).toBe(raw);
    fail.clear();
    expect((await pass(N1)).wish).toMatchObject({ alerts: 1, sent: 1 });
    expect(posts).toHaveLength(1);
  });

  it('two people on one item: each gets only their own wish', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    const bobs = (await gameWish(bob, 9000, true, product.id)).watch;
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    await pass(N1);
    expect(posts.map((p) => p.hook)).toEqual([hook(1)]);
    expect(await wishOf(watch.id)).toMatchObject({ in: true });
    expect(await wishOf(bobs.id)).toMatchObject({ in: false, alerted: {} });
  });

  it("a sent alert's state write that throws costs that wish only: the other's is written", async () => {
    // Ann wishes the game in two conditions; one like-new copy at 9,500 serves both.
    const { product, watch: good } = await gameWish(ann, 10_000);
    const { watch: mint } = await addGameWish(db, ann, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: product.id,
      watch: { targetPriceBase: 10_000, condition: 'like_new' },
    });
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)], 'cond:like_new')]);
    // The first write to a watch after the message went throws once.
    let thrown = false;
    const failing = new Proxy(db, {
      get(target, prop) {
        const real = Reflect.get(target, prop) as unknown;
        if (typeof real !== 'function') return real;
        if (prop !== 'update') return real.bind(target);
        return (...args: unknown[]) => {
          if (args[0] === watches && posts.length > 0 && !thrown) {
            thrown = true;
            throw new Error('write failed');
          }
          return (real as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const logged: string[] = [];
    const result = await sendWishAlerts(failing, { ...ctx, log: (m) => logged.push(m) }, at(N1));
    expect(result).toMatchObject({ alerts: 2, sent: 1, lost: 1, failed: 0, status: 'done' });
    expect(posts).toHaveLength(1);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('write failed');
    // One of the two states is written, the other is as it was (its copy may come once more).
    const raws = [await rawOf(good.id), await rawOf(mint.id)];
    expect(raws.filter((r) => r === null)).toHaveLength(1);
    const written = raws[0] === null ? mint : good;
    expect((await wishOf(written.id)).alerted).toEqual({ 'marketa|a1': 9500 });
  });

  it("one person's failure is counted and logged without a name; the next is still alerted", async () => {
    const { product } = await gameWish(ann, 10_000);
    await gameWish(bob, 10_000, true, product.id);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    // Every read naming the first person the pass reaches throws (their first read is their wishes).
    let first: string | null = null;
    const wrap = <T extends object>(target: T): T =>
      new Proxy(target, {
        get(b, p) {
          const v = Reflect.get(b, p) as unknown;
          if (p === 'then' && 'toSQL' in b) {
            const { params } = (b as { toSQL: () => { params: unknown[] } }).toSQL();
            const who = [ann, bob].find((id) => params.includes(id)) ?? null;
            if (who && first === null) first = who;
            if (who && who === first)
              return (_: unknown, failed: (e: Error) => void) => failed(new Error('read failed'));
          }
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            const out = (v as (...a: unknown[]) => unknown).apply(b, args);
            return out && typeof out === 'object' && !(out instanceof Promise) ? wrap(out) : out;
          };
        },
      });
    const failing = new Proxy(db, {
      get(target, prop) {
        const real = Reflect.get(target, prop) as unknown;
        if (typeof real !== 'function') return real;
        if (prop !== 'select') return real.bind(target);
        return (...args: unknown[]) =>
          wrap((real as (...a: unknown[]) => object).apply(target, args));
      },
    });
    const logged: string[] = [];
    const result = await sendWishAlerts(failing, { ...ctx, log: (m) => logged.push(m) }, at(N1));
    const other = first === ann ? bob : ann;
    expect(result).toMatchObject({ failed: 1, alerts: 1, sent: 1, status: 'done' });
    expect(posts.map((p) => p.hook)).toEqual([hook(other === ann ? 1 : 2)]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('read failed');
    expect(logged[0]).not.toMatch(/ann|bob/);
  });

  it('no run in the last 7 days, or an older night than stored: nothing sent or written', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran('2026-06-01');
    await saveSupply(db, [row(product.id, 'marketa', '2026-06-01', [offer('a1', 9500)])]);
    await pass(N1);
    expect([posts.length, await rawOf(watch.id)]).toEqual([0, null]);
    const later = { night: N2, reads: 1, in: false, lastIn: null, sent: null, reference: null };
    const state = {
      wish: { ...later, was: { in: false, lastIn: null, reference: null }, alerted: {}, runs: {} },
    };
    await db.update(watches).set({ alertState: state }).where(eq(watches.id, watch.id));
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    const raw = await rawOf(watch.id);
    await pass(N1);
    expect([posts.length, await rawOf(watch.id)]).toEqual([0, raw]);
  });

  it('a stored state that is not valid is skipped and counted, never reset', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await db
      .update(watches)
      .set({ alertState: { wish: { reads: 'x' } } })
      .where(eq(watches.id, watch.id));
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    const raw = await rawOf(watch.id);
    expect((await pass(N1)).wish).toMatchObject({ invalid: 1, sent: 0 });
    expect(await rawOf(watch.id)).toBe(raw);
  });

  it('game wishes, confirmed or not, priced or not: no zone or target; only the wish step', async () => {
    const wishes = [];
    for (const [i, [price, confirmed]] of (
      [
        [9000, true],
        [null, true],
        [9000, false],
        [null, false],
      ] as const
    ).entries()) {
      const product = await createProduct(db, ann, {
        category: 'game',
        kind: 'software',
        name: `Game ${i}`,
        platform: 'Alpha Station',
      });
      const { watch } = await gameWish(ann, price, confirmed, product.id);
      if (i === 0 || i === 2) {
        await db.insert(productSources).values({
          productId: product.id,
          source: 'marketa',
          externalId: `p${i}`,
          url: `https://a.test/p${i}`,
        });
      }
      if (confirmed) {
        const hash = (await currentRules(db, product.id))!.hashFor('sales', '');
        await recordItemCheck(db, {
          productId: product.id,
          kind: 'sales',
          source: '',
          outcome: 'confirmed',
          by: 'person',
          rulesHash: hash,
          userId: ann,
        });
      }
      wishes.push({ watch, product });
    }
    await ran(N1);
    await saveSupply(
      db,
      wishes.map(({ product }) => row(product.id, 'marketa', N1, [offer(`x${product.id}`, 8000)])),
    );
    expect(await sendWatchAlerts(db, ctx, at(N1))).toEqual({ sent: 0, alerts: 0 });
    for (const { watch } of wishes) expect(await rawOf(watch.id)).toBeNull();
    await pass(N1);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.text).toContain('Game 0');
    const states = await Promise.all(wishes.map(({ watch }) => stored(watch.id)));
    expect(states.map((s) => Object.keys(s.alertState ?? {}))).toEqual([
      ['wish'],
      [],
      ['wish'],
      [],
    ]);
    // Check needed with a price: the night counts, never in.
    expect(states[2]!.alertState!.wish).toMatchObject({ reads: 1, in: false });
  });
});

describe('the lease (plan 9.F)', () => {
  const lease = (value: { id: string; until: number }) =>
    db.insert(appSettings).values({ key: WISH_LEASE_KEY, value });
  const leaseNow = async () =>
    (await db.select().from(appSettings).where(eq(appSettings.key, WISH_LEASE_KEY)))[0]?.value;

  it("a dead holder's lease is waited out, then taken; released after", async () => {
    const { product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    let t = 1_000_000;
    await lease({ id: 'dead', until: t + 5 * 60_000 });
    const slept: number[] = [];
    const result = await sendWishAlerts(db, ctx, at(N1), {
      clock: () => t,
      sleep: async (ms) => {
        slept.push(ms);
        t += ms;
      },
    });
    expect(result).toMatchObject({ status: 'done', sent: 1 });
    expect(t).toBeGreaterThanOrEqual(1_000_000 + 6 * 60_000);
    expect(slept.every((ms) => ms <= 10_000)).toBe(true);
    expect(await leaseNow()).toMatchObject({ until: 0 });
  });

  it('a lease released between the failed take and the read is taken at once', async () => {
    const { product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    const t = 1_000_000;
    await lease({ id: 'ending', until: t + WISH_LEASE_MS });
    // The holder's `finally` runs right after the waiter's take failed, before its read.
    let released = false;
    const releasing = new Proxy(db, {
      get(target, prop) {
        const real = Reflect.get(target, prop) as unknown;
        if (prop !== 'select' || released) {
          return typeof real === 'function' ? real.bind(target) : real;
        }
        return (fields: Parameters<typeof target.select>[0]) => {
          released = true;
          return {
            from: (table: typeof appSettings) => ({
              where: async (w: SQL | undefined) => {
                await lease({ id: 'ending', until: 0 }).onConflictDoUpdate({
                  target: appSettings.key,
                  set: { value: { id: 'ending', until: 0 } },
                });
                return target.select(fields!).from(table).where(w);
              },
            }),
          };
        };
      },
    });
    const slept: number[] = [];
    const result = await sendWishAlerts(releasing, ctx, at(N1), {
      clock: () => t,
      sleep: async (ms) => void slept.push(ms),
    });
    expect([released, result.status, result.sent, slept]).toEqual([true, 'done', 1, []]);
    expect(await leaseNow()).toMatchObject({ until: 0 });
  });

  it('a holder still renewing: the waiter gives up, sends nothing', async () => {
    const { product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    let t = 1_000_000;
    await lease({ id: 'slow', until: t + WISH_LEASE_MS });
    const result = await sendWishAlerts(db, ctx, at(N1), {
      clock: () => t,
      sleep: async (ms) => {
        t += ms;
        await db
          .update(appSettings)
          .set({ value: { id: 'slow', until: t + WISH_LEASE_MS } })
          .where(eq(appSettings.key, WISH_LEASE_KEY));
      },
    });
    expect(result.status).toBe('busy');
    expect(posts).toHaveLength(0);
    expect(await leaseNow()).toMatchObject({ id: 'slow' });
  });

  it('a lease taken over during the pass stops it before the next person', async () => {
    const { product } = await gameWish(ann, 10_000);
    await gameWish(bob, 10_000, true, product.id);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    onPost = async () => {
      await db
        .update(appSettings)
        .set({ value: { id: 'other', until: Date.now() + WISH_LEASE_MS } })
        .where(eq(appSettings.key, WISH_LEASE_KEY));
    };
    const result = await sendWishAlerts(db, ctx, at(N1));
    expect(result).toMatchObject({ status: 'lease_lost', sent: 1 });
    expect(posts).toHaveLength(1);
    expect(await leaseNow()).toMatchObject({ id: 'other' });
  });
});

describe('a save beside the pass (plan 9.E, 9.K)', () => {
  it('a price saved while the alert was sent stands, and the copy sent is remembered', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    onPost = async () => {
      onPost = null;
      await setWishTarget(db, ann, watch.id, 9000);
    };
    expect((await pass(N1)).wish).toMatchObject({ sent: 1, lost: 0 });
    const w = await stored(watch.id);
    expect(w.targetPriceBase).toBe(9000);
    expect(w.alertState!.wish).toMatchObject({ in: false, alerted: { 'marketa|a1': 9500 } });
  });

  /** N1 a1 at 9,500 and a2 at 9,600 on a new wish at 10,000 (stored state NULL), `during` the post. */
  async function heldWith(during: (watchId: string) => Promise<unknown>) {
    const made = await gameWish(ann, 10_000);
    expect(await rawOf(made.watch.id)).toBeNull();
    await ran(N1);
    const both = (day: string) =>
      row(made.product.id, 'marketa', day, [offer('a1', 9500), offer('a2', 9600)]);
    await saveSupply(db, [both(N1)]);
    onPost = async () => {
      onPost = null;
      await during(made.watch.id);
    };
    expect((await pass(N1)).wish).toMatchObject({ sent: 1, lost: 0 });
    // N2, both still listed: a2 is not 3 % under the reference a1 (9,600 > 9,215).
    await ran(N2);
    await saveSupply(db, [both(N2)]);
    await pass(N2);
    return made;
  }

  it('a note saved while the alert was sent: the step stands, the next night is quiet', async () => {
    const { watch } = await heldWith((id) =>
      updateWatch(db, ann, id, {
        condition: 'no_noticeable_damage',
        targetPriceBase: 10_000,
        note: 'a note',
      }),
    );
    expect(posts).toHaveLength(1);
    expect((await stored(watch.id)).note).toBe('a note');
    expect(await wishOf(watch.id)).toMatchObject({
      reads: 2,
      alerted: { 'marketa|a1': 9500 },
      reference: { cost: 9500, key: 'marketa|a1', at: 1 },
    });
  });

  it("a price saved while a shop copy's alert was sent: its run stays, no second alert", async () => {
    const { watch, product } = await gameWish(ann, 4000);
    const own = (day: string) =>
      row(product.id, 'shop', day, [offer('own', 3800, { own: 'own', stock: 1 })]);
    await ran(N1);
    await saveSupply(db, [own(N1)]);
    onPost = async () => {
      onPost = null;
      await setWishTarget(db, ann, watch.id, 4200);
    };
    expect((await pass(N1)).wish).toMatchObject({ sent: 1, lost: 0 });
    // The save won; the copy sent and the run it is keyed by are remembered.
    const state = await wishOf(watch.id);
    expect(Object.values(state.runs)).toEqual([N1]);
    expect(Object.keys(state.alerted)).toHaveLength(1);
    // N2, the same copy at the same price: it was alerted, nothing goes.
    await ran(N2);
    await saveSupply(db, [own(N2)]);
    await pass(N2);
    expect(posts).toHaveLength(1);
  });

  it('a write that left price, condition and wish part as read: the step goes on it', async () => {
    // Another writer turned the NULL into an empty memory (as a note save does).
    const { watch } = await heldWith((id) =>
      db.update(watches).set({ alertState: {} }).where(eq(watches.id, id)),
    );
    expect(posts).toHaveLength(1);
    expect(await wishOf(watch.id)).toMatchObject({
      reads: 2,
      reference: { cost: 9500, key: 'marketa|a1', at: 1 },
    });
  });

  it('a save between the read and a write with no alert: the pass skips the wish', async () => {
    const { watch, product } = await gameWish(ann, 9000);
    await ran(N1);
    await saveSupply(db, [row(product.id, 'marketa', N1, [offer('a1', 9500)])]);
    let raced = false;
    const racing = new Proxy(db, {
      get(target, prop) {
        const real = Reflect.get(target, prop) as unknown;
        if (prop !== 'update') return typeof real === 'function' ? real.bind(target) : real;
        return (table: typeof watches) => {
          const builder = target.update(table);
          if (table !== watches || raced) return builder;
          return {
            set: (v: Parameters<typeof builder.set>[0]) => ({
              where: (w: Parameters<ReturnType<typeof builder.set>['where']>[0]) => ({
                returning: async (r: { id: typeof watches.id }) => {
                  raced = true;
                  await setWishTarget(db, ann, watch.id, 9600);
                  return builder.set(v).where(w).returning(r);
                },
              }),
            }),
          };
        };
      },
    });
    expect(await sendWishAlerts(racing, ctx, at(N1))).toMatchObject({ skipped: 1, sent: 0 });
    const w = await stored(watch.id);
    expect([raced, w.targetPriceBase, w.alertState]).toEqual([true, 9600, {}]);
  });

  /** A wish alerted on N1 (a1 at 9,500), so its state has something to restart and keep. */
  async function alerted() {
    const made = await gameWish(ann, 10_000);
    await ran(N1);
    await saveSupply(db, [row(made.product.id, 'marketa', N1, [offer('a1', 9500)])]);
    await pass(N1);
    expect(await wishOf(made.watch.id)).toMatchObject({ in: true, sent: 1 });
    return made;
  }
  const restarted = {
    in: false,
    lastIn: null,
    sent: null,
    reference: null,
    alerted: { 'marketa|a1': 9500 },
  };

  it('updateWatch: a new price or condition restarts the wish and keeps what was alerted', async () => {
    const { watch } = await alerted();
    const before = await rawOf(watch.id);
    await updateWatch(db, ann, watch.id, {
      condition: 'no_noticeable_damage',
      targetPriceBase: 10_000,
      note: 'a note',
    });
    expect(await rawOf(watch.id)).toBe(before);
    await updateWatch(db, ann, watch.id, {
      condition: 'no_noticeable_damage',
      targetPriceBase: 9800,
    });
    expect(await wishOf(watch.id)).toMatchObject(restarted);
  });

  it('setWishTarget and setWishCondition restart it', async () => {
    const { watch } = await alerted();
    await setWishTarget(db, ann, watch.id, 9900);
    expect(await wishOf(watch.id)).toMatchObject(restarted);
    const { watch: other } = await alerted();
    const moved = await setWishCondition(db, ann, other.id, 'like_new');
    expect((await stored(moved.id)).alertState).toEqual({
      wish: expect.objectContaining(restarted) as unknown,
    });
  });

  it('wishing it again at another price restarts it; at the same price leaves it', async () => {
    const { watch, product } = await alerted();
    const before = await rawOf(watch.id);
    await gameWish(ann, 10_000, true, product.id);
    expect(await rawOf(watch.id)).toBe(before);
    await gameWish(ann, 9700, true, product.id);
    expect(await wishOf(watch.id)).toMatchObject(restarted);
  });

  it('an empty-condition wish becoming the good one keeps its wish part, restarted', async () => {
    const { watch, product } = await alerted();
    const state = (await stored(watch.id)).alertState;
    await db.delete(watches).where(eq(watches.id, watch.id));
    const [empty] = await db
      .insert(watches)
      .values({
        userId: ann,
        productId: product.id,
        bucket: '',
        targetPriceBase: 10_000,
        alertState: state,
      })
      .returning();
    await gameWish(ann, null, true, product.id);
    const w = await stored(empty!.id);
    expect(w.bucket).toBe('cond:good');
    expect(w.alertState).toEqual({ wish: expect.objectContaining(restarted) as unknown });
  });

  it('two items merged: a copy the dropped wish alerted is not alerted again', async () => {
    const { watch, product } = await gameWish(ann, 10_000);
    const dup = await createProduct(db, ann, {
      category: 'game',
      kind: 'software',
      name: 'Star Rover again',
      platform: 'Alpha Station',
    });
    const dropped = (await gameWish(ann, 10_000, true, dup.id)).watch;
    await db
      .insert(productSources)
      .values({ productId: dup.id, source: 'marketa', externalId: 'p2', url: 'https://a.test/p2' });
    const hash = (await currentRules(db, dup.id))!.hashFor('sales', '');
    await recordItemCheck(db, {
      productId: dup.id,
      kind: 'sales',
      source: '',
      outcome: 'confirmed',
      by: 'person',
      rulesHash: hash,
      userId: ann,
    });
    await ran(N1);
    await saveSupply(db, [row(dup.id, 'marketa', N1, [offer('a1', 9500)])]);
    await pass(N1);
    expect(posts).toHaveLength(1);
    expect((await wishOf(dropped.id)).alerted).toEqual({ 'marketa|a1': 9500 });
    // The kept wish had nothing read: no state; it gets a fresh one holding what was sent.
    expect(await rawOf(watch.id)).toBeNull();
    await mergeProducts(db, { id: ann, role: 'admin' }, dup.id, product.id);
    expect(await db.select().from(watches).where(eq(watches.id, dropped.id))).toEqual([]);
    expect(await wishOf(watch.id)).toMatchObject({
      night: null,
      reads: 0,
      reference: null,
      alerted: { 'marketa|a1': 9500 },
    });
    await ran(N2);
    await saveSupply(db, [row(product.id, 'marketa', N2, [offer('a1', 9500)])]);
    await pass(N2);
    expect(posts).toHaveLength(1);
    expect(await wishOf(watch.id)).toMatchObject({ reads: 1, in: true });
  });

  it("two items merged: a card's memory and a kept wish's broken part stay as they were", async () => {
    const card = (name: string) =>
      createProduct(db, ann, {
        category: 'tcg',
        kind: 'single',
        name,
        franchise: 'pokemon',
        region: 'jp',
      });
    const [keep, dup] = [await card('Card'), await card('Card again')];
    const kept = (await addWatch(db, ann, { productId: keep.id }, { targetPriceBase: 9000 })).watch;
    const gone = (await addWatch(db, ann, { productId: dup.id }, { targetPriceBase: 9000 })).watch;
    const memory = (sent: string) => ({ zone: { on: true, sent }, target: { on: true, sent } });
    await db
      .update(watches)
      .set({ alertState: memory(N1) })
      .where(eq(watches.id, kept.id));
    await db
      .update(watches)
      .set({ alertState: memory(N2) })
      .where(eq(watches.id, gone.id));
    const before = await rawOf(kept.id);
    await mergeProducts(db, { id: ann, role: 'admin' }, dup.id, keep.id);
    expect(await rawOf(kept.id)).toBe(before);
    // A game wish whose stored part is not a valid one: never rewritten.
    const { watch, product } = await gameWish(ann, 10_000);
    const other = await createProduct(db, ann, {
      category: 'game',
      kind: 'software',
      name: 'Star Rover again',
      platform: 'Alpha Station',
    });
    const dropped = (await gameWish(ann, 10_000, true, other.id)).watch;
    const valid: WishAlertState = {
      night: N1,
      reads: 1,
      in: false,
      lastIn: null,
      was: { in: false, lastIn: null, reference: null },
      sent: null,
      reference: null,
      alerted: { 'marketa|a1': 9500 },
      runs: {},
    };
    await db
      .update(watches)
      .set({ alertState: { wish: valid } })
      .where(eq(watches.id, dropped.id));
    await db
      .update(watches)
      .set({ alertState: { wish: { reads: 'x' } } })
      .where(eq(watches.id, watch.id));
    const broken = await rawOf(watch.id);
    await mergeProducts(db, { id: ann, role: 'admin' }, other.id, product.id);
    expect(await rawOf(watch.id)).toBe(broken);
  });

  it("a card's memory is saved as before: no wish part, the same fields", async () => {
    const product = await createProduct(db, ann, {
      category: 'tcg',
      kind: 'single',
      name: 'Card',
      franchise: 'pokemon',
      region: 'jp',
    });
    const { watch } = await addWatch(db, ann, { productId: product.id }, { targetPriceBase: 9000 });
    const memory = { zone: { on: true, sent: N1 }, target: { on: true, sent: N1 } };
    await db.update(watches).set({ alertState: memory }).where(eq(watches.id, watch.id));
    // Watched again at a new target: its target part starts over as in the edit form (A14).
    await addWatch(db, ann, { productId: product.id }, { targetPriceBase: 8000 });
    expect(await rawOf(watch.id)).toBe(JSON.stringify({ zone: memory.zone }));
    await db.update(watches).set({ alertState: memory }).where(eq(watches.id, watch.id));
    await updateWatch(db, ann, watch.id, { targetPriceBase: 7000 });
    expect(await rawOf(watch.id)).toBe(JSON.stringify({ zone: memory.zone }));
    await updateWatch(db, ann, watch.id, { targetPriceBase: 7000, note: 'n' });
    expect(await rawOf(watch.id)).toBe(JSON.stringify({ zone: memory.zone }));
    // A note on a card with no memory leaves none (not an empty one).
    const other = await createProduct(db, ann, {
      category: 'tcg',
      kind: 'single',
      name: 'Other card',
      franchise: 'pokemon',
      region: 'jp',
    });
    const { watch: fresh } = await addWatch(
      db,
      ann,
      { productId: other.id },
      { targetPriceBase: 5000 },
    );
    expect(await rawOf(fresh.id)).toBeNull();
    await updateWatch(db, ann, fresh.id, { targetPriceBase: 5000, note: 'n' });
    // As before the wish's part came: a note save stores the empty memory for a NULL.
    expect([(await stored(fresh.id)).note, await rawOf(fresh.id)]).toEqual(['n', '{}']);
  });
});
