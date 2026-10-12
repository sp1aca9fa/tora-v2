'use server';

import { setLotTracking } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { runDomain } from '@/lib/form';

export type TrackingState = { saved?: boolean; error?: string };

/** Saves how a lot (or every lot of its item) counts in the portfolio. */
export async function setTrackingAction(
  holdingId: string,
  _prev: TrackingState,
  formData: FormData,
): Promise<TrackingState> {
  const { db, user } = await authed();
  const result = await runDomain(() =>
    setLotTracking(
      db,
      user.id,
      holdingId,
      {
        countInCost: formData.get('countInCost') === 'on',
        countInValue: formData.get('countInValue') === 'on',
      },
      formData.get('allLots') === 'on',
    ),
  );
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  return { saved: true };
}
