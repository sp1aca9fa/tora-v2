import { localDate } from '@tora/core';
import { authed } from '@/lib/auth/guard';
import { StoreAreaForm } from '../store-area';
import { storeViews } from '../store-views';

/**
 * The person's area (S25): picked stores or a distance, travel mode, each store on or off. Set
 * once (the first page until an area is set).
 */
export default async function StoreAreaPage() {
  const { db, user } = await authed();
  return (
    <StoreAreaForm
      stores={await storeViews(db)}
      area={user.preferences?.storeArea ?? null}
      today={localDate()}
    />
  );
}
