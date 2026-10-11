import type { Collector, RateSource } from '@tora/collector-sdk';
import { usdJpy } from './fx';
import { tcgcsv } from './tcgcsv';

// Collectors safe to publish: public APIs only.
export const collectors: Collector[] = [tcgcsv];
export const rates: RateSource[] = [usdJpy];
