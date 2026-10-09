import { productClass, tokyoDate } from '@tora/core';
import { getHoldingDetail } from '@tora/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { addPullAction } from '../actions';
import { PullLogger } from './pull-logger';

export default async function PullsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, id);
  if (!detail || productClass(detail.product) !== 'sealed') notFound();
  const t = await getTranslations();
  const pulls = detail.children.toReversed();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{detail.product.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('holding.logPulls')}</h1>
      </header>

      <PullLogger action={addPullAction.bind(null, id)} today={tokyoDate()} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t('holding.pulls', { count: pulls.length })}</h2>
        {pulls.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {pulls.map((c) => (
              <li key={c.holding.id} className="flex justify-between gap-3 px-3 py-2">
                <Link href={`/holdings/${c.holding.id}`} className="hover:underline">
                  {c.product.name}
                  {c.product.rarity && (
                    <span className="text-muted-foreground"> {c.product.rarity}</span>
                  )}
                </Link>
                <span className="shrink-0 text-muted-foreground">
                  Raw {c.holding.rawGrade ?? '-'} × {c.holding.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button asChild variant="outline">
        <Link href={`/holdings/${id}`}>{t('pulls.done')}</Link>
      </Button>
    </div>
  );
}
