import type { SourceRegistry } from '@tora/core';
import { describe, expect, it } from 'vitest';
import { offEverywhere } from './collect-plan';

const registry = (r: Partial<SourceRegistry>): SourceRegistry => ({
  sources: [
    { key: 'megastore', label: 'Megastore', market: 'jp' },
    {
      key: 'arcade',
      label: 'Arcade',
      market: 'jp',
      identity: ['game'],
      links: [{ pattern: 'x', url: 'y' }],
    },
  ],
  roles: {},
  markets: { primary: 'jp', secondary: null },
  ...r,
});

describe('sources left out of the collect', () => {
  it('leaves out a source off for every item type', () => {
    expect(
      offEverywhere(registry({ roles: { megastore: { card: 'off', game: 'off' } } }), 'megastore'),
    ).toBe(true);
    // No role at all is off too.
    expect(offEverywhere(registry({}), 'megastore')).toBe(true);
  });

  it('keeps a source used for any type, even only for comparison', () => {
    expect(
      offEverywhere(
        registry({ roles: { megastore: { card: 'off', game: 'comparison' } } }),
        'megastore',
      ),
    ).toBe(false);
    expect(
      offEverywhere(registry({ roles: { megastore: { sealed: 'supporting' } } }), 'megastore'),
    ).toBe(false);
  });

  it('keeps an identity source whose roles are all off', () => {
    expect(offEverywhere(registry({ roles: { arcade: { game: 'off' } } }), 'arcade')).toBe(false);
    // The admin chose no identity source for games in its market: then it is off.
    const none = registry({
      roles: { arcade: { game: 'off' } },
      markets: { primary: 'jp', secondary: null, identity: { jp: { game: null } } },
    });
    expect(offEverywhere(none, 'arcade')).toBe(true);
  });

  it('keeps a source the registry does not describe (unknown is not off)', () => {
    expect(offEverywhere(registry({}), 'myboard')).toBe(false);
  });
});
