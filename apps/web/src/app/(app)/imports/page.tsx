import { productClass } from '@tora/core';
import { pendingImportReview } from '@tora/db';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { ReviewForm, type ReviewItem } from './review-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports'))('title') };
}

export default async function ImportReviewPage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([pendingImportReview(db, user.id), getTranslations()]);
  const items: ReviewItem[] = rows.map(({ holding, product }) => {
    const cls = productClass(product);
    return {
      id: holding.id,
      cls,
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
  });

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('portfolio.title')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('imports.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('imports.intro')}</p>
      </header>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('imports.none')}
        </p>
      ) : (
        <ReviewForm items={items} />
      )}
    </div>
  );
}
