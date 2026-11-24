// The numbers the texts state (core's `CORE_TEXT_NUMBERS`) and the db package's own: every alert
// text's token has its value here, since the db's sender and tests read the texts too.
import { CORE_TEXT_NUMBERS, type TextNumbers } from '@tora/core';
import { SETUP_LINK_HOURS } from './accounts';
import { SUMMARY_GAP_HOURS } from './alerts';
import { FREE_ROWS_READ, FREE_ROWS_WRITTEN, PACE_FROM_DAY } from './db-usage';
import { LOT_SIZE_RECENT_DAYS } from './lot-sizes';
import { POPULAR_BEFORE_DAYS, POPULAR_DAYS, POPULAR_YEAR_DAYS, TRENDING_RATIO } from './popularity';
import { CANDIDATE_TOP, RANKING_FRESH_DAYS } from './rankings';
import {
  HEALTH_STALE_DAYS,
  JUMP_BEFORE_DAYS,
  JUMP_RECENT_DAYS,
  JUMP_SHARE,
  LISTING_BROKEN_NIGHTS,
  QUIET_DAYS,
} from './sources';
import { KEEP_POSTS_DAYS } from './stores';
import { MAX_ACTIVE_DEVICES } from './users';
import { WISH_CHECK_SALES_DAYS } from './wish-check';
import { LAST_NIGHT_DAYS, WISH_CHANGE_DAYS } from './wish-view';

export const DB_TEXT_NUMBERS: TextNumbers = {
  ...CORE_TEXT_NUMBERS,
  maxDevices: MAX_ACTIVE_DEVICES,
  setupLinkHours: SETUP_LINK_HOURS,
  freeReadMillions: FREE_ROWS_READ / 1e6, // rows shown in millions
  freeWrittenMillions: FREE_ROWS_WRITTEN / 1e6, // rows shown in millions
  paceFromDay: PACE_FROM_DAY,
  summaryGapHours: SUMMARY_GAP_HOURS,
  quietDays: QUIET_DAYS,
  listingBrokenNights: LISTING_BROKEN_NIGHTS,
  healthStaleDays: HEALTH_STALE_DAYS,
  jumpPct: Math.round(JUMP_SHARE * 100), // a share 0.5 shown as 50
  jumpRecentDays: JUMP_RECENT_DAYS,
  jumpBeforeDays: JUMP_BEFORE_DAYS,
  lotSizeRecentDays: LOT_SIZE_RECENT_DAYS,
  keepPostsDays: KEEP_POSTS_DAYS,
  candidateTop: CANDIDATE_TOP,
  rankingFreshDays: RANKING_FRESH_DAYS,
  popularDays: POPULAR_DAYS,
  popularBeforeDays: POPULAR_BEFORE_DAYS,
  popularFollowDays: POPULAR_DAYS + POPULAR_BEFORE_DAYS, // the days both counts need
  popularYearDays: POPULAR_YEAR_DAYS,
  trendingRatio: TRENDING_RATIO,
  wishChangeWeeks: WISH_CHANGE_DAYS / 7, // days shown as weeks
  lastNightDays: LAST_NIGHT_DAYS,
  wishCheckMonths: (WISH_CHECK_SALES_DAYS / 365) * 12, // days shown as months
};
