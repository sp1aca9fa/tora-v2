import {
  type Db,
  addPurchaseLinks,
  createDb,
  createHolding,
  createUser,
  importRunsOf,
  purchaseLinksOf,
  schema,
  setPurchaseLinkResult,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import {
  type AskClaude,
  type ExtractedRow,
  type ReadCache,
  checkContext,
  checkRow,
  readPurchases,
} from './ai-import';
import { applyAiImport, planAiImport } from './ai-import-plan';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-ai-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const row = (over: Partial<ExtractedRow>): ExtractedRow => ({
  file: 'a.png',
  shop: 'mercari',
  orderId: null,
  title: 'x',
  url: null,
  priceJpy: 1000,
  quantity: 1,
  date: '2026-09-01',
  dateApprox: false,
  status: 'purchased',
  collectible: true,
  productId: null,
  product: null,
  gradedAs: null,
  sealedState: null,
  unsure: null,
  ...over,
});

const card = (name: string, cardNumber: string) => ({
  category: 'tcg' as const,
  kind: 'single' as const,
  name,
  franchise: 'pokemon',
  setName: null,
  setCode: 'SV2a',
  cardNumber,
  rarity: 'SAR',
  platform: null,
  region: 'jp',
});

/** A Claude stand-in: answers per model from a script, records the files it was asked about. */
function scripted(answer: (model: string, prompt: string) => ExtractedRow[]) {
  const asked: { model: string; prompt: string }[] = [];
  const ask: AskClaude = async <T>(o: { model: 'haiku' | 'sonnet'; prompt: string }) => {
    asked.push({ model: o.model, prompt: o.prompt });
    return {
      output: { rows: answer(o.model, o.prompt) } as T,
      costUsd: 0.01,
      tokens: 1000,
      modelName: `claude-${o.model}`,
    };
  };
  return { ask, asked };
}

it('flags rows with code checks, not the model', async () => {
  const { holding, product } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'エリカの招待', cardNumber: '206/165' } },
    { quantity: 1, costTotalJpy: 30000, acquiredAt: '2026-08-01T12:00:00.000+09:00' },
  );
  const ctx = await checkContext(db, userId);
  ctx.unitValue.set(product.id, 30000);
  expect(holding.id).toBeTruthy();
  expect(
    checkRow(
      row({ title: 'エリカの招待 SAR 206/165', productId: product.id, priceJpy: 28000 }),
      ctx,
    ),
  ).toEqual([]);
  expect(
    checkRow(row({ title: 'リーリエ SAR', productId: product.id, priceJpy: 28000 }), ctx),
  ).toEqual(['weak_match']);
  expect(
    checkRow(row({ title: 'エリカの招待 206/165', productId: product.id, priceJpy: 3000 }), ctx),
  ).toEqual(['price_far']);
  expect(checkRow(row({ priceJpy: null, date: null, product: card('X', '1/1') }), ctx)).toEqual([
    'no_price',
    'no_date',
  ]);
  expect(checkRow(row({ product: card('エリカの招待', '206/165') }), ctx)).toEqual([
    'maybe_registered',
  ]);
  // Not imported anyway: no checks.
  expect(checkRow(row({ collectible: false, priceJpy: null }), ctx)).toEqual([]);
});

it('reads with Haiku, has Sonnet read flagged files again, and caches', async () => {
  const ctx = await checkContext(db, userId);
  const { ask, asked } = scripted((model, prompt) =>
    model === 'haiku'
      ? [
          row({ file: 'a.png', title: 'ピカチュウ', product: card('ピカチュウ', '001/030') }),
          row({ file: 'b.png', title: '?', priceJpy: null, product: card('ミュウ', '151/165') }),
        ]
      : prompt.includes('b.png')
        ? [
            row({
              file: 'b.png',
              title: 'ミュウ',
              priceJpy: 5000,
              product: card('ミュウ', '151/165'),
            }),
          ]
        : [],
  );
  let cache: ReadCache | null = null;
  const files = [
    { name: 'a.png', hash: 'h1' },
    { name: 'b.png', hash: 'h2' },
  ];
  const options = {
    sample: 0,
    loadCache: async () => cache,
    saveCache: async (c: ReadCache) => void (cache = structuredClone(c)),
  };
  const read = await readPurchases(ctx, '/tmp', files, ask, options);
  expect(asked.map((a) => a.model)).toEqual(['haiku', 'sonnet']);
  // Sonnet got the first reading and what was wrong with it.
  expect(asked[1]!.prompt).toContain('no_price');
  expect(read.reviewed).toEqual([{ file: 'b.png', why: 'no_price' }]);
  expect(read.rows.map((r) => [r.row.title, r.row.priceJpy, r.flags])).toEqual([
    ['ピカチュウ', 1000, []],
    ['ミュウ', 5000, []],
  ]);

  const again = await readPurchases(ctx, '/tmp', files, ask, options);
  expect(asked).toHaveLength(2);
  expect(again.costUsd).toBe(0);
  expect(again.rows).toHaveLength(2);
});

