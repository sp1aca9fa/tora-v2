import { type MissingSource, STORE_LINK_MIN_COST, missingPriceSources } from '@tora/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { formatJpy } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('coverage'))('title') };
}

/**
 * Items without their stable price source (requirements S7): cards not linked to SNKRDUNK, other
 * items over ¥3,000 not linked to 駿河屋. Each links to the item's price sources to confirm a
 * suggestion or paste a link.
 */
export default async function CoveragePage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([missingPriceSources(db, user.id), getTranslations()]);
  const section = (source: MissingSource['source'], list: MissingSource[]) =>
    list.length > 0 && (
      <section className="space-y-2">
        <h2 className="font-semibold">{t(`coverage.${source}.title`, { count: list.length })}</h2>
        <p className="text-sm text-muted-foreground">
          {t(`coverage.${source}.intro`, { amount: formatJpy(STORE_LINK_MIN_COST) })}
        </p>
        <ul className="divide-y rounded-xl border bg-card">
          {list.map((m) => (
            <li key={m.product.id}>
              <Link
                href={`/products/${m.product.id}#sources`}
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[m.product.setCode, m.product.cardNumber].filter(Boolean).join(' ')}
                    {(m.product.setCode || m.product.cardNumber) && ' · '}
                    {m.suggestions > 0
                      ? t('coverage.suggestions', { count: m.suggestions })
                      : t('coverage.noSuggestion')}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t('portfolio.spentShort', { amount: formatJpy(m.costJpy) })}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-6">
      <Link
        href="/imports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('nav.imports')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('coverage.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('coverage.intro')}</p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('coverage.none')}
        </p>
      ) : (
        <>
          {section(
            'snkrdunk',
            rows.filter((r) => r.source === 'snkrdunk'),
          )}
          {section(
            'surugaya',
            rows.filter((r) => r.source === 'surugaya'),
          )}
        </>
      )}
    </div>
  );
}
