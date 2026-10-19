import { trackedBoxes } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { loadOpenings } from '@/lib/opening';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('opening'))('listTitle') };
}

/**
 * The booster boxes the person holds or watches side by side (S20): today's price against what
 * opening one returns on average, best first. Not advice.
 */
export default async function OpeningListPage() {
  const { db, user } = await authed();
  const [t, money, boxes] = await Promise.all([
    getTranslations(),
    getMoney(),
    trackedBoxes(db, user.id),
  ]);
  const openings = await loadOpenings(db, boxes);
  const back = (o: { value: { expected: number }; boxPrice: number | null }) =>
    o.boxPrice ? o.value.expected / o.boxPrice : -1;
  const rows = [...openings.values()].sort((a, b) => back(b) - back(a));
  const without = boxes.filter((p) => !openings.has(p.id));
  const percent = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/watchlist" className="hover:underline">
            {t('nav.watchlist')}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('opening.listTitle')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('opening.listIntro')}</p>
      </header>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('opening.listEmpty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">{t('opening.box')}</th>
                  <th className="py-1 pr-3 text-right font-normal">{t('opening.boxPrice')}</th>
                  <th className="py-1 pr-3 text-right font-normal">{t('opening.breakEven')}</th>
                  <th className="py-1 pr-3 text-right font-normal">{t('opening.back')}</th>
                  <th className="py-1 pr-3 text-right font-normal">{t('opening.chanceBack')}</th>
                  <th className="py-1 text-right font-normal">{t('opening.premium')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const pays = o.boxPrice !== null && o.value.expected >= o.boxPrice;
                  return (
                    <tr key={o.product.id} className="border-t">
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/products/${o.product.id}/opening`}
                          className="hover:underline"
                        >
                          {o.set.set.name}
                        </Link>
                        {!o.readAt && (
                          <span className="block text-xs text-muted-foreground">
                            {t('opening.notReadShort')}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {o.boxPrice === null ? '-' : money(o.boxPrice)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {money(Math.round(o.value.expected))}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 pr-3 text-right tabular-nums',
                          pays && 'font-semibold text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {o.boxPrice ? percent(back(o)) : '-'}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {o.value.chanceBack === null ? '-' : percent(o.value.chanceBack)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {o.boxPrice && o.value.expected > 0
                          ? `×${(o.boxPrice / o.value.expected).toFixed(1)}`
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {without.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t('opening.listWithout', {
                names: without.map((p) => p.setName ?? p.name).join(', '),
              })}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t('opening.notAdvice')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
