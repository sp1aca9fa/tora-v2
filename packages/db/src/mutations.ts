// Write operations on the collection. Every holding change records a holding_event in the same
// transaction; actions on part of a lot split it first (requirements section 5, lot rules).
import {
  type AcquisitionType,
  type Condition,
  type Grader,
  type Grading,
  type PackagingState,
  type RawGrade,
  isConsumedAfterOpening,
  openedStatesFor,
  pendingGrading,
  splitHolding,
  toTokyoIso,
} from '@tora/core';
import { and, count, eq } from 'drizzle-orm';
import type { Db } from './client';
import {
  type Holding,
  type NewHoldingEvent,
  type NewProduct,
  type Product,
  holdingEvents,
  holdings,
  products,
  valuationSnapshots,
} from './schema';

export type DomainErrorCode =
  | 'not_found'
  | 'not_owned'
  | 'invalid_quantity'
  | 'invalid_input'
  | 'not_a_card'
  | 'not_sealed'
  | 'not_packaged'
  | 'already_at_grader'
  | 'not_at_grader'
  | 'no_change'
  | 'has_dependents';

/** Expected business-rule failure; actions map the code to a user-facing message. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ProductInput = Omit<NewProduct, 'id' | 'createdAt' | 'updatedAt'>;

export interface HoldingInput {
  quantity: number;
  costTotalJpy: number;
  acquiredAt: string;
  acquiredFrom?: string | null;
  acquisitionType?: AcquisitionType;
  parentHoldingId?: string | null;
  condition?: Condition | null;
  packagingState?: PackagingState | null;
  grading?: Grading | null;
  rawGrade?: RawGrade | null;
  grader?: Grader | null;
  grade?: string | null;
  certNumber?: string | null;
  notes?: string | null;
}

/** Either an existing product or a new one to create. */
export type ProductRef = { productId: string } | { product: ProductInput };

// ---------------------------------------------------------------------------------------------
// helpers

function assertQuantity(quantity: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > max) {
    throw new DomainError('invalid_quantity');
  }
}

function assertYen(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new DomainError('invalid_input');
}

function assertProductInput(input: ProductInput): void {
  if (!input.nameJa?.trim() && !input.nameEn?.trim()) throw new DomainError('invalid_input');
}

