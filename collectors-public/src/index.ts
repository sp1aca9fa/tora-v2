import type { SourceInfo } from '@tora/core';
import type { Collector, PullRateSource, RateSource } from '@tora/collector-sdk';
import { ebay as ebayCollector } from './ebay';
import { frankfurter } from './fx';
import { pullRateSuggestions } from './pull-rates';
import { tcgcsv } from './tcgcsv';
import { tcgdex } from './tcgdex';

const hasEbayKeys = !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

// Collectors safe to publish: public APIs only. eBay needs a keyset (EBAY_CLIENT_ID / _SECRET);
// Cardmarket is switched on by ENABLE_CARDMARKET=1 (for a European market).
export const collectors: Collector[] = [
  tcgcsv,
  ...(hasEbayKeys ? [ebayCollector] : []),
  ...(process.env.ENABLE_CARDMARKET === '1' ? [tcgdex] : []),
];
export const rates: RateSource[] = [frankfurter];
// Community pull rates for the box opening value (S20).
export const pullRates: PullRateSource[] = [pullRateSuggestions];

/** eBay's official Browse API: US asking prices. */
const ebay: SourceInfo = {
  key: 'ebay',
  label: 'eBay',
  badge: 'e',
  market: 'us',
  currency: 'USD',
  priceKinds: ['listing'],
  roles: { card: 'supporting', sealed: 'supporting' },
  priority: 50,
  // eBay's API terms: no eBay data in AI models; copies only as long as needed.
  noAi: true,
  detailsDays: 14,
};

/** Cardmarket through TCGdex: a European market's price reference for cards. */
const cardmarket: SourceInfo = {
  key: 'tcgdex',
  label: 'Cardmarket',
  badge: 'C',
  market: 'eu',
  currency: 'EUR',
  // Cardmarket's daily trend price, worked out from its sales: one "sale" a day.
  priceKinds: ['market'],
  roles: { card: 'reference' },
  identity: ['card'],
  priority: 40,
  // TCGdex's card link (its API answer for the card): a stable page per card.
  links: [
    {
      pattern: 'api\\.tcgdex\\.net/v2/\\w+/cards/([\\w.-]+)',
      url: 'https://api.tcgdex.net/v2/en/cards/{id}',
    },
  ],
};

/**
 * How the app should use these (requirements S8, sources with roles): TCGplayer's US prices,
 * and eBay's and Cardmarket's when switched on. Shops purchases come from belong to each setup's
 * own package (`collectors/`).
 */
export const sources: SourceInfo[] = [
  {
    key: 'tcgcsv',
    label: 'TCGplayer',
    badge: 'T',
    market: 'us',
    currency: 'USD',
    priceKinds: ['listing'],
    // The secondary market's price (S11): its own market, never the primary value.
    roles: { card: 'reference', sealed: 'reference' },
    identity: ['card', 'sealed'],
    priority: 40,
    // The set is read from the rest of the path, so the link is kept as pasted.
    links: [
      {
        pattern: 'tcgplayer\\.com/product/(\\d+)(/[\\w-]*)?',
        url: 'https://www.tcgplayer.com/product/{id}{rest}',
      },
    ],
  },
  // Only with its keys, like its collector.
  ...(hasEbayKeys ? [ebay] : []),
  // Only when switched on: otherwise its market would show in Settings without prices.
  ...(process.env.ENABLE_CARDMARKET === '1' ? [cardmarket] : []),
];
