// The numbers the texts state (spec 2026-11-25 text-numbers): the db package's
// (`DB_TEXT_NUMBERS`, core's included) and the web app's own. Imports only modules that do not
// import next-intl: a page that does leads back here through the texts' loader.
import { MIN_PASSWORD, TOTP_DIGITS, USERNAME_MAX, USERNAME_MIN } from '@tora/auth';
import { type TextNumbers } from '@tora/core';
import { DB_TEXT_NUMBERS } from '@tora/db';
import { SILENT_MS } from '@/app/(app)/stores/feed-state';
import {
  CONSOLE_KEY_MAX,
  CONSOLE_SORT_MAX,
  FEED_CHECK_MINUTES,
  GLOSSARY_CODE_MAX,
  MAX_LINKS,
  OPENING_PACKS_MAX,
  POST_DAY_STARTS,
  PRICE_STATS_DAYS,
  SHEET_MAX_BYTES,
  SHEET_MAX_ROWS,
} from '@/lib/app-numbers';

export const TEXT_NUMBERS: TextNumbers = {
  ...DB_TEXT_NUMBERS,
  totpDigits: TOTP_DIGITS,
  usernameMin: USERNAME_MIN,
  usernameMax: USERNAME_MAX,
  maxLinks: MAX_LINKS,
  sheetMaxMb: SHEET_MAX_BYTES / 1024 / 1024, // bytes shown in MB
  sheetMaxRows: SHEET_MAX_ROWS.toLocaleString('en-US'), // shown with a thousands comma: 5,000
  minPassword: MIN_PASSWORD,
  glossaryCodeMax: GLOSSARY_CODE_MAX,
  consoleKeyMax: CONSOLE_KEY_MAX,
  consoleSortMax: CONSOLE_SORT_MAX,
  openingPacksMax: OPENING_PACKS_MAX,
  postDayStarts: POST_DAY_STARTS.replace(/^0/, ''), // 05:00 shown as 5:00
  priceStatsDays: PRICE_STATS_DAYS,
  feedCheckMinutes: FEED_CHECK_MINUTES,
  silentMinutes: SILENT_MS / 60_000, // ms shown as minutes
};
