'use server';

import {
  DEFAULT_FEED_PREFS,
  FEED_SILENT_MINUTES,
  type StoreArea,
  type StoreAreaChoice,
  type StoreFeedPrefs,
  STORE_NOTICE_KM,
  roundPoint,
} from '@tora/core';
import {
  addGlossary,
  addStore,
  forgetBoard,
  newFeedToken,
  recordAdminChange,
  removeGlossary,
  removeStore,
  setPreferences,
  setStoreCodes,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { type PostsFilter, postViews } from './post-views';

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

/** Every code posters use for a store, set by an admin (the posts are matched again). */
export async function setStoreCodesAction(storeId: string, codes: string[]) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  const clean = codes.map(String).slice(0, 30);
  const store = await setStoreCodes(db, storeId, clean);
  if (store)
    await recordAdminChange(db, user.id, 'storeCodes', { store, to: clean }, '/stores/area');
  revalidatePath('/stores', 'layout');
}

/** What the person is told about their store feed: silence, unknown stores (S25). */
export async function saveStoreFeedAction(prefs: StoreFeedPrefs) {
  const { db, user } = await authed();
  const hhmm = (v: unknown) =>
    typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  const minutes = FEED_SILENT_MINUTES.includes(prefs.silentMinutes as number)
    ? prefs.silentMinutes
    : DEFAULT_FEED_PREFS.silentMinutes;
  await setPreferences(db, user.id, {
    storeFeed: {
      ...user.preferences?.storeFeed,
      silentMinutes: minutes,
      from: hhmm(prefs.from) ?? DEFAULT_FEED_PREFS.from,
      to: hhmm(prefs.to) ?? DEFAULT_FEED_PREFS.to,
      unknown: prefs.unknown !== false,
    },
  });
  revalidatePath('/stores');
}

/** A store or place an admin adds by hand (S25): anyone can add stores without code. */
export async function addStoreAction(input: {
  chain: string;
  chainLabel: string;
  name: string;
  region: string;
  codes: string;
  /** "35.6987, 139.7746" as Google Maps copies it, or empty. */
  location: string;
}): Promise<{ error?: string }> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return { error: 'admin' };
  const chain = input.chain.trim().toLowerCase();
  const name = input.name.normalize('NFKC').trim();
  if (!/^[a-z0-9_-]{1,40}$/.test(chain)) return { error: 'chain' };
  if (!name) return { error: 'name' };
  let lat: number | null = null;
  let lon: number | null = null;
  if (input.location.trim()) {
    const m = input.location.match(/(-?\d+(?:\.\d+)?)\s*[,、\s]\s*(-?\d+(?:\.\d+)?)/);
    lat = m ? Number(m[1]) : NaN;
    lon = m ? Number(m[2]) : NaN;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return { error: 'location' };
  }
  const store = await addStore(db, {
    chain,
    chainLabel: input.chainLabel.trim() || null,
    name,
    region: input.region.trim() || null,
    codes: [
      ...new Set(
        input.codes
          .split(/[,、]/)
          .map((c) => c.normalize('NFKC').trim())
          .filter(Boolean),
      ),
    ],
    lat,
    lon,
  });
  await recordAdminChange(db, user.id, 'storeAdded', { store: store.name }, '/stores/area');
  revalidatePath('/stores');
  return {};
}

/** Removes a store an admin added. */
export async function removeStoreAction(storeId: string) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  const store = await removeStore(db, storeId);
  if (store) await recordAdminChange(db, user.id, 'storeRemoved', { store }, '/stores/area');
  revalidatePath('/stores');
}

/** Forgets a board the feed no longer reads. */
export async function forgetBoardAction(key: string) {
  const { db, user } = await authed();
  await forgetBoard(db, user.id, String(key));
  revalidatePath('/stores');
}

/** A code that is no store or place, with its meaning (admins). */
export async function addGlossaryAction(
  code: string,
  meaning: string,
  product = false,
): Promise<{ error?: string }> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return { error: 'admin' };
  const c = code.normalize('NFKC').trim();
  const m = meaning.trim();
  if (!c || !m || c.length > 20 || m.length > 200) return { error: 'glossary' };
  await addGlossary(db, { code: c, meaning: m, ...(product === true ? { product: true } : {}) });
  await recordAdminChange(db, user.id, 'glossaryAdded', { code: c, meaning: m }, '/stores/area');
  revalidatePath('/stores');
  return {};
}

export async function removeGlossaryAction(code: string) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  await removeGlossary(db, String(code));
  await recordAdminChange(db, user.id, 'glossaryRemoved', { code: String(code) }, '/stores/area');
  revalidatePath('/stores');
}

/** The boards the feed should watch, chosen here (null: the feed decides). */
export async function saveFeedBoardsAction(boards: string[] | null) {
  const { db, user } = await authed();
  const { boards: _, ...rest } = user.preferences?.storeFeed ?? {};
  const clean = boards
    ? [...new Set(boards.map(String).filter((b) => /^[a-z0-9_-]{1,40}$/.test(b)))].slice(0, 20)
    : [];
  await setPreferences(db, user.id, {
    storeFeed: clean.length ? { ...rest, boards: clean } : rest,
  });
  revalidatePath('/stores/feed');
}

/** The next posts as the list is scrolled (S25). */
export async function morePostsAction(offset: number, filter: PostsFilter) {
  const { db, user } = await authed();
  return postViews(db, user.preferences?.storeArea ?? null, {
    offset: Math.max(0, Math.floor(offset) || 0),
    filter: {
      show: (['area', 'named', 'all'] as const).find((s) => s === filter.show),
      chain: typeof filter.chain === 'string' || filter.chain === null ? filter.chain : undefined,
      storeIds: Array.isArray(filter.storeIds)
        ? filter.storeIds.map(String).slice(0, 200)
        : undefined,
    },
  });
}
