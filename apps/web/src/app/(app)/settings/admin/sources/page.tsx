import { ITEM_CLASSES, type ProductClass, inClassOrder } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { adminOnly } from '@/lib/auth/guard';
import { getRegistry, marketLabels } from '@/lib/sources';
import { SourcesForm } from '../../sources-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.sources.title') };
}

/** A role change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/** Each market's sources and their role per kind of item (S8, S11). */
export default async function SourceSettingsPage() {
  await adminOnly();
  const [registry, marketLabel, t] = await Promise.all([
    getRegistry(),
    marketLabels(),
    getTranslations(),
  ]);
  const labels = Object.fromEntries(registry.sources.map((s) => [s.key, s.label]));
  const order = Object.fromEntries(
    ITEM_CLASSES.map((c) => [c, inClassOrder(registry, c, registry.sources).map((s) => s.key)]),
  ) as Record<ProductClass, string[]>;
  const { primary = null, secondary = null } = registry.markets ?? {};
  const tabs = [
    ...(primary ? [{ key: 'primary', market: primary }] : []),
    ...(secondary ? [{ key: 'secondary', market: secondary }] : []),
  ].map(({ key, market }) => ({
    key,
    // Phones: the market's name only.
    label: (
      <>
        <span className="hidden sm:inline">{t(`markets.${key}`)}: </span>
        {marketLabel(market)}
      </>
    ),
    content: (
      <SourcesForm
        sources={registry.sources.filter((s) => s.market === market)}
        order={order}
        roles={registry.declared ?? registry.roles}
        quality={registry.quality ?? {}}
        labels={labels}
        editable
      />
    ),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sourceRoles.title')}</CardTitle>
        <CardDescription>{t('sourceRoles.info')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs tabs={tabs} />
      </CardContent>
    </Card>
  );
}
