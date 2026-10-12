import { productClass } from '@tora/core';
import type { Holding, Product } from '@tora/db';

export interface ReviewItem {
  id: string;
  productId: string;
  importRunId: string | null;
  cls: 'card' | 'sealed' | 'item';
  name: string;
  details: string;
  acquiredAt: string;
  orderId: string | null;
  costJpy: number;
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
    cls: productClass(product),
    name: product.name,
    details: [product.rarity, product.setCode, product.cardNumber].filter(Boolean).join(' '),
    acquiredAt: holding.acquiredAt.slice(0, 10),
    orderId: holding.orderId,
    costJpy: holding.costTotalJpy,
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
