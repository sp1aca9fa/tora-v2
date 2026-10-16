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
  fieldsFor,
  itemTypeOf,
  resolveTaxonomy,
  kindsForSetType,
  orderSourceOf,
  singleItemOrders,
  openedStatesFor,
  pendingGrading,
  productClass,
  splitHolding,
  toLocalIso,
} from '@tora/core';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from './client';
import { findSameCard } from './similar';
import { loadSourceRegistry } from './registry';
import { clearBucketValues } from './valuation';
import {
  type Holding,
  type NewHoldingEvent,
  type NewProduct,
  type Product,
  type User,
  cancelledOrders,
  holdingEvents,
  holdings,
  manualPrices,
  priceObservations,
  productImages,
  productSources,
  products,
  sourceCandidates,
  sourceWarningDismissals,
  tcgSets,
  valuationSnapshots,
  watches,
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
  | 'duplicate_order'
  | 'no_rate'
  | 'invalid_time_zone'
  | 'duplicate_watch';

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
  costTotalBase: number;
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
  /** A value of the admin's condition list (S16). */
  conditionValue?: string | null;
  notes?: string | null;
  /** Transaction / order ID at the place of purchase (e.g. a SNKRDUNK 取引ID). */
  orderId?: string | null;
  /** Portfolio tracking (S8); both on unless the lot is bought to use. */
  countInCost?: boolean;
  countInValue?: boolean;
  /** Set by imports: the holding waits for the import review in the app. */
  reviewPending?: boolean;
  /** Why it waits for review (comma-separated reasons, e.g. `deadline_missed`). */
  reviewReason?: string | null;
  /** The import that created it (Imports history). */
  importRunId?: string | null;
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

/**
 * A product as saved: its category and kind must be the admin's (S16), its item type follows
 * them, and only its category's custom fields are kept.
 */
async function checkedProduct(
  tx: Pick<Db, 'select'>,
  input: ProductInput,
): Promise<ProductInput & { itemType: string }> {
  if (!input.name?.trim()) throw new DomainError('invalid_input');
  const taxonomy = (await loadSourceRegistry(tx)).taxonomy ?? resolveTaxonomy(null);
  const itemType = itemTypeOf(taxonomy, input.category, input.kind);
  if (!itemType) throw new DomainError('invalid_input');
  const custom = new Set(
    fieldsFor(taxonomy, input.category, input.kind)
      .filter((f) => !f.standard)
      .map((f) => f.key),
  );
  const fields = Object.fromEntries(
    Object.entries(input.fields ?? {}).filter(([k, v]) => custom.has(k) && v !== '' && v !== null),
  );
  return { ...input, itemType, fields: Object.keys(fields).length ? fields : null };
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
    .set({ quantity: result.original.quantity, costTotalBase: result.original.costTotalBase })
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

  const taxonomy = (await loadSourceRegistry(tx)).taxonomy ?? resolveTaxonomy(null);
  const [product] = await tx
    .insert(products)
    .values({
      category: 'tcg',
      kind: ref.kind,
      itemType:
        itemTypeOf(taxonomy, 'tcg', ref.kind) ?? productClass({ category: 'tcg', kind: ref.kind }),
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

/** The product a reference names, created first when new (e.g. an item added to the watchlist). */
export async function resolveProductRef(db: Db, userId: string, ref: ProductRef): Promise<Product> {
  return db.transaction((tx) => resolveProduct(tx, userId, ref));
}

async function resolveProduct(tx: Tx, userId: string, ref: ProductRef): Promise<Product> {
  if ('catalog' in ref) return resolveCatalogProduct(tx, ref.catalog);
  if ('productId' in ref) {
    const [product] = await tx.select().from(products).where(eq(products.id, ref.productId));
    if (!product) throw new DomainError('not_found');
    return product;
  }
  const input = await checkedProduct(tx, ref.product);
  const [product] = await tx
    .insert(products)
    .values({ ...input, createdBy: userId })
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
 * (shops whose orders hold one item each, per the source registry). `exceptId` skips the holding
 * being edited.
 */
async function checkOrder(
  tx: Tx,
  userId: string,
  acquiredFrom: string | null | undefined,
  orderId: string | null | undefined,
  exceptId?: string,
): Promise<{ orderSource: string | null; orderId: string | null }> {
  const id = orderId?.normalize('NFKC').trim() || null;
  const registry = await loadSourceRegistry(tx);
  const source = id ? orderSourceOf(registry, acquiredFrom) : null;
  if (id && source && singleItemOrders(registry, source)) {
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
  assertYen(input.costTotalBase);
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
    amountBase: holding!.costTotalBase,
    // Snapshot of the state as received; a box's "value as received" bucket comes from here.
    payload: {
      quantity: holding!.quantity,
      condition: holding!.condition,
      packagingState: holding!.packagingState,
      grading: holding!.grading,
      rawGrade: holding!.rawGrade,
      grader: holding!.grader,
      grade: holding!.grade,
      conditionValue: holding!.conditionValue,
    },
  });
  return holding!;
}

// ---------------------------------------------------------------------------------------------
// products

export async function createProduct(db: Db, userId: string, input: ProductInput): Promise<Product> {
  const checked = await checkedProduct(db, input);
  const [product] = await db
    .insert(products)
    .values({ ...checked, createdBy: userId })
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
  const checked = await checkedProduct(db, input);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(products).where(eq(products.id, id));
    if (!current) throw new DomainError('not_found');
    if (actor.role !== 'admin' && current.createdBy !== actor.id) {
      throw new DomainError('forbidden');
    }
    const [product] = await tx.update(products).set(checked).where(eq(products.id, id)).returning();
    // Kind, retail price and the like change what the item is worth.
    await clearBucketValues(tx, [id]);
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
    // A card typed with the same name and number as one already registered is that card (it
    // keeps its price sources and portfolio row).
    const same =
      'card' in ref
        ? await findSameCard(tx, { ...ref.card, franchise: box.franchise, region: box.region })
        : null;
    const product = await resolveProduct(
      tx,
      userId,
      same
        ? { productId: same.id }
        : 'productId' in ref
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
      costTotalBase: 0,
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
    | 'costTotalBase'
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
  occurredAt: string = toLocalIso(),
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    if (edit.quantity !== undefined) assertQuantity(edit.quantity);
    if (edit.costTotalBase !== undefined) assertYen(edit.costTotalBase);
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
  occurredAt: string = toLocalIso(),
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

/** One reviewed import row: the card's grade (and cert), or a sealed product's packaging. */
export interface ImportReview {
  id: string;
  grade?: CardGrade | null;
  certNumber?: string | null;
  packagingState?: PackagingState | null;
  /** Corrected purchase time (ISO), e.g. when the import only knew it roughly. */
  acquiredAt?: string | null;
  /** Corrected number of units (e.g. a listing that sold several cards together); cost stays. */
  quantity?: number | null;
}

/**
 * Confirms imported holdings (import review in the app): applies what the user filled in and
 * clears `review_pending`. Changes are logged as `note` edit events. A card left without a grade
 * is still confirmed (it shows up under card grades). Returns how many rows were confirmed.
 */
export async function confirmImportReview(
  db: Db,
  userId: string,
  rows: ImportReview[],
  occurredAt: string = toLocalIso(),
): Promise<number> {
  return db.transaction(async (tx) => {
    let confirmed = 0;
    for (const row of rows) {
      const { holding, product } = await loadHolding(tx, userId, row.id);
      if (!holding.reviewPending) continue;
      const cls = productClass(product);
      const patch: Partial<Holding> = {};
      if (cls === 'card' && row.grade) {
        Object.assign(
          patch,
          row.grade.grading === 'raw'
            ? {
                grading: 'raw',
                rawGrade: row.grade.rawGrade,
                grader: null,
                grade: null,
                certNumber: null,
              }
            : {
                grading: 'graded',
                rawGrade: null,
                grader: row.grade.grader,
                grade: row.grade.grade,
                certNumber: row.certNumber?.trim() || null,
              },
        );
      }
      if (cls === 'sealed' && row.packagingState) {
        // As received: still sealed, with or without shrink (opening is its own action).
        if (!['sealed_shrink', 'sealed_no_shrink'].includes(row.packagingState)) {
          throw new DomainError('invalid_input');
        }
        patch.packagingState = row.packagingState;
      }
      if (row.acquiredAt && row.acquiredAt.slice(0, 10) !== holding.acquiredAt.slice(0, 10)) {
        patch.acquiredAt = row.acquiredAt;
      }
      if (row.quantity != null && row.quantity !== holding.quantity) {
        assertQuantity(row.quantity);
        patch.quantity = row.quantity;
      }
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const [key, after] of Object.entries(patch) as [keyof Holding, unknown][]) {
        if (holding[key] !== after) changes[key] = { before: holding[key], after };
      }
      await tx
        .update(holdings)
        .set({ ...patch, reviewPending: false })
        .where(eq(holdings.id, row.id));
      if (Object.keys(changes).length > 0) {
        await insertEvent(tx, {
          holdingId: row.id,
          type: 'note',
          occurredAt,
          payload: { kind: 'edit', changes },
        });
      }
      confirmed++;
    }
    return confirmed;
  });
}

/** Splits `quantity` units into a new holding; returns the new holding. */
export async function splitOff(
  db: Db,
  userId: string,
  id: string,
  quantity: number,
  occurredAt: string = toLocalIso(),
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
  input: {
    quantity: number;
    grader: Grader;
    feeBase: number;
    service?: string;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding, product } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    assertYen(input.feeBase);
    if (productClass(product) !== 'card') throw new DomainError('not_a_card');
    const events = await tx.select().from(holdingEvents).where(eq(holdingEvents.holdingId, id));
    if (pendingGrading(events)) throw new DomainError('already_at_grader');

    const target = await takeUnits(tx, holding, input.quantity, input.occurredAt);
    const costAfter = target.costTotalBase + input.feeBase;
    const [updated] = await tx
      .update(holdings)
      .set({ costTotalBase: costAfter })
      .where(eq(holdings.id, target.id))
      .returning();
    await insertEvent(tx, {
      holdingId: target.id,
      type: 'grading_submitted',
      occurredAt: input.occurredAt,
      amountBase: input.feeBase,
      payload: {
        quantity: input.quantity,
        grader: input.grader,
        service: input.service ?? null,
        costBefore: target.costTotalBase,
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
    extraFeeBase?: number;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    const extraFee = input.extraFeeBase ?? 0;
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
      costTotalBase: holding.costTotalBase + extraFee,
    };
    const [updated] = await tx.update(holdings).set(after).where(eq(holdings.id, id)).returning();
    await insertEvent(tx, {
      holdingId: id,
      type: 'grading_returned',
      occurredAt: input.occurredAt,
      amountBase: extraFee || null,
      payload: {
        before: {
          grading: holding.grading,
          rawGrade: holding.rawGrade,
          grader: holding.grader,
          grade: holding.grade,
          costTotalBase: holding.costTotalBase,
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
    priceBase: number;
    feesBase: number;
    platform?: string | null;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    assertYen(input.priceBase);
    assertYen(input.feesBase);
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
      amountBase: input.priceBase,
      feesBase: input.feesBase,
      payload: {
        quantity: input.quantity,
        platform: input.platform?.trim() || null,
        costBasisBase: target.costTotalBase,
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
    conditionValue?: string | null;
    occurredAt: string;
  },
): Promise<Holding> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, id);
    assertOwned(holding);
    const patch: Partial<
      Pick<Holding, 'condition' | 'rawGrade' | 'packagingState' | 'grading' | 'conditionValue'>
    > = {};
    const before: Record<string, unknown> = {};
    for (const key of ['condition', 'rawGrade', 'packagingState', 'conditionValue'] as const) {
      const value = input[key];
      if (value === undefined || value === holding[key]) continue;
      Object.assign(patch, { [key]: value });
      before[key] = holding[key];
    }
    // A raw grade given to a card with no grading yet makes it a raw card (else it stays
    // "ungraded" and gets no market value).
    if (input.rawGrade && holding.grading === null) {
      patch.grading = 'raw';
      before.grading = null;
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

/**
 * The order was cancelled (e.g. by the buyer, which sends no email): removes every lot of that
 * order and remembers the ID so imports skip it. Refused when a lot has pulls logged from it.
 */
export async function markOrderCancelled(
  db: Db,
  userId: string,
  holdingId: string,
): Promise<{ orderId: string; removed: number; productId: string }> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, holdingId);
    if (!holding.orderSource || !holding.orderId) throw new DomainError('invalid_input');
    const lots = await tx
      .select({ id: holdings.id })
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.orderSource, holding.orderSource),
          eq(holdings.orderId, holding.orderId),
        ),
      );
    const ids = lots.map((l) => l.id);
    const [children] = await tx
      .select({ n: count() })
      .from(holdings)
      .where(inArray(holdings.parentHoldingId, ids));
    if ((children?.n ?? 0) > 0) throw new DomainError('has_dependents');
    await tx.delete(valuationSnapshots).where(inArray(valuationSnapshots.holdingId, ids));
    await tx.delete(holdingEvents).where(inArray(holdingEvents.holdingId, ids));
    await tx.delete(holdings).where(inArray(holdings.id, ids));
    await tx
      .insert(cancelledOrders)
      .values({ userId, orderSource: holding.orderSource, orderId: holding.orderId })
      .onConflictDoNothing();
    return { orderId: holding.orderId, removed: ids.length, productId: holding.productId };
  });
}

/** Order IDs of one source the user marked as cancelled. */
export async function cancelledOrderIds(
  db: Db,
  userId: string,
  orderSource: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ orderId: cancelledOrders.orderId })
    .from(cancelledOrders)
    .where(and(eq(cancelledOrders.userId, userId), eq(cancelledOrders.orderSource, orderSource)));
  return new Set(rows.map((r) => r.orderId));
}

/**
 * Puts holdings up for review with a reason. A holding already flagged for that reason (even if
 * the user has since confirmed it) is left alone. Returns how many were flagged.
 */
export async function flagForReview(
  db: Db,
  userId: string,
  flags: { holdingId: string; reason: string }[],
): Promise<number> {
  let flagged = 0;
  for (const { holdingId, reason } of flags) {
    const [h] = await db
      .select({ reviewReason: holdings.reviewReason })
      .from(holdings)
      .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)));
    if (!h) continue;
    const reasons = (h.reviewReason ?? '').split(',').filter(Boolean);
    if (reasons.includes(reason)) continue;
    await db
      .update(holdings)
      .set({ reviewPending: true, reviewReason: [...reasons, reason].join(',') })
      .where(eq(holdings.id, holdingId));
    flagged++;
  }
  return flagged;
}

