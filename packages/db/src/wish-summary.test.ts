import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LevelChange, type SourceInfo, type WishAlertState, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAlertTexts } from './alert-texts';
import { recordActivity } from './activity';
import { type AlertContext, addDiscordChannel, sendSummaries } from './alerts';
import { type Db, createDb } from './client';
import { saveConsole, saveConsolePlugins } from './consoles';
import { currentRules, recordItemCheck, saveItemRules } from './item-rules';
import { migrateDb } from './migrate';
import { readSetting, saveSetting, saveSourceInfos } from './registry';
import { setGameRules } from './rule-marks';
import {
  collectorRuns,
  itemRuleState,
  productSources,
  saleCoverage,
  users,
  watches,
} from './schema';
import { type SupplyOffer, saveSupply } from './supply';
import { createUser } from './users';
import { addWatch } from './watches';
import { nightAlerts } from './wish-alerts';
import { wishEvents, wishSummary } from './wish-summary';
import { type WishView, recordItemFact, wishView } from './wish-view';
import { addGameWish } from './wishes';
import { createProduct } from './mutations';

// Made-up sources and console (public test), as in wish-alerts.test.ts.
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
];
const SECRET = 'test-secret-0123456789abcdef0123456789';
const hook = (n: number) => `https://discord.com/api/webhooks/${300 + n}/fake`;
// The app's own wording: the summary lines are read as the person gets them (numbers replaced).
const EN = {
  alertText: readAlertTexts('en', join(import.meta.dirname, '../../..')),
};

const DAYS = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'];
/** The summary's time: 08:00 in the app's zone, after the night's collect. */
const at = (day: string) => new Date(`${day}T08:00:00+09:00`);

let db: Db;
let ann: string;
let bob: string;
let posts: { hook: string; text: string }[];
let fail: Set<string>;
let ctx: AlertContext;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wish-summary-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  ann = (await createUser(db, 'ann', creds, 'member')).user.id;
  bob = (await createUser(db, 'bob', creds, 'member')).user.id;
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha Station' },
    aliases: [],
    categories: { marketa: '123' },
    boxedAllowed: true,
  });
  await saveSourceInfos(db, SOURCES);
  await saveSetting(db, 'appUrl', 'https://tora.test');
  posts = [];
  fail = new Set();
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input).split('?')[0]!;
    if (!init?.method) return Response.json({ name: 'test' });
    if (fail.has(url)) return new Response('down', { status: 500 });
    const body = JSON.parse(String(init.body)) as {
      content?: string;
      embeds?: { title?: string; description?: string }[];
    };
    const text = [body.content, ...(body.embeds ?? []).flatMap((e) => [e.title, e.description])];
    posts.push({ hook: url, text: text.filter(Boolean).join('\n') });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  ctx = { secret: SECRET, texts: () => EN.alertText, fetch: fake };
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

/** Market A's read of the night (and the collect run that day). */
async function night(productId: string, day: string, offers: SupplyOffer[]) {
  await db
    .insert(collectorRuns)
    .values({ source: 'marketa', startedAt: `${day}T00:10:00+09:00`, status: 'ok' });
  await saveSupply(db, [
    {
      productId,
      source: 'marketa',
      bucket: 'cond:good',
      day,
      lowestAskBase: offers.length ? Math.min(...offers.map((o) => o.priceBase)) : null,
      lowestAskOriginal: null,
      currency: 'JPY',
      fxRate: null,
      listings: offers.length,
      fetchedAt: `${day}T00:30:00+09:00`,
      offers,
    },
  ]);
}

/**
 * Ann's game wish linked at market A by a stored search; its rules first, then its checks (with
 * `listings` false, its sales only). `who` and `name` give another person's wish.
 */
async function gameWish(
  price: number | null,
  confirmed = true,
  { who = ann, name = 'Star Rover', listings = true } = {},
) {
  const { watch, product } = await addGameWish(db, who, {
    name,
    console: 'alpha',
    watch: { targetPriceBase: price },
  });
  await db.insert(productSources).values({
    productId: product.id,
    source: 'marketa',
    externalId: 'search',
    query: { keywords: ['star rover'], excludeKeywords: ['lot'] },
  });
  const rules = { console: 'alpha', edition: null, boxed: false, boxedOf: null, gameRules: null };
  await saveItemRules(
    db,
    product.id,
    { ...rules, required: ['deluxe'], excluded: ['broken'] },
    who,
  );
  if (confirmed) {
    // Its sales, and its listings at market A (a search link: W15's checked status).
    const current = (await currentRules(db, product.id))!;
    const checks: ['sales' | 'listings', string][] = [['sales', '']];
    if (listings) checks.push(['listings', 'marketa']);
    for (const [kind, source] of checks)
      await recordItemCheck(db, {
        productId: product.id,
        kind,
        source,
        outcome: 'confirmed',
        by: 'person',
        rulesHash: current.hashFor(kind, source),
        userId: who,
      });
  }
  return { watch, product };
}

