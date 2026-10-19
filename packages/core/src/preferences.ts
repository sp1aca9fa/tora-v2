// Per-user display preferences (requirements S8).
import type { StrategyChoice } from './signals';
import type { StoreArea } from './stores';

/** Panels of the Portfolio Summary's rotating card, in their default order. */
export const SUMMARY_PANELS = [
  'movers_pct',
  'movers_amount',
  'movers_sealed',
  'most_traded',
  'gains',
  'most_valuable',
  'market_movers',
  'market_traded',
] as const;
export type SummaryPanel = (typeof SUMMARY_PANELS)[number];

/** Periods (days) the movers and trade panels switch between. */
export const INSIGHT_PERIODS = [7, 30, 90, 365] as const;

/** Seconds per panel the user can pick. */
export const ROTATE_SECONDS = [5, 8, 15, 30] as const;

export interface UserPreferences {
  /** Show amounts when a session starts (default: hidden until the eye button is pressed). */
  amountsVisible?: boolean;
  summary?: {
    /** Cycle through the panels (default); off shows the chosen panels side by side. */
    rotate?: boolean;
    seconds?: number;
    /** The panels shown, in order; all by default. */
    panels?: SummaryPanel[];
  };
  /** Alerts outside the app (S17). */
  alerts?: AlertPrefs;
  /** Buy strategies per item type (S9 part 4); types not listed use Tora's suggestion. */
  buyStrategy?: {
    byType: Record<string, StrategyChoice>;
    /** When the person chose (the Watchlist asks until then). */
    chosenAt?: string;
  };
  /** The stores watched for store notices (S25). */
  storeArea?: StoreArea;
}

/** What a person is sent (S17); each kind on unless switched off. */
export interface AlertPrefs {
  /** Admins: the collect or the backup failed or did not run (at once). */
  failures?: boolean;
  /** Daily summary: imports with rows not added. */
  imports?: boolean;
  /** Daily summary: what waits on the Actions page. */
  actions?: boolean;
  /** Watched items: the buy zone (Good price) and an ask under the target (at once, S9). */
  buy?: boolean;
  /** Daily summary: sharp drops of owned and watched items (S9). */
  drops?: boolean;
  /** The messages' language (one of the admin's two); the app's primary when unset. */
  language?: string;
}

export function alertPrefs(prefs: UserPreferences | null | undefined) {
  const a = prefs?.alerts ?? {};
  return {
    failures: a.failures ?? true,
    imports: a.imports ?? true,
    actions: a.actions ?? true,
    buy: a.buy ?? true,
    drops: a.drops ?? true,
    language: a.language ?? null,
  };
}

/** The Summary card's settings with the defaults filled in. */
export function summaryPrefs(prefs: UserPreferences | null | undefined) {
  const s = prefs?.summary ?? {};
  const panels = (s.panels ?? [])
    // Saved before amounts left yen (S16).
    .map((p) => ((p as string) === 'movers_jpy' ? 'movers_amount' : p))
    .filter((p) => (SUMMARY_PANELS as readonly string[]).includes(p));
  return {
    rotate: s.rotate ?? true,
    seconds: (ROTATE_SECONDS as readonly number[]).includes(s.seconds ?? 0) ? s.seconds! : 8,
    panels: panels.length ? panels : [...SUMMARY_PANELS],
  };
}
