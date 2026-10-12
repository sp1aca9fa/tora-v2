/**
 * Amounts hidden or shown (requirements S8): the eye button's choice for this browser session,
 * kept in a session cookie so pages render already hidden (no flash of amounts); without it the
 * user's setting decides (hidden unless "always show amounts").
 */
export const AMOUNTS_COOKIE = 'tora_amounts';
export type AmountsMode = 'hidden' | 'shown';
