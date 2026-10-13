import { dismissedSourceWarnings, getProduct } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { productImageUrl } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { userActions } from '@/lib/actions';
import { sourceLabels } from '@/lib/sources';
import { authed } from '@/lib/auth/guard';
import { lotConditionLabel, productMeta } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { setSourceWarningAction } from './actions';
import { reviewItemOf } from '../imports/review/review-item';
import { SuggestionCard } from '../imports/suggestions/suggestion-card';
import { type ActionCardView, ActionsList } from './actions-list';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('actions') };
}

/**
 * Everything waiting for the user (requirements S8): one card per action with what is needed to
 * settle it here, most urgent level first.
 */
export default async function ActionsPage() {
  const sourceLabel = await sourceLabels();
  const { db, user } = await authed();
  const [items, dismissedIds, t, format] = await Promise.all([
    userActions(),
    dismissedSourceWarnings(db, user.id),
    getTranslations(),
    getFormatter(),
  ]);
  const dismissed = (await Promise.all([...dismissedIds].map((id) => getProduct(db, id)))).filter(
    (p) => p !== null,
  );
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  const reasons = (list: string[]) =>
    list.map((r) => (t.has(`imports.reason.${r}`) ? t(`imports.reason.${r}`) : r)).join(' · ');

  const cards: ActionCardView[] = items.map((i): ActionCardView => {
    const base = { key: i.key, type: i.type, level: i.level, kind: i.kind };
    if (i.kind === 'quality') {
      const pct = Math.round(Math.abs(i.quality.bias ?? i.quality.gap ?? 0) * 100);
      return {
        ...base,
        title: sourceLabel(i.source),
        meta: t(`sourceRoles.class.${i.cls}`),
        summary: t((i.quality.bias ?? 0) < 0 ? 'actions.quality.below' : 'actions.quality.above', {
          pct,
          reference: sourceLabel(i.quality.against ?? ''),
          count: i.quality.pairs,
          cls: t(`sourceRoles.class.${i.cls}`),
        }),
        image: null,
        href: '/settings#sources',
      };
    }
    if (i.kind === 'link') {
      return {
        ...base,
        title: i.link.url.replace(/^https?:\/\//, ''),
        meta: date(i.link.createdAt),
        summary: i.link.message ?? t('imports.links.status.failed'),
        image: null,
        href: '/imports#failed',
        linkId: i.link.id,
        url: i.link.url,
      };
    }
    if (i.kind === 'suggestion') {
      return {
        ...base,
        title: i.product?.name ?? t(`suggestions.kind.${i.suggestion.kind}`),
        meta: i.product ? productMeta(i.product, t) : '',
        summary: t(`suggestions.kind.${i.suggestion.kind}`),
        image: i.product ? productImageUrl(i.product.id, i.imageVersion) : null,
        href: '/imports/suggestions',
        productId: i.product?.id,
        body: (
          <div className="space-y-2 text-sm">
            <SuggestionCard suggestion={i.suggestion} product={i.product} showProduct={false} />
          </div>
        ),
      };
    }
    const common = {
      ...base,
      title: i.product.name,
      meta: productMeta(i.product, t),
      image: productImageUrl(i.product.id, i.imageVersion),
      productId: i.product.id,
    };
    if (i.kind === 'lot') {
      const h = i.holding;
      const owned = [
        `×${h.quantity}`,
        formatJpy(h.costTotalJpy),
        date(h.acquiredAt),
        lotConditionLabel(h, i.product, t),
      ]
        .filter(Boolean)
        .join(' · ');
      if (i.type === 'import_review') {
        const review = reviewItemOf(h, i.product);
        return {
          ...common,
          summary: reasons(review.reasons) || t('actions.need.import_review'),
          href: '/imports/review',
          holdingId: h.id,
          owned,
          review,
        };
      }
      return {
        ...common,
        summary: t(`actions.need.${i.type}`),
        href: `/holdings/${h.id}`,
        holdingId: h.id,
        owned,
      };
    }
    return {
      ...common,
      summary: i.candidates.length
        ? t('actions.suggestions', { count: i.candidates.length, source: sourceLabel(i.source) })
        : t('actions.noSuggestion', { source: sourceLabel(i.source) }),
      href: `/products/${i.product.id}#sources`,
      source: i.source,
      sourceLabel: sourceLabel(i.source),
      main: i.main,
      owned: t('actions.owned', { units: i.units, amount: formatJpy(i.costJpy) }),
      candidates: i.candidates.map((c) => ({
        id: c.id,
        title: c.title,
        url: c.url,
        image:
          c.imageUrl ??
          (c.linkedImage ? productImageUrl(c.linkedImage.productId, c.linkedImage.version) : null),
        priceJpy: c.priceJpy,
        score: c.score,
      })),
    };
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.actions')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('actions.intro')}{' '}
          <Link href="/settings#notices" className="underline">
            {t('actions.levels')}
          </Link>
        </p>
      </header>
      <ActionsList cards={cards} />
      {dismissed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t('coverage.dismissed', { count: dismissed.length })}
          </summary>
          <ul className="mt-2 divide-y rounded-xl border bg-card">
            {dismissed.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 pl-4">
                <Link
                  href={`/products/${p.id}#sources`}
                  className="min-w-0 truncate hover:underline"
                >
                  {p.name}
                </Link>
                <form action={setSourceWarningAction.bind(null, p.id, false)} className="px-2">
                  <Button variant="ghost" size="sm" className="text-xs">
                    {t('coverage.warnAgain')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
