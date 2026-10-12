import { pendingImportReview } from '@tora/db';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { ReviewForm } from './review-form';
import { reviewItemOf } from './review-item';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports'))('title') };
}

export default async function ImportReviewPage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([pendingImportReview(db, user.id), getTranslations()]);
  const items = rows.map(({ holding, product }) => reviewItemOf(holding, product));

  return (
    <div className="space-y-4">
      <Link
        href="/imports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('nav.imports')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('imports.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('imports.intro')}</p>
      </header>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('imports.none')}{' '}
          <Link href="/imports" className="underline">
            {t('imports.hub.back')}
          </Link>
        </p>
      ) : (
        <ReviewForm items={items} />
      )}
    </div>
  );
}
