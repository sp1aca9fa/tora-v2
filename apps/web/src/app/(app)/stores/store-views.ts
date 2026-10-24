import 'server-only';
import { PLACE } from '@tora/core';
import { ADMIN_STORES, type Db, listStores, storeCodes } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import type { StoreView } from './store-area';

/** The stores as the Area and Codes pages list them. */
export async function storeViews(db: Db): Promise<StoreView[]> {
  const [t, all] = await Promise.all([getTranslations('stores'), listStores(db)]);
  return all.map((s) => ({
    id: s.id,
    chainKey: s.chain,
    chain: s.chain === PLACE ? t('places') : (s.chainLabel ?? s.chain),
    name: s.name,
    codes: storeCodes(s),
    byHand: s.source === ADMIN_STORES,
    region: s.region,
    lat: s.lat,
    lon: s.lon,
  }));
}
