// The lots spreadsheet (requirements S6): one row per lot, downloaded from Settings > Your data,
// and imported back in the same layout (Imports > Spreadsheet). Cells show keys by their names in
// the person's language (the caller's `name`); an import takes names in any of the app's languages
// or the keys (the caller's `keyOf`).
import {
  GRADERS,
  type Grader,
  RAW_GRADES,
  type RawGrade,
  categoryDef,
  holdingFieldsFor,
  itemTypeOf,
  localDate,
  localTime,
  orderSourceOf,
  productClass,
  resolveTaxonomy,
  singleItemOrders,
  toLocalIso,
} from '@tora/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { type ImportRowLog, finishImportRun, saveImportRows, startImportRun } from './imports';
import { type HoldingInput, type ProductRef, DomainError, createHolding } from './mutations';
import { findSameProduct } from './purchases';
import { loadSourceRegistry } from './registry';
import { type Holding, type Product, holdingEvents, holdings, products } from './schema';
import { portfolioValuation } from './valuation';

export const SHEET_COLUMNS = [
  'lot_id',
  'item_id',
  'item',
  'category',
  'kind',
  'franchise',
  'platform',
  'set',
  'set_code',
  'card_number',
  'rarity',
  'variant',
  'region',
  'condition',
  'packaging',
  'graded',
  'quantity',
  'cost',
  'acquired',
  'shop',
  'order_id',
  'acquisition',
  'status',
  'value',
  'profit',
  'sold_on',
  'sold_for',
  'fees',
  'from_lot',
  'notes',
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

/** A key's name as the app shows it; `ns` is its texts section (`kind`, `conditionValue.<list>`...). */
export type NameOf = (ns: string, key: string) => string;
/** A cell back to its key (the key, or its name in one of the app's languages); null: none. */
export type KeyOf = (ns: string, cell: string) => string | null;

type HoldingFieldsFor = ReturnType<typeof holdingFieldsFor>;

/** Condition cells of a lot: what its condition list records. */
function conditionCells(holding: Holding, product: Product, name: NameOf) {
  const fields = holdingFieldsFor(productClass(product));
  const condition = holding.conditionValue
    ? name(`conditionValue.${fields.value}`, holding.conditionValue)
    : holding.condition
      ? name('condition', holding.condition)
      : (holding.rawGrade ?? '');
  return {
    condition,
    packaging: holding.packagingState ? name('packaging', holding.packagingState) : '',
    graded:
      holding.grading === 'graded' ? `${holding.grader ?? ''} ${holding.grade ?? ''}`.trim() : '',
  };
}

const text = (v: string | number | null | undefined) => (v == null ? '' : String(v));

/** Every lot of the account (owned, opened, sold, lost) as spreadsheet rows, header first. */
export async function lotSheet(
  db: Db,
  userId: string,
  header: (column: SheetColumn) => string,
  name: NameOf,
  now = new Date(),
): Promise<string[][]> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.userId, userId))
    .orderBy(asc(holdings.acquiredAt), asc(holdings.createdAt));
  const values = new Map(
    (await portfolioValuation(db, userId, now)).rows.map((r) => [
      r.holding.id,
      r.valuation.valueBase,
    ]),
  );
  const ids = rows.map((r) => r.holding.id);
  const sold = new Map(
    (ids.length
      ? await db
          .select()
          .from(holdingEvents)
          .innerJoin(holdings, eq(holdings.id, holdingEvents.holdingId))
          .where(and(eq(holdings.userId, userId), eq(holdingEvents.type, 'sold')))
      : []
    ).map((r) => [r.holding_events.holdingId, r.holding_events]),
  );
  const out: string[][] = [SHEET_COLUMNS.map(header)];
  for (const { holding: h, product: p } of rows) {
    const value = values.get(h.id) ?? null;
    const sale = sold.get(h.id);
    const cells: Record<SheetColumn, string> = {
      lot_id: h.id,
      item_id: p.id,
      item: p.name,
      category: name('category', p.category),
      kind: name('kind', p.kind),
      franchise: text(p.franchise),
      platform: text(p.platform),
      set: text(p.setName),
      set_code: text(p.setCode),
      card_number: text(p.cardNumber),
      rarity: text(p.rarity),
      variant: text(p.variant),
      region: p.region ? name('region', p.region) : '',
      ...conditionCells(h, p, name),
      quantity: String(h.quantity),
      cost: String(h.costTotalBase),
      acquired: h.acquiredAt.slice(0, 10),
      shop: text(h.acquiredFrom),
      order_id: text(h.orderId),
      acquisition: name('acquisitionType', h.acquisitionType),
      status: name('status', h.status),
      value: h.status === 'owned' ? text(value) : '',
      profit: h.status === 'owned' && value !== null ? String(value - h.costTotalBase) : '',
      sold_on: sale ? sale.occurredAt.slice(0, 10) : '',
      sold_for: text(sale?.amountBase),
      fees: text(sale?.feesBase),
      from_lot: text(h.parentHoldingId),
      notes: text(h.notes),
    };
    out.push(SHEET_COLUMNS.map((c) => cells[c]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// import

export type SheetError =
  | 'missing_item'
  | 'unknown_item'
  | 'unknown_category'
  | 'unknown_kind'
  | 'bad_region'
  | 'bad_status'
  | 'bad_quantity'
  | 'bad_cost'
  | 'bad_date'
  | 'bad_condition'
  | 'bad_packaging'
  | 'bad_graded';

/** A lot the row would add. */
export interface NewLot {
  quantity: number;
  costBase: number;
  acquired: string;
  newItem: boolean;
  ref: ProductRef;
  input: HoldingInput;
}

/** How a row was found in Tora: its lot ID, the same order, or (loosely) the same lot details. */
export type SheetMatch = 'lot_id' | 'same_order' | 'same_lot';

export type SheetEntry = { line: number; item: string } & (
  | ({ type: 'new' } & NewLot)
  | {
      type: 'existing';
      /** The lot it matched (none: an earlier row of the file with the same order). */
      lotId: string | null;
      match: SheetMatch;
      /** A loose match can still be added ("add anyway"): the lot it would be. */
      asNew?: NewLot;
    }
  | { type: 'skipped'; why: 'not_owned' }
  | { type: 'error'; error: SheetError }
);

export interface SheetRead {
  /** Data rows by column, with their line in the file. */
  rows: { line: number; cells: Partial<Record<SheetColumn, string>> }[];
  /** Header cells not recognized (ignored). */
  ignored: string[];
}

/** A header cell without its unit ("Cost (JPY)" -> "cost"), for matching. */
export const headerKey = (cell: string) =>
  cell
    .normalize('NFKC')
    .replace(/\s*[(（][^)）]*[)）]\s*$/, '')
    .trim()
    .toLowerCase();

/**
 * Reads the rows of a sheet whose first row names the columns (`column` matches a header cell).
 * Null when no header names the item (nothing to import from).
 */
export function readSheet(
  table: string[][],
  column: (cell: string) => SheetColumn | null,
): SheetRead | null {
  const [head, ...data] = table;
  if (!head) return null;
  const columns = head.map((cell) => column(cell));
  if (!columns.includes('item') && !columns.includes('item_id')) return null;
  return {
    rows: data.map((r, i) => ({
      line: i + 2,
      cells: Object.fromEntries(
        columns.flatMap((c, j) => (c && r[j]?.trim() ? [[c, r[j]!.trim()]] : [])),
      ),
    })),
    ignored: head.filter((_, j) => !columns[j]),
  };
}

/** A whole number from a spreadsheet cell ("¥12,000", "１２０００", "12000.0"). */
function amount(cell: string | undefined): number | null {
  if (!cell) return null;
  const n = Number(cell.normalize('NFKC').replace(/[,\s¥$€£円]/g, ''));
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : NaN;
}

/** A day from a cell ("2026-10-16", "2026/10/16", "2026/1/5"). */
function day(cell: string | undefined): string | null {
  const m = cell
    ?.normalize('NFKC')
    .trim()
    .match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return new Date(`${d}T00:00:00Z`).toISOString().startsWith(d) ? d : null;
}

/** The lot's condition fields from its cells; an error when a cell names nothing known. */
function conditionInput(
  fields: HoldingFieldsFor,
  cells: Partial<Record<SheetColumn, string>>,
  keyOf: KeyOf,
): Partial<HoldingInput> | SheetError {
  const input: Partial<HoldingInput> = {};
  const condition = cells.condition;
  if (fields.value) {
    if (condition) {
      const key = keyOf(`conditionValue.${fields.value}`, condition);
      if (!key) return 'bad_condition';
      input.conditionValue = key;
    }
  } else if (fields.grading) {
    const graded = cells.graded?.normalize('NFKC').trim();
    if (graded) {
      const m = graded.match(/^(\S+)\s*(.*)$/);
      const grader = GRADERS.find((g) => g.toLowerCase() === m?.[1]?.toLowerCase());
      if (!grader) return 'bad_graded';
      Object.assign(input, { grading: 'graded', grader: grader as Grader, grade: m![2] || null });
    } else {
      input.grading = 'raw';
      if (condition) {
        const raw = RAW_GRADES.find((g) => g === condition.normalize('NFKC').trim().toUpperCase());
        if (!raw) return 'bad_condition';
        input.rawGrade = raw as RawGrade;
      }
    }
  } else if (fields.condition && condition) {
    const key = keyOf('condition', condition);
    if (!key) return 'bad_condition';
    input.condition = key as HoldingInput['condition'];
  }
  if (fields.packaging && cells.packaging) {
    const key = keyOf('packaging', cells.packaging);
    if (!key) return 'bad_packaging';
    input.packagingState = key as HoldingInput['packagingState'];
  }
  return input;
}

/**
 * What importing each row would do: a new lot, already in Tora (its lot ID is in the account, or
 * the same order is), skipped (not an owned lot) or a problem. Nothing is written.
 */
export async function planSheet(
  db: Db,
  userId: string,
  read: SheetRead,
  keyOf: KeyOf,
  now = new Date(),
): Promise<SheetEntry[]> {
  const registry = await loadSourceRegistry(db);
  const taxonomy = registry.taxonomy ?? resolveTaxonomy(null);
  const mine = await db
    .select({
      id: holdings.id,
      productId: holdings.productId,
      orderSource: holdings.orderSource,
      orderId: holdings.orderId,
      acquiredAt: holdings.acquiredAt,
      quantity: holdings.quantity,
      costTotalBase: holdings.costTotalBase,
    })
    .from(holdings)
    .where(eq(holdings.userId, userId));
  // Lots a row without IDs was matched to (each lot matches one row at most).
  const matched = new Set<string>();
  const lotIds = new Set(mine.map((h) => h.id));
  const itemIds = [...new Set(read.rows.flatMap((r) => r.cells.item_id ?? []))];
  const known = new Map(
    (itemIds.length
      ? await db.select().from(products).where(inArray(products.id, itemIds))
      : []
    ).map((p) => [p.id, p]),
  );
  // Orders already planned in this file (a second row of a one-item order is the same lot).
  const planned = new Set<string>();

  const entries: SheetEntry[] = [];
  for (const { line, cells } of read.rows) {
    const item = cells.item ?? known.get(cells.item_id ?? '')?.name ?? cells.item_id ?? '';
    const fail = (error: SheetError) => entries.push({ line, item, type: 'error', error });
    if (cells.lot_id && lotIds.has(cells.lot_id)) {
      entries.push({ line, item, type: 'existing', lotId: cells.lot_id, match: 'lot_id' });
      continue;
    }
    if (cells.status) {
      const status = keyOf('status', cells.status);
      if (!status) {
        fail('bad_status');
        continue;
      }
      if (status !== 'owned') {
        entries.push({ line, item, type: 'skipped', why: 'not_owned' });
        continue;
      }
    }

    // The item: by its ID, else by name and kind (an item already in Tora, or a new one).
    let product: Product | null = known.get(cells.item_id ?? '') ?? null;
    let ref: ProductRef;
    if (product) ref = { productId: product.id };
    else {
      if (!cells.item) {
        fail(cells.item_id ? 'unknown_item' : 'missing_item');
        continue;
      }
      const category = cells.category ? keyOf('category', cells.category) : null;
      if (!category || !categoryDef(taxonomy, category)) {
        fail('unknown_category');
        continue;
      }
      const kind = cells.kind ? keyOf('kind', cells.kind) : null;
      if (!kind || !itemTypeOf(taxonomy, category, kind)) {
        fail('unknown_kind');
        continue;
      }
      let region: string | null = null;
      if (cells.region) {
        region = keyOf('region', cells.region);
        if (!region || !categoryDef(taxonomy, category)?.regions?.includes(region)) {
          fail('bad_region');
          continue;
        }
      }
      const fields = {
        category,
        kind,
        name: cells.item.normalize('NFKC').trim(),
        franchise: cells.franchise ?? null,
        platform: cells.platform ?? null,
        setName: cells.set ?? null,
        setCode: cells.set_code ?? null,
        cardNumber: cells.card_number ?? null,
        rarity: cells.rarity ?? null,
        variant: cells.variant ?? null,
        region: region as Product['region'],
      };
      product = await findSameProduct(db, fields);
      ref = product ? { productId: product.id } : { product: fields };
    }
    const cls =
      'product' in ref
        ? itemTypeOf(taxonomy, ref.product.category, ref.product.kind)!
        : productClass(product!);

    const quantity = cells.quantity ? Number(cells.quantity.normalize('NFKC')) : 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      fail('bad_quantity');
      continue;
    }
    const cost = amount(cells.cost);
    if (Number.isNaN(cost)) {
      fail('bad_cost');
      continue;
    }
    const acquired = cells.acquired ? day(cells.acquired) : localDate(now);
    if (!acquired || acquired > localDate(now)) {
      fail('bad_date');
      continue;
    }
    const condition = conditionInput(holdingFieldsFor(cls), cells, keyOf);
    if (typeof condition === 'string') {
      fail(condition);
      continue;
    }

    // Already in Tora: the same order (one-item shops), or the same order of the same item.
    const orderSource = orderSourceOf(registry, cells.shop);
    const orderId = cells.order_id?.normalize('NFKC').trim();
    if (orderSource && orderId) {
      const single = singleItemOrders(registry, orderSource);
      const same = mine.find(
        (h) =>
          h.orderSource === orderSource &&
          h.orderId === orderId &&
          (single || h.productId === product?.id),
      );
      if (same) {
        entries.push({ line, item, type: 'existing', lotId: same.id, match: 'same_order' });
        continue;
      }
      const key = `${orderSource}\n${orderId}\n${single ? '' : (product?.id ?? cells.item)}`;
      if (planned.has(key)) {
        entries.push({ line, item, type: 'existing', lotId: null, match: 'same_order' });
        continue;
      }
      planned.add(key);
    }

    const reasons = [
      ...(product ? [] : ['new_product']),
      ...(cells.acquired ? [] : ['date_approx']),
    ];
    const lot: NewLot = {
      quantity,
      costBase: cost ?? 0,
      acquired,
      newItem: !product,
      ref,
      input: {
        quantity,
        costTotalBase: cost ?? 0,
        // Noon of the day: the same day in any time zone change nearby.
        acquiredAt: toLocalIso(localTime(acquired, '12:00:00.000')),
        acquiredFrom: cells.shop ?? null,
        orderId: orderId || null,
        notes: cells.notes ?? null,
        ...condition,
        reviewPending: true,
        reviewReason: reasons.length ? reasons.join(',') : null,
      },
    };

    // Maybe already in Tora (a hand-made sheet imported again): a lot of the same item acquired
    // the same day, in the same quantity, for the same cost. The person decides ("add anyway").
    if (product && cells.acquired) {
      const same = mine.find(
        (h) =>
          !matched.has(h.id) &&
          h.productId === product.id &&
          h.acquiredAt.slice(0, 10) === acquired &&
          h.quantity === quantity &&
          h.costTotalBase === (cost ?? 0),
      );
      if (same) {
        matched.add(same.id);
        entries.push({
          line,
          item,
          type: 'existing',
          lotId: same.id,
          match: 'same_lot',
          asNew: lot,
        });
        continue;
      }
    }
    entries.push({ line, item, type: 'new', ...lot });
  }
  return entries;
}

/**
 * Adds the plan's new lots (and the loose matches the person chose to add anyway, by line) as one
 * import (Imports history), each waiting in Review; every row goes in the import's log.
 */
export async function applySheet(
  db: Db,
  userId: string,
  entries: SheetEntry[],
  fileName: string,
  addAnyway: readonly number[] = [],
): Promise<{ runId: string; counts: Record<string, number> }> {
  const runId = await startImportRun(db, { userId, method: 'file' });
  const counts: Record<string, number> = {};
  const add = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const log: ImportRowLog[] = [];
  for (const e of entries) {
    const row = { title: e.item, detail: `line:${e.line}` };
    const lot =
      e.type === 'new'
        ? e
        : e.type === 'existing' && e.asNew && addAnyway.includes(e.line)
          ? e.asNew
          : null;
    if (!lot) {
      if (e.type === 'existing') {
        add('duplicate');
        log.push({ ...row, outcome: 'existing', reason: e.match, holdingId: e.lotId });
      } else if (e.type === 'skipped') {
        add('skipped');
        log.push({ ...row, outcome: 'skipped', reason: e.why });
      } else if (e.type === 'error') {
        add('failed');
        log.push({ ...row, outcome: 'problem', reason: e.error });
      }
      continue;
    }
    const details = { quantity: lot.quantity, costBase: lot.costBase, day: lot.acquired };
    // A new item made by an earlier row is used again.
    let ref = lot.ref;
    if ('product' in ref) {
      const same = await findSameProduct(db, ref.product);
      if (same) ref = { productId: same.id };
    }
    try {
      const { holding } = await createHolding(db, userId, ref, {
        ...lot.input,
        importRunId: runId,
      });
      add('imported');
      log.push({
        ...row,
        ...details,
        outcome: 'imported',
        reason: e.type === 'existing' ? 'added_anyway' : null,
        holdingId: holding.id,
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const duplicate = error.code === 'duplicate_order';
      add(duplicate ? 'duplicate' : 'failed');
      log.push({
        ...row,
        ...details,
        outcome: duplicate ? 'existing' : 'problem',
        reason: duplicate ? 'same_order' : error.code,
        holdingId: duplicate ? (error.message === error.code ? null : error.message) : null,
      });
    }
  }
  await saveImportRows(db, runId, log);
  await finishImportRun(db, runId, counts, { note: fileName.slice(0, 200) });
  return { runId, counts };
}
