import {
  type HoldingEventType,
  PACKAGED_TYPES,
  type PackagingState,
  type ProductType,
} from './domain';

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
export function openedStatesFor(type: ProductType): PackagingState[] {
  return type === 'sealed_tcg'
    ? ['box_opened_contents_sealed', 'opened', 'empty']
    : ['opened', 'empty'];
}

/** A sealed TCG product whose packs are opened is used up (its value now lives in the pulls). */
export function isConsumedAfterOpening(type: ProductType, state: PackagingState): boolean {
  return type === 'sealed_tcg' && (state === 'opened' || state === 'empty');
}

/** True when the string contains Japanese script (used to route a single name field). */
export function hasJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/.test(text);
}

/** Integer yen per unit, rounded. */
export function unitCost(costTotalJpy: number, quantity: number): number {
  return quantity > 0 ? Math.round(costTotalJpy / quantity) : 0;
}

export type ProductField =
  | 'franchise'
  | 'setName'
  | 'setCode'
  | 'cardNumber'
  | 'rarity'
  | 'language'
  | 'releaseDate'
  | 'retailPriceJpy';

/** Optional product fields that make sense for each type (the form shows only these). */
export const PRODUCT_FIELDS: Record<ProductType, readonly ProductField[]> = {
  card_single: ['franchise', 'setName', 'setCode', 'cardNumber', 'rarity', 'language'],
  sealed_tcg: ['franchise', 'setName', 'setCode', 'language', 'releaseDate', 'retailPriceJpy'],
  game_ce: ['franchise', 'releaseDate', 'retailPriceJpy'],
  game: ['franchise', 'releaseDate', 'retailPriceJpy'],
  amiibo: ['franchise', 'releaseDate', 'retailPriceJpy'],
  controller: ['franchise', 'releaseDate', 'retailPriceJpy'],
  figure: ['franchise', 'releaseDate', 'retailPriceJpy'],
  other: ['franchise', 'releaseDate', 'retailPriceJpy'],
};

/** Which condition dimensions a holding of this type records. */
export function holdingFieldsFor(type: ProductType): {
  condition: boolean;
  packaging: boolean;
  grading: boolean;
} {
  if (type === 'card_single') return { condition: false, packaging: false, grading: true };
  if (type === 'sealed_tcg') return { condition: false, packaging: true, grading: false };
  return { condition: true, packaging: PACKAGED_TYPES.includes(type), grading: false };
}
