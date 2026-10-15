import { parseCsv, toCsv } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { accountData } from './account-data';
import { type Db, createDb } from './client';
import {
  type KeyOf,
  SHEET_COLUMNS,
  type SheetColumn,
  applySheet,
  headerKey,
  lotSheet,
  planSheet,
  readSheet,
} from './lot-sheet';
import { migrateDb } from './migrate';
import { createHolding, sellHolding } from './mutations';
import { saveSourceInfos } from './registry';
import { holdings, importRuns } from './schema';
import { seedCollection } from './seed';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';

let db: Db;
let a: string;
let b: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-sheet-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  const user = (name: string) =>
    createUser(db, name, { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] });
  a = (await user('a')).user.id;
  b = (await user('b')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

// Two languages' names, as the app gives them.
const NAMES: Record<string, Record<string, string[]>> = {
  category: { tcg: ['TCG', 'トレカ'], game: ['Games', 'ゲーム'] },
  kind: { booster_box: ['Booster box', 'BOX'], single: ['Single card', 'シングル'] },
  status: {
    owned: ['Owned', '所持'],
    sold: ['Sold', '売却済み'],
    consumed: ['Opened', '開封済み'],
  },
  packaging: { sealed_shrink: ['Sealed (shrink)', 'シュリンク付き'] },
};
const HEADERS: Partial<Record<SheetColumn, string>> = {
  item: '商品',
  category: 'カテゴリ',
  kind: '種類',
  quantity: '数量',
  cost: '購入額',
  acquired: '購入日',
  shop: '購入先',
  order_id: '注文番号',
  status: '状態',
  packaging: '包装',
  graded: '鑑定',
  condition: 'コンディション',
};
const keyOf: KeyOf = (ns, cell) => {
  const names = NAMES[ns] ?? {};
  if (cell in names) return cell;
  for (const [key, list] of Object.entries(names)) if (list.includes(cell)) return key;
  // Category, kind and status must be known; other sections take their keys here.
  return ['category', 'kind', 'status'].includes(ns) ? null : cell;
};
const column = (cell: string) => {
  const k = headerKey(cell);
  return (
    SHEET_COLUMNS.find((c) => c === k) ??
    (Object.entries(HEADERS).find(([, h]) => h === k)?.[0] as SheetColumn | undefined) ??
    null
  );
};
const english = (ns: string, key: string) => NAMES[ns]?.[key]?.[0] ?? key;

it('downloads every lot, and a re-import adds only what is not in Tora yet', async () => {
  await seedCollection(db, a);
  const [lot] = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, a), eq(holdings.status, 'owned'), eq(holdings.quantity, 1)))
    .limit(1);
  await sellHolding(db, a, lot!.id, {
    quantity: 1,
    priceBase: 25_000,
    feesBase: 2_500,
    occurredAt: '2026-10-10T12:00:00.000+09:00',
  });

  const sheet = await lotSheet(db, a, (c) => (c === 'cost' ? 'Cost (JPY)' : c), english);
  const lots = await db.select().from(holdings).where(eq(holdings.userId, a));
  expect(sheet).toHaveLength(lots.length + 1);
  const at = (row: string[], c: SheetColumn) => row[SHEET_COLUMNS.indexOf(c)]!;
  const sold = sheet.find((r) => at(r, 'lot_id') === lot!.id)!;
  expect([at(sold, 'status'), at(sold, 'sold_for'), at(sold, 'fees')]).toEqual([
    'Sold',
    '25000',
    '2500',
  ]);
  const box = sheet.find((r) => at(r, 'kind') === 'Booster box')!;
  expect(at(box, 'status')).toBe('Opened');
  // Pulls point at their box.
  expect(sheet.filter((r) => at(r, 'from_lot') === at(box, 'lot_id'))).toHaveLength(3);

  // Through a CSV file and back.
  const read = readSheet(parseCsv(toCsv(sheet)), column)!;
  expect(read.ignored).toEqual([]);

  // The same account: everything is already there (or not an owned lot).
  const again = await planSheet(db, a, read, keyOf);
  expect(again.filter((e) => e.type === 'new')).toEqual([]);

  // Another account: its owned lots become new lots of the same items, waiting in review.
  const plan = await planSheet(db, b, read, keyOf);
  const owned = lots.filter((l) => l.status === 'owned');
  expect(plan.filter((e) => e.type === 'new')).toHaveLength(owned.length);
  expect(plan.filter((e) => e.type === 'skipped')).toHaveLength(lots.length - owned.length);
  const { runId, counts } = await applySheet(db, b, plan, 'lots.csv');
  expect(counts.imported).toBe(owned.length);
  const imported = await db.select().from(holdings).where(eq(holdings.userId, b));
  expect(imported.every((h) => h.reviewPending && h.importRunId === runId)).toBe(true);
  expect(imported.map((h) => h.productId).sort()).toEqual(owned.map((h) => h.productId).sort());
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId));
  expect(run).toMatchObject({ method: 'file', note: 'lots.csv' });
});

