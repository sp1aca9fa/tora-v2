import { type Db, createDb, fxRateOn, latestFxDate } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { PoliteHttp } from './http';
import { updateRates } from './rates';
import type { RateSource } from './types';

let db: Db;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-rates-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

it('fills the history once, then only the days since the last stored one', async () => {
  const asked: [string, string][] = [];
  const source: RateSource = {
    pair: 'USDJPY',
    label: 'test',
    rates: async (_http, from, to) => {
      asked.push([from, to]);
      return [
        { date: '2026-10-08', rate: 158.28 },
        { date: '2026-10-09', rate: 158.25 },
      ].filter((r) => r.date >= from);
    },
  };
  const http = new PoliteHttp();
  await updateRates(db, [source], http, new Date('2026-10-12T03:00:00Z'));
  expect(asked[0]).toEqual(['2025-09-07', '2026-10-12']);
  expect(await latestFxDate(db, 'USDJPY')).toBe('2026-10-09');
  // A weekend or holiday uses the last working day's rate.
  expect(await fxRateOn(db, 'USDJPY', '2026-10-11')).toEqual({ date: '2026-10-09', rate: 158.25 });
  expect(await fxRateOn(db, 'USDJPY', '2026-10-01')).toBeNull();

  const [again] = await updateRates(db, [source], http, new Date('2026-10-13T03:00:00Z'));
  expect(asked[1]).toEqual(['2026-10-09', '2026-10-13']);
  expect(again).toMatchObject({ saved: 1, latest: '2026-10-09' });
});
