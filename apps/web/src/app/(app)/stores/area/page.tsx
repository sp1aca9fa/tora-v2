import { PLACE, localDate } from '@tora/core';
import { ADMIN_STORES, listStores } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { AddStoreForm, type StoreView, StoreAreaForm } from '../store-area';

/**
 * The person's area (S25): picked stores or a distance, travel mode, each store on or off; admins
 * add stores and places. Set once, so the last sub page (the first until an area is set).
 */
export default async function StoreAreaPage() {
  const { db, user } = await authed();
  const [t, all] = await Promise.all([getTranslations('stores'), listStores(db)]);
  const views: StoreView[] = all.map((s) => ({
    id: s.id,
    chainKey: s.chain,
    chain: s.chain === PLACE ? t('places') : (s.chainLabel ?? s.chain),
    name: s.name,
    codes: s.codes,
    extra: s.extraCodes ?? [],
    byHand: s.source === ADMIN_STORES,
    region: s.region,
    lat: s.lat,
    lon: s.lon,
  }));
  const admin = user.role === 'admin';
  return (
    <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
      <StoreAreaForm
        stores={views}
        area={user.preferences?.storeArea ?? null}
        today={localDate()}
        admin={admin}
      />
      {admin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('addTitle')}</CardTitle>
            <CardDescription>{t('addInfo')}</CardDescription>
          </CardHeader>
          <CardContent>
            <AddStoreForm
              chains={[
                ...new Map(all.map((s) => [s.chain, s.chainLabel ?? s.chain])).entries(),
              ].map(([chain, label]) => ({ chain, label }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
