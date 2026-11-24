import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlockedError, type CollectorContext, PoliteHttp, runCollector } from '@tora/collector-sdk';
import {
  type Db,
  type Product,
  type ProductSource,
  addWatch,
  askChecks,
  chooseAsk,
  createDb,
  createProduct,
  createUser,
  currentSupply,
  linkSource,
  listProductSources,
  lowestAsk,
  mergeFacts,
  saveSourceFacts,
  saveSourceInfos,
  schema,
  searchListingRows,
  sendWatchAlerts,
  sourceFacts,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maskClientId,
  readAnswer,
  supplyRow,
  validJan,
  yahooShopping,
} from '../src/yahoo-shopping';

// Made-up data only: a Client ID, a JAN in the in-store range (20-29: never a real product's) with a
// valid check digit, another such JAN, and the shops of the fixture.
const CLIENT_ID = 'made-up-client-id-0123456789';
const JAN = '2012345678903';
const OTHER_JAN = '2098765432103';
const newAnswer = readFileSync(join(__dirname, 'fixtures', 'yahoo-shopping-new.json'), 'utf8');

const hit = (over: Record<string, unknown> = {}) => ({
  name: 'Hero Quest Alpha edition (used)',
  url: 'https://store.example/shop-d/item-9.html',
  inStock: true,
  code: 'shop-d_item-9',
  condition: 'used',
  price: 2800,
  shipping: { code: 1, name: '' },
  janCode: JAN,
  seller: { sellerId: 'shop-d', name: 'Shop D' },
  ...over,
});
const answer = (hits: unknown[], total = hits.length) =>
  JSON.stringify({
    totalResultsAvailable: total,
    totalResultsReturned: hits.length,
    // The sample's spelling (the table's is `firstResultsPosition`, in the new-copies fixture).
    firstResultPosition: 1,
    hits,
  });
const usedAnswer = answer([
  hit({ code: 'shop-e_item-4', price: 3100, seller: { sellerId: 'shop-e' } }),
  hit(),
]);

const game = {
  id: 'G1',
  category: 'game',
  kind: 'software',
  name: 'Hero Quest',
  region: 'jp',
} as Product;
const link = { id: 'L1', externalId: JAN } as ProductSource;

/** A context whose requests answer from `answers` by condition; every asked URL is kept. */
function fakeCtx(answers: { new: string; used: string }) {
  const asked: string[] = [];
  const logs: string[] = [];
  const ctx = {
    http: {
      text: async (url: string, headers: Record<string, string>) => {
        asked.push(url);
        expect(headers.Accept).toBe('application/json');
        return new URL(url).searchParams.get('condition') === 'new' ? answers.new : answers.used;
      },
    } as unknown as PoliteHttp,
    now: new Date('2026-11-24T03:00:00Z'),
    log: (m: string) => logs.push(m),
    save: async () => 0,
    // The item's code now, as its identity shop stored it: the link's.
    productCode: async () => JAN,
  } satisfies CollectorContext;
  return { ctx, asked, logs };
}

