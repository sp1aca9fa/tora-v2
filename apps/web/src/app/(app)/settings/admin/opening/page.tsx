import { suggestedRates } from '@tora/core';
import { boxSets, openingCardsOf, openingFee, openingRates, suggestedRateList } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { OpeningFeeForm, OpeningRatesForm, type OpeningRatesView } from '../../opening-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.opening.title') };
}

/** "1/6" for 0.1666..., else the number. */
function perBoxInput(perBox: number): string {
  const inverse = 1 / perBox;
  return perBox > 0 && perBox < 1 && Math.abs(inverse - Math.round(inverse)) < 1e-6
    ? `1/${Math.round(inverse)}`
    : String(perBox);
}

/**
 * Pull rates per set for the box opening value (S20): one form per set of a tracked booster box,
 * starting from the rates a plug-in suggests where there are some; and the selling fee.
 */
export default async function OpeningSettingsPage() {
  const { db } = await adminOnly();
  const sets = await boxSets(db);
  const ids = sets.map((s) => s.id);
  const [t, rates, cards, fee, suggested] = await Promise.all([
    getTranslations('opening'),
    openingRates(db, ids),
    openingCardsOf(db, ids),
    openingFee(db),
    suggestedRateList(db),
  ]);
  const views: OpeningRatesView[] = sets.map((set) => {
    const r = rates.get(set.id);
    const read = cards.get(set.id) ?? [];
    return {
      setId: set.id,
      name: set.name,
      code: r?.rates.code ?? set.code ?? '',
      packsPerBox: r?.rates.packsPerBox ?? 30,
      tiers: (r?.rates.tiers ?? []).map((tier) => ({
        rarity: tier.rarity,
        perBox: perBoxInput(tier.perBox),
        match: tier.match ?? '',
      })),
      source: r?.rates.source ?? '',
      saved: !!r?.saved,
      suggested: !!suggestedRates(set, suggested),
      cards: read.length,
      readAt: read.reduce<string | null>((a, c) => (a && a > c.readAt ? a : c.readAt), null),
    };
  });
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('settingsTitle')}</CardTitle>
          <CardDescription>{t('settingsInfo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <OpeningFeeForm percent={Math.round(fee * 100)} />
        </CardContent>
      </Card>
      {views.length === 0 && <p className="text-sm text-muted-foreground">{t('noBoxes')}</p>}
      {views.map((view) => (
        <Card key={view.setId}>
          <CardHeader>
            <CardTitle className="text-base">{view.name}</CardTitle>
            <CardDescription>
              {t(view.saved ? 'stateSaved' : view.tiers.length ? 'stateSuggested' : 'stateNone')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OpeningRatesForm view={view} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