it('reads a hand-made sheet in Japanese and reports each problem', async () => {
  await createHolding(
    db,
    a,
    { product: { category: 'tcg', kind: 'single', name: 'ピカチュウ' } },
    {
      quantity: 1,
      costTotalBase: 3000,
      acquiredAt: '2026-09-01T12:00:00.000+09:00',
      acquiredFrom: 'SNKRDUNK',
      orderId: '111',
    },
  );
  const rows = [
    [
      '商品',
      'カテゴリ',
      '種類',
      '数量',
      '購入額 (円)',
      '購入日',
      '購入先',
      '注文番号',
      '状態',
      '包装',
      '鑑定',
      'メモ欄',
    ],
    [
      'ポケモンBOX',
      'トレカ',
      'BOX',
      '2',
      '¥12,000',
      '2026/9/5',
      'ヨドバシ',
      '',
      '',
      'シュリンク付き',
      '',
      'x',
    ],
    ['ポケモンBOX', 'トレカ', 'BOX', '1', '6000', '', '', '', '', '', '', ''],
    [
      'ピカチュウ',
      'トレカ',
      'シングル',
      '1',
      '3000',
      '2026-09-01',
      'スニダン',
      '111',
      '',
      '',
      '',
      '',
    ],
    [
      'ミュウ',
      'トレカ',
      'シングル',
      '1',
      '3000',
      '2026-09-02',
      'スニダン',
      '222',
      '',
      '',
      'PSA 10',
      '',
    ],
    [
      'ミュウ',
      'トレカ',
      'シングル',
      '1',
      '3000',
      '2026-09-02',
      'スニダン',
      '222',
      '',
      '',
      'PSA 10',
      '',
    ],
    ['ミュウ', 'トレカ', 'シングル', '1', '3000', '', '', '', '', '', 'XYZ 10', ''],
    ['ミュウ', 'トレカ', 'シングル', '1', '3000', '', '', '', '売却済み', '', '', ''],
    ['ミュウ', 'カード', 'シングル', '1', '3000', '', '', '', '', '', '', ''],
    ['ミュウ', 'トレカ', 'シングル', '0', '3000', '', '', '', '', '', '', ''],
    ['ミュウ', 'トレカ', 'シングル', '1', '-5', '', '', '', '', '', '', ''],
    ['ミュウ', 'トレカ', 'シングル', '1', '3000', '2026-02-30', '', '', '', '', '', ''],
    ['', 'トレカ', 'シングル', '1', '3000', '', '', '', '', '', '', ''],
    ['ミュウ', 'トレカ', 'シングル', '1', '3000', '', '', '', '持ってる', '', '', ''],
  ];
  const read = readSheet(rows, column)!;
  expect(read.ignored).toEqual(['メモ欄']);
  const plan = await planSheet(db, a, read, keyOf, new Date('2026-10-16T12:00:00+09:00'));
  expect(plan.map((e) => (e.type === 'error' ? e.error : e.type))).toEqual([
    'new',
    'new',
    // The same SNKRDUNK order (one item per order), named by an alias.
    'existing',
    'new',
    // The same order again in the file.
    'existing',
    'bad_graded',
    'skipped',
    'unknown_category',
    'bad_quantity',
    'bad_cost',
    'bad_date',
    'missing_item',
    'bad_status',
  ]);
  const first = plan[0]!;
  expect(first.type === 'new' && first.input).toMatchObject({
    quantity: 2,
    costTotalBase: 12_000,
    acquiredAt: '2026-09-05T12:00:00.000+09:00',
    acquiredFrom: 'ヨドバシ',
    packagingState: 'sealed_shrink',
    reviewReason: 'new_product',
  });
  const noDate = plan[1]!;
  expect(noDate.type === 'new' && noDate.input).toMatchObject({
    acquiredAt: '2026-10-16T12:00:00.000+09:00',
    reviewReason: 'new_product,date_approx',
  });
  const graded = plan[3]!;
  expect(graded.type === 'new' && graded.input).toMatchObject({
    grading: 'graded',
    grader: 'PSA',
    grade: '10',
  });

  // Two rows of one new item make one item.
  const { counts } = await applySheet(db, a, plan, 'mine.csv');
  expect(counts).toEqual({ imported: 3, duplicate: 2, skipped: 1, failed: 7 });
  const boxes = await db.select().from(holdings).where(eq(holdings.userId, a));
  const ids = new Set(boxes.map((h) => h.productId));
  expect(ids.size).toBe(3);

  // The same file again: the lots it added are found (the one without a date cannot be).
  const again = await planSheet(db, a, read, keyOf, new Date('2026-10-16T12:00:00+09:00'));
  expect(again.slice(0, 5).map((e) => e.type)).toEqual([
    'existing',
    'new',
    'existing',
    'existing',
    'existing',
  ]);
});

it('downloads the account data without collected prices or secrets', async () => {
  await seedCollection(db, a);
  await seedCollection(db, b);
  const data = await accountData(db, a);
  const lots = await db.select().from(holdings).where(eq(holdings.userId, a));
  expect(data).toMatchObject({ format: 'tora-account', version: 1, account: { username: 'a' } });
  expect(data.lots.map((l) => l.id).sort()).toEqual(lots.map((l) => l.id).sort());
  expect(data.history.length).toBeGreaterThanOrEqual(lots.length);
  const text = JSON.stringify(data);
  expect(text).not.toMatch(
    /passwordHash|totpSecretEnc|backupCodeHashes|recentSales|price_observations/,
  );
});