it('imports new lots, skips what is not a collectible, matches again on a second run, resolves failed links', async () => {
  const { product: erika } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'エリカの招待', cardNumber: '206/165' } },
    { quantity: 1, costTotalJpy: 30000, acquiredAt: '2026-08-01T12:00:00.000+09:00' },
  );
  await addPurchaseLinks(db, userId, ['https://jp.mercari.com/item/m11111111111']);
  const [link] = await purchaseLinksOf(db, userId);
  await setPurchaseLinkResult(db, link!.id, {
    status: 'failed',
    message: 'deleted',
    holdingId: null,
    importRunId: null,
  });

  const ctx = await checkContext(db, userId);
  const rows = [
    // Mercari, no ID, a new card.
    row({ title: 'ミミッキュ CHR', priceJpy: 6000, product: card('ミミッキュ', '075/071') }),
    // Mercari, the deleted listing of a failed link, another copy of a card the user has.
    row({
      title: 'エリカの招待 SAR 206/165',
      orderId: 'm11111111111',
      priceJpy: 29000,
      productId: erika.id,
    }),
    // Amazon: two items in one order, one of them not a collectible.
    row({
      file: 'b.png',
      shop: 'Amazon.co.jp',
      orderId: '503-1234567-1234567',
      title: 'Nintendo Switch 2',
      priceJpy: 49980,
      product: {
        ...card('Nintendo Switch 2', ''),
        category: 'game',
        kind: 'console',
        cardNumber: null,
        setCode: null,
        rarity: null,
        franchise: null,
        platform: 'switch2',
      },
    }),
    row({
      file: 'b.png',
      shop: 'Amazon.co.jp',
      orderId: '503-1234567-1234567',
      title: '洗剤',
      collectible: false,
    }),
    row({
      file: 'b.png',
      shop: 'Amazon.co.jp',
      orderId: '503-1234567-1234567',
      title: 'マリオカート ワールド',
      priceJpy: 8000,
      product: {
        ...card('マリオカート ワールド', ''),
        category: 'game',
        kind: 'software',
        cardNumber: null,
        setCode: null,
        rarity: null,
        franchise: null,
        platform: 'switch2',
      },
    }),
  ];
  const read = {
    rows: rows.map((r) => ({ row: r, flags: checkRow(r, ctx), reviewedBy: null })),
    files: 2,
    reviewed: [],
    calls: [],
    costUsd: 0,
  };
  const fallback = () => '2026-09-01T12:00:00.000+09:00';
  const plan = await planAiImport(db, userId, read, ctx.products, fallback);
  expect(plan.skipped.map((s) => [s.row.title, s.why])).toEqual([['洗剤', 'not_collectible']]);
  const outcome = await applyAiImport(db, userId, plan, 'test');
  expect(outcome.counts).toMatchObject({ imported: 4, skipped: 1 });
  expect(outcome.linksResolved).toBe(1);

  const lots = await db
    .select()
    .from(schema.holdings)
    .where(eq(schema.holdings.importRunId, outcome.runId));
  const by = (t: number) => lots.find((l) => l.costTotalJpy === t)!;
  expect(by(6000)).toMatchObject({ orderId: null, acquiredFrom: 'Mercari', reviewPending: true });
  expect(by(29000)).toMatchObject({ orderId: 'm11111111111', productId: erika.id });
  expect(by(49980)).toMatchObject({ orderId: '503-1234567-1234567#1', acquiredFrom: 'Amazon' });
  expect(by(8000).orderId).toBe('503-1234567-1234567#2');
  expect(by(6000).reviewReason).toContain('new_product');
  const [run] = await importRunsOf(db, userId);
  expect(run).toMatchObject({ method: 'claude', note: 'test' });

  // The same files again: nothing new (rows without an ID are found by item, price and date).
  const ctx2 = await checkContext(db, userId);
  const plan2 = await planAiImport(db, userId, read, ctx2.products, fallback);
  expect(plan2.shops.flatMap((s) => s.plan.map((e) => e.type)).sort()).toEqual([
    'duplicate',
    'duplicate',
    'duplicate',
    'likely',
  ]);
  const second = await applyAiImport(db, userId, plan2, 'again');
  expect(second.counts.imported ?? 0).toBe(0);
  expect(await db.select().from(schema.holdings)).toHaveLength(5);
});
