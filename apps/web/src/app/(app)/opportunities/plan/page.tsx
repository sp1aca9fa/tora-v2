import { localDate } from '@tora/core';
import { buyPlanFor } from '@tora/db';
import { authed } from '@/lib/auth/guard';
import { PlanCard } from '../plan-card';

/** Budget and date (S13 part 4, as a sub page S26). */
export default async function PlanPage() {
  const { db, user } = await authed();
  const plan = await buyPlanFor(db, user);
  return (
    <PlanCard
      rows={plan.map((p) => ({
        productId: p.productId,
        bucket: p.bucket,
        name: p.product.name,
        step: p.step,
        from: p.from,
        ticked: p.ticked,
      }))}
      budget={user.preferences?.buyPlan?.budget ?? null}
      until={user.preferences?.buyPlan?.until ?? null}
      today={localDate()}
    />
  );
}
