import { newId, toLocalIso } from './time';

export interface Lot {
  id: string;
  quantity: number;
  costTotalBase: number;
}

export interface SplitEvent {
  id: string;
  holdingId: string;
  type: 'split';
  occurredAt: string;
  amountBase: null;
  feesBase: null;
  payload: SplitSourcePayload | SplitTargetPayload;
}

export interface SplitSourcePayload {
  role: 'source';
  toHoldingId: string;
  quantityMoved: number;
  costMovedBase: number;
  before: { quantity: number; costTotalBase: number };
  after: { quantity: number; costTotalBase: number };
}

export interface SplitTargetPayload {
  role: 'target';
  fromHoldingId: string;
  quantity: number;
  costTotalBase: number;
}

export interface SplitResult<H extends Lot> {
  /** The original holding with reduced quantity and cost. */
  original: H;
  /** The new holding carrying the split-off units; copies every other field. */
  split: H;
  /** One `split` event for each side. */
  events: [SplitEvent, SplitEvent];
}

/**
 * Cost moved to a split of `splitQuantity` units out of `quantity`.
 * Proportional, integer yen, rounded down so the remainder stays on the original lot.
 */
export function allocateSplitCost(
  costTotalBase: number,
  quantity: number,
  splitQuantity: number,
): number {
  assertInt(costTotalBase, 'costTotalBase');
  assertInt(quantity, 'quantity');
  assertInt(splitQuantity, 'splitQuantity');
  if (costTotalBase < 0) throw new RangeError('costTotalBase must be >= 0');
  if (quantity < 2) throw new RangeError('a lot needs at least 2 units to split');
  if (splitQuantity < 1 || splitQuantity >= quantity) {
    throw new RangeError(`splitQuantity must be between 1 and ${quantity - 1}`);
  }
  return Math.floor((costTotalBase * splitQuantity) / quantity);
}

/** Split `splitQuantity` units of a lot into a new holding (requirements section 5, lot rules). */
export function splitHolding<H extends Lot>(
  holding: H,
  splitQuantity: number,
  options: { occurredAt?: string; newHoldingId?: string } = {},
): SplitResult<H> {
  const costMovedBase = allocateSplitCost(holding.costTotalBase, holding.quantity, splitQuantity);
  const occurredAt = options.occurredAt ?? toLocalIso();
  const splitId = options.newHoldingId ?? newId();

  const original: H = {
    ...holding,
    quantity: holding.quantity - splitQuantity,
    costTotalBase: holding.costTotalBase - costMovedBase,
  };
  const split: H = {
    ...holding,
    id: splitId,
    quantity: splitQuantity,
    costTotalBase: costMovedBase,
  };

  return {
    original,
    split,
    events: [
      {
        id: newId(),
        holdingId: holding.id,
        type: 'split',
        occurredAt,
        amountBase: null,
        feesBase: null,
        payload: {
          role: 'source',
          toHoldingId: splitId,
          quantityMoved: splitQuantity,
          costMovedBase,
          before: { quantity: holding.quantity, costTotalBase: holding.costTotalBase },
          after: { quantity: original.quantity, costTotalBase: original.costTotalBase },
        },
      },
      {
        id: newId(),
        holdingId: splitId,
        type: 'split',
        occurredAt,
        amountBase: null,
        feesBase: null,
        payload: {
          role: 'target',
          fromHoldingId: holding.id,
          quantity: splitQuantity,
          costTotalBase: costMovedBase,
        },
      },
    ],
  };
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`);
}
