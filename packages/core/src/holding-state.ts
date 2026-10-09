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
