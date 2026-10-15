import { baseCurrency, marketsOf, rateSettingFor, ratedCurrencies } from '@tora/core';
import { baseChoices, getDb, latestRates, storedAmounts } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getRegistry, marketLabels } from '@/lib/sources';
import { CurrencyForm } from '../../currency-form';
import { MarketsForm } from '../../markets-form';

/** The primary and secondary markets (S11) and the currencies' exchange rates (S16). */
export async function MarketsSection() {
  await adminOnly();
  const [registry, marketLabel, t] = await Promise.all([
    getRegistry(),
    marketLabels(),
    getTranslations(),
  ]);
  // Every currency a market prices in or the admin set a rate for, other than the base (S16).
  const base = baseCurrency(registry);
  const settings = registry.currency ?? { base };
  const plugins = registry.rateSources ?? [];
  const codes = ratedCurrencies(settings, registry.sources);
  const [latest, choices, amounts] = await Promise.all([
    latestRates(getDb(), codes),
    baseChoices(getDb()),
    storedAmounts(getDb()),
  ]);
  const rows = codes.map((code) => ({
    code,
    markets: [
      ...new Set(
        registry.sources.filter((s) => s.currency === code && s.market).map((s) => s.market!),
      ),
    ],
    choices: plugins
      .filter((p) => p.currencies.includes(code) && p.currencies.includes(base))
      .map((p) => ({ key: p.key, label: p.label })),
    setting: rateSettingFor(settings, plugins, code),
    latest: latest[code] ?? null,
  }));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('markets.title')}</CardTitle>
          <CardDescription>{t('markets.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <MarketsForm
            markets={marketsOf(registry.sources).map((m) => ({ key: m, label: marketLabel(m) }))}
            primary={registry.markets?.primary ?? null}
            secondary={registry.markets?.secondary ?? null}
            compare={registry.markets?.compare ?? 'secondary'}
            editable
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('currency.title')}</CardTitle>
          <CardDescription>{t('currency.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CurrencyForm base={base} baseChoices={choices} amounts={amounts} rows={rows} />
        </CardContent>
      </Card>
    </>
  );
}
