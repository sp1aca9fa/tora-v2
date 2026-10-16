import type { Product, Suggestion, SuggestionListing } from '@tora/db';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { getTranslations as GetT } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { decideSuggestionAction } from './actions';
import { sourceLabels } from '@/lib/sources';
import type { Money } from '@/lib/money';
import { getMoney } from '@/lib/money-server';

/**
 * One data review suggestion: what it would change, why, and Accept / Dismiss with a note
 * (the data review page and the Actions page).
 */
export async function SuggestionCard({
  suggestion: s,
  product,
  showProduct = true,
}: {
  suggestion: Suggestion;
  product: Product | null;
  /** The item's name and link (the Actions card already shows them). */
  showProduct?: boolean;
}) {
  const money = await getMoney();
  const sourceLabel = await sourceLabels();
  const t = await getTranslations();
  const fieldLabel = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f);
  const empty = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));
  const payload = s.payload as Record<string, unknown>;
  const evidence = (s.evidence ?? {}) as Record<string, unknown>;
  const listings = (evidence.listings as SuggestionListing[] | undefined) ?? [];
  const keptCount = listings.filter((l) => l.kept).length;
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{t(`suggestions.kind.${s.kind}`)}</span>
        {showProduct && product && (
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
          <p className="amount">
            {t('suggestions.sale', {
              price: money(Number(evidence.priceBase)),
              date: String(evidence.date ?? ''),
              source: sourceLabel(String(evidence.source ?? '')),
              value: money(Number(evidence.valueBase)),
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
              {t(evidence.title ? 'suggestions.openListing' : 'suggestions.openProductPage', {
                source: sourceLabel(String(evidence.source ?? '')),
              })}
              <ExternalLink className="size-3" />
            </a>
          ) : null}
          {payload.unsure ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('suggestions.unsure')}</p>
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
              <ListingList money={money} listings={listings} t={t} />
            </>
          )}
        </div>
      )}

      {s.kind === 'fix_product' && (
        <div className="space-y-1">
          <table className="text-xs">
            <tbody>
              {Object.entries((payload.changes ?? {}) as Record<string, string | null>).map(
                ([field, after]) => (
                  <tr key={field}>
                    <td className="pr-3 text-muted-foreground">{fieldLabel(field)}</td>
                    <td className="pr-2 text-muted-foreground line-through">
                      {empty((evidence.before as Record<string, unknown>)?.[field])}
                    </td>
                    <td className="font-medium">{empty(after)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {listings.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{t('suggestions.seenIn')}</p>
              <ListingList money={money} listings={listings} t={t} />
            </>
          )}
        </div>
      )}

      {s.kind === 'link_set' && (
        <div className="space-y-0.5">
          <p>
            {t('suggestions.set', {
              name: String((evidence.set as Record<string, unknown>)?.name ?? ''),
              code: empty((evidence.set as Record<string, unknown>)?.code),
              date: empty((evidence.set as Record<string, unknown>)?.releaseDate),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('suggestions.setBefore', {
              name: empty((evidence.before as Record<string, unknown>)?.setName),
              code: empty((evidence.before as Record<string, unknown>)?.setCode),
            })}
          </p>
        </div>
      )}

      {s.kind !== 'link_set' && (
        <p className="text-xs text-muted-foreground">
          {t('suggestions.why', {
            reason: s.reason,
            model: (s.model ?? '').replace(/^claude-/, ''),
            confidence: Math.round((s.confidence ?? 0) * 100),
          })}
        </p>
      )}
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
    </>
  );
}

/** Collected listings behind a suggestion, each opening the listing on its site. */
function ListingList({
  listings,
  t,
  money,
}: {
  listings: SuggestionListing[];
  t: Awaited<ReturnType<typeof GetT>>;
  money: Money;
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
          <span className="amount shrink-0 text-muted-foreground">{money(l.priceBase)}</span>
        </li>
      ))}
    </ul>
  );
}
