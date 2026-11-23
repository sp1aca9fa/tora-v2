import type { WishState } from '@tora/db';

/**
 * Whether a wish's row shows its price, ask, gap to the target, buy timing and last sale (fix C5):
 * not while a game wish needs its check, since they would come from sales nobody checked. A
 * confirmed game wish, a card and sealed show them.
 */
export function showsPrices(state: WishState): boolean {
  return state !== 'check_needed';
}