/**
 * The test's database with `from(table)` failing the first time it reads `table` (a fault in one
 * person's wish part); every table read is added to `read`.
 */
function failingOnce(table: unknown, read: unknown[] = []): Db {
  let armed = true;
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (key !== 'select') return typeof value === 'function' ? value.bind(target) : value;
      return (...args: Parameters<Db['select']>) => {
        const query = target.select(...args);
        const from = query.from.bind(query);
        query.from = ((t: Parameters<typeof from>[0]) => {
          read.push(t);
          if (armed && t === table) {
            armed = false;
            throw new Error('read failed');
          }
          return from(t);
        }) as typeof from;
        return query;
      };
    },
  });
}

const summary = (day: string) => sendSummaries(db, ctx, at(day));
const wishPosts = () => posts.filter((p) => p.text.includes(EN.alertText.summaryWishes!));
const shown = () => readSetting<Record<string, Record<string, string[]>>>(db, 'alertWishShown');

describe('the morning summary\'s "Wishes" part (S36 C3, C4)', () => {
  it('points to the helper within 10 % over the price, once while true, again only after it ended', async () => {
    const { watch, product } = await gameWish(10_000);
    await night(product.id, DAYS[0]!, [offer('a1', 11_000)]);
    await summary(DAYS[0]!);
    expect(wishPosts()).toHaveLength(1);
    expect(wishPosts()[0]!.text).toContain('Star Rover: the cheapest copy, ¥11,000 at Market A');
    expect(wishPosts()[0]!.text).toContain(`/watchlist/${watch.id}`);
    expect((await shown())![ann]).toEqual({ [watch.id]: ['pointer'] });
    // Still true the next morning: not told again.
    await night(product.id, DAYS[1]!, [offer('a1', 10_500)]);
    await summary(DAYS[1]!);
    expect(wishPosts()).toHaveLength(1);
    // Ended (over 10 %): nothing told, the memory goes though nothing was sent.
    await night(product.id, DAYS[2]!, [offer('a1', 11_100)]);
    await summary(DAYS[2]!);
    expect(wishPosts()).toHaveLength(1);
    expect((await shown())![ann]).toBeUndefined();
    // True again: told again.
    await night(product.id, DAYS[3]!, [offer('a1', 10_900)]);
    await summary(DAYS[3]!);
    expect(wishPosts()).toHaveLength(2);
  });

  it('a summary not delivered adds no memory; the next one tells it', async () => {
    const { product } = await gameWish(10_000);
    await night(product.id, DAYS[0]!, [offer('a1', 10_200)]);
    fail.add(hook(1));
    await summary(DAYS[0]!);
    expect(posts).toHaveLength(0);
    expect(await shown()).toBeNull();
    fail.clear();
    await night(product.id, DAYS[1]!, [offer('a1', 10_200)]);
    await summary(DAYS[1]!);
    expect(wishPosts()).toHaveLength(1);
  });

  it('check needed with its reason, and a fact recorded since the last summary (no recorder)', async () => {
    const { watch, product } = await gameWish(null, false);
    await night(product.id, DAYS[0]!, [offer('a1', 9000)]);
    await recordItemFact(db, ann, watch.id, { kind: 'price_cut', day: DAYS[0]!, text: 'to 3,000' });
    await summary(DAYS[0]!);
    const text = wishPosts()[0]!.text;
    expect(text).toContain(EN.alertText.summaryWishCheck_unchecked);
    expect(text).toContain('fact recorded: price cut: to 3,000');
    expect(text).not.toContain('ann');
    // No price: no pointer, whatever the copies.
    expect(text).not.toContain('within 10%');
    await night(product.id, DAYS[1]!, [offer('a1', 9000)]);
    await summary(DAYS[1]!);
    expect(wishPosts()).toHaveLength(1);
  });

  it('buy alerts off: no wish part, and no memory written', async () => {
    const { product } = await gameWish(10_000);
    await db
      .update(users)
      .set({ preferences: { alerts: { buy: false } } })
      .where(eq(users.id, ann));
    await night(product.id, DAYS[0]!, [offer('a1', 10_500)]);
    await summary(DAYS[0]!);
    expect(wishPosts()).toHaveLength(0);
    expect(await shown()).toBeNull();
  });

  it('a person with no game wish: the summary as before and no memory written', async () => {
    const card = await createProduct(db, bob, {
      category: 'tcg',
      kind: 'single',
      name: 'Blue Dragon',
      franchise: 'pokemon',
      region: 'en',
    });
    await addWatch(db, bob, { productId: card.id }, { targetPriceBase: 500 });
    await db
      .insert(collectorRuns)
      .values({ source: 'marketa', startedAt: `${DAYS[0]}T00:10:00+09:00`, status: 'ok' });
    await sendSummaries(db, ctx, at(DAYS[0]!));
    const on = posts.map((p) => p.text);
    expect(await shown()).toBeNull();
    // The same summary taken the old way (buy alerts off skips the wish part): byte for byte.
    await saveSetting(db, 'alertSummaries', {});
    await db
      .update(users)
      .set({ preferences: { alerts: { buy: false } } })
      .where(eq(users.id, bob));
    posts = [];
    await sendSummaries(db, ctx, at(DAYS[0]!));
    expect(posts.map((p) => p.text)).toEqual(on);
  });

  it("one person's wish part failing: the others' summaries go, that person's other parts too, memories saved", async () => {
    const a = await gameWish(10_000);
    const b = await gameWish(10_000, true, { who: bob, name: 'Moon Rover' });
    for (const [who, { product }] of [
      [ann, a],
      [bob, b],
    ] as const) {
      await night(product.id, DAYS[0]!, [offer(`${who}1`, 10_500)]);
      await recordActivity(db, {
        kind: 'import',
        action: 'csv',
        userId: who,
        detail: { outcomes: { imported: 1, existing: 2 } },
        occurredAt: toLocalIso(new Date(at(DAYS[0]!).getTime() - 3_600_000)),
      });
    }
    const before = { old: ['level:up'] };
    await saveSetting(db, 'alertWishShown', { [ann]: before, [bob]: before });
    const logs: string[] = [];
    // The first wish part to run fails on one of its reads (whoever comes first).
    const sent = await sendSummaries(
      failingOnce(saleCoverage),
      { ...ctx, log: (m) => logs.push(m) },
      at(DAYS[0]!),
    );
    expect(sent).toBe(2);
    // Each person's import card went; one person's wish part with it.
    for (const h of [hook(1), hook(2)])
      expect(
        posts.filter((p) => p.hook === h && p.text.includes('2 already in Tora')),
      ).toHaveLength(1);
    expect(wishPosts()).toHaveLength(1);
    const told = wishPosts()[0]!.hook === hook(1) ? ann : bob;
    const failed = told === ann ? bob : ann;
    const memory = (await shown())!;
    expect(memory[failed]).toEqual(before);
    expect(memory[told]).toEqual({ [(told === ann ? a : b).watch.id]: ['pointer'] });
    const state = (await readSetting<Record<string, string>>(db, 'alertSummaries'))!;
    expect(Object.keys(state).toSorted()).toEqual([ann, bob].toSorted());
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(/ann|bob|Rover/);
  });

  it('a person with only card watches: no wish view read', async () => {
    const card = await createProduct(db, bob, {
      category: 'tcg',
      kind: 'single',
      name: 'Blue Dragon',
      franchise: 'pokemon',
      region: 'en',
    });
    await addWatch(db, bob, { productId: card.id }, { targetPriceBase: 500 });
    const read: unknown[] = [];
    await sendSummaries(failingOnce(null, read), ctx, at(DAYS[0]!));
    expect(read).not.toContain(itemRuleState);
    expect(read).not.toContain(saleCoverage);
  });

  it('buy alerts off forgets the memory: an event that ended and came back meanwhile is told', async () => {
    const { product } = await gameWish(10_000);
    const buy = (on: boolean) =>
      db
        .update(users)
        .set({ preferences: { alerts: { buy: on } } })
        .where(eq(users.id, ann));
    await night(product.id, DAYS[0]!, [offer('a1', 10_500)]);
    await summary(DAYS[0]!);
    expect(wishPosts()).toHaveLength(1);
    await buy(false);
    await night(product.id, DAYS[1]!, [offer('a1', 12_000)]);
    await summary(DAYS[1]!);
    expect(await shown()).toEqual({});
    await night(product.id, DAYS[2]!, [offer('a1', 10_500)]);
    await summary(DAYS[2]!);
    await buy(true);
    await night(product.id, DAYS[3]!, [offer('a1', 10_500)]);
    await summary(DAYS[3]!);
    expect(wishPosts()).toHaveLength(2);
  });
});