/**
 * Merges a duplicate product into another (same category and kind): its lots, sales data, manual
 * prices, watches and listings move over, then the duplicate is deleted. Listings the target already has,
 * the duplicate's pending suggestions and its picture are dropped. Products are shared, so other
 * users' lots of the duplicate move too (they are the same item).
 */
export async function mergeProducts(
  db: Db,
  actor: Pick<User, 'id' | 'role'>,
  fromId: string,
  intoId: string,
): Promise<Product> {
  if (fromId === intoId) throw new DomainError('invalid_input');
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(products).where(eq(products.id, fromId));
    const [into] = await tx.select().from(products).where(eq(products.id, intoId));
    if (!from || !into) throw new DomainError('not_found');
    if (!canEditProduct(actor, from)) throw new DomainError('forbidden');
    if (from.category !== into.category || from.kind !== into.kind) {
      throw new DomainError('invalid_input');
    }
    await tx.update(holdings).set({ productId: intoId }).where(eq(holdings.productId, fromId));
    await tx
      .update(priceObservations)
      .set({ productId: intoId })
      .where(eq(priceObservations.productId, fromId));
    await tx
      .update(manualPrices)
      .set({ productId: intoId })
      .where(eq(manualPrices.productId, fromId));
    // A watch the target already has (same person and condition) is dropped.
    const intoWatches = await tx
      .select({ userId: watches.userId, bucket: watches.bucket })
      .from(watches)
      .where(eq(watches.productId, intoId));
    const watched = new Set(intoWatches.map((w) => `${w.userId}|${w.bucket}`));
    for (const w of await tx.select().from(watches).where(eq(watches.productId, fromId))) {
      if (watched.has(`${w.userId}|${w.bucket}`)) {
        await tx.delete(watches).where(eq(watches.id, w.id));
      } else {
        await tx.update(watches).set({ productId: intoId }).where(eq(watches.id, w.id));
      }
    }
    const intoListings = await tx
      .select({ source: productSources.source, externalId: productSources.externalId })
      .from(productSources)
      .where(eq(productSources.productId, intoId));
    const has = new Set(intoListings.map((l) => `${l.source}|${l.externalId}`));
    for (const l of await tx
      .select()
      .from(productSources)
      .where(eq(productSources.productId, fromId))) {
      if (has.has(`${l.source}|${l.externalId}`)) {
        await tx.delete(productSources).where(eq(productSources.id, l.id));
      } else {
        await tx
          .update(productSources)
          .set({ productId: intoId })
          .where(eq(productSources.id, l.id));
      }
    }
    await tx.delete(sourceCandidates).where(eq(sourceCandidates.productId, fromId));
    await tx.delete(sourceWarningDismissals).where(eq(sourceWarningDismissals.productId, fromId));
    await tx.delete(productImages).where(eq(productImages.productId, fromId));
    await clearBucketValues(tx, [fromId, intoId]);
    await tx.delete(products).where(eq(products.id, fromId));
    return into;
  });
}

