import {
  type Db,
  createDb,
  fxRateOn,
  latestFxDate,
  saveSourceInfos,
  setCurrencySettings,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { PoliteHttp } from './http';
import { MissingRateError, baseConverter } from './money';
import { updateRates } from './rates';
import type { RateSource } from './types';

let db: Db;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-rates-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  // A US market source: its currency needs a rate to the base (yen by default).
  await saveSourceInfos(db, [{ key: 'us', label: 'US', market: 'us', currency: 'USD' }]);
  return () => rm(dir, { recursive: true, force: true });
});

const asked: [string, string, string][] = [];
const source: RateSource = {
  key: 'test',
  label: 'test',
  currencies: ['USD', 'JPY', 'EUR'],
  rates: async (_http, pair, start, end) => {
    asked.push([`${pair.from}${pair.to}`, start, end]);
    return [
      { date: '2026-10-08', rate: 158.28 },
      { date: '2026-10-09', rate: 158.25 },
    ].filter((r) => r.date >= start);
  },
};

it('fills the history once, then only the days since the last stored one', async () => {
  asked.length = 0;
  const http = new PoliteHttp();
  await updateRates(db, [source], http, new Date('2026-10-12T03:00:00Z'));
  expect(asked[0]).toEqual(['USDJPY', '2025-09-07', '2026-10-12']);
  expect(await latestFxDate(db, 'USDJPY')).toBe('2026-10-09');
  // A weekend or holiday uses the last working day's rate; a day before any, the first after.
  expect(await fxRateOn(db, 'USDJPY', '2026-10-11')).toEqual({ date: '2026-10-09', rate: 158.25 });
  expect(await fxRateOn(db, 'USDJPY', '2026-10-01')).toEqual({ date: '2026-10-08', rate: 158.28 });

  const [again] = await updateRates(db, [source], http, new Date('2026-10-13T03:00:00Z'));
  expect(asked[1]).toEqual(['USDJPY', '2026-10-09', '2026-10-13']);
  expect(again).toMatchObject({ saved: 1, latest: '2026-10-09' });
});

it('converts plug-in amounts to the base with the rate of their day, in its smallest unit', async () => {
  await updateRates(db, [source], new PoliteHttp(), new Date('2026-10-12T03:00:00Z'));
  const toBase = await baseConverter(db);
  // $23.50 (2350 cents) at 158.25 yen.
  expect(await toBase(2350, 'USD', '2026-10-10T12:00:00.000+09:00')).toEqual({
    amount: 3719,
    rate: 158.25,
    rateDate: '2026-10-09',
  });
  expect(await toBase(5000, 'JPY', '2026-10-10T12:00:00.000+09:00')).toMatchObject({
    amount: 5000,
  });
  await expect(toBase(100, 'GBP', '2026-10-10T12:00:00.000+09:00')).rejects.toThrow(
    MissingRateError,
  );
});

it('skips currencies with a typed rate and fetches pairs to another base', async () => {
  asked.length = 0;
  await setCurrencySettings(db, { base: 'EUR', rates: { JPY: { manual: 0.0057 } } });
  await saveSourceInfos(db, [
    { key: 'us', label: 'US', market: 'us', currency: 'USD' },
    { key: 'jp', label: 'JP', market: 'jp', currency: 'JPY' },
  ]);
  const out = await updateRates(db, [source], new PoliteHttp(), new Date('2026-10-12T03:00:00Z'));
  expect(out.map((o) => o.pair)).toEqual(['USDEUR']);
  expect(asked.map((a) => a[0])).toEqual(['USDEUR']);
});