describe('wishEvents (S36 C3, C4 thresholds)', () => {
  const change = (from: number, to: number): LevelChange => ({
    from: { day: '2026-05-18', level: from },
    to: { day: '2026-06-15', level: to },
    amount: to - from,
    share: (to - from) / from,
  });
  const view = (over: Record<string, unknown>) =>
    ({
      state: 'confirmed',
      night: '2026-06-15',
      checkWhy: null,
      watch: { id: 'w', targetPriceBase: 10_000 },
      level: null,
      bounds: null,
      facts: [],
      recorded: [],
      cheapest: null,
      helper: [{ source: 'marketa' }],
      ...over,
    }) as unknown as WishView;
  const keys = (v: WishView) => [
    ...wishEvents(v, '2026-06-15T00:00:00', EN.alertText, String, (s) => s).keys(),
  ];
  const cheap = (counted: number) => ({ source: 'marketa', day: '2026-06-15', counted });

  it('a level move from 5 %, a buyback move from 10 %, either way', () => {
    expect(keys(view({ level: { change: change(10_000, 10_490) } }))).toEqual([]);
    expect(keys(view({ level: { change: change(10_000, 10_500) } }))).toEqual(['level:up']);
    expect(keys(view({ level: { change: change(10_000, 9500) } }))).toEqual(['level:down']);
    const buyback = (c: LevelChange) => ({ buyback: { source: 'shop', price: 1, change: c } });
    expect(keys(view({ bounds: buyback(change(1000, 1099)) }))).toEqual([]);
    expect(keys(view({ bounds: buyback(change(1000, 900)) }))).toEqual(['buyback:shop:down']);
  });

  it('the pointer: above the price by 10 % or less, tonight, confirmed, with a price', () => {
    expect(keys(view({ cheapest: cheap(10_000) }))).toEqual([]);
    expect(keys(view({ cheapest: cheap(11_000) }))).toEqual(['pointer']);
    expect(keys(view({ cheapest: cheap(11_001) }))).toEqual([]);
    expect(keys(view({ cheapest: cheap(10_500), night: null }))).toEqual([]);
    expect(keys(view({ cheapest: cheap(10_500), watch: { targetPriceBase: null } }))).toEqual([]);
    expect(keys(view({ cheapest: cheap(10_500), state: 'check_needed' }))).toEqual([]);
    // Nothing on the page to point to (a boxed wish, no stored search): no pointer.
    expect(keys(view({ cheapest: cheap(10_500), helper: [] }))).toEqual([]);
  });

  it('the stock facts keyed by their start; a fact only when recorded since the last summary', () => {
    const facts = [
      { kind: 'shop_out', source: 'shop', nights: 5, since: '2026-06-11' },
      { kind: 'no_new_copy', nights: 6, since: '2026-06-10' },
    ];
    const recorded = [
      { id: 'f1', kind: 'other', text: 'x', recordedAt: '2026-06-14T23:00:00' },
      { id: 'f2', kind: 'port', text: null, recordedAt: '2026-06-15T01:00:00' },
    ];
    expect(keys(view({ facts, recorded }))).toEqual([
      'shop_out:shop:2026-06-11',
      'no_new_copy:2026-06-10',
      'fact:f2',
    ]);
  });

  it('wishSummary keeps only the keys still true and tells only the new ones', () => {
    const v = view({ cheapest: cheap(10_500), level: { change: change(10_000, 11_000) } });
    const part = wishSummary([v], { w: ['pointer', 'level:down'] }, (x) =>
      wishEvents(x, '', EN.alertText, String, (s) => s),
    );
    expect(part.told).toEqual({ w: ['pointer'] });
    expect(part.withNew).toEqual({ w: ['level:up', 'pointer'] });
    expect(part.lines[0]!.texts).toHaveLength(1);
  });
});

