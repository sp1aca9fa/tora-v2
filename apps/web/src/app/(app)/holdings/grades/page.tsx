import { ownedCards } from '@tora/db';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { GradesForm } from './grades-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('grades'))('title') };
}

export default async function GradesPage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([ownedCards(db, user.id), getTranslations()]);
  const cards = rows.map(({ holding, product }) => ({
    id: holding.id,
    name: product.name,
    details: [product.rarity, product.setCode, product.cardNumber].filter(Boolean).join(' '),
    quantity: holding.quantity,
    acquiredAt: holding.acquiredAt.slice(0, 10),
    grade:
      holding.grading === 'graded'
        ? `${holding.grader === 'other' ? t('common.other') : holding.grader} ${holding.grade}`
        : holding.rawGrade
          ? `Raw ${holding.rawGrade}`
          : null,
  }));

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('portfolio.title')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('grades.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('grades.intro')}</p>
      </header>
      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('grades.none')}
        </p>
      ) : (
        <GradesForm cards={cards} />
      )}
    </div>
  );
}
