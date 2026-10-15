import type { SourceInfo } from '@tora/core';
import type { Collector } from '@tora/collector-sdk';
import { exampleMarket } from './example-market';

// A plug-in package's entry point (docs/collectors.md). `pnpm collect` loads
// `collectors-public/src/index.ts` and `collectors/src/index.ts`, not this template.
export const collectors: Collector[] = [exampleMarket];

/** How the app should use the source: saved to the database on every run. */
export const sources: SourceInfo[] = [
  {
    key: 'example',
    label: 'Example Market',
    badge: 'X',
    market: 'jp',
    currency: 'JPY',
    // Real sales: it can be a reference (docs/sources.md). Asking prices would be 'listing'.
    priceKinds: ['sold'],
    // A suggestion; the admin decides in Settings. New sources are best started as comparison.
    roles: { card: 'comparison' },
    priority: 60,
    // One stable page per card: it can be a card's identity link.
    identity: ['card'],
    // A pasted item link is read with this (group 1: the listing ID).
    links: [
      {
        pattern: 'example-market\\.test/items/([\\w-]+)',
        url: 'https://example-market.test/items/{id}',
      },
    ],
  },
];
