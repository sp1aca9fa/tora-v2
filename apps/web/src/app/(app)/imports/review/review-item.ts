import { conditionListOf, productClass } from '@tora/core';
import type { Holding, Product } from '@tora/db';

export interface ReviewItem {
  id: string;
  productId: string;
  importRunId: string | null;
  /** Which review controls it gets: by its condition list (card grades, sealed, the rest). */
  cls: 'card' | 'sealed' | 'item';
  name: string;
  details: string;
  acquiredAt: string;
  orderId: string | null;
  costBase: number;
  quantity: number;
  packagingState: string | null;
  /** Why it was flagged (e.g. `deadline_missed`, `no_delivery`). */
  reasons: string[];
  /** What is already recorded (a lot flagged again keeps its grade). */
  grading: string | null;
  rawGrade: string | null;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
}

/** A lot waiting for the import review, as the review controls show it. */
export function reviewItemOf(holding: Holding, product: Product): ReviewItem {
  return {
    id: holding.id,
    productId: product.id,
    importRunId: holding.importRunId,
    cls:
      ({ card_grades: 'card', sealed: 'sealed' } as Record<string, ReviewItem['cls']>)[
        conditionListOf(productClass(product))
      ] ?? 'item',
    name: product.name,
    details: [product.rarity, product.setCode, product.cardNumber].filter(Boolean).join(' '),
    acquiredAt: holding.acquiredAt.slice(0, 10),
    orderId: holding.orderId,
    costBase: holding.costTotalBase,
    quantity: holding.quantity,
    packagingState: holding.packagingState,
    reasons: (holding.reviewReason ?? '').split(',').filter(Boolean),
    grading: holding.grading,
    rawGrade: holding.rawGrade,
    grader: holding.grader,
    grade: holding.grade,
    certNumber: holding.certNumber,
  };
}
