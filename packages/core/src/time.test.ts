import { describe, expect, it } from 'vitest';
import { displayName } from './names';
import { tokyoDate, tokyoDateToIso, toTokyoIso } from './time';

describe('time', () => {
  it('formats in Asia/Tokyo with offset', () => {
    const d = new Date('2026-10-09T15:30:00.000Z');
    expect(toTokyoIso(d)).toBe('2026-10-10T00:30:00.000+09:00');
    expect(tokyoDate(d)).toBe('2026-10-10');
    expect(new Date(toTokyoIso(d)).getTime()).toBe(d.getTime());
  });
});

describe('displayName', () => {
  it('uses the locale with fallback', () => {
    expect(displayName({ nameJa: 'ピカチュウ', nameEn: 'Pikachu' }, 'ja')).toBe('ピカチュウ');
    expect(displayName({ nameJa: 'ピカチュウ', nameEn: 'Pikachu' }, 'en')).toBe('Pikachu');
    expect(displayName({ nameJa: 'ピカチュウ', nameEn: ' ' }, 'en')).toBe('ピカチュウ');
    expect(displayName({ nameJa: null, nameEn: 'Pikachu' }, 'ja')).toBe('Pikachu');
  });
});

describe('tokyoDateToIso', () => {
  it('uses now for today and start of day otherwise', () => {
    const now = new Date('2026-10-09T03:00:00.000Z');
    expect(tokyoDateToIso('2026-10-09', now)).toBe('2026-10-09T12:00:00.000+09:00');
    expect(tokyoDateToIso('2026-09-28', now)).toBe('2026-09-28T00:00:00.000+09:00');
    expect(() => tokyoDateToIso('28/09/2026', now)).toThrow(RangeError);
  });
});
