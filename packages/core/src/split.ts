import { newId, toTokyoIso } from './time';

export interface Lot {
  id: string;
  quantity: number;
  costTotalJpy: number;
}

export interface SplitEvent {
  id: string;
  holdingId: string;
  type: 'split';
  occurredAt: string;
  amountJpy: null;
  feesJpy: null;
  payload: SplitSourcePayload | SplitTargetPayload;
}

export interface SplitSourcePayload {
  role: 'source';
  toHoldingId: string;
  quantityMoved: number;
  costMovedJpy: number;
  before: { quantity: number; costTotalJpy: number };
  after: { quantity: number; costTotalJpy: number };
}

export interface SplitTargetPayload {
  role: 'target';
  fromHoldingId: string;
  quantity: number;
  costTotalJpy: number;
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
  costTotalJpy: number,
  quantity: number,
  splitQuantity: number,
): number {
  assertInt(costTotalJpy, 'costTotalJpy');
  assertInt(quantity, 'quantity');
  assertInt(splitQuantity, 'splitQuantity');
  if (costTotalJpy < 0) throw new RangeError('costTotalJpy must be >= 0');
  if (quantity < 2) throw new RangeError('a lot needs at least 2 units to split');
  if (splitQuantity < 1 || splitQuantity >= quantity) {
    throw new RangeError(`splitQuantity must be between 1 and ${quantity - 1}`);
  }
  return Math.floor((costTotalJpy * splitQuantity) / quantity);
}

/** Split `splitQuantity` units of a lot into a new holding (requirements section 5, lot rules). */
export function splitHolding<H extends Lot>(
  holding: H,
  splitQuantity: number,
  options: { occurredAt?: string; newHoldingId?: string } = {},
): SplitResult<H> {
  const costMovedJpy = allocateSplitCost(holding.costTotalJpy, holding.quantity, splitQuantity);
  const occurredAt = options.occurredAt ?? toTokyoIso();
  const splitId = options.newHoldingId ?? newId();

  const original: H = {
    ...holding,
    quantity: holding.quantity - splitQuantity,
    costTotalJpy: holding.costTotalJpy - costMovedJpy,
  };
  const split: H = {
    ...holding,
    id: splitId,
    quantity: splitQuantity,
    costTotalJpy: costMovedJpy,
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
        amountJpy: null,
        feesJpy: null,
        payload: {
          role: 'source',
          toHoldingId: splitId,
          quantityMoved: splitQuantity,
          costMovedJpy,
          before: { quantity: holding.quantity, costTotalJpy: holding.costTotalJpy },
          after: { quantity: original.quantity, costTotalJpy: original.costTotalJpy },
        },
      },
      {
        id: newId(),
        holdingId: splitId,
        type: 'split',
        occurredAt,
        amountJpy: null,
        feesJpy: null,
        payload: {
          role: 'target',
          fromHoldingId: holding.id,
          quantity: splitQuantity,
          costTotalJpy: costMovedJpy,
        },
      },
    ],
  };
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be an integer`);
}
