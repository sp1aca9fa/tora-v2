import { dismissedSourceWarnings, getProduct } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { productImageUrl } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { lotConditionLabel, productMeta, sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { setSourceWarningAction } from './actions';
import { type ActionCardView, ActionsList } from './actions-list';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('actions') };
}

const COUNT_HREF = {
  import_review: '/imports/review',
  failed_link: '/imports#failed',
  data_review: '/imports/suggestions',
} as const;

/**
 * Everything waiting for the user (requirements S8): one card per action with what is needed to
 * settle it here, most urgent level first.
 */
export default async function ActionsPage() {
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

  const cards: ActionCardView[] = items.map((i): ActionCardView => {
    const base = { key: i.key, type: i.type, level: i.level, kind: i.kind };
    if (i.kind === 'count') {
      return {
        ...base,
        title: '',
        meta: '',
        image: null,
        href: COUNT_HREF[i.type as keyof typeof COUNT_HREF] ?? '/imports',
        count: i.count,
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
      return {
        ...common,
        href: `/holdings/${h.id}`,
        holdingId: h.id,
        owned: [
          `×${h.quantity}`,
          formatJpy(h.costTotalJpy),
          date(h.acquiredAt),
          lotConditionLabel(h, i.product, t),
        ]
          .filter(Boolean)
          .join(' · '),
      };
    }
    return {
      ...common,
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