async function loadHolding(tx: Tx, id: string): Promise<{ holding: Holding; product: Product }> {
  const [row] = await tx
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

function assertOwned(holding: Holding): void {
  if (holding.status !== 'owned') throw new DomainError('not_owned');
}

async function insertEvent(tx: Tx, event: Omit<NewHoldingEvent, 'id'>): Promise<void> {
  await tx.insert(holdingEvents).values(event);
}

/**
 * Returns a holding holding exactly `quantity` units: the holding itself when the whole lot is
 * affected, else a new holding split off it (with `split` events on both).
 */
async function takeUnits(
  tx: Tx,
  holding: Holding,
  quantity: number,
  occurredAt: string,
): Promise<Holding> {
  assertQuantity(quantity, holding.quantity);
  if (quantity === holding.quantity) return holding;

  const result = splitHolding(holding, quantity, { occurredAt });
  await tx
    .update(holdings)
    .set({ quantity: result.original.quantity, costTotalJpy: result.original.costTotalJpy })
    .where(eq(holdings.id, holding.id));
  const { createdAt: _c, updatedAt: _u, ...split } = result.split;
  const [inserted] = await tx.insert(holdings).values(split).returning();
  await tx
    .insert(holdingEvents)
    .values(result.events.map((e) => ({ ...e, payload: { ...e.payload } })));
  return inserted!;
}

async function resolveProduct(tx: Tx, ref: ProductRef): Promise<Product> {
  if ('productId' in ref) {
    const [product] = await tx.select().from(products).where(eq(products.id, ref.productId));
    if (!product) throw new DomainError('not_found');
    return product;
  }
  assertProductInput(ref.product);
  const [product] = await tx.insert(products).values(ref.product).returning();
  return product!;
}

async function insertHolding(tx: Tx, productId: string, input: HoldingInput): Promise<Holding> {
  assertQuantity(input.quantity);
  assertYen(input.costTotalJpy);
  if ((input.acquisitionType === 'pull') !== Boolean(input.parentHoldingId)) {
    throw new DomainError('invalid_input');
  }
  const [holding] = await tx
    .insert(holdings)
    .values({ ...input, productId })
    .returning();
  await insertEvent(tx, {
    holdingId: holding!.id,
    type: 'acquired',
    occurredAt: holding!.acquiredAt,
    amountJpy: holding!.costTotalJpy,
    // Snapshot of the state as received; a box's "value as received" bucket comes from here.
    payload: {
      quantity: holding!.quantity,
      condition: holding!.condition,
      packagingState: holding!.packagingState,
      grading: holding!.grading,
      rawGrade: holding!.rawGrade,
      grader: holding!.grader,
      grade: holding!.grade,
    },
  });
  return holding!;
}

// ---------------------------------------------------------------------------------------------
// products

export async function createProduct(db: Db, input: ProductInput): Promise<Product> {
  assertProductInput(input);
  const [product] = await db.insert(products).values(input).returning();
  return product!;
}

export async function updateProduct(db: Db, id: string, input: ProductInput): Promise<Product> {
  assertProductInput(input);
  const [product] = await db.update(products).set(input).where(eq(products.id, id)).returning();
  if (!product) throw new DomainError('not_found');
  return product;
}

// ---------------------------------------------------------------------------------------------
// holdings

/** Registers a lot (creating its product first when needed) with its `acquired` event. */
export async function createHolding(
  db: Db,
  ref: ProductRef,
  input: HoldingInput,
): Promise<{ holding: Holding; product: Product }> {
  return db.transaction(async (tx) => {
    const product = await resolveProduct(tx, ref);
    if (input.parentHoldingId) {
      const parent = await loadHolding(tx, input.parentHoldingId);
      if (parent.product.type !== 'sealed_tcg') throw new DomainError('not_sealed');
    }
    return { product, holding: await insertHolding(tx, product.id, input) };
  });
}

/**
 * Logs a card pulled from a sealed product. Cost is 0 (the box keeps its cost); a new product
 * inherits set, franchise and language from the box.
 */
export async function addPull(
  db: Db,
  parentHoldingId: string,
  ref: ProductRef,
  input: { quantity: number; rawGrade: RawGrade; acquiredAt: string },
): Promise<{ holding: Holding; product: Product }> {
  return db.transaction(async (tx) => {
    const parent = await loadHolding(tx, parentHoldingId);
    if (parent.product.type !== 'sealed_tcg') throw new DomainError('not_sealed');
    const box = parent.product;
    const product = await resolveProduct(
      tx,
      'productId' in ref
        ? ref
        : {
            product: {
              setName: box.setName,
              setCode: box.setCode,
              franchise: box.franchise,
              language: box.language,
              ...ref.product,
            },
          },
    );
    const holding = await insertHolding(tx, product.id, {
      quantity: input.quantity,
      costTotalJpy: 0,
      acquiredAt: input.acquiredAt,
      acquiredFrom: parent.holding.acquiredFrom,
      acquisitionType: 'pull',
      parentHoldingId,
      grading: 'raw',
      rawGrade: input.rawGrade,
    });
    return { holding, product };
  });
}

export type HoldingEdit = Partial<
  Pick<
    Holding,
    | 'acquiredAt'
    | 'acquiredFrom'
    | 'acquisitionType'
    | 'costTotalJpy'
    | 'quantity'
    | 'certNumber'
    | 'notes'
  >
>;

/** Corrects recorded facts. Logged as a `note` event with `kind: 'edit'` and before/after. */
export async function editHolding(
  db: Db,
  id: string,
  edit: HoldingEdit,
  occurredAt: string = toTokyoIso(),
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, id);
    if (edit.quantity !== undefined) assertQuantity(edit.quantity);
    if (edit.costTotalJpy !== undefined) assertYen(edit.costTotalJpy);
    const nextType = edit.acquisitionType ?? holding.acquisitionType;
    if ((nextType === 'pull') !== Boolean(holding.parentHoldingId)) {
      throw new DomainError('invalid_input');
    }

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, after] of Object.entries(edit) as [keyof HoldingEdit, unknown][]) {
      if (after === undefined || holding[key] === after) continue;
      changes[key] = { before: holding[key], after };
    }
    if (Object.keys(changes).length === 0) throw new DomainError('no_change');

    const [updated] = await tx.update(holdings).set(edit).where(eq(holdings.id, id)).returning();
    await insertEvent(tx, {
      holdingId: id,
      type: 'note',
      occurredAt,
      payload: { kind: 'edit', changes },
    });
    return updated!;
  });
}

