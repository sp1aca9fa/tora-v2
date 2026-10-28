import { localDate } from '@tora/core';
import { buyPlanFor, loadOpportunities } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cleanSearch, signalLabel } from '../cards';
import { PlanCard } from '../plan-card';

/** The buy plan (S13 part 4, as a sub page S26; a suggested mix and a name search S27). */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { db, user } = await authed();
  const q = cleanSearch((await searchParams).q);
  const [plan, saved, t] = await Promise.all([
    buyPlanFor(db, user),
    loadOpportunities(db),
    getTranslations(),
  ]);
  const rules = saved?.rules ?? [];
  return (
    <PlanCard
      rows={plan.map((p) => ({
        productId: p.productId,
        bucket: p.bucket,
        name: p.product.name,
        step: p.step,
        from: p.from,
        ticked: p.ticked,
        mix: {
          key: `${p.productId}|${p.bucket}`,
          step: p.step,
          type: p.mix.type,
          set: p.mix.set,
          worth: p.mix.worth,
          score: p.mix.score,
          watched: p.from.includes('watch'),
        },
        signals: p.mix.signals.map((k) => signalLabel(t, k, rules)),
      }))}
      budget={user.preferences?.buyPlan?.budget ?? null}
      until={user.preferences?.buyPlan?.until || null}
      today={localDate()}
      q={q}
    />
  );
}
