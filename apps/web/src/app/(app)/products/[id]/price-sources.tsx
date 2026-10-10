import {
  bucketStats,
  type Db,
  listPendingCandidates,
  listProductSources,
  recentObservations,
} from '@tora/db';
import type { Product } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sourceLabel } from '@/lib/product-display';
import { cn, formatJpy } from '@/lib/utils';
import { LinkUrlForm } from './link-url-form';
import {
  confirmCandidateAction,
  linkUrlAction,
  rejectCandidateAction,
  unlinkSourceAction,
} from './source-actions';

/**
 * Where this product's market prices come from: linked listings, matches waiting for
 * confirmation, and a quick look at the collected trades (plain medians; valuation is S5).
 */
export async function PriceSources({
  db,
  product,
  bucket,
}: {
  db: Db;
  product: Product;
  /** The bucket most of the user's lots are in (highlighted). */
  bucket: string | null;
}) {
  const [t, format, sources, candidates, stats, recent] = await Promise.all([
    getTranslations(),
    getFormatter(),
    listProductSources(db, product.id),
    listPendingCandidates(db, product.id),
    bucketStats(db, product.id, 30),
    recentObservations(db, product.id, 10),
  ]);
  const active = sources.filter((s) => s.active);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const canUseSnkrdunk = product.category === 'tcg';

  const matching = (
    <>
      {candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('sources.confirmTitle')}</p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-md border p-2">
                <div className="min-w-0 flex-1">
                  <a
                    href={c.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="line-clamp-2 text-sm hover:underline"
                  >
                    {c.title}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {sourceLabel(c.source)}
                    {c.priceJpy ? ` · ${formatJpy(c.priceJpy)}` : ''} ·{' '}
                    {t('sources.score', { score: Math.round(c.score * 100) })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <form action={confirmCandidateAction.bind(null, c.id)}>
                    <Button size="sm" className="w-full">
                      {t('sources.confirm')}
                    </Button>
                  </form>
                  <form action={rejectCandidateAction.bind(null, c.id)}>
                    <Button size="sm" variant="ghost" className="w-full">
                      {t('sources.reject')}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.length === 0 && candidates.length === 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {canUseSnkrdunk ? t('sources.noneYet') : t('sources.noneForGames')}
        </p>
      )}

      {canUseSnkrdunk && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('sources.pasteUrl')}</p>
          <LinkUrlForm action={linkUrlAction.bind(null, product.id)} />
        </div>
      )}
    </>
  );

  return (
    <Card id="sources" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{t('sources.title')}</CardTitle>
        <CardDescription>{t('sources.info')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {active.length > 0 && (
          <ul className="divide-y text-sm">
            {active.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {sourceLabel(s.source)}{' '}
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-normal underline"
                      >
                        {t('sources.open')}
                      </a>
                    )}
                  </p>
                  {s.title && <p className="truncate text-xs text-muted-foreground">{s.title}</p>}
                  <p className="text-xs text-muted-foreground">
                    {s.lastSuccessAt
                      ? t('sources.collected', {
                          count: s.observations,
                          date: date(s.lastSuccessAt),
                        })
                      : t('sources.waiting')}
                  </p>
                </div>
                <form action={unlinkSourceAction.bind(null, s.id)}>
                  <Button variant="ghost" size="sm">
                    {t('sources.unlink')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {active.length === 0
          ? matching
          : (candidates.length > 0 || canUseSnkrdunk) && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('sources.addAnother', { count: candidates.length })}
                </summary>
                <div className="mt-3 space-y-4">{matching}</div>
              </details>
            )}

        {stats.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('sources.last30')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-normal">{t('holding.bucket')}</th>
                    <th className="py-1 text-right font-normal">{t('sources.median')}</th>
                    <th className="py-1 text-right font-normal">{t('sources.trades')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr
                      key={`${s.source}-${s.bucket}`}
                      className={cn(s.bucket === bucket && 'font-medium')}
                    >
                      <td className="py-1">
                        <span className="mr-1.5 text-xs text-muted-foreground">
                          {sourceLabel(s.source)}
                        </span>
                        <code className="text-xs">{s.bucket ?? t('sources.unmapped')}</code>
                        {s.bucket === bucket && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t('sources.yours')})
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {s.medianJpy === null ? '-' : formatJpy(Math.round(s.medianJpy))}
                      </td>
                      <td className="py-1 text-right tabular-nums">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {t('sources.recentTrades')}
            </summary>
            <ul className="mt-2 divide-y">
              {recent.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 py-1.5">
                  <span className="text-muted-foreground">
                    {date(o.observedAt)} · <code className="text-xs">{o.bucket ?? '-'}</code>
                  </span>
                  <span className="tabular-nums">{formatJpy(o.priceJpy)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