/** Splits `quantity` units into a new holding; returns the new holding. */
export async function splitOff(
  db: Db,
  id: string,
  quantity: number,
  occurredAt: string = toTokyoIso(),
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, id);
    assertOwned(holding);
    if (quantity >= holding.quantity) throw new DomainError('invalid_quantity');
    return takeUnits(tx, holding, quantity, occurredAt);
  });
}

export async function markOpened(
  db: Db,
  id: string,
  input: { quantity: number; packagingState: PackagingState; occurredAt: string },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding, product } = await loadHolding(tx, id);
    assertOwned(holding);
    if (!openedStatesFor(product.type).includes(input.packagingState)) {
      throw new DomainError('invalid_input');
    }
    if (holding.packagingState === input.packagingState) throw new DomainError('no_change');

    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const status = isConsumedAfterOpening(product.type, input.packagingState)
      ? 'consumed'
      : target.status;
    const [updated] = await tx
      .update(holdings)
      .set({ packagingState: input.packagingState, status })
      .where(eq(holdings.id, target.id))
      .returning();
    await insertEvent(tx, {
      holdingId: target.id,
      type: 'opened',
      occurredAt: input.occurredAt,
      payload: {
        quantity: input.quantity,
        before: { packagingState: target.packagingState, status: target.status },
        after: { packagingState: input.packagingState, status },
      },
    });
    return updated!;
  });
}

/** Sends cards to a grader. The fee is added to the cost basis. */
export async function submitGrading(
  db: Db,
  id: string,
  input: { quantity: number; grader: Grader; feeJpy: number; service?: string; occurredAt: string },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding, product } = await loadHolding(tx, id);
    assertOwned(holding);
    assertYen(input.feeJpy);
    if (product.type !== 'card_single') throw new DomainError('not_a_card');
    const events = await tx.select().from(holdingEvents).where(eq(holdingEvents.holdingId, id));
    if (pendingGrading(events)) throw new DomainError('already_at_grader');

    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const costAfter = target.costTotalJpy + input.feeJpy;
    const [updated] = await tx
      .update(holdings)
      .set({ costTotalJpy: costAfter })
      .where(eq(holdings.id, target.id))
      .returning();
    await insertEvent(tx, {
      holdingId: target.id,
      type: 'grading_submitted',
      occurredAt: input.occurredAt,
      amountJpy: input.feeJpy,
      payload: {
        quantity: input.quantity,
        grader: input.grader,
        service: input.service ?? null,
        costBefore: target.costTotalJpy,
        costAfter,
      },
    });
    return updated!;
  });
}

