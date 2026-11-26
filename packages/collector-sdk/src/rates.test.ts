import {
  type Db,
  createDb,
  fxRateOn,
  latestFxDate,
  saveFxRates,
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
import { staleRates, updateRates } from './rates';
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

it('reports fetched rates more than 7 days old, not typed ones nor pairs with none', async () => {
  await saveFxRates(db, 'USDJPY', [{ date: '2026-10-01', rate: 150 }]);
  expect(await staleRates(db, [source], new Date('2026-10-08T03:00:00Z'))).toEqual([]);
  expect(await staleRates(db, [source], new Date('2026-10-09T03:00:00Z'))).toEqual([
    { from: 'USD', to: 'JPY', latest: '2026-10-01', days: 8 },
  ]);
  // A typed rate applies until changed.
  await setCurrencySettings(db, { base: 'JPY', rates: { USD: { manual: 150 } } });
  expect(await staleRates(db, [source], new Date('2026-10-20T03:00:00Z'))).toEqual([]);
  // No rate stored: updateRates says so.
  await setCurrencySettings(db, { base: 'EUR', rates: {} });
  expect(await staleRates(db, [source], new Date('2026-10-20T03:00:00Z'))).toEqual([]);
});

it('leaves a refused rate site alone, takes its lock, and stops at a refusal (Refusals)', async () => {
  // Two currencies to the base from one rate site.
  await saveSourceInfos(db, [
    { key: 'us', label: 'US', market: 'us', currency: 'USD' },
    { key: 'eu', label: 'EU', market: 'eu', currency: 'EUR' },
  ]);
  const sent: string[] = [];
  const refusing: RateSource = {
    ...source,
    rates: async (http, pair) => {
      await http.text(`https://rates.example/${pair.from}`);
      return [{ date: '2026-10-09', rate: 1 }];
    },
  };
  const http = () =>
    new PoliteHttp({
      minDelayMs: 0,
      maxDelayMs: 0,
      fetchImpl: (async (url: string) => {
        sent.push(url);
        return new Response('', { status: 429 });
      }) as unknown as typeof fetch,
    });
  const now = new Date('2026-10-12T03:00:00Z');
  const taken: string[] = [];
  const released: string[] = [];
  const lock = async (key: string) => {
    taken.push(key);
    return { release: () => void released.push(key) };
  };

  // Refused earlier today: nothing is sent, no lock taken, the stored rates stay.
  const left = await updateRates(db, [refusing], http(), now, { leave: new Set(['test']), lock });
  expect(left.map((r) => r.waits)).toEqual(['left', 'left']);
  expect(sent).toEqual([]);
  expect(taken).toEqual([]);

  // Its lock held by another run: its pairs wait.
  const held = await updateRates(db, [refusing], http(), now, { lock: async () => null });
  expect(held.map((r) => r.waits)).toEqual(['locked', 'locked']);
  expect(sent).toEqual([]);

  // A refusal: that pair is marked with its time, the next is not sent, the lock is given back.
  const refused = await updateRates(db, [refusing], http(), now, { lock });
  expect(refused.map((r) => r.waits)).toEqual(['refused', 'left']);
  expect(refused[0]).toMatchObject({ source: 'test', saved: 0, waits: 'refused' });
  expect(refused[0]!.refusedAt).toBeInstanceOf(Date);
  expect(sent).toHaveLength(1);
  expect(taken).toEqual(['test']);
  expect(released).toEqual(['test']);

  // A plug-in that catches the refusal still stops the rates.
  sent.length = 0;
  const swallowing: RateSource = {
    ...refusing,
    rates: async (h, pair) => {
      await h.text(`https://rates.example/${pair.from}`).catch(() => '');
      return [{ date: '2026-10-09', rate: 1 }];
    },
  };
  const caught = await updateRates(db, [swallowing], http(), now);
  expect(caught.map((r) => r.waits)).toEqual(['refused', 'left']);
  expect(sent).toHaveLength(1);
  expect(await latestFxDate(db, 'USDJPY')).toBeNull();
  expect(await latestFxDate(db, 'EURJPY')).toBeNull();
});

it("a site's refusal leaves its later pairs, other sites are still read with their own client", async () => {
  // Three currencies: two from a refusing site, one from another site.
  await saveSourceInfos(db, [
    { key: 'us', label: 'US', market: 'us', currency: 'USD' },
    { key: 'eu', label: 'EU', market: 'eu', currency: 'EUR' },
    { key: 'gb', label: 'GB', market: 'gb', currency: 'GBP' },
  ]);
  const sent: string[] = [];
  const site = (key: string, currencies: string[]): RateSource => ({
    key,
    label: key,
    currencies,
    rates: async (http, pair) => {
      await http.text(`https://${key}.example/${pair.from}`);
      return [{ date: '2026-10-09', rate: 150 }];
    },
  });
  const sources = [site('sitea', ['USD', 'EUR', 'JPY']), site('siteb', ['GBP', 'JPY'])];
  const http = () =>
    new PoliteHttp({
      minDelayMs: 0,
      maxDelayMs: 0,
      fetchImpl: (async (url: string) => {
        sent.push(url);
        return url.includes('sitea')
          ? new Response('', { status: 403 })
          : new Response('ok', { status: 200 });
      }) as unknown as typeof fetch,
    });
  const now = new Date('2026-10-12T03:00:00Z');
  const byPair = (rows: Awaited<ReturnType<typeof updateRates>>) =>
    Object.fromEntries(rows.map((r) => [r.pair, r.waits ?? `saved ${r.saved}`]));

  // One client per site: sitea refuses once, its other pair is left, siteb is still read.
  const made: string[] = [];
  const out = await updateRates(db, sources, http(), now, {
    httpFor: (key) => (made.push(key), http()),
  });
  const waits = byPair(out);
  expect(Object.values(waits).filter((w) => w === 'refused')).toHaveLength(1);
  expect(Object.values(waits).filter((w) => w === 'left')).toHaveLength(1);
  expect(waits.GBPJPY).toBe('saved 1');
  expect(sent.filter((u) => u.includes('sitea'))).toHaveLength(1);
  expect(made.sort()).toEqual(['sitea', 'siteb']);
  expect(await latestFxDate(db, 'GBPJPY')).toBe('2026-10-09');

  // One client shared by both (no httpFor): siteb's pair waits unsent, sitea alone is named.
  sent.length = 0;
  const shared = byPair(await updateRates(db, sources, http(), now));
  expect(Object.values(shared).filter((w) => w === 'refused')).toHaveLength(1);
  expect(shared.GBPJPY).toBe('stopped');
  expect(sent.every((u) => u.includes('sitea'))).toBe(true);
});
