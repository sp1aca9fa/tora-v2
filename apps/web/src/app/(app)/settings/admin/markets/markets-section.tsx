import { marketsOf } from '@tora/core';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { getRegistry, marketLabels } from '@/lib/sources';
import { MarketsForm } from '../../markets-form';

/** The primary and secondary markets (S11). */
export async function MarketsSection() {
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
