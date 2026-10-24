// Rules that must always hold, tried on many random cases (requirements S15).
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { convertMinor, currencyDigits } from './money';
import { splitHolding } from './split';
import { type ValuationObservation, valueUnit } from './valuation';

const NOW = new Date('2026-10-25T12:00:00Z');

it('keeps the units and the cost when a lot is split', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 100_000 }),
      fc.integer({ min: 0, max: 1e12 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      (quantity, cost, at) => {
        const moved = 1 + Math.floor(at * (quantity - 2));
        const { original, split } = splitHolding({ id: 'L', quantity, costTotalBase: cost }, moved);
        expect(original.quantity + split.quantity).toBe(quantity);
        expect(original.costTotalBase + split.costTotalBase).toBe(cost);
        expect(split.costTotalBase).toBeGreaterThanOrEqual(0);
        // Each side's unit cost stays within a yen of the lot's.
        expect(Math.abs(split.costTotalBase / moved - cost / quantity)).toBeLessThan(1);
      },
    ),
  );
});

const observation = fc.record({
  source: fc.constantFrom('megastore', 'arcade'),
  bucket: fc.constantFrom('sealed:shrink', 'sealed:no_shrink', 'opened', null),
  priceBase: fc.integer({ min: 1, max: 10_000_000 }),
  observedAt: fc
    .integer({ min: 0, max: 400 })
    .map((d) => new Date(NOW.getTime() - d * 86_400_000).toISOString()),
  observationType: fc.constantFrom('sold', 'listing', 'buylist', 'retail'),
}) as fc.Arbitrary<ValuationObservation>;

it('never values from an excluded sale', () => {
  fc.assert(
    fc.property(
      fc.array(observation, { maxLength: 40 }),
      fc.array(observation, { minLength: 1, maxLength: 10 }),
      fc.constantFrom('sealed:shrink', 'opened'),
      (kept, excluded, bucket) => {
        const value = (observations: ValuationObservation[]) =>
          valueUnit({ bucket, observations, now: NOW, sources: ['megastore', 'arcade'] });
        const marked = excluded.map((o) => ({ ...o, excluded: true }));
        expect(value([...kept, ...marked])).toEqual(value(kept));
        expect(value([...marked, ...kept])).toEqual(value(kept));
      },
    ),
  );
});

it('converts an amount there and back within rounding', () => {
  const codes = ['JPY', 'USD', 'EUR', 'KRW', 'BHD'];
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1e12 }),
      fc.constantFrom(...codes),
      fc.constantFrom(...codes),
      fc.double({ min: 0.0001, max: 10_000, noNaN: true }),
      (minor, from, to, rate) => {
        const there = convertMinor(minor, from, to, rate);
        const back = convertMinor(there, to, from, 1 / rate);
        // One rounding each way: half a minor unit of `to`, worth this much in `from`'s units.
        const k = rate * 10 ** (currencyDigits(to) - currencyDigits(from));
        expect(Math.abs(back - minor)).toBeLessThanOrEqual(0.5 + 0.5 / k + 1e-9 * minor);
      },
    ),
  );
});
