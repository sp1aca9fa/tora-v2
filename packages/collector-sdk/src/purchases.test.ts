import {
  type Db,
  createDb,
  createHolding,
  createUser,
  linkSource,
  markOrderCancelled,
  listProductSources,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readMbox } from './mbox';
import { type Decision, applyImport, gatherReceipts, planImport, reviewFlags } from './purchases';
import type { PurchaseImporter, PurchaseReceipt, ReceiptMail } from './types';

let dir: string;
let db: Db;
let userId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tora-purchases-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

describe('readMbox', () => {
  it('splits messages, decodes them and filters on the header', async () => {
    const subject = Buffer.from('ご購入ありがとうございます').toString('base64');
    const mbox = [
      'From 1@xxx Mon Mar 04 12:34:56 +0000 2026',
      'From: Shop <no-reply@shop.example>',
      `Subject: =?UTF-8?B?${subject}?=`,
      'Date: Mon, 04 Mar 2026 21:34:56 +0900',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'line one',
      '>From the shop',
      '',
      'From 2@xxx Tue Mar 05 00:00:00 +0000 2026',
      'From: other@else.example',
      'Subject: hello',
      '',
      'body',
      '',
    ].join('\n');
    const path = join(dir, 'mail.mbox');
    await writeFile(path, mbox);
    const all = [];
    for await (const m of readMbox(path)) all.push(m);
    expect(all.map((m) => m.subject)).toEqual(['ご購入ありがとうございます', 'hello']);
    expect(all[0]!.text).toContain('From the shop');
    const shop = [];
    for await (const m of readMbox(path, (h) => /shop\.example/.test(h))) shop.push(m);
    expect(shop).toHaveLength(1);
  });
});

const receipt = (orderId: string, over: Partial<PurchaseReceipt> = {}): PurchaseReceipt => ({
  orderId,
  orderedAt: '2026-03-04T21:00:00.000+09:00',
  title: `Item ${orderId}`,
  quantity: 1,
  totalJpy: 6000,
  itemPriceJpy: 5500,
  listing: { externalId: `L${orderId}`, url: `https://shop.example/${orderId}` },
  ...over,
});

const importer: PurchaseImporter = {
  source: 'snkrdunk',
  label: 'SNKRDUNK',
  matchesHeader: () => true,
  parse: () => null,
  productFor: (r) =>
    r.title.includes('???') ? null : { category: 'tcg', kind: 'booster_box', name: r.title },
  holdingFor: () => ({ packagingState: 'sealed_shrink' }),
};

const box = (name: string) =>
  ({ product: { category: 'tcg', kind: 'booster_box', name } }) as const;
const holdingInput = (over: Record<string, unknown> = {}) => ({
  quantity: 1,
  costTotalJpy: 6000,
  acquiredAt: '2026-03-04T00:00:00.000+09:00',
  acquisitionType: 'purchase' as const,
  ...over,
});

