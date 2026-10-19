import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import { loadOpenings } from '@/lib/opening';
import { OpeningNumbers, perBoxText } from '../../opening-numbers';
import { loadItem } from '../../item-data';

/** Cards listed by their part of the value. */
const TOP_CARDS = 15;

/**
 * The box's opening value (S20): what its hit cards are worth on average against the box price,
 * the spread between boxes, and which cards carry the value. Not advice.
 */
export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, user, product } = await loadItem(id);
  const [t, money, openings] = await Promise.all([
    getTranslations(),
    getMoney(),
    loadOpenings(db, [product]),
  ]);
  const opening = openings.get(product.id);
  const admin = user.role === 'admin';
  if (!opening) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('opening.title')}</CardTitle>
          <CardDescription>
            {t(product.setId ? 'opening.noRates' : 'opening.noSet')}
          </CardDescription>
        </CardHeader>
        {admin && product.setId && (
          <CardContent>
            <Link href="/settings/admin/opening" className="text-sm underline">
              {t('opening.enterRates')}
            </Link>
          </CardContent>
        )}
      </Card>
    );
  }
  const { value, cards, set, readAt, fee } = opening;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const percent = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <div className="space-y-5">
        <OpeningNumbers opening={opening} retail={product.retailPriceBase} />

        <Card>
          <CardHeader>
            <CardTitle>{t('opening.carry')}</CardTitle>
            <CardDescription>{t('opening.carryInfo')}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {value.cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(readAt ? 'opening.noCards' : 'opening.notRead')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-normal">{t('opening.card')}</th>
                    <th className="py-1 pr-3 text-right font-normal">{t('opening.price')}</th>
                    <th className="py-1 pr-3 text-right font-normal">{t('opening.chance')}</th>
                    <th className="py-1 text-right font-normal">{t('opening.share')}</th>
                  </tr>
                </thead>
                <tbody>
                  {value.cards.slice(0, TOP_CARDS).map((s) => {
                    const c = byId.get(s.key)!;
                    return (
                      <tr key={s.key} className="border-t">
                        <td className="py-1.5 pr-3">
                          {c.url ? (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {c.name}
                            </a>
                          ) : (
                            c.name
                          )}{' '}
                          <span className="font-mono text-xs text-muted-foreground">
                            {c.rarity} {c.number}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {money(c.value!)}
                          <span className="block text-xs text-muted-foreground">
                            {c.sold != null
                              ? t('opening.fromSales', { n: c.sales ?? 0 })
                              : t('opening.fromAsk')}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {perBoxText(s.perBox, t)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{percent(s.share)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('opening.rates')}</CardTitle>
          <CardDescription>
            {t(set.saved ? 'opening.ratesSaved' : 'opening.ratesSuggested', {
              set: set.set.name,
              source: set.rates.source ?? '-',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">{t('opening.rarity')}</th>
                <th className="py-1 pr-3 text-right font-normal">{t('opening.perBox')}</th>
                <th className="py-1 pr-3 text-right font-normal">{t('opening.average')}</th>
                <th className="py-1 text-right font-normal">{t('opening.part')}</th>
              </tr>
            </thead>
            <tbody>
              {value.tiers.map((tier, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono">{tier.rarity}</span>
                    {tier.match && (
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        {t('opening.matching', { text: tier.match })}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {t('opening.cardCount', { count: tier.cards })}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {perBoxText(tier.perBox, t)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {tier.average === null ? '-' : money(Math.round(tier.average))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {value.expected > 0 ? percent(tier.expected / value.expected) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            {t('opening.footer', {
              packs: set.rates.packsPerBox,
              fee: Math.round(fee * 100),
              read: readAt ? readAt.slice(0, 10) : '-',
            })}
          </p>
          {admin && (
            <Link href="/settings/admin/opening" className="text-sm underline">
              {t('opening.editRates')}
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
