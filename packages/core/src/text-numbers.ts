// Numbers the texts state, from the code's own constants (spec 2026-11-25 text-numbers): a text
// names one by a token, `[[name]]`, and the loader replaces it before anything reads the text.
// One value a line; a derived one says how (a share 0.15 shown as 15, days shown as weeks).
// The db package adds its own (`DB_TEXT_NUMBERS`), the web app its own on top.
import { DATA_CHECK } from './data-check';
import { LISTINGS_BACK_DAYS } from './deal-ways';
import { DEEP_READ_MONTHS, TRACKED_WEEKLY_DAYS } from './deep-read';
import { CHECK_SAMPLE_SIZE } from './game-rules';
import { MARKET_FLOOR, MARKET_HOURS, MARKET_WAIT_MS } from './market-ceiling';
import {
  AGE_CHANGE_DAYS,
  OPPORTUNITY_HORIZON,
  PROVEN_MIN_CHECKS,
  PROVEN_POINTS,
  QUICK_RISE_BEFORE_DAYS,
  QUICK_RISE_DAYS,
  SALES_RECENT_DAYS,
} from './opportunities';
import { MIX_MAX_SHARE } from './plan';
import { POTENTIAL_SUBJECTS } from './potential';
import {
  DEFAULT_MARGIN,
  FAIR_DAYS,
  FALLING_2W,
  FALL_DAYS,
  HOLD_BEFORE_DAYS,
  HOLD_DAYS,
  LIMITED_SALES,
  MARKET_MIN_ITEMS,
  MONTH_TREND_DAYS,
  NEW_RELEASE_DAYS,
  PATTERN_HORIZON,
  PATTERN_MIN_ITEMS,
  RANGE_DAYS,
  RANGE_MIN_DAYS,
  SHARP_DROP_7D,
  SHARP_DROP_DAYS,
  TREND_DAYS,
  YEAR_LOW_SHARE,
} from './signals';
import { QUALITY_MIN_PAIRS } from './sources';
import { BURST_AUTHORS, BURST_MINUTES } from './stores';
import { MAX_TRACKING_DELAY } from './tracking';
import {
  HIGH_CONFIDENCE_DAYS,
  HIGH_CONFIDENCE_SALES,
  MEDIUM_CONFIDENCE_DAYS,
  MIN_SAMPLES,
} from './valuation';
import { WISH_POINTER_SHARE } from './wish-alert';
import { LEVEL_MIN, LEVEL_WINDOWS } from './wish-level';

/** A token's value: a number, or a string already formatted (a time, a number with a separator). */
export type TextNumbers = Readonly<Record<string, number | string>>;

/** A share (0.15) as the percent a text shows (15). */
const percent = (share: number) => Math.round(Math.abs(share) * 100);
/** An hour as a text shows it (`05:00`). */
const clock = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export const CORE_TEXT_NUMBERS: TextNumbers = {
  fairDays: FAIR_DAYS,
  limitedSales: LIMITED_SALES,
  rangeDays: RANGE_DAYS,
  rangeMonths: RANGE_DAYS / 30, // days shown as months
  rangeMinDays: RANGE_MIN_DAYS[RANGE_DAYS],
  yearLowOneIn: Math.round(1 / YEAR_LOW_SHARE), // a share 0.1 shown as "1 day in 10"
  fallWeeks: FALL_DAYS / 7, // days shown as weeks
  fallingPct: percent(FALLING_2W), // a fall -0.05 shown as 5
  monthTrendWeeks: MONTH_TREND_DAYS / 7, // days shown as weeks
  trendWeeks: TREND_DAYS / 7, // days shown as weeks
  holdDays: HOLD_DAYS,
  holdWeeks: HOLD_DAYS / 7, // days shown as weeks
  holdBeforeDays: HOLD_BEFORE_DAYS,
  defaultMargin: DEFAULT_MARGIN,
  marketMinItems: MARKET_MIN_ITEMS,
  patternDays: PATTERN_HORIZON,
  patternMonths: PATTERN_HORIZON / 30, // days shown as months
  patternMinItems: PATTERN_MIN_ITEMS,
  newReleaseDays: NEW_RELEASE_DAYS,
  sharpDropPct: percent(SHARP_DROP_7D), // a drop -0.15 shown as 15
  sharpDropDays: SHARP_DROP_DAYS,
  highConfidenceSales: HIGH_CONFIDENCE_SALES,
  highConfidenceDays: HIGH_CONFIDENCE_DAYS,
  mediumConfidenceSales: MIN_SAMPLES,
  mediumConfidenceDays: MEDIUM_CONFIDENCE_DAYS,
  opportunityDays: OPPORTUNITY_HORIZON,
  provenMinChecks: PROVEN_MIN_CHECKS,
  provenPoints: percent(PROVEN_POINTS), // a share 0.05 shown as 5 points
  salesRecentDays: SALES_RECENT_DAYS,
  ageChangeDays: AGE_CHANGE_DAYS,
  quickRiseDays: QUICK_RISE_DAYS,
  quickRiseBeforeDays: QUICK_RISE_BEFORE_DAYS,
  listingsBackDays: LISTINGS_BACK_DAYS,
  mixMaxPct: percent(MIX_MAX_SHARE), // a share 0.4 shown as 40
  potentialSubjects: POTENTIAL_SUBJECTS,
  levelDays: LEVEL_WINDOWS[0],
  levelLongDays: LEVEL_WINDOWS[1],
  levelMin: LEVEL_MIN,
  checkSample: CHECK_SAMPLE_SIZE,
  trackedWeeklyWeeks: TRACKED_WEEKLY_DAYS / 7, // days shown as weeks
  deepReadMonths: DEEP_READ_MONTHS,
  marketFloor: MARKET_FLOOR,
  marketFrom: clock(MARKET_HOURS.from), // an hour shown as 05:00
  marketTo: clock(MARKET_HOURS.to), // an hour shown as 22:00
  marketWaitDays: MARKET_WAIT_MS / 86_400_000, // ms shown as days
  maxTrackingDelay: MAX_TRACKING_DELAY,
  burstAuthors: BURST_AUTHORS,
  burstMinutes: BURST_MINUTES,
  qualityMinPairs: QUALITY_MIN_PAIRS,
  wishPointerPct: percent(WISH_POINTER_SHARE), // a share 0.1 shown as 10
  dataCheckNights: DATA_CHECK.learnNights,
};

const TOKEN = /\[\[(\w+)\]\]/g;

/**
 * The texts with every `[[name]]` replaced by its value, as a new tree (the input is not changed).
 * A token without a value throws: a text never shows a token, nor a guess.
 */
export function withNumbers<T>(tree: T, values: TextNumbers): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string')
      return node.replace(TOKEN, (_, name: string) => {
        if (!Object.prototype.hasOwnProperty.call(values, name))
          throw new Error(`Text number [[${name}]] has no value`);
        return String(values[name]);
      });
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object')
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return walk(tree) as T;
}
