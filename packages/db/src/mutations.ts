// Write operations on the collection. Every holding change records a holding_event in the same
// transaction; actions on part of a lot split it first (requirements section 5, lot rules).
// Holdings are per user: every holding operation takes the acting user's id and only touches
// that user's holdings. Products and the TCG set catalog are shared.
import {
  type AcquisitionType,
  type CardGrade,
  type Condition,
  type Grader,
  type Grading,
  type PackagingState,
  type ProductKind,
  type RawGrade,
  type Region,
  catalogProductName,
  isConsumedAfterOpening,
  SINGLE_ITEM_ORDER_SOURCES,
  kindsFor,
  kindsForSetType,
  orderSourceOf,
  openedStatesFor,
  pendingGrading,
  productClass,
  splitHolding,
  toTokyoIso,
} from '@tora/core';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import {
  type Holding,
  type NewHoldingEvent,
  type NewProduct,
  type Product,
  type User,
  holdingEvents,
  holdings,
  products,
  tcgSets,
  valuationSnapshots,
} from './schema';

export type DomainErrorCode =
  | 'not_found'
  | 'not_owned'
  | 'forbidden'
  | 'invalid_quantity'
  | 'invalid_input'
  | 'not_a_card'
  | 'not_sealed'
  | 'not_packaged'
  | 'already_at_grader'
  | 'not_at_grader'
  | 'no_change'
  | 'has_dependents'
  | 'duplicate_order';

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

export type ProductInput = Omit<NewProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

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
  /** Transaction / order ID at the place of purchase (e.g. a SNKRDUNK 取引ID). */
  orderId?: string | null;
}

/** A sealed product of a catalog set; created on first use. */
export interface CatalogRef {
  setId: string;
  kind: ProductKind;
  variant?: string | null;
  /** Used when the set itself has no region (e.g. Magic sets are the same everywhere). */
  region?: Region | null;
}

/** An existing product, a new one to create, or a catalog set's sealed product. */
export type ProductRef =
  { productId: string } | { product: ProductInput } | { catalog: CatalogRef };

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
  if (!input.name?.trim()) throw new DomainError('invalid_input');
  if (!kindsFor(input.category).includes(input.kind)) throw new DomainError('invalid_input');
}

async function loadHolding(
  tx: Tx,
  userId: string,
  id: string,
): Promise<{ holding: Holding; product: Product }> {
  const [row] = await tx
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
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

/** Finds or creates the sealed product for a catalog set + kind + variant (+ region). */
async function resolveCatalogProduct(tx: Tx, ref: CatalogRef): Promise<Product> {
  const [set] = await tx.select().from(tcgSets).where(eq(tcgSets.id, ref.setId));
  if (!set) throw new DomainError('not_found');
  if (!kindsForSetType(set.setType).includes(ref.kind)) throw new DomainError('invalid_input');
  const variant = ref.variant?.trim() || null;
  const region = set.region ?? ref.region ?? null;

  const [existing] = await tx
    .select()
    .from(products)
    .where(
      and(
        eq(products.setId, set.id),
        eq(products.kind, ref.kind),
        variant ? eq(products.variant, variant) : isNull(products.variant),
        region ? eq(products.region, region) : isNull(products.region),
        isNull(products.createdBy),
      ),
    );
  if (existing) return existing;

  const [product] = await tx
    .insert(products)
    .values({
      category: 'tcg',
      kind: ref.kind,
      name: catalogProductName(set.name, ref.kind, variant),
      nameAlias: set.nameAlias ? catalogProductName(set.nameAlias, ref.kind, variant) : null,
      franchise: set.franchise,
      region,
      setId: set.id,
      setName: set.name,
      setCode: set.code,
      variant,
      releaseDate: set.releaseDate,
      createdBy: null,
    })
    .returning();
  return product!;
}

async function resolveProduct(tx: Tx, userId: string, ref: ProductRef): Promise<Product> {
  if ('catalog' in ref) return resolveCatalogProduct(tx, ref.catalog);
  if ('productId' in ref) {
    const [product] = await tx.select().from(products).where(eq(products.id, ref.productId));
    if (!product) throw new DomainError('not_found');
    return product;
  }
  assertProductInput(ref.product);
  const [product] = await tx
    .insert(products)
    .values({ ...ref.product, createdBy: userId })
    .returning();
  return product!;
}

/** The holding already registered with this transaction ID, if any. */
export async function findHoldingByOrder(
  db: Db | Tx,
  userId: string,
  orderSource: string,
  orderId: string,
): Promise<Holding | null> {
  const [row] = await db
    .select()
    .from(holdings)
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.orderSource, orderSource),
        eq(holdings.orderId, orderId),
      ),
    )
    .orderBy(holdings.createdAt)
    .limit(1);
  return row ?? null;
}