describe('purchase import', () => {
  it('plans, asks only where data disagrees, and re-running adds nothing', async () => {
    await createHolding(
      db,
      userId,
      box('Item 100'),
      holdingInput({ acquiredFrom: 'SNKRDUNK', orderId: '100' }),
    );
    const conflict = await createHolding(
      db,
      userId,
      box('Item 101'),
      holdingInput({ acquiredFrom: 'スニダン', orderId: '101', costTotalJpy: 9999 }),
    );
    const manual = await createHolding(
      db,
      userId,
      box('Battle Partners BOX'),
      holdingInput({ acquiredAt: '2026-03-06T00:00:00.000+09:00', costTotalJpy: 5500 }),
    );
    await createHolding(
      db,
      userId,
      box('Item 104'),
      holdingInput({ acquiredFrom: 'SNKRDUNK', orderId: '104' }),
    );
    const linked = await createHolding(
      db,
      userId,
      box('Linked product'),
      holdingInput({ acquiredFrom: 'Shop' }),
    );
    await linkSource(db, linked.product.id, { source: 'snkrdunk', externalId: 'L106' });
    const titled = await createHolding(
      db,
      userId,
      box('Titled'),
      holdingInput({ costTotalJpy: 1 }),
    );
    await linkSource(db, titled.product.id, {
      source: 'snkrdunk',
      externalId: 'X9',
      title: 'Listing  Title &',
    });

    const mails: ReceiptMail[] = [
      { kind: 'purchase', receipt: receipt('100') },
      { kind: 'purchase', receipt: receipt('100') },
      { kind: 'purchase', receipt: receipt('101') },
      {
        kind: 'purchase',
        receipt: receipt('102', { title: 'ポケモン Battle Partners BOX シュリンク付き' }),
      },
      { kind: 'purchase', receipt: receipt('103') },
      { kind: 'cancel', orderId: '103' },
      { kind: 'purchase', receipt: receipt('104') },
      { kind: 'cancel', orderId: '104' },
      { kind: 'purchase', receipt: receipt('105', { totalJpy: 7000 }) },
      { kind: 'purchase', receipt: receipt('106', { totalJpy: 1234 }) },
      { kind: 'purchase', receipt: receipt('107', { title: '???', listing: null }) },
      { kind: 'purchase', receipt: receipt('108', { title: 'Listing Title &', listing: null }) },
      { kind: 'unreadable', subject: 'odd', reason: 'no price' },
    ];
    const gathered = gatherReceipts(mails);
    expect(gathered.receipts).toHaveLength(9);
    expect(gathered.unreadable).toHaveLength(1);

    const plan = await planImport(db, userId, importer, gathered);
    const types = Object.fromEntries(plan.map((e) => [e.receipt.orderId, e.type]));
    expect(types).toEqual({
      '100': 'duplicate',
      '101': 'conflict',
      '102': 'likely',
      '103': 'cancelled',
      '104': 'cancelledRegistered',
      '105': 'new',
      '106': 'new',
      '107': 'unclassified',
      '108': 'new',
    });
    const c = plan.find((e) => e.type === 'conflict');
    expect(c?.type === 'conflict' && c.diffs).toEqual([
      { field: 'cost', existing: 9999, imported: 6000 },
    ]);

    const decisions = new Map<string, Decision>([
      ['101', 'imported'],
      ['102', 'same'],
    ]);
    const outcome = await applyImport(db, userId, importer, plan, decisions);
    expect(outcome).toEqual({ created: 3, updated: 1, attached: 1, flagged: 0, failed: [] });

    const rows = await db.select().from(schema.holdings).where(eq(schema.holdings.userId, userId));
    const byId = new Map(rows.map((h) => [h.id, h]));
    expect(byId.get(conflict.holding.id)?.costTotalJpy).toBe(6000);
    expect(byId.get(manual.holding.id)).toMatchObject({
      orderSource: 'snkrdunk',
      orderId: '102',
      acquiredFrom: 'SNKRDUNK',
    });
    const created105 = rows.find((h) => h.orderId === '105')!;
    expect(created105).toMatchObject({
      costTotalJpy: 7000,
      acquiredFrom: 'SNKRDUNK',
      orderSource: 'snkrdunk',
      packagingState: 'sealed_shrink',
      reviewPending: true,
    });
    expect((await listProductSources(db, created105.productId)).map((s) => s.externalId)).toEqual([
      'L105',
    ]);
    expect(rows.find((h) => h.orderId === '106')?.productId).toBe(linked.product.id);
    expect(rows.find((h) => h.orderId === '108')?.productId).toBe(titled.product.id);
    // Cancelled-but-registered entries stay.
    expect(rows.some((h) => h.orderId === '104')).toBe(true);
    expect(rows.some((h) => h.orderId === '103')).toBe(false);

    const again = await planImport(db, userId, importer, gathered);
    expect(
      again.filter((e) => e.type === 'new' || e.type === 'conflict' || e.type === 'likely'),
    ).toEqual([]);
  });

  it('creates a product bought twice in one run once', async () => {
    const twice = gatherReceipts([
      { kind: 'purchase', receipt: receipt('300', { title: 'Same', listing: null }) },
      { kind: 'purchase', receipt: receipt('301', { title: 'Same', listing: null }) },
    ]);
    const plan = await planImport(db, userId, importer, twice);
    await applyImport(db, userId, importer, plan, new Map());
    const rows = await db.select().from(schema.holdings);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.productId).toBe(rows[1]!.productId);
  });

  it('reuses a product with the same name instead of creating it twice', async () => {
    const existing = await createHolding(
      db,
      userId,
      box('Item 200'),
      holdingInput({ costTotalJpy: 1 }),
    );
    const plan = await planImport(
      db,
      userId,
      importer,
      gatherReceipts([{ kind: 'purchase', receipt: receipt('200') }]),
    );
    expect(plan[0]).toMatchObject({ type: 'new', ref: { existing: { id: existing.product.id } } });
  });
});

describe('review flags', () => {
  const at = (day: string) => `2026-${day}T12:00:00.000+09:00`;
  const box = (id: string, day: string) =>
    ({
      kind: 'purchase',
      receipt: receipt(id, { title: 'Box', orderedAt: at(day), listing: null }),
    }) as const;

  it('flags deadline notices, and older purchases of items with missing deliveries', () => {
    const gathered = gatherReceipts([
      box('1', '08-01'),
      box('2', '08-05'),
      box('3', '08-10'),
      box('4', '10-01'),
      { kind: 'delivered', title: 'Box', quantity: 1, at: at('08-20') },
      { kind: 'notice', orderId: '4', reason: 'deadline_missed' },
    ]);
    const { flags, gaps } = reviewFlags(gathered, new Set(), at('10-10'));
    // Three older purchases, one delivery: all three flagged; the recent one may be on its way.
    expect(gaps).toEqual([{ title: 'Box', purchases: 4, delivered: 1, recent: 1 }]);
    expect([...flags]).toEqual([
      ['4', ['deadline_missed']],
      ['1', ['no_delivery']],
      ['2', ['no_delivery']],
      ['3', ['no_delivery']],
    ]);
  });

  it('flags new and existing lots, and skips orders cancelled in the app', async () => {
    const existing = await createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'booster_box', name: 'Box' } },
      holdingInput({ acquiredFrom: 'SNKRDUNK', orderId: '1', acquiredAt: at('08-01') }),
    );
    const gone = await createHolding(
      db,
      userId,
      { productId: existing.product.id },
      holdingInput({ acquiredFrom: 'SNKRDUNK', orderId: '3', acquiredAt: at('08-10') }),
    );
    await markOrderCancelled(db, userId, gone.holding.id);
    const gathered = gatherReceipts([
      box('1', '08-01'),
      box('2', '08-05'),
      box('3', '08-10'),
      { kind: 'delivered', title: 'Box', quantity: 1, at: at('08-20') },
    ]);
    const plan = await planImport(db, userId, importer, gathered, { exportedAt: at('10-10') });
    expect(plan.map((e) => [e.receipt.orderId, e.type, e.flags])).toEqual([
      ['1', 'duplicate', ['no_delivery']],
      ['2', 'new', ['no_delivery']],
      ['3', 'cancelledInApp', undefined],
    ]);
    const outcome = await applyImport(db, userId, importer, plan, new Map());
    expect(outcome).toMatchObject({ created: 1, flagged: 1 });
    const rows = await db.select().from(schema.holdings);
    expect(rows.every((h) => h.reviewPending && h.reviewReason === 'no_delivery')).toBe(true);
  });
});
