import { expect, it, vi } from 'vitest';
import { amount, optText, qty } from './form';

vi.mock('./money-server', () => ({ getBase: async () => 'JPY' }));

it('reads quantities as whole numbers from 1 to 100,000, full-width digits too', () => {
  expect(qty.safeParse('３').data).toBe(3);
  expect(qty.safeParse(' 12 ').data).toBe(12);
  for (const bad of ['0', '-1', '1.5', '1e9', 'abc', ''])
    expect(qty.safeParse(bad).success, bad).toBe(false);
});

it('refuses negative, huge or unreadable amounts and keeps decimals of the base unit', async () => {
  expect((await amount.safeParseAsync('0')).data).toBe(0);
  expect((await amount.safeParseAsync('¥1,234')).data).toBe(1234);
  expect((await amount.safeParseAsync('12.4')).data).toBe(12);
  for (const bad of ['-5', '1e12', 'abc', '', 'NaN', 'Infinity'])
    expect((await amount.safeParseAsync(bad)).success, bad).toBe(false);
});

it('caps texts at 1,000 characters and keeps markup as typed', () => {
  expect(optText.safeParse('<b>x</b>').data).toBe('<b>x</b>');
  expect(optText.safeParse('x'.repeat(1001)).success).toBe(false);
  expect(optText.safeParse('   ').data).toBeUndefined();
});
