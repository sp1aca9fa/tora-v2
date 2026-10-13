import { ITEM_CLASSES, identityChoices, identitySources, marketsOf } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { authed } from '@/lib/auth/guard';
import { getRegistry, marketLabels } from '@/lib/sources';
import { MarketsForm } from '../markets-form';
import { SourcesForm } from '../sources-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.sources.title') };
}

/** A market or role change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/** Markets and price sources (S11): the two markets, then each market's sources and roles. */
export default async function SourceSettingsPage() {
  const { user } = await authed();
  const [registry, marketLabel, t] = await Promise.all([
    getRegistry(),
    marketLabels(),
    getTranslations(),
  ]);
  const editable = user.role === 'admin';
  const { primary = null, secondary = null } = registry.markets ?? {};
  const labels = Object.fromEntries(registry.sources.map((s) => [s.key, s.label]));
  const form = (market: string) => (
    <SourcesForm
      sources={registry.sources.filter((s) => s.market === market)}
      roles={registry.declared ?? registry.roles}
      quality={registry.quality ?? {}}
      labels={labels}
      editable={editable}
      identity={{
        market,
        chosen: Object.fromEntries(
          ITEM_CLASSES.map((cls) => [cls, identitySources(registry, cls, market)[0] ?? null]),
        ),
        choices: identityChoices(registry, market),
      }}
    />
  );
  const tabs = [
    ...(primary ? [{ key: 'primary', market: primary }] : []),
    ...(secondary ? [{ key: 'secondary', market: secondary }] : []),
  ].map(({ key, market }) => ({
    key,
    label: `${t(`markets.${key}`)}: ${marketLabel(market)}`,
    content: form(market),
  }));

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('markets.title')}</CardTitle>
          <CardDescription>
            {t('markets.info')} {!editable && t('sourceRoles.adminOnly')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MarketsForm
            markets={marketsOf(registry.sources).map((m) => ({ key: m, label: marketLabel(m) }))}
            primary={primary}
            secondary={secondary}
            editable={editable}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('sourceRoles.title')}</CardTitle>
          <CardDescription>{t('sourceRoles.info')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs tabs={tabs} />
        </CardContent>
      </Card>
    </div>
  );
}