/** A real polite client whose fetch answers `respond`; counts the requests sent. */
function politeCtx(respond: () => Response) {
  const fetchImpl = vi.fn(async () => respond());
  const http = new PoliteHttp({
    minDelayMs: 0,
    maxDelayMs: 0,
    retries: 0,
    sleep: async () => {},
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const ctx: CollectorContext = {
    http,
    now: new Date(0),
    log: () => {},
    save: async () => 0,
    productCode: async () => JAN,
  };
  return { ctx, fetchImpl };
}

async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a failure');
}

describe('the plug-in', () => {
  it('checks the JAN check digit, 13 digits only (a short code is never sent)', () => {
    expect(validJan(JAN)).toBe(true);
    expect(validJan(OTHER_JAN)).toBe(true);
    expect(validJan('2012345678904')).toBe(false);
    expect(validJan('96385074')).toBe(false);
    expect(validJan('96385075')).toBe(false);
    expect(validJan('201234567890')).toBe(false);
    expect(validJan('2012345678903&x=1')).toBe(false);
  });

  it('games of the home market only', () => {
    const p = yahooShopping(CLIENT_ID);
    expect(p.supports(game)).toBe(true);
    expect(p.supports({ ...game, region: null } as Product)).toBe(true);
    expect(p.supports({ ...game, region: 'na' } as Product)).toBe(false);
    expect(p.supports({ ...game, kind: 'amiibo' } as Product)).toBe(false);
    expect(p.supports({ ...game, category: 'tcg', kind: 'booster_box' } as Product)).toBe(false);
  });

  it('links by the stored JAN with no request, and skips an item without one', async () => {
    const p = yahooShopping(CLIENT_ID);
    const { ctx, asked } = fakeCtx({ new: '', used: '' });
    expect(await p.findCandidates(game, { ...ctx, productCode: async () => JAN })).toEqual([
      { externalId: JAN, title: `JAN ${JAN}`, url: null, score: 1 },
    ]);
    expect(await p.findCandidates(game, { ...ctx, productCode: async () => null })).toEqual([]);
    expect(await p.findCandidates(game, { ...ctx, productCode: undefined })).toEqual([]);
    // A broken code is no code: never a search by name.
    expect(
      await p.findCandidates(game, { ...ctx, productCode: async () => '2012345678904' }),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('asks twice, new and used in stock, cheapest first; rows new and used apart', async () => {
    const { ctx, asked } = fakeCtx({ new: newAnswer, used: usedAnswer });
    const result = await yahooShopping(CLIENT_ID).collect(link, game, ctx);
    expect(asked).toHaveLength(2);
    const params = asked.map((u) => Object.fromEntries(new URL(u).searchParams));
    expect(asked.every((u) => u.startsWith('https://shopping.yahooapis.jp/'))).toBe(true);
    expect(params).toEqual(
      ['new', 'used'].map((condition) => ({
        appid: CLIENT_ID,
        jan_code: JAN,
        condition,
        in_stock: 'true',
        sort: '+price',
        results: '20',
      })),
    );
    const [fresh, used] = result.supply!;
    expect(fresh).toMatchObject({
      bucket: 'cond:new',
      lowestAsk: 4500,
      currency: 'JPY',
      listings: 3,
      url: 'https://store.example/shop-a/item-1.html',
    });
    expect(fresh!.offers!.map((o) => [o.ref, o.price, o.seller, o.shipping])).toEqual([
      ['shop-a_item-1', 4500, 'shop-a', 'unknown'],
      ['shop-b_item-2', 4980, 'shop-b', 'included'],
      ['shop-c_item-3', 5200, 'shop-c', 'unknown'],
    ]);
    expect(fresh!.offers![0]).toEqual({
      ref: 'shop-a_item-1',
      title: 'Hero Quest Alpha edition',
      url: 'https://store.example/shop-a/item-1.html',
      price: 4500,
      currency: 'JPY',
      seller: 'shop-a',
      category: null,
      shippingPayerId: null,
      shipping: 'unknown',
    });
    // Used copies: a bucket no wish or holding has (no condition grade from the API), shown apart.
    expect(used).toMatchObject({ bucket: 'cond:used', lowestAsk: 2800, listings: 2 });
    expect(used!.offers!.map((o) => o.ref)).toEqual(['shop-d_item-9', 'shop-e_item-4']);
    expect(result.facts).toEqual({
      releaseDate: null,
      listPrice: null,
      jan: null,
      maker: null,
      soldNew: true,
    });
    expect(result.found).toBeUndefined();
  });

  it('shipping: free (2) is included; not set (1), conditional (3) or missing is unknown', () => {
    const s = readAnswer(
      answer([
        hit({ code: 'a', shipping: { code: 1 } }),
        hit({ code: 'b', shipping: { code: 2 } }),
        hit({ code: 'c', shipping: { code: 3 } }),
        hit({ code: 'd', shipping: { code: '2' } }),
        hit({ code: 'e', shipping: undefined }),
      ]),
      JAN,
      'used',
    );
    expect(s.kept.map((l) => [l.ref, l.shipping])).toEqual([
      ['a', 'unknown'],
      ['b', 'included'],
      ['c', 'unknown'],
      ['d', 'included'],
      ['e', 'unknown'],
    ]);
  });

  it("drops another code's hits, an empty code, out of stock, the other condition, no price", () => {
    const s = readAnswer(
      answer([
        hit({ code: 'other', janCode: OTHER_JAN, price: 100 }),
        hit({ code: 'empty', janCode: '', price: 200 }),
        hit({ code: 'gone', inStock: false, price: 300 }),
        hit({ code: 'new', condition: 'new', price: 400 }),
        hit({ code: 'free', price: 0 }),
        hit({ code: 'odd', price: 'cheap' }),
        hit({ code: undefined, price: 500 }),
        hit({ code: 'ok', price: 2800 }),
      ]),
      JAN,
      'used',
    );
    expect(s.kept.map((l) => l.ref)).toEqual(['ok']);
    // Every match was returned: the count is the kept ones.
    expect(supplyRow(null, s)).toMatchObject({ lowestAsk: 2800, listings: 1 });
    // Some matches past the hits returned, and some returned were not the item: not known.
    expect(supplyRow(null, { ...s, total: 40 }).listings).toBeNull();
  });

  it('no new copy in stock: no ask, 0 listings, no longer sold new', async () => {
    const { ctx } = fakeCtx({ new: answer([]), used: answer([]) });
    const result = await yahooShopping(CLIENT_ID).collect(link, game, ctx);
    expect(result.supply).toEqual([
      expect.objectContaining({ bucket: 'cond:new', lowestAsk: null, listings: 0, url: null }),
      expect.objectContaining({ bucket: 'cond:used', lowestAsk: null, listings: 0, url: null }),
    ]);
    expect(result.facts?.soldNew).toBe(false);
  });

  it("only another code's copies, with more past the page: not known, so no fact", async () => {
    const { ctx } = fakeCtx({
      new: answer([hit({ condition: 'new', janCode: OTHER_JAN })], 30),
      used: answer([]),
    });
    const result = await yahooShopping(CLIENT_ID).collect(link, game, ctx);
    expect(result.supply![0]).toMatchObject({ lowestAsk: null, listings: null });
    expect(result.facts).toBeUndefined();
  });

  it("stores nothing when the item's code is not the link's now, or there is none (no request)", async () => {
    for (const [code, cause] of [
      [OTHER_JAN, /product code is now 2098765432103, not the link's 2012345678903/],
      [null, /no product code from its identity shop now/],
      [undefined, /no product code from its identity shop now/],
    ] as const) {
      const { ctx, asked } = fakeCtx({ new: newAnswer, used: usedAnswer });
      const e = await failure(() =>
        yahooShopping(CLIENT_ID).collect(link, game, {
          ...ctx,
          productCode: code === undefined ? undefined : async () => code,
        }),
      );
      // A plain error: never "gone" (the link stays) and never a refusal (the run goes on).
      expect(e).not.toBeInstanceOf(BlockedError);
      expect(e.name).toBe('Error');
      expect(e.message).toMatch(cause);
      expect(asked).toEqual([]);
    }
  });

  it('reads either spelling of the first position and ignores unknown fields', () => {
    expect(readAnswer(newAnswer, JAN, 'new').kept).toHaveLength(3);
    expect(readAnswer(answer([hit()]), JAN, 'used').kept).toHaveLength(1);
  });
});

describe('refusals and the Client ID', () => {
  const refusals: [string, () => Response][] = [
    ['HTTP 429', () => new Response('Too Many Requests', { status: 429 })],
    ['HTTP 403', () => new Response('Your Request was Forbidden', { status: 403 })],
    [
      'HTTP 500 (the limited state, an HTML page)',
      () => new Response('<html><body>Service unavailable</body></html>', { status: 500 }),
    ],
    ['a body that is not JSON', () => new Response('<html>maintenance</html>', { status: 200 })],
  ];
  for (const [name, respond] of refusals)
    it(`${name}: a refusal, asked once, the Client ID nowhere in it`, async () => {
      const { ctx, fetchImpl } = politeCtx(respond);
      const e = await failure(() => yahooShopping(CLIENT_ID).collect(link, game, ctx));
      expect(e).toBeInstanceOf(BlockedError);
      // Never retried around, and the second search is not sent.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(`${e.message} ${(e as BlockedError).body}`).not.toContain(CLIENT_ID);
      expect(e.message).not.toContain('appid=made');
    });

  it('a scope error says the application lacks the shopping API (403 body or JSON answer)', async () => {
    const scope = { error: 'insufficient_scope', error_description: 'insufficient scope' };
    for (const respond of [
      () =>
        new Response(JSON.stringify(scope), {
          status: 403,
          headers: { 'WWW-Authenticate': 'Bearer error="insufficient_scope"' },
        }),
      () => Response.json(scope),
    ]) {
      const { ctx } = politeCtx(respond);
      const e = await failure(() => yahooShopping(CLIENT_ID).collect(link, game, ctx));
      expect(e).toBeInstanceOf(BlockedError);
      expect(e.message).toMatch(/lacks the shopping API/);
    }
  });

  it('a 401 or 400 is a refusal; another status and a timeout name no Client ID; a 404 is not "gone"', async () => {
    for (const [status, blocked] of [
      [401, true],
      [400, true],
      [404, false],
    ] as const) {
      const { ctx } = politeCtx(() => new Response('', { status }));
      const e = await failure(() => yahooShopping(CLIENT_ID).collect(link, game, ctx));
      expect(e instanceof BlockedError).toBe(blocked);
      expect(e.name).not.toBe('HttpError');
      expect(e.message).not.toContain(CLIENT_ID);
    }
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const http = new PoliteHttp({
      minDelayMs: 0,
      maxDelayMs: 0,
      retries: 0,
      sleep: async () => {},
      fetchImpl: (async () => {
        throw timeout;
      }) as unknown as typeof fetch,
    });
    const e = await failure(() =>
      yahooShopping(CLIENT_ID).collect(link, game, {
        http,
        now: new Date(0),
        log: () => {},
        save: async () => 0,
        productCode: async () => JAN,
      }),
    );
    expect(e.message).toMatch(/no answer within/);
    expect(e.message).not.toContain(CLIENT_ID);
  });

  it('a 400 or a JSON error answer stops the run, asked once, the Client ID nowhere in it', async () => {
    for (const respond of [
      () => new Response(`{"Error":{"Message":"appid=${CLIENT_ID} invalid"}}`, { status: 400 }),
      () => Response.json({ Error: { Message: `invalid application ${CLIENT_ID}` } }),
      () => Response.json({ error: 'invalid_client' }),
    ]) {
      const { ctx, fetchImpl } = politeCtx(respond);
      const e = await failure(() => yahooShopping(CLIENT_ID).collect(link, game, ctx));
      expect(e).toBeInstanceOf(BlockedError);
      expect(e.message).not.toMatch(/lacks the shopping API/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(`${e.message} ${(e as BlockedError).body}`).not.toContain(CLIENT_ID);
    }
  });

  it('masks the parameter and the value, raw or encoded', () => {
    const odd = 'id+with/odd=chars';
    expect(
      maskClientId(
        `HTTP 403 for https://x/?appid=${encodeURIComponent(odd)}&jan_code=1 (${odd})`,
        odd,
      ),
    ).toBe('HTTP 403 for https://x/?appid=***&jan_code=1 (***)');
  });
});

describe('the stored fact', () => {
  const none = { releaseDate: null, listPrice: null, jan: null, maker: null };
  it('is kept until read again, and absent for sources that never read it', () => {
    const shop = mergeFacts(null, { ...none, jan: JAN }, 'a');
    expect('soldNew' in shop).toBe(false);
    const sold = mergeFacts(shop, { ...none, soldNew: false }, 'b');
    expect(sold).toMatchObject({ jan: JAN, soldNew: false });
    // A night that could not tell keeps the last answer.
    expect(mergeFacts(sold, none, 'c').soldNew).toBe(false);
    expect(mergeFacts(sold, { ...none, soldNew: true }, 'd').soldNew).toBe(true);
    expect(sourceFacts({ soldNew: 'yes' })).not.toHaveProperty('soldNew');
  });
});

describe('registration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('without its Client ID: not in the collectors or the sources, as before', async () => {
    vi.stubEnv('YAHOO_SHOPPING_CLIENT_ID', '');
    vi.resetModules();
    const off = await import('../src/index');
    expect(off.collectors.map((c) => c.source)).not.toContain('yahoo_shopping');
    expect(off.sources.map((s) => s.key)).not.toContain('yahoo_shopping');
    vi.stubEnv('YAHOO_SHOPPING_CLIENT_ID', CLIENT_ID);
    vi.resetModules();
    const on = await import('../src/index');
    // Only this plug-in is added: the others are as they were.
    expect(on.collectors.map((c) => c.source)).toEqual([
      ...off.collectors.map((c) => c.source),
      'yahoo_shopping',
    ]);
    expect(on.sources.map((s) => s.key)).toEqual([
      ...off.sources.map((s) => s.key),
      'yahoo_shopping',
    ]);
    const info = on.sources.find((s) => s.key === 'yahoo_shopping')!;
    expect(info).toMatchObject({
      label: 'Yahoo! Shopping',
      market: 'jp',
      currency: 'JPY',
      credit: {
        text: 'Web Services by Yahoo! JAPAN',
        url: 'https://developer.yahoo.co.jp/sitemap/',
      },
    });
    expect(info.noAi).toBeUndefined();
    // The Client ID is in no description the plug-in package hands out (saved to the database).
    expect(JSON.stringify(on.sources)).not.toContain(CLIENT_ID);
    expect(JSON.stringify(on.collectors)).not.toContain(CLIENT_ID);
  });
});

describe('in a nightly run', () => {
  let db: Db;
  let userId: string;
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-yshop-'));
    db = createDb({ url: `file:${join(dir, 'test.db')}` });
    await migrateDb(db);
    userId = (
      await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
    ).user.id;
    await saveSourceInfos(db, [
      { key: 'shop', label: 'Shop', market: 'jp', currency: 'JPY', identity: ['game'] },
      { key: 'yahoo_shopping', label: 'Yahoo! Shopping', market: 'jp', currency: 'JPY' },
    ]);
    return () => rm(dir, { recursive: true, force: true });
  });

  async function wished(name: string, jan: string | null, wish: { targetPriceBase?: number } = {}) {
    const p = await createProduct(db, userId, {
      category: 'game',
      kind: 'software',
      name,
      platform: 'Alpha',
      region: 'jp',
    });
    await addWatch(db, userId, { productId: p.id }, wish);
    const shop = await linkSource(db, p.id, { source: 'shop', externalId: `S-${p.id}` });
    if (jan)
      await saveSourceFacts(
        db,
        { id: shop.id, productId: p.id, facts: null },
        { releaseDate: null, listPrice: null, jan, maker: null },
        '2026-11-23T03:00:00.000+09:00',
        '2026-11-23',
      );
    return p;
  }

  it('links by the JAN, stores both rows with their copies and the fact; nothing logs the Client ID', async () => {
    const withJan = await wished('Hero Quest', JAN);
    const without = await wished('Other Quest', null);
    const card = await createProduct(db, userId, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'BP BOX',
    });
    await addWatch(db, userId, { productId: card.id }, {});
    const urls: string[] = [];
    const logs: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(
        new URL(url).searchParams.get('condition') === 'new' ? newAnswer : usedAnswer,
      );
    }) as unknown as typeof fetch;
    const summary = await runCollector(db, yahooShopping(CLIENT_ID), {
      log: (m) => logs.push(m),
      http: { minDelayMs: 0, maxDelayMs: 0, fetchImpl, sleep: async () => {} },
      now: new Date('2026-11-24T03:00:00.000Z'),
    });
    expect(summary).toMatchObject({ status: 'ok', requests: 2, candidates: 1, errors: [] });
    expect(urls.every((u) => new URL(u).host === 'shopping.yahooapis.jp')).toBe(true);
    const links = await listProductSources(db, withJan.id);
    expect(links.find((l) => l.source === 'yahoo_shopping')).toMatchObject({
      externalId: JAN,
      active: true,
    });
    for (const p of [without, card])
      expect((await listProductSources(db, p.id)).some((l) => l.source === 'yahoo_shopping')).toBe(
        false,
      );
    const rows = await db.select().from(schema.supply);
    expect(rows.map((r) => [r.productId, r.bucket, r.lowestAskOriginal, r.listings])).toEqual([
      [withJan.id, 'cond:new', 4500, 3],
      [withJan.id, 'cond:used', 2800, 2],
    ]);
    expect(rows[0]!.offers!.map((o) => [o.ref, o.shipping])).toEqual([
      ['shop-a_item-1', 'unknown'],
      ['shop-b_item-2', 'included'],
      ['shop-c_item-3', 'unknown'],
    ]);
    const mine = links.find((l) => l.source === 'yahoo_shopping')!;
    const stored = (await db.select().from(schema.productSources)).find((l) => l.id === mine.id);
    expect(sourceFacts(stored!.facts)).toMatchObject({ soldNew: true, jan: null });
    // No price observations: asks only.
    expect(await db.select().from(schema.priceObservations)).toEqual([]);
    const everything = JSON.stringify([logs, rows, await db.select().from(schema.collectorRuns)]);
    expect(everything).not.toContain(CLIENT_ID);
  });

  it("the used row is never an any-condition wish's ask: no target alert, no ask, not listed", async () => {
    // A game wish (any condition: bucket '') with a target above the used ask (2,800) and under
    // the new one (4,500).
    const p = await wished('Hero Quest', JAN, { targetPriceBase: 3_000 });
    const now = new Date('2026-11-24T03:00:00.000Z');
    const fetchImpl = (async (url: string) =>
      new Response(
        new URL(url).searchParams.get('condition') === 'new' ? newAnswer : usedAnswer,
      )) as unknown as typeof fetch;
    await runCollector(db, yahooShopping(CLIENT_ID), {
      log: () => {},
      http: { minDelayMs: 0, maxDelayMs: 0, fetchImpl, sleep: async () => {} },
      now,
    });
    const [watch] = await db.select().from(schema.watches);
    expect(watch!.bucket).toBe('');
    const rows = (await currentSupply(db, [p.id], now)).get(p.id) ?? [];
    expect(rows.map((r) => [r.bucket, r.lowestAskBase])).toEqual([
      ['cond:new', 4500],
      ['cond:used', 2800],
    ]);
    // The buy page's and the alert's readers, for the wish's condition.
    const checks = await askChecks(db, [p]);
    expect(lowestAsk(checks.usable(rows), '')).toBeNull();
    expect(chooseAsk(rows, '', (r) => checks.status(r))).toEqual({ ask: null, unverified: null });
    expect(searchListingRows(rows, null)).toEqual([]);
    expect(
      await sendWatchAlerts(db, { secret: 'made-up', texts: () => ({}) as never }, now),
    ).toEqual({ sent: 0, alerts: 0 });
    const [after] = await db.select().from(schema.watches);
    expect((after!.alertState as { target?: unknown } | null)?.target).toBeUndefined();
  });

  it('a refusal stops the run; its stored error names no Client ID', async () => {
    await wished('Hero Quest', JAN);
    const logs: string[] = [];
    const fetchImpl = (async () =>
      new Response('Your Request was Forbidden', { status: 403 })) as unknown as typeof fetch;
    const summary = await runCollector(db, yahooShopping(CLIENT_ID), {
      log: (m) => logs.push(m),
      http: { minDelayMs: 0, maxDelayMs: 0, fetchImpl, sleep: async () => {} },
      now: new Date('2026-11-24T03:00:00.000Z'),
    });
    expect(summary.status).toBe('blocked');
    expect(summary.requests).toBe(1);
    const runs = await db.select().from(schema.collectorRuns);
    expect(JSON.stringify([logs, summary, runs])).not.toContain(CLIENT_ID);
    expect(await db.select().from(schema.supply)).toEqual([]);
  });
});
