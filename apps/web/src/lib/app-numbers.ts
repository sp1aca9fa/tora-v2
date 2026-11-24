// The web app's own limits that its texts state too (i18n/text-numbers.ts). A plain module with no
// imports: server actions may export only async functions, and a page's module may import
// next-intl, which leads back to the texts' loader.

/** Links one paste may add at most. */
export const MAX_LINKS = 200;
/** A sheet import's largest file and most rows. */
export const SHEET_MAX_BYTES = 2 * 1024 * 1024;
export const SHEET_MAX_ROWS = 5000;
/** A glossary code's most characters. */
export const GLOSSARY_CODE_MAX = 20;
/** A console key's most characters, and the highest sort order. */
export const CONSOLE_KEY_MAX = 32;
export const CONSOLE_SORT_MAX = 9999;
/** Packs a box may hold at most (opening rates). */
export const OPENING_PACKS_MAX = 100;
/** A day of posts starts at this hour (a late night's posts belong to the day before). */
export const POST_DAY_STARTS = '05:00';
/** Days of an item's sources' median and trades ("Last 30 days"). */
export const PRICE_STATS_DAYS = 30;
/** Minutes between two store feed checks on a self-hosted server. */
export const FEED_CHECK_MINUTES = 2;
