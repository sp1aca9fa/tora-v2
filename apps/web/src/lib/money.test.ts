import { expect, it } from 'vitest';
import { amountFromText, makeMoney } from './money';

it('reads typed amounts with symbols, full-width digits and decimal commas', () => {
  expect(amountFromText('¥5,400')).toBe(5400);
  expect(amountFromText('５４００')).toBe(5400);
  expect(amountFromText('12.50')).toBe(12.5);
  expect(amountFromText('12,50 €')).toBe(12.5);
  expect(amountFromText('1,250')).toBe(1250);
  expect(amountFromText('')).toBeNull();
  expect(amountFromText('abc')).toBeNull();
});

it('shows and reads amounts in the base currency smallest unit', () => {
  const yen = makeMoney({ base: 'JPY', locale: 'en' });
  expect(yen(5400)).toBe('¥5,400');
  expect(yen.parse('5,400')).toBe(5400);
  const euro = makeMoney({ base: 'EUR', locale: 'en' });
  expect(euro(1250)).toBe('€12.50');
  expect(euro.symbol).toBe('€');
  expect(euro.input(1250)).toBe('12.5');
  expect(euro.parse('12,50')).toBe(1250);
});
