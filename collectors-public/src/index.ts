import type { Collector, RateSource } from '@tora/collector-sdk';
import { ebay } from './ebay';
import { usdJpy } from './fx';
import { tcgcsv } from './tcgcsv';

// Collectors safe to publish: public APIs only. eBay needs a keyset (EBAY_CLIENT_ID / _SECRET).
export const collectors: Collector[] = [
  tcgcsv,
  ...(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET ? [ebay] : []),
];
export const rates: RateSource[] = [usdJpy];
