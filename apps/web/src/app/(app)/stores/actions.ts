'use server';

import { type StoreArea, type StoreAreaChoice, STORE_NOTICE_KM, roundPoint } from '@tora/core';
import { newFeedToken, setPreferences, setStoreCodes } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

function cleanChoice(c: unknown): StoreAreaChoice | null {
  const v = c as Partial<StoreAreaChoice> | null;
  if (v?.mode === 'stores' && Array.isArray(v.storeIds))
    return { mode: 'stores', storeIds: [...new Set(v.storeIds.map(String))].slice(0, 500) };
  if (v?.mode === 'distance' && v.point) {
    const { lat, lon } = v.point;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return null;
    if (!STORE_NOTICE_KM.includes(v.km as number)) return null;
    return { mode: 'distance', point: roundPoint({ lat, lon }), km: v.km! };
  }
  return null;
}

/** The person's store area (S25): home, travel until a date, muted stores. */
export async function saveStoreAreaAction(area: StoreArea): Promise<{ error?: string }> {
  const { db, user } = await authed();
  const home = cleanChoice(area.home);
  if (!home) return { error: 'area' };
  let travel: StoreArea['travel'];
  if (area.travel) {
    const choice = cleanChoice(area.travel);
    if (!choice || !/^\d{4}-\d{2}-\d{2}$/.test(area.travel.until)) return { error: 'travel' };
    travel = { ...choice, until: area.travel.until };
  }
  await setPreferences(db, user.id, {
    storeArea: {
      home,
      ...(travel ? { travel } : {}),
      muted: [...new Set((area.muted ?? []).map(String))].slice(0, 500),
      added: [...new Set((area.added ?? []).map(String))].slice(0, 500),
    },
  });
  revalidatePath('/stores');
  return {};
}

/** A new feed token, shown once (the old one stops working). */
export async function newFeedTokenAction(): Promise<string> {
  const { db, user } = await authed();
  const token = await newFeedToken(db, user.id);
  revalidatePath('/stores');
  return token;
}

/** Codes posters use for a store, added by an admin. */
export async function setStoreCodesAction(storeId: string, codes: string[]) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  await setStoreCodes(db, storeId, codes.map(String).slice(0, 30));
  revalidatePath('/stores');
}
