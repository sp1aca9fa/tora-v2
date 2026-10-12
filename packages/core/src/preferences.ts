// Per-user display preferences (requirements S8).

/** Panels of the Portfolio Summary's rotating card, in their default order. */
export const SUMMARY_PANELS = [
  'movers_pct',
  'movers_jpy',
  'movers_sealed',
  'most_traded',
  'gains',
  'most_valuable',
] as const;
export type SummaryPanel = (typeof SUMMARY_PANELS)[number];

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
}

/** The Summary card's settings with the defaults filled in. */
export function summaryPrefs(prefs: UserPreferences | null | undefined) {
  const s = prefs?.summary ?? {};
  const panels = (s.panels ?? []).filter((p) => (SUMMARY_PANELS as readonly string[]).includes(p));
  return {
    rotate: s.rotate ?? true,
    seconds: (ROTATE_SECONDS as readonly number[]).includes(s.seconds ?? 0) ? s.seconds! : 8,
    panels: panels.length ? panels : [...SUMMARY_PANELS],
  };
}
