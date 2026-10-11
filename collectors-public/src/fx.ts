import type { RateSource } from '@tora/collector-sdk';

/**
 * USD/JPY from Frankfurter (European Central Bank reference rates, free, no key). Working days
 * only; the app uses the last rate on or before a date.
 */
export const usdJpy: RateSource = {
  pair: 'USDJPY',
  label: 'Frankfurter (ECB)',
  async rates(http, from, to) {
    const data = await http.json<{ rates?: Record<string, { JPY?: number }> }>(
      `https://api.frankfurter.dev/v1/${from}..${to}?from=USD&to=JPY`,
    );
    return Object.entries(data.rates ?? {})
      .filter(([, r]) => typeof r.JPY === 'number')
      .map(([date, r]) => ({ date, rate: r.JPY! }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
};