/**
 * Normalizes the order fields and refuses a second registration of a single-item transaction
 * (SNKRDUNK / Mercari / Yahoo IDs are one item each). `exceptId` skips the holding being edited.
 */
async function checkOrder(
  tx: Tx,
  userId: string,
  acquiredFrom: string | null | undefined,
  orderId: string | null | undefined,
  exceptId?: string,
): Promise<{ orderSource: string | null; orderId: string | null }> {
  const id = orderId?.normalize('NFKC').trim() || null;
  const source = id ? orderSourceOf(acquiredFrom) : null;
  if (id && source && SINGLE_ITEM_ORDER_SOURCES.includes(source)) {
    const existing = await findHoldingByOrder(tx, userId, source, id);
    if (existing && existing.id !== exceptId) {
      throw new DomainError('duplicate_order', existing.id);
    }
  }
  return { orderSource: source, orderId: id };
}

async function insertHolding(
  tx: Tx,
  userId: string,
  productId: string,
  input: HoldingInput,
): Promise<Holding> {
  assertQuantity(input.quantity);
  assertYen(input.costTotalJpy);
  if ((input.acquisitionType === 'pull') !== Boolean(input.parentHoldingId)) {
    throw new DomainError('invalid_input');
  }
  const order = await checkOrder(tx, userId, input.acquiredFrom, input.orderId);
  const [holding] = await tx
    .insert(holdings)
    .values({ ...input, ...order, userId, productId })
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

export async function createProduct(db: Db, userId: string, input: ProductInput): Promise<Product> {
  assertProductInput(input);
  const [product] = await db
    .insert(products)
    .values({ ...input, createdBy: userId })
    .returning();
  return product!;
}

/** Products are shared: only their creator or an admin may edit them. */
export async function updateProduct(
  db: Db,
  actor: Pick<User, 'id' | 'role'>,
  id: string,
  input: ProductInput,
): Promise<Product> {
  assertProductInput(input);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(products).where(eq(products.id, id));
    if (!current) throw new DomainError('not_found');
    if (actor.role !== 'admin' && current.createdBy !== actor.id) {
      throw new DomainError('forbidden');
    }
    const [product] = await tx.update(products).set(input).where(eq(products.id, id)).returning();
    return product!;
  });
}

export function canEditProduct(actor: Pick<User, 'id' | 'role'>, product: Product): boolean {
  return actor.role === 'admin' || product.createdBy === actor.id;
}

// ---------------------------------------------------------------------------------------------
// holdings

/** Registers a lot (creating its product first when needed) with its `acquired` event. */
export async function createHolding(
  db: Db,
  userId: string,
  ref: ProductRef,
  input: HoldingInput,
): Promise<{ holding: Holding; product: Product }> {
  return db.transaction(async (tx) => {
    const product = await resolveProduct(tx, userId, ref);
    if (input.parentHoldingId) {
      const parent = await loadHolding(tx, userId, input.parentHoldingId);
      if (productClass(parent.product) !== 'sealed') throw new DomainError('not_sealed');
    }
    return { product, holding: await insertHolding(tx, userId, product.id, input) };
  });
}

/**
 * Logs a card pulled from a sealed product. Cost is 0 (the box keeps its cost); a new card
 * inherits franchise, region and set from the box.
 */
