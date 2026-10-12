import { openSuggestions, reviewNotes } from '@tora/db';
import { ChevronLeft, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { clearNoteAction } from './actions';
import { SuggestionCard } from './suggestion-card';

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
          {rows.map(({ suggestion, product }) => (
            <li
              key={suggestion.id}
              className="space-y-2 rounded-xl border bg-card px-4 py-3 text-sm"
            >
              <SuggestionCard suggestion={suggestion} product={product} />
            </li>
          ))}
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
