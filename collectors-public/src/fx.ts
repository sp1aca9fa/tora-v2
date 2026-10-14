import type { RateSource } from '@tora/collector-sdk';

/**
 * Daily rates from Frankfurter (European Central Bank reference rates, free, no key) between the
 * currencies the ECB publishes. Working days only; the app uses the last rate on or before a date.
 */
export const frankfurter: RateSource = {
  key: 'frankfurter',
  label: 'European Central Bank (Frankfurter)',
  currencies: [
    'AUD',
    'BGN',
    'BRL',
    'CAD',
    'CHF',
    'CNY',
    'CZK',
    'DKK',
    'EUR',
    'GBP',
    'HKD',
    'HUF',
    'IDR',
    'ILS',
    'INR',
    'ISK',
    'JPY',
    'KRW',
    'MXN',
    'MYR',
    'NOK',
    'NZD',
    'PHP',
    'PLN',
    'RON',
    'SEK',
    'SGD',
    'THB',
    'TRY',
    'USD',
    'ZAR',
  ],
  async rates(http, pair, start, end) {
    const data = await http.json<{ rates?: Record<string, Record<string, number>> }>(
      `https://api.frankfurter.dev/v1/${start}..${end}?from=${pair.from}&to=${pair.to}`,
    );
    return Object.entries(data.rates ?? {})
      .filter(([, r]) => typeof r[pair.to] === 'number')
      .map(([date, r]) => ({ date, rate: r[pair.to]! }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
};
