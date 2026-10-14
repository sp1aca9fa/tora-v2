import { importRunDetail } from '@tora/db';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { sourceLabels } from '@/lib/sources';
import { authed } from '@/lib/auth/guard';
import { lotConditionLabel } from '@/lib/product-display';
import { getMoney } from '@/lib/money-server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports.hub'))('runTitle') };
}

/** One import run: what it did, the lots it created and the links it read. */
export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const money = await getMoney();
  const sourceLabel = await sourceLabels();
  const { id } = await params;
  const { db, user } = await authed();
  const [detail, t, format] = await Promise.all([
    importRunDetail(db, user.id, id),
    getTranslations(),
    getFormatter(),
  ]);
  if (!detail) notFound();
  const { run, lots, links } = detail;
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-6">
      <Link
        href="/imports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('nav.imports')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t(`imports.hub.method.${run.method}`)}
          {run.source ? ` · ${sourceLabel(run.source)}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{dateTime(run.startedAt)}</p>
      </header>

      <ul className="flex flex-wrap gap-2 text-sm">
        {Object.entries(run.counts).map(([k, n]) => (
          <li key={k} className="rounded-full border bg-card px-3 py-1">
            {t.has(`imports.hub.count.${k}`)
              ? t(`imports.hub.count.${k}`, { count: n })
              : `${k} ${n}`}
          </li>
        ))}
      </ul>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {t('imports.hub.lots', { count: lots.length })}
        </h2>
        {lots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('imports.hub.noLots')}</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {lots.map(({ holding, product }) => (
              <li key={holding.id}>
                <Link
                  href={`/holdings/${holding.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="amount block truncate text-xs text-muted-foreground">
                      {[
                        holding.acquiredAt.slice(0, 10),
                        money(holding.costTotalBase),
                        holding.quantity > 1 && `× ${holding.quantity}`,
                        lotConditionLabel(holding, product, t),
                        holding.status !== 'owned' && t(`status.${holding.status}`),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {holding.reviewPending && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                      {t('product.toReview')}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {links.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('imports.hub.linksRead', { count: links.length })}
          </h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {links.map((l) => (
              <li key={l.id} className="space-y-0.5 px-4 py-2.5">
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
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
