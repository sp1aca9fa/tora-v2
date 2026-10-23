import { sourceInfo, valueUnit } from '@tora/core';
import { type Db, type ProductSource, keptObservations, sourceObservations } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { QueryForm } from './query-form';
import { ReferenceForm } from './reference-form';
import {
  excludeObservationAction,
  removeReferenceAction,
  unlinkSourceAction,
} from './source-actions';
import { getRegistry, sourceLabels } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';

interface ReferenceInfo {
  name: string;
  price: number;
  sold: boolean;
  updated: number;
}

/**
 * A search-based source (e.g. Mercari): its query, and the latest sold items it found, with why
 * an item was left out and buttons to exclude or include one by hand. A source of asking prices
 * (e.g. eBay: listings still for sale, a day's median per condition) says so: nothing it finds
 * is a sale, and a listing that ends may have sold or been withdrawn.
 */
export async function SearchSource({ db, link }: { db: Db; link: ProductSource }) {
  const money = await getMoney();
  const [sourceLabel, registry] = await Promise.all([sourceLabels(), getRegistry()]);
  const kinds = sourceInfo(registry, link.source)?.priceKinds;
  const asks = !kinds?.includes('sold') && !kinds?.includes('market');
  const [t, format, sales, kept] = await Promise.all([
    getTranslations(),
    getFormatter(),
    sourceObservations(db, link.productId, link.source, 30),
    keptObservations(db, link.productId, link.source),
  ]);
  // What the valuation computes from this source, per condition (same rules: 30/90/180-day
  // window, outliers removed, median).
  const summary = [...new Set(kept.map((o) => o.bucket).filter((b): b is string => !!b))]
    .map((bucket) => {
      const v = valueUnit({ bucket, observations: kept });
      const latest = kept
        .filter((o) => o.bucket === bucket)
        .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      return { bucket, v, latest };
    })
    .filter((r) => r.v.method === 'median')
    .sort((a, b) => b.v.sampleSize - a.v.sampleSize);
  const query = link.query;
  // Listing links the user added, with what the collector read from them (once).
  const references = (query?.extra?.references as string[] | undefined) ?? [];
  const read = ((link.state as { references?: Record<string, ReferenceInfo> } | null)?.references ??
    {}) as Record<string, ReferenceInfo>;
  const infoFor = (url: string) =>
    Object.entries(read).find(([id]) => url.includes(id))?.[1] ?? null;
  const keptCount = sales.filter((s) => !s.excluded).length;
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
              ? ` · ${query.priceMin ? money(query.priceMin) : ''}–${query.priceMax ? money(query.priceMax) : ''}`
              : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {link.lastSuccessAt
              ? t(asks ? 'sources.search.foundAsks' : 'sources.search.found', {
                  kept: keptCount,
                  total: sales.length,
                })
              : t('sources.waiting')}
          </p>
        </div>
        <form action={unlinkSourceAction.bind(null, link.id)}>
          <Button variant="ghost" size="sm">
            {t('sources.search.turnOff')}
          </Button>
        </form>
      </div>
      {asks && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          {t('sources.search.asksNote', { source: sourceLabel(link.source) })}
        </p>
      )}

      {summary.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">{t('holding.bucket')}</th>
                <th className="py-1 text-right font-normal">{t('sources.median')}</th>
                <th className="py-1 text-right font-normal">
                  {t(asks ? 'sources.search.usedAsks' : 'sources.search.used')}
                </th>
                <th className="py-1 text-right font-normal">
                  {t(asks ? 'sources.search.lastAsk' : 'valuation.lastSale')}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.map(({ bucket, v, latest }) => (
                <tr key={bucket}>
                  <td className="py-1">
                    <code className="text-xs">{bucket}</code>
                  </td>
                  <td className="py-1 text-right font-medium tabular-nums">
                    {v.unitBase === null ? '-' : money(v.unitBase)}
                  </td>
                  <td className="py-1 text-right text-xs text-muted-foreground tabular-nums">
                    {t('valuation.medianOf', { count: v.sampleSize, days: v.windowDays ?? 0 })}
                    {v.pooled && ` · ${t('valuation.pooled')}`}
                  </td>
                  <td className="py-1 text-right text-xs text-muted-foreground tabular-nums">
                    {latest
                      ? `${money(latest.priceBase)} · ${format.dateTime(new Date(latest.observedAt), { dateStyle: 'medium' })}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Listings added by hand are read by sold-items searches only (e.g. Mercari). */}
      {!asks && (
        <details className="text-sm" open={references.length > 0 || undefined}>
          <summary className="cursor-pointer text-muted-foreground">
            {t('sources.search.references', { count: references.length })}
          </summary>
          <div className="mt-2 space-y-2">
            {references.length > 0 && (
              <ul className="divide-y">
                {references.map((url) => {
                  const info = infoFor(url);
                  return (
                    <li key={url} className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1 text-xs">
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-1 hover:underline"
                        >
                          {info?.name ?? url}
                        </a>
                        <p className="amount text-muted-foreground">
                          {info
                            ? `${money(info.price)} · ${info.sold ? t('sources.search.sold') : t('sources.search.forSale')} · ${format.dateTime(new Date(info.updated * 1000), { dateStyle: 'medium' })}`
                            : t('sources.search.readNext')}
                        </p>
                      </div>
                      <form action={removeReferenceAction.bind(null, link.id, url)}>
                        <Button variant="ghost" size="sm">
                          {t('sources.search.remove')}
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <ReferenceForm sourceId={link.id} />
          </div>
        </details>
      )}

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
            {t(asks ? 'sources.search.latestAsks' : 'sources.search.latest', {
              count: sales.length,
            })}
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
                        {money(s.priceBase)}
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
