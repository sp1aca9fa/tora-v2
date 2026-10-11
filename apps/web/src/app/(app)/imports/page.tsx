import { productClass } from '@tora/core';
import { pendingImportReview, purchaseLinksOf } from '@tora/db';
import { ChevronLeft, RotateCw, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { Button } from '@/components/ui/button';
import { removeLinkAction, retryLinkAction } from './actions';
import { LinksForm } from './links-form';
import { ReviewForm, type ReviewItem } from './review-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports'))('title') };
}

export default async function ImportReviewPage() {
  const { db, user } = await authed();
  const [rows, links, t] = await Promise.all([
    pendingImportReview(db, user.id),
    purchaseLinksOf(db, user.id, 50),
    getTranslations(),
  ]);
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

  const failed = links.filter((l) => l.status === 'failed');
  const others = links.filter((l) => l.status !== 'failed');
  const linkRow = (l: (typeof links)[number]) => (
    <li key={l.id} className="flex items-start gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <a
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-muted-foreground hover:text-foreground"
        >
          {l.url.replace(/^https?:\/\//, '')}
        </a>
        <p className="text-xs">
          <span className={l.status === 'failed' ? 'text-destructive' : 'font-medium'}>
            {t(`imports.links.status.${l.status}`)}
          </span>
          {l.message && <span className="text-muted-foreground"> · {l.message}</span>}
          {l.holdingId && (
            <>
              {' · '}
              <Link href={`/holdings/${l.holdingId}`} className="underline">
                {t('imports.links.open')}
              </Link>
            </>
          )}
        </p>
      </div>
      {l.status === 'failed' && (
        <form action={retryLinkAction.bind(null, l.id)}>
          <Button type="submit" variant="ghost" size="icon" aria-label={t('imports.links.retry')}>
            <RotateCw className="size-4" />
          </Button>
        </form>
      )}
      {l.status !== 'imported' && l.status !== 'matched' && (
        <form action={removeLinkAction.bind(null, l.id)}>
          <Button type="submit" variant="ghost" size="icon" aria-label={t('imports.links.remove')}>
            <X className="size-4" />
          </Button>
        </form>
      )}
    </li>
  );

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
      {failed.length > 0 && (
        <section id="failed" className="scroll-mt-20 space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('imports.links.failedTitle', { count: failed.length })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('imports.links.failedIntro')}{' '}
            <Link href="/add" className="underline">
              {t('imports.links.addByHand')}
            </Link>
          </p>
          <ul className="divide-y rounded-xl border bg-card text-sm">{failed.map(linkRow)}</ul>
        </section>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('imports.none')}
        </p>
      ) : (
        <ReviewForm items={items} />
      )}

      <section id="links" className="scroll-mt-20 space-y-3">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{t('imports.links.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('imports.links.intro')}</p>
        </header>
        <LinksForm />
        {others.length > 0 && (
          <ul className="divide-y rounded-xl border bg-card text-sm">{others.map(linkRow)}</ul>
        )}
      </section>
    </div>
  );
}
