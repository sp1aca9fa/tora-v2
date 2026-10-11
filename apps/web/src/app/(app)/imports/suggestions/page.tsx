import { openSuggestions } from '@tora/db';
import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { decideSuggestionAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('suggestions'))('title') };
}

/** Fixes the automated data review proposes (requirements S4d); nothing changes until accepted. */
export default async function SuggestionsPage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([openSuggestions(db, user.id), getTranslations()]);
  const fieldLabel = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f);
  const empty = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));

  return (
    <div className="space-y-6">
      <Link
        href="/imports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {t('nav.imports')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('suggestions.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('suggestions.intro')}</p>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t('suggestions.none')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ suggestion: s, product }) => {
            const payload = s.payload as Record<string, unknown>;
            const evidence = (s.evidence ?? {}) as Record<string, unknown>;
            const titles = (evidence.titles as string[] | undefined) ?? [];
            return (
              <li key={s.id} className="space-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(`suggestions.kind.${s.kind}`)}</span>
                  {product && (
                    <Link
                      href={`/products/${product.id}`}
                      className="min-w-0 truncate text-muted-foreground underline"
                    >
                      {product.name}
                    </Link>
                  )}
                </div>

                {s.kind === 'exclude_sale' && (
                  <div className="space-y-0.5">
                    <p>
                      {t('suggestions.sale', {
                        price: formatJpy(Number(evidence.priceJpy)),
                        date: String(evidence.date ?? ''),
                        source: sourceLabel(String(evidence.source ?? '')),
                        value: formatJpy(Number(evidence.valueJpy)),
                      })}
                    </p>
                    {evidence.title ? (
                      <p className="text-muted-foreground">{String(evidence.title)}</p>
                    ) : null}
                    {payload.unsure ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t('suggestions.unsure')}
                      </p>
                    ) : null}
                  </div>
                )}

                {s.kind === 'exclude_word' && (
                  <div className="space-y-1">
                    <p>
                      {t('suggestions.word', {
                        word: String(payload.word),
                        source: sourceLabel(String(payload.source ?? '')),
                      })}
                    </p>
                    {titles.length > 0 && (
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        {titles.slice(0, 5).map((title) => (
                          <li key={title} className="truncate">
                            {title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {s.kind === 'fix_product' && (
                  <div className="space-y-1">
                    <table className="text-xs">
                      <tbody>
                        {Object.entries(
                          (payload.changes ?? {}) as Record<string, string | null>,
                        ).map(([field, after]) => (
                          <tr key={field}>
                            <td className="pr-3 text-muted-foreground">{fieldLabel(field)}</td>
                            <td className="pr-2 text-muted-foreground line-through">
                              {empty((evidence.before as Record<string, unknown>)?.[field])}
                            </td>
                            <td className="font-medium">{empty(after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {titles.length > 0 && (
                      <p className="truncate text-xs text-muted-foreground">
                        {t('suggestions.seenIn', { title: titles[0]! })}
                      </p>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {t('suggestions.why', {
                    reason: s.reason,
                    model: (s.model ?? '').replace(/^claude-/, ''),
                    confidence: Math.round((s.confidence ?? 0) * 100),
                  })}
                </p>
                <div className="flex gap-2">
                  <form action={decideSuggestionAction.bind(null, s.id, true)}>
                    <Button type="submit" size="sm">
                      {t(`suggestions.accept.${s.kind}`)}
                    </Button>
                  </form>
                  <form action={decideSuggestionAction.bind(null, s.id, false)}>
                    <Button type="submit" size="sm" variant="outline">
                      {t('suggestions.dismiss')}
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
