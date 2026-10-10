// Lot sizes a source did not report (e.g. SNKRDUNK card trades before it showed "10枚"): a trade
// priced at about k times what the same item sold for around then is taken as k units.
import { median } from './market';

/** Largest lot considered. */
export const MAX_ESTIMATED_LOT = 10;
/** How close the price must be to k times the reference (0.12 = within 12 %). */
export const LOT_TOLERANCE = 0.12;
/** Fewer reference trades than this: no estimate (the lot counts as 1). */
export const MIN_LOT_REFERENCES = 3;

/**
 * Units in a trade of `lotPrice`, given prices of comparable single units sold around the same
 * time (same item and condition). 1 unless the price is close to a multiple of their median.
 */
export function estimateLotSize(lotPrice: number, references: readonly number[]): number {
  if (references.length < MIN_LOT_REFERENCES || lotPrice <= 0) return 1;
  const unit = median([...references]);
  if (!unit || unit <= 0) return 1;
  let best = 1;
  let bestError = Math.abs(lotPrice / unit - 1);
  for (let k = 2; k <= MAX_ESTIMATED_LOT; k++) {
    const error = Math.abs(lotPrice / (k * unit) - 1);
    if (error < bestError) {
      best = k;
      bestError = error;
    }
  }
  return best > 1 && bestError <= LOT_TOLERANCE ? best : 1;
}
