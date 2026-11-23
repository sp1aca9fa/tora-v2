import { expect, it } from 'vitest';
import { showsPrices } from './wish-prices';

it('hides prices only while a game wish needs its check', () => {
  expect(showsPrices('check_needed')).toBe(false);
  expect(showsPrices('confirmed')).toBe(true);
  expect(showsPrices('not_game')).toBe(true);
});