describe('the wish page: in on N nights, the alert in words, the helper (S36 C3, C4)', () => {
  it('counts the read nights the alert step reads as in, "so far" under 30', async () => {
    const { watch, product } = await gameWish(10_000);
    const prices = [9500, 12_000, null, 9900];
    let state: WishAlertState | null = null;
    let ins = 0;
    for (const [i, p] of prices.entries()) {
      if (p === null) continue; // No run that day: no read night.
      await night(product.id, DAYS[i]!, [offer(`a${i}`, p)]);
      await nightAlerts(db, ctx, new Date(`${DAYS[i]}T02:00:00+09:00`));
      state = (await db.select().from(watches).where(eq(watches.id, watch.id)))[0]!.alertState!
        .wish as WishAlertState;
      if (state.in) ins++;
    }
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[3]!) }))!;
    expect(v.trial).toEqual({ in: ins, counted: state!.reads });
    expect(v.trial).toEqual({ in: 2, counted: 3 });
  });

  it('sales confirmed, a price, no source with checked listings: no trial, no alert can come yet', async () => {
    const { watch, product } = await gameWish(10_000, true, { listings: false });
    await night(product.id, DAYS[0]!, [offer('a1', 9000)]);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect([v.state, v.trial, v.listingsUnread]).toEqual(['confirmed', null, true]);
    // With its listings checked: counted, and the flag off.
    const w = await gameWish(10_000, true, { name: 'Sun Rover' });
    await night(w.product.id, DAYS[0]!, [offer('b1', 9000)]);
    const x = (await wishView(db, ann, w.watch.id, { now: at(DAYS[0]!) }))!;
    expect([x.trial, x.listingsUnread]).toEqual([{ in: 1, counted: 1 }, false]);
    // Its listings checked and read, nothing found (no row is stored): no trial, but an alert can
    // come the night a copy is found.
    const rare = await gameWish(10_000, true, { name: 'Moon Rover' });
    const y = (await wishView(db, ann, rare.watch.id, { now: at(DAYS[0]!) }))!;
    expect([y.state, y.trial, y.listingsUnread]).toEqual(['confirmed', null, false]);
  });

  it('a copy at 0 is never the cheapest: the real one beside it is', async () => {
    const { watch, product } = await gameWish(10_000);
    await night(product.id, DAYS[0]!, [offer('a0', 0), offer('a1', 11_000)]);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect(v.cheapest).toMatchObject({ source: 'marketa', counted: 11_000 });
  });

  it('the helper leaves out a stored search of another shape; the page loads', async () => {
    await setGameRules(db, true);
    const { watch, product } = await gameWish(10_000);
    await db
      .update(productSources)
      .set({ query: { keywords: 'star rover' } as never })
      .where(eq(productSources.productId, product.id));
    await night(product.id, DAYS[0]!, [offer('a1', 9000)]);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect(v.helper).toEqual([]);
  });

  it('no price, check needed: no trial, the reason given', async () => {
    const { watch } = await gameWish(null, false);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect([v.trial, v.checkWhy]).toEqual([null, 'unchecked']);
  });

  it('the helper: the search as sent, the excluded words, the category link, the cap', async () => {
    await setGameRules(db, true);
    await saveConsolePlugins(db, {
      suggested: [],
      searchSources: ['marketa'],
      categoryUrls: { marketa: 'https://a.test/search?c=TORA_CATEGORY_ID' },
    });
    const { watch, product } = await gameWish(10_000);
    await night(product.id, DAYS[0]!, [offer('a1', 9000, { shipping: 'unknown' })]);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect(v.helper).toEqual([
      {
        source: 'marketa',
        words: ['star rover', 'deluxe'],
        excluded: ['lot', 'broken'],
        categoryId: '123',
        categoryUrl: 'https://a.test/search?c=123',
        cap: 10_000,
        plusShipping: true,
      },
    ]);
  });

  it('the helper with the game rules off: the stored search as it is, no link without a plug-in', async () => {
    const { watch, product } = await gameWish(null);
    await night(product.id, DAYS[0]!, [offer('a1', 9000)]);
    const v = (await wishView(db, ann, watch.id, { now: at(DAYS[0]!) }))!;
    expect(v.helper).toEqual([
      {
        source: 'marketa',
        words: ['star rover'],
        excluded: ['lot'],
        categoryId: null,
        categoryUrl: null,
        cap: null,
        plusShipping: false,
      },
    ]);
  });
});
