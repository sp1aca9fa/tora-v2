import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { bucketLabel } from './product-display';

const texts: Record<string, unknown> = {
  ...en,
  conditionValue: { vinyl_grades: { nm: 'Near mint' } },
};
const lookup = (key: string) =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], texts);
const t = Object.assign((key: string) => String(lookup(key) ?? key), {
  has: (key: string) => typeof lookup(key) === 'string',
});

describe('bucketLabel', () => {
  it('names price conditions instead of showing their codes', () => {
    expect(bucketLabel('sealed:shrink', t)).toBe('Sealed (shrink)');
    expect(bucketLabel('sealed:no_shrink', t)).toBe('Sealed (no shrink)');
    expect(bucketLabel('graded:PSA:10', t)).toBe('PSA 10');
    expect(bucketLabel('raw:A', t)).toBe('Raw A');
    expect(bucketLabel('cond:good', t)).toBe('No noticeable damage');
    expect(bucketLabel('cond:fair', t)).toBe('Minor damage or worse');
    expect(bucketLabel('vinyl_grades:nm', t)).toBe('Near mint');
    expect(bucketLabel('mystery:x', t)).toBe('mystery:x');
  });
});
