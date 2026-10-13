import { marketsOf } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getRegistry, marketLabels } from '@/lib/sources';
import { MarketsForm } from '../../markets-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.markets.title') };
}

/** A market change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/** The primary and secondary markets (S11). */
export default async function MarketSettingsPage() {
  await adminOnly();
  const [registry, marketLabel, t] = await Promise.all([
    getRegistry(),
    marketLabels(),
    getTranslations('markets'),
  ]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <MarketsForm
          markets={marketsOf(registry.sources).map((m) => ({ key: m, label: marketLabel(m) }))}
          primary={registry.markets?.primary ?? null}
          secondary={registry.markets?.secondary ?? null}
          editable
        />
      </CardContent>
    </Card>
  );
}
