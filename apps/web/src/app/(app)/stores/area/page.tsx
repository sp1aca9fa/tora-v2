import { localDate, storeNoticeModeOf } from '@tora/core';
import { trackerState } from '@tora/db';
import { authed } from '@/lib/auth/guard';
import { feedDown } from '../feed-state';
import { StoreAreaForm, StoreNoticeChoice } from '../store-area';
import { storeViews } from '../store-views';

/**
 * The person's area (S25): picked stores or a distance, travel mode, each store on or off. Set
 * once (the first page until an area is set). Above it, how the person is told (S29).
 */
export default async function StoreAreaPage() {
  const { db, user } = await authed();
  const state = await trackerState(db);
  return (
    <div className="space-y-5">
      <StoreNoticeChoice
        mode={storeNoticeModeOf(user.preferences)}
        hideLotteries={user.preferences?.nowHidesLotteries === true}
        paused={feedDown(state.feed, state.tracking).down}
      />
      <StoreAreaForm
        stores={await storeViews(db)}
        area={user.preferences?.storeArea ?? null}
        today={localDate()}
      />
    </div>
  );
}
