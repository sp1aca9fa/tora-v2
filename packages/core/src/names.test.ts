import { describe, expect, it } from 'vitest';
import { pickLocale, resolveLanguages } from './names';

describe('app languages (S16)', () => {
  const installed = ['en', 'ja', 'fr'];

  it('defaults to English with Japanese as the toggle', () => {
    expect(resolveLanguages(null, installed)).toEqual({ primary: 'en', secondary: 'ja' });
  });

  it('keeps the admin choice to installed languages', () => {
    expect(resolveLanguages({ primary: 'fr', secondary: 'en' }, installed)).toEqual({
      primary: 'fr',
      secondary: 'en',
    });
    expect(resolveLanguages({ primary: 'de', secondary: 'ko' }, installed)).toEqual({
      primary: 'en',
      secondary: null,
    });
    expect(resolveLanguages({ primary: 'fr', secondary: null }, installed).secondary).toBeNull();
    expect(resolveLanguages({ primary: 'ja', secondary: 'ja' }, installed).secondary).toBeNull();
  });

  it("shows a user's choice only when it is one of the two", () => {
    const languages = { primary: 'fr', secondary: 'en' };
    expect(pickLocale('en', languages)).toBe('en');
    expect(pickLocale('ja', languages)).toBe('fr');
    expect(pickLocale(undefined, languages)).toBe('fr');
  });
});
