import {
  bucketStats,
  type Db,
  linkedListingImages,
  listPendingCandidates,
  listProductSources,
  QUERY_SOURCE_ID,
  recentObservations,
  identityFor,
} from '@tora/db';
import type { Product } from '@tora/db';
import { byRole, productClass, referenceSource, roleOf, valuationOrder } from '@tora/core';
import { getFormatter, getTranslations } from 'next-intl/server';
import { productImageUrl } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LinkUrlForm } from './link-url-form';
import { SearchSource } from './search-source';
import { type MarketTab, SourceTabs } from './source-tabs';
import {
  confirmCandidateAction,
  linkUrlAction,
  reactivateSourceAction,
  rejectCandidateAction,
  unlinkSourceAction,
} from './source-actions';
import { setSourceWarningAction } from '../../actions/actions';
import { getRegistry, marketLabels, sourceLabels } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';

/**
 * Where this product's market prices come from: linked listings, matches waiting for
 * confirmation, and a quick look at the collected trades (plain medians; valuation is S5).
 */
export async function PriceSources({
  db,
  product,
  bucket,
  ownedCostBase,
  warningDismissed,
}: {
  db: Db;
  product: Product;
  /** What the user paid for the lots they own (decides whether a main source is expected). */
  ownedCostBase: number;
  /** The user turned the "not linked" warning off for this item. */
  warningDismissed: boolean;
  /** The bucket most of the user's lots are in (highlighted). */
  bucket: string | null;
}) {
  const money = await getMoney();
  const sourceLabel = await sourceLabels();
  const [t, format, sources, candidates, stats, recent] = await Promise.all([
    getTranslations(),
    getFormatter(),
    listProductSources(db, product.id),
    listPendingCandidates(db, product.id),
    bucketStats(db, product.id, 30),
    recentObservations(db, product.id, 60),
  ]);
  // Suggestions without a picture of their own (e.g. from a linked look-alike): show the stored
  // thumbnail of the product already linked to that listing.
  const known = await linkedListingImages(
    db,
    candidates
      .filter((c) => !c.imageUrl)
      .map((c) => ({ source: c.source, externalId: c.externalId })),
  );
  // Search-based sources (a saved query, e.g. Mercari) are shown with their own editor.
  const searches = sources.filter((s) => s.externalId === QUERY_SOURCE_ID);
  const active = sources.filter((s) => s.active && s.externalId !== QUERY_SOURCE_ID);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  // Suggestions from a source this product has no listing of yet are shown open; the rest
  // (e.g. a no-shrink variant of a linked SNKRDUNK listing) wait under "Add another listing".
  const linked = new Set(active.map((s) => s.source));
  // No identity link yet (a stable product page: SNKRDUNK for cards, 駿河屋 for other items over
  // the admin's identity amount): say so and keep the paste box open, whatever else is linked.
  const registry = await getRegistry();
  const identity = identityFor(product, ownedCostBase, registry);
  // Sources whose product links can be pasted here.
  const linkable = registry.sources
    .filter((s) => s.links?.length)
    .map((s) => s.label)
    .join(', ');
  const missing =
    identity && !identity.accepted.some((s) => linked.has(s)) && !warningDismissed
      ? identity.preferred
      : null;
  const pasteUp = !!missing && !candidates.some((c) => c.source === missing);
  const suggestions = (list: typeof candidates) =>
    list.length > 0 && (
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('sources.confirmTitle')}</p>
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border p-2">
              {/* The listing's own picture, loaded from the site: it is how near-identical
                    listings are told apart. The only external image in the app; the product's
                    stored thumbnail comes from the listing confirmed here. */}
              {(c.imageUrl || known.has(`${c.source}|${c.externalId}`)) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={
                    c.imageUrl ??
                    productImageUrl(
                      known.get(`${c.source}|${c.externalId}`)!.productId,
                      known.get(`${c.source}|${c.externalId}`)!.version,
                    )!
                  }
                  alt=""
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="size-14 shrink-0 rounded object-contain"
                />
              )}
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
                  {c.priceBase ? (
                    <span className="amount"> · {money(c.priceBase)}</span>
                  ) : (
                    ''
                  )} · {t('sources.score', { score: Math.round(c.score * 100) })}
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
    );
  const paste = (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {t('sources.pasteUrl', { sources: linkable })}
      </p>
      <LinkUrlForm action={linkUrlAction.bind(null, product.id)} />
    </div>
  );

  // A tab per source that applies to this kind of item or has something for it, grouped by
  // market: the primary market, then the secondary one (S11).
  const cls = productClass(product);
  const order = valuationOrder(registry, cls);
  const hasAny = (key: string) =>
    sources.some((x) => x.source === key) ||
    candidates.some((c) => c.source === key) ||
    stats.some((x) => x.source === key);
  const marketKeys = [registry.markets?.primary, registry.markets?.secondary].filter(
    (m): m is string => !!m,
  );
  // In the order values use them: reference, supporting, comparison, then off with data;
  // within a role, the admin's order (Settings > Price sources).
  const tabSources = byRole(
    registry,
    cls,
    registry.sources.filter(
      (x) =>
        x.market &&
        marketKeys.includes(x.market) &&
        !x.shopOnly &&
        (roleOf(registry, x.key, cls) !== 'off' || hasAny(x.key)),
    ),
  );
  const marketLabel = await marketLabels();

  const panel = (key: string) => {
    const label = sourceLabel(key);
    const mySearches = searches.filter((x) => x.source === key);
    const myLinks = active.filter((x) => x.source === key);
    const mine = candidates.filter((c) => c.source === key);
    const myStats = stats.filter((x) => x.source === key);
    const myRecent = recent.filter((o) => o.source === key).slice(0, 10);
    const canPaste = !!registry.sources.find((x) => x.key === key)?.links?.length;
    const pasteHere = canPaste && !(pasteUp && key === missing) && (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('sources.pasteOne', { source: label })}</p>
        <LinkUrlForm action={linkUrlAction.bind(null, product.id)} />
      </div>
    );
    return (
      <>
        {mySearches.map((x) =>
          x.active ? (
            <SearchSource key={x.id} db={db} link={x} />
          ) : (
            <div
              key={x.id}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
            >
              <span>{t('sources.search.off', { source: label })}</span>
              <form action={reactivateSourceAction.bind(null, x.id)}>
                <Button variant="ghost" size="sm">
                  {t('sources.search.turnOn')}
                </Button>
              </form>
            </div>
          ),
        )}
        {myLinks.length > 0 && (
          <ul className="divide-y text-sm">
            {myLinks.map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {label}{' '}
                    {x.url && (
                      <a
                        href={x.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-normal underline"
                      >
                        {t('sources.open')}
                      </a>
                    )}
                  </p>
                  {x.title && <p className="truncate text-xs text-muted-foreground">{x.title}</p>}
                  <p className="text-xs text-muted-foreground">
                    {x.lastSuccessAt
                      ? t('sources.collected', {
                          count: x.observations,
                          date: date(x.lastSuccessAt),
                        })
                      : t('sources.waiting')}
                  </p>
                </div>
                <form action={unlinkSourceAction.bind(null, x.id)}>
                  <Button variant="ghost" size="sm">
                    {t('sources.unlink')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {mySearches.length === 0 && myLinks.length === 0 && mine.length === 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('sources.nothingYet', { source: label })}
          </p>
        )}
        {myLinks.length === 0 ? (
          <>
            {suggestions(mine)}
            {pasteHere}
          </>
        ) : (
          (mine.length > 0 || pasteHere) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('sources.addAnother', { count: mine.length })}
              </summary>
              <div className="mt-3 space-y-4">
                {suggestions(mine)}
                {pasteHere}
              </div>
            </details>
          )
        )}
        {myStats.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('sources.last30')}</p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-normal">{t('holding.bucket')}</th>
                  <th className="py-1 text-right font-normal">{t('sources.median')}</th>
                  <th className="py-1 text-right font-normal">{t('sources.trades')}</th>
                </tr>
              </thead>
              <tbody>
                {myStats.map((x) => (
                  <tr key={x.bucket ?? ''} className={cn(x.bucket === bucket && 'font-medium')}>
                    <td className="py-1">
                      <code className="text-xs">{x.bucket ?? t('sources.unmapped')}</code>
                      {x.bucket === bucket && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t('sources.yours')})
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {x.medianBase === null ? '-' : money(Math.round(x.medianBase))}
                    </td>
                    <td className="py-1 text-right tabular-nums">{x.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {myRecent.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {t('sources.recentTrades')}
            </summary>
            <ul className="mt-2 divide-y">
              {myRecent.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 py-1.5">
                  <span className="text-muted-foreground">
                    {date(o.observedAt)} · <code className="text-xs">{o.bucket ?? '-'}</code>
                  </span>
                  <span className="tabular-nums">{money(o.priceBase)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  };

  const markets: MarketTab[] = marketKeys.map((m) => ({
    key: m,
    label: marketLabel(m),
    sources: tabSources
      .filter((x) => x.market === m)
      .map((x) => ({
        key: x.key,
        label: sourceLabel(x.key),
        main: x.key === referenceSource(registry, cls, m),
        // Suggestions for a source without a linked listing yet are what needs a look.
        waiting: linked.has(x.key) ? 0 : candidates.filter((c) => c.source === x.key).length,
        content: panel(x.key),
      })),
  }));
  const initial =
    missing ??
    tabSources.find((x) => !linked.has(x.key) && candidates.some((c) => c.source === x.key))?.key ??
    order.find((key) => tabSources.some((x) => x.key === key)) ??
    tabSources[0]?.key;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sources.title')}</CardTitle>
        <CardDescription>{t('sources.info')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {missing && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-sm">
              {t('sources.missingStable', { source: sourceLabel(missing) })}
            </p>
            {pasteUp && paste}
            <form action={setSourceWarningAction.bind(null, product.id, true)}>
              <Button variant="ghost" size="sm" className="text-xs">
                {t('coverage.dismiss')}
              </Button>
            </form>
          </div>
        )}
        {initial && (
          <SourceTabs markets={markets} initial={initial} mainTitle={t('sources.mainReference')} />
        )}
      </CardContent>
    </Card>
  );
}