/** Records the grade received. An optional extra fee (upcharge, shipping) adds to cost. */
export async function returnGrading(
  db: Db,
  id: string,
  input: {
    grader: Grader;
    grade: string;
    certNumber?: string | null;
    extraFeeJpy?: number;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, id);
    assertOwned(holding);
    const extraFee = input.extraFeeJpy ?? 0;
    assertYen(extraFee);
    const grade = input.grade.trim();
    if (!grade) throw new DomainError('invalid_input');
    const events = await tx.select().from(holdingEvents).where(eq(holdingEvents.holdingId, id));
    if (!pendingGrading(events)) throw new DomainError('not_at_grader');

    const after = {
      grading: 'graded' as const,
      grader: input.grader,
      grade,
      certNumber: input.certNumber?.trim() || null,
      costTotalJpy: holding.costTotalJpy + extraFee,
    };
    const [updated] = await tx.update(holdings).set(after).where(eq(holdings.id, id)).returning();
    await insertEvent(tx, {
      holdingId: id,
      type: 'grading_returned',
      occurredAt: input.occurredAt,
      amountJpy: extraFee || null,
      payload: {
        before: {
          grading: holding.grading,
          rawGrade: holding.rawGrade,
          grader: holding.grader,
          grade: holding.grade,
          costTotalJpy: holding.costTotalJpy,
        },
        after,
      },
    });
    return updated!;
  });
}

export async function sellHolding(
  db: Db,
  id: string,
  input: {
    quantity: number;
    priceJpy: number;
    feesJpy: number;
    platform?: string | null;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, id);
    assertOwned(holding);
    assertYen(input.priceJpy);
    assertYen(input.feesJpy);
    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const [updated] = await tx
      .update(holdings)
      .set({ status: 'sold' })
      .where(eq(holdings.id, target.id))
      .returning();
    await insertEvent(tx, {
      holdingId: target.id,
      type: 'sold',
      occurredAt: input.occurredAt,
      amountJpy: input.priceJpy,
      feesJpy: input.feesJpy,
      payload: {
        quantity: input.quantity,
        platform: input.platform?.trim() || null,
        costBasisJpy: target.costTotalJpy,
      },
    });
    return updated!;
  });
}

export async function changeCondition(
  db: Db,
  id: string,
  input: {
    quantity: number;
    condition?: Condition | null;
    rawGrade?: RawGrade | null;
    packagingState?: PackagingState | null;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, id);
    assertOwned(holding);
    const patch: Partial<Pick<Holding, 'condition' | 'rawGrade' | 'packagingState'>> = {};
    const before: Record<string, unknown> = {};
    for (const key of ['condition', 'rawGrade', 'packagingState'] as const) {
      const value = input[key];
      if (value === undefined || value === holding[key]) continue;
      Object.assign(patch, { [key]: value });
      before[key] = holding[key];
    }
    if (Object.keys(patch).length === 0) throw new DomainError('no_change');

    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const [updated] = await tx
      .update(holdings)
      .set(patch)
      .where(eq(holdings.id, target.id))
      .returning();
    await insertEvent(tx, {
      holdingId: target.id,
      type: 'condition_changed',
      occurredAt: input.occurredAt,
      payload: { quantity: input.quantity, before, after: patch },
    });
    return updated!;
  });
}

export async function addNote(
  db: Db,
  id: string,
  input: { text: string; occurredAt: string },
): Promise<void> {
  const text = input.text.trim();
  if (!text) throw new DomainError('invalid_input');
  await db.transaction(async (tx) => {
    await loadHolding(tx, id);
    await insertEvent(tx, {
      holdingId: id,
      type: 'note',
      occurredAt: input.occurredAt,
      payload: { text },
    });
  });
}

/**
 * Removes a holding registered by mistake. Refused once other records depend on it
 * (pulls logged from it, or a split to/from it), so history stays consistent.
 */
export async function deleteHolding(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await loadHolding(tx, id);
    const [children] = await tx
      .select({ n: count() })
      .from(holdings)
      .where(eq(holdings.parentHoldingId, id));
    const [splits] = await tx
      .select({ n: count() })
      .from(holdingEvents)
      .where(and(eq(holdingEvents.holdingId, id), eq(holdingEvents.type, 'split')));
    if ((children?.n ?? 0) > 0 || (splits?.n ?? 0) > 0) throw new DomainError('has_dependents');
    await tx.delete(valuationSnapshots).where(eq(valuationSnapshots.holdingId, id));
    await tx.delete(holdingEvents).where(eq(holdingEvents.holdingId, id));
    await tx.delete(holdings).where(eq(holdings.id, id));
  });
}
