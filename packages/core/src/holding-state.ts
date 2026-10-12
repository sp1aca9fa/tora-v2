import type { HoldingEventType, PackagingState } from './domain';
import type { ProductClass } from './taxonomy';

/** Grader the holding is currently at, derived from its event history (null when not submitted). */
export function pendingGrading(
  events: readonly { type: HoldingEventType; occurredAt: string; payload?: unknown }[],
): { grader: string | null; since: string } | null {
  const grading = events
    .filter((e) => e.type === 'grading_submitted' || e.type === 'grading_returned')
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = grading.at(-1);
  if (!last || last.type !== 'grading_submitted') return null;
  const grader = (last.payload as { grader?: unknown } | null)?.grader;
  return { grader: typeof grader === 'string' ? grader : null, since: last.occurredAt };
}

/** Packaging states an item can be put in by "mark opened". */
export function openedStatesFor(cls: ProductClass): PackagingState[] {
  return cls === 'sealed' ? ['box_opened_contents_sealed', 'opened', 'empty'] : ['opened', 'empty'];
}

/** A sealed TCG product whose packs are opened is used up (its value now lives in the pulls). */
export function isConsumedAfterOpening(cls: ProductClass, state: PackagingState): boolean {
  return cls === 'sealed' && (state === 'opened' || state === 'empty');
}

/** Integer yen per unit, rounded. */
export function unitCost(costTotalJpy: number, quantity: number): number {
  return quantity > 0 ? Math.round(costTotalJpy / quantity) : 0;
}

/**
 * How a lot counts in the portfolio (requirements S8): an investment (cost and value, with P/L),
 * value only (bought to use: worth shown, no P/L), cost only, or not tracked.
 */
export const TRACKING_MODES = ['investment', 'value_only', 'cost_only', 'untracked'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export function trackingMode(lot: { countInCost: boolean; countInValue: boolean }): TrackingMode {
  if (lot.countInCost && lot.countInValue) return 'investment';
  if (lot.countInValue) return 'value_only';
  if (lot.countInCost) return 'cost_only';
  return 'untracked';
}
