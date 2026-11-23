import { inAppZone } from '@tora/core';
import { type Db, insertObservationsWithRuleState } from '@tora/db';
import type { baseConverter } from './money';
import type { PriceInput } from './types';

/**
 * Stores a plug-in's rows: amounts converted to the base currency (S16), times in the app's zone.
 * The nightly runner and the daytime job runner (S36 B4) both save through it. Returns rows added.
 */
export async function saveObservations(
  db: Db,
  toBase: Awaited<ReturnType<typeof baseConverter>>,
  rows: PriceInput[],
): Promise<number> {
  const converted = [];
  for (const { price, ...row } of rows) {
    const c = await toBase(price, row.currency, row.observedAt);
    converted.push({
      ...row,
      // Plug-ins may give times with any offset (a site's own): stored in the app's zone.
      observedAt: inAppZone(row.observedAt),
      fetchedAt: inAppZone(row.fetchedAt),
      priceBase: c.amount,
      fxRate: c.rate,
      raw: c.rateDate ? { ...(row.raw as object), fxDate: c.rateDate } : row.raw,
    });
  }
  // A row the game rules marked goes in with its item's rule state (S36 A1); others as before.
  return insertObservationsWithRuleState(db, converted);
}