export async function addPull(
  db: Db,
  userId: string,
  parentHoldingId: string,
  ref: { productId: string } | { card: Pick<ProductInput, 'name' | 'cardNumber' | 'rarity'> },
  input: { quantity: number; rawGrade: RawGrade; acquiredAt: string },
): Promise<{ holding: Holding; product: Product }> {
  return db.transaction(async (tx) => {
    const parent = await loadHolding(tx, userId, parentHoldingId);
    if (productClass(parent.product) !== 'sealed') throw new DomainError('not_sealed');
    const box = parent.product;
    const product = await resolveProduct(
      tx,
      userId,
      'productId' in ref
        ? ref
        : {
            product: {
              category: 'tcg',
              kind: 'single',
              franchise: box.franchise,
              region: box.region,
              setId: box.setId,
              setName: box.setName,
              setCode: box.setCode,
              ...ref.card,
            },
          },
    );
    const holding = await insertHolding(tx, userId, product.id, {
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
    | 'orderId'
  >
>;

/** Corrects recorded facts. Logged as a `note` event with `kind: 'edit'` and before/after. */
export async function editHolding(
  db: Db,
  userId: string,
  id: string,
  edit: HoldingEdit,
  occurredAt: string = toTokyoIso(),
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    if (edit.quantity !== undefined) assertQuantity(edit.quantity);
    if (edit.costTotalJpy !== undefined) assertYen(edit.costTotalJpy);
    const nextType = edit.acquisitionType ?? holding.acquisitionType;
    if ((nextType === 'pull') !== Boolean(holding.parentHoldingId)) {
      throw new DomainError('invalid_input');
    }

    let patch: HoldingEdit & { orderSource?: string | null } = edit;
    const orderChanged =
      (edit.orderId !== undefined && (edit.orderId || null) !== holding.orderId) ||
      (edit.acquiredFrom !== undefined &&
        holding.orderId &&
        edit.acquiredFrom !== holding.acquiredFrom);
    if (orderChanged) {
      const order = await checkOrder(
        tx,
        userId,
        edit.acquiredFrom ?? holding.acquiredFrom,
        edit.orderId !== undefined ? edit.orderId : holding.orderId,
        id,
      );
      patch = { ...edit, ...order };
    }

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [key, after] of Object.entries(edit) as [keyof HoldingEdit, unknown][]) {
      if (after === undefined || holding[key] === after) continue;
      changes[key] = { before: holding[key], after };
    }
    if (Object.keys(changes).length === 0) throw new DomainError('no_change');

    const [updated] = await tx.update(holdings).set(patch).where(eq(holdings.id, id)).returning();
    await insertEvent(tx, {
      holdingId: id,
      type: 'note',
      occurredAt,
      payload: { kind: 'edit', changes },
    });
    return updated!;
  });
}

/**
 * Sets the grade of owned cards in one go (e.g. a batch bought as PSA 10). A correction of the
 * recorded facts, logged per holding as a `note` event with `kind: 'edit'`. Returns how many
 * holdings changed; non-cards and cards already at that grade are left alone.
 */
export async function setCardGrade(
  db: Db,
  userId: string,
  ids: string[],
  grade: CardGrade,
  occurredAt: string = toTokyoIso(),
): Promise<number> {
  const next =
    grade.grading === 'raw'
      ? { grading: 'raw' as const, rawGrade: grade.rawGrade, grader: null, grade: null }
      : { grading: 'graded' as const, rawGrade: null, grader: grade.grader, grade: grade.grade };
  return db.transaction(async (tx) => {
    let changed = 0;
    for (const id of new Set(ids)) {
      const { holding, product } = await loadHolding(tx, userId, id);
      assertOwned(holding);
      if (productClass(product) !== 'card') throw new DomainError('not_a_card');
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const [key, after] of Object.entries(next) as [keyof typeof next, unknown][]) {
        if (holding[key] !== after) changes[key] = { before: holding[key], after };
      }
      if (Object.keys(changes).length === 0) continue;
      await tx.update(holdings).set(next).where(eq(holdings.id, id));
      await insertEvent(tx, {
        holdingId: id,
        type: 'note',
        occurredAt,
        payload: { kind: 'edit', changes },
      });
      changed++;
    }
    return changed;
  });
}

/** Splits `quantity` units into a new holding; returns the new holding. */
export async function splitOff(
  db: Db,
  userId: string,
  id: string,
  quantity: number,
  occurredAt: string = toTokyoIso(),
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    if (quantity >= holding.quantity) throw new DomainError('invalid_quantity');
    return takeUnits(tx, holding, quantity, occurredAt);
  });
}

export async function markOpened(
  db: Db,
  userId: string,
  id: string,
  input: { quantity: number; packagingState: PackagingState; occurredAt: string },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding, product } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    if (!openedStatesFor(productClass(product)).includes(input.packagingState)) {
      throw new DomainError('invalid_input');
    }
    if (holding.packagingState === input.packagingState) throw new DomainError('no_change');

    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const status = isConsumedAfterOpening(productClass(product), input.packagingState)
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
  userId: string,
  id: string,
  input: { quantity: number; grader: Grader; feeJpy: number; service?: string; occurredAt: string },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding, product } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    assertYen(input.feeJpy);
    if (productClass(product) !== 'card') throw new DomainError('not_a_card');
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
  userId: string,
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
    const { holding } = await loadHolding(tx, userId, id);
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
  userId: string,
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
    const { holding } = await loadHolding(tx, userId, id);
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
  userId: string,
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
    const { holding } = await loadHolding(tx, userId, id);
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
  userId: string,
  id: string,
  input: { text: string; occurredAt: string },
): Promise<void> {
  const text = input.text.trim();
  if (!text) throw new DomainError('invalid_input');
  await db.transaction(async (tx) => {
    await loadHolding(tx, userId, id);
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
export async function deleteHolding(db: Db, userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await loadHolding(tx, userId, id);
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
