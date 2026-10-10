import { type Db, type ProductSource, sourceObservations } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { sourceLabel } from '@/lib/product-display';
import { cn, formatJpy } from '@/lib/utils';
import { QueryForm } from './query-form';
import { excludeObservationAction, unlinkSourceAction } from './source-actions';

/**
 * A search-based source (e.g. Mercari): its query, and the latest sold items it found, with why
 * an item was left out and buttons to exclude or include one by hand.
 */
export async function SearchSource({ db, link }: { db: Db; link: ProductSource }) {
  const [t, format, sales] = await Promise.all([
    getTranslations(),
    getFormatter(),
    sourceObservations(db, link.productId, link.source, 30),
  ]);
  const query = link.query;
  const kept = sales.filter((s) => !s.excluded).length;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {sourceLabel(link.source)} · {t('sources.search.title')}
          </p>
          <p className="text-xs break-words text-muted-foreground">
            “{(query?.keywords ?? []).join(' ')}”
            {query?.excludeKeywords?.length
              ? ` · ${t('sources.search.without', { words: query.excludeKeywords.join(' ') })}`
              : ''}
            {query?.priceMin || query?.priceMax
              ? ` · ${query.priceMin ? formatJpy(query.priceMin) : ''}–${query.priceMax ? formatJpy(query.priceMax) : ''}`
              : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {link.lastSuccessAt
              ? t('sources.search.found', { kept, total: sales.length })
              : t('sources.waiting')}
          </p>
        </div>
        <form action={unlinkSourceAction.bind(null, link.id)}>
          <Button variant="ghost" size="sm">
            {t('sources.search.turnOff')}
          </Button>
        </form>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {t('sources.search.edit')}
        </summary>
        <div className="mt-3">
          <QueryForm sourceId={link.id} query={query} />
        </div>
      </details>

      {sales.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t('sources.search.latest', { count: sales.length })}
          </summary>
          <ul className="mt-2 divide-y">
            {sales.map((s) => {
              const raw = (s.raw ?? {}) as { name?: string; filter?: string };
              const why =
                s.excludedReason === 'manual'
                  ? t('sources.search.byYou')
                  : (raw.filter ?? s.excludedReason);
              return (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <div className={cn('min-w-0 flex-1', s.excluded && 'opacity-60')}>
                    <a
                      href={s.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-2 text-xs hover:underline"
                    >
                      {raw.name ?? '-'}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">
                        {formatJpy(s.priceJpy)}
                      </span>{' '}
                      · {format.dateTime(new Date(s.observedAt), { dateStyle: 'medium' })}
                      {s.bucket && (
                        <>
                          {' '}
                          · <code>{s.bucket}</code>
                        </>
                      )}
                      {s.excluded && <> · {t('sources.search.left', { why: why ?? '-' })}</>}
                    </p>
                  </div>
                  <form action={excludeObservationAction.bind(null, s.id, !s.excluded)}>
                    <Button variant="ghost" size="sm">
                      {s.excluded ? t('sources.search.include') : t('sources.search.exclude')}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
