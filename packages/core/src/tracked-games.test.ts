import { describe, expect, it } from 'vitest';
import { addMonths, nightlyMinutes, pickSlot, slotOfDay } from './tracked-games';

describe('slotOfDay', () => {
  it('cycles through 7 slots, one per night', () => {
    // 1970-01-01 is day 0; 2026-11-24 is day 20416 + 1 = 20417 (mod 7 = 5).
    expect(slotOfDay('1970-01-01')).toBe(0);
    expect(slotOfDay('2026-11-24')).toBe(5);
    const week = ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
    expect(week.map(slotOfDay)).toEqual([5, 6, 0, 1, 2]);
    expect(slotOfDay('2026-12-01')).toBe(slotOfDay('2026-11-24'));
  });
});

describe('pickSlot', () => {
  it('takes the slot with the fewest games, the lowest on a tie', () => {
    expect(pickSlot([])).toBe(0);
    expect(pickSlot([1, 1, 0, 0, 1, 1, 1])).toBe(2);
    expect(pickSlot([2, 2, 2, 2, 2, 2, 1])).toBe(6);
  });

  it('spreads 300 games evenly: no slot holds more than one game over another', () => {
    const counts = Array(7).fill(0);
    for (let i = 0; i < 300; i++) counts[pickSlot(counts)]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(300);
  });
});

describe('nightlyMinutes', () => {
  it('is a seventh of the set a night, two requests each, at the measured pace', () => {
    // 300 games: 43 a night, 86 requests at 30 s = 43 minutes (S36 step D: "about 45").
    expect(nightlyMinutes(300, 30_000)).toBe(43);
    expect(nightlyMinutes(1, 30_000)).toBe(1);
    expect(nightlyMinutes(0, null)).toBe(0);
  });

  it('is unknown while the pace is not measured', () => {
    expect(nightlyMinutes(300, null)).toBeNull();
    expect(nightlyMinutes(300, 0)).toBeNull();
    expect(nightlyMinutes(300, Number.NaN)).toBeNull();
  });
});

describe('addMonths', () => {
  it('keeps the day, or the last of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', 12)).toBe('2027-03-10');
  });
});
