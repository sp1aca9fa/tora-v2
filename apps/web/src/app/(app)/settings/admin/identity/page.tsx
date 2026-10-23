import {
  baseCurrency,
  identityChoices,
  identityMinCostFor,
  identitySources,
  typesOf,
} from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getRegistry, marketLabels, marketsInOrder } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';
import { IdentityAmountForm } from '../../identity-amount-form';
import { IdentityForm } from '../../identity-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.identity.title') };
}

/**
 * Identity pages (S8, S11): per market and kind of item, the shop whose product page says
 * exactly what an item is. Items without one are flagged under Actions.
 */
export default async function IdentitySettingsPage() {
  await adminOnly();
  const [registry, marketLabel, t, money] = await Promise.all([
    getRegistry(),
    marketLabels(),
    getTranslations(),
    getMoney(),
  ]);
  const labels = Object.fromEntries(registry.sources.map((s) => [s.key, s.label]));
  // Other markets' items are not flagged.
  const markets = marketsInOrder(registry);
  const amount = registry.markets?.identityMinCost ?? identityMinCostFor(baseCurrency(registry));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('identity.whatTitle')}</CardTitle>
          <CardDescription className="space-y-2">
            <span className="block">{t('identity.what')}</span>
            <span className="block">{t('identity.why')}</span>
            <span className="block">{t('identity.how')}</span>
            <span className="block">{t('identity.notListed')}</span>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('identity.amount')}</CardTitle>
          <CardDescription>{t('identity.amountInfo', { amount: money(amount) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <IdentityAmountForm amount={amount} />
        </CardContent>
      </Card>
      {markets.map(({ which, market }) => (
        <Card key={market}>
          <CardHeader>
            <CardTitle>{`${t(`markets.${which}`)}: ${marketLabel(market)}`}</CardTitle>
            <CardDescription>
              {t(`identity.${which}Notice`, { market: marketLabel(market) })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IdentityForm
              market={market}
              chosen={Object.fromEntries(
                typesOf(registry).map((cls) => [
                  cls,
                  identitySources(registry, cls, market)[0] ?? null,
                ]),
              )}
              choices={identityChoices(registry, market)}
              labels={labels}
              editable
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
