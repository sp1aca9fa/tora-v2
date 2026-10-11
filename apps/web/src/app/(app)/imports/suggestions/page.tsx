import { type SuggestionListing, openSuggestions, reviewNotes } from '@tora/db';
import { ChevronLeft, ExternalLink, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { getTranslations as GetT } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { authed } from '@/lib/auth/guard';
import { sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { clearNoteAction, decideSuggestionAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('suggestions'))('title') };
}

/** Fixes the automated data review proposes (requirements S4d); nothing changes until accepted. */
export default async function SuggestionsPage() {
  const { db, user } = await authed();
  const [rows, notes, t] = await Promise.all([
    openSuggestions(db, user.id),
    reviewNotes(db, user.id),
    getTranslations(),
  ]);
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
            const listings = (evidence.listings as SuggestionListing[] | undefined) ?? [];
            const keptCount = listings.filter((l) => l.kept).length;
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
                    {evidence.url ? (
                      <a
                        href={String(evidence.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium underline"
                      >
                        {t(
                          evidence.title
                            ? 'suggestions.openListing'
                            : 'suggestions.openProductPage',
                          { source: sourceLabel(String(evidence.source ?? '')) },
                        )}
                        <ExternalLink className="size-3" />
                      </a>
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
                    {listings.length > 0 && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {t('suggestions.wordListings', { kept: keptCount })}
                        </p>
                        <ListingList listings={listings} t={t} />
                      </>
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
                    {listings.length > 0 && (
                      <>
                        <p className="text-xs text-muted-foreground">{t('suggestions.seenIn')}</p>
                        <ListingList listings={listings} t={t} />
                      </>
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
                <form className="space-y-2">
                  <Textarea
                    name="note"
                    rows={1}
                    maxLength={1000}
                    placeholder={t('suggestions.notePlaceholder')}
                    aria-label={t('suggestions.noteLabel')}
                    className="min-h-9 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      formAction={decideSuggestionAction.bind(null, s.id, true)}
                    >
                      {t(`suggestions.accept.${s.kind}`)}
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      formAction={decideSuggestionAction.bind(null, s.id, false)}
                    >
                      {t('suggestions.dismiss')}
                    </Button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{t('suggestions.notesTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('suggestions.notesIntro')}</p>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="whitespace-pre-wrap">{n.note}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`suggestions.kind.${n.kind}`)} · {t(`suggestions.decision.${n.status}`)}
                    {n.productName ? ` · ${n.productName}` : ''}
                  </p>
                </div>
                <form action={clearNoteAction.bind(null, n.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={t('suggestions.deleteNote')}
                  >
                    <X className="size-4" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Collected listings behind a suggestion, each opening the listing on its site. */
function ListingList({
  listings,
  t,
}: {
  listings: SuggestionListing[];
  t: Awaited<ReturnType<typeof GetT>>;
}) {
  return (
    <ul className="space-y-1 text-xs">
      {listings.map((l) => (
        <li key={l.url ?? l.title} className="flex items-baseline gap-2">
          <span
            className={
              l.kept
                ? 'shrink-0 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300'
                : 'shrink-0 rounded bg-muted px-1 text-muted-foreground'
            }
          >
            {t(l.kept ? 'suggestions.counted' : 'suggestions.leftOut')}
          </span>
          {l.url ? (
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate underline decoration-muted-foreground/50"
            >
              {l.title}
            </a>
          ) : (
            <span className="min-w-0 truncate">{l.title}</span>
          )}
          <span className="shrink-0 text-muted-foreground">{formatJpy(l.priceJpy)}</span>
        </li>
      ))}
    </ul>
  );
}
