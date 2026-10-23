import type { SourceInfo } from '@tora/core';
import type { Collector, PullRateSource, RateSource } from '@tora/collector-sdk';
import { ebay } from './ebay';
import { frankfurter } from './fx';
import { pullRateSuggestions } from './pull-rates';
import { tcgcsv } from './tcgcsv';
import { tcgdex } from './tcgdex';

// Collectors safe to publish: public APIs only. eBay needs a keyset (EBAY_CLIENT_ID / _SECRET);
// Cardmarket is switched on by ENABLE_CARDMARKET=1 (for a European market).
export const collectors: Collector[] = [
  tcgcsv,
  ...(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET ? [ebay] : []),
  ...(process.env.ENABLE_CARDMARKET === '1' ? [tcgdex] : []),
];
export const rates: RateSource[] = [frankfurter];
// Community pull rates for the box opening value (S20).
export const pullRates: PullRateSource[] = [pullRateSuggestions];

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
 * How the app should use these (requirements S8, sources with roles; part of the "Japan
 * collectibles" preset): US prices for comparison only, and the shops purchases come from.
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
  {
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
  },
  // Only when switched on: otherwise its market would show in Settings without prices.
  ...(process.env.ENABLE_CARDMARKET === '1' ? [cardmarket] : []),
  // Shops purchases come from (not price sources).
  {
    key: 'amazon',
    label: 'Amazon',
    shopOnly: true,
    aliases: ['amazon', 'アマゾン'],
    orderIds: { hint: '注文番号 like 503-1234567-1234567' },
  },
  {
    key: 'yahoo',
    label: 'Yahoo',
    shopOnly: true,
    aliases: ['yahoo', 'ヤフオク', 'ヤフー', 'paypay'],
    singleItemOrders: true,
  },
  { key: 'yodobashi', label: 'Yodobashi', shopOnly: true, aliases: ['yodobashi', 'ヨドバシ'] },
  {
    key: 'biccamera',
    label: 'Bic Camera',
    shopOnly: true,
    aliases: ['bic camera', 'biccamera', 'ビックカメラ'],
  },
  {
    key: 'pokemoncenter',
    label: 'Pokemon Center',
    shopOnly: true,
    aliases: ['pokemon center', 'ポケモンセンター'],
  },
];