/**
 * Deletes a product nobody holds or watches (e.g. one an import made from a cut-off title, whose lot was
 * merged into another): its listings, sales data, suggestions and picture go with it. Returns
 * false, changing nothing, when any lot still refers to it.
 */
export async function deleteUnusedProduct(db: Db, productId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [used] = await tx
      .select({ n: count() })
      .from(holdings)
      .where(eq(holdings.productId, productId));
    if ((used?.n ?? 0) > 0) return false;
    const [watched] = await tx
      .select({ n: count() })
      .from(watches)
      .where(eq(watches.productId, productId));
    if ((watched?.n ?? 0) > 0) return false;
    await tx.delete(priceObservations).where(eq(priceObservations.productId, productId));
    await tx.delete(manualPrices).where(eq(manualPrices.productId, productId));
    await tx.delete(sourceCandidates).where(eq(sourceCandidates.productId, productId));
    await tx
      .delete(sourceWarningDismissals)
      .where(eq(sourceWarningDismissals.productId, productId));
    await tx.delete(productSources).where(eq(productSources.productId, productId));
    await tx.delete(productImages).where(eq(productImages.productId, productId));
    await clearBucketValues(tx, [productId]);
    await tx.delete(products).where(eq(products.id, productId));
    return true;
  });
}

/**
 * Sets how a lot counts in the portfolio (cost, value, both or neither); with `allOfItem`, every
 * lot of the user's of the same item. Returns how many lots changed.
 */
export async function setLotTracking(
  db: Db,
  userId: string,
  holdingId: string,
  tracking: { countInCost: boolean; countInValue: boolean },
  allOfItem = false,
): Promise<number> {
  return db.transaction(async (tx) => {
    const { holding } = await loadHolding(tx, userId, holdingId);
    const changed = await tx
      .update(holdings)
      .set({ ...tracking, updatedAt: toLocalIso() })
      .where(
        allOfItem
          ? and(eq(holdings.userId, userId), eq(holdings.productId, holding.productId))
          : eq(holdings.id, holdingId),
      )
      .returning({ id: holdings.id });
    return changed.length;
  });
}
