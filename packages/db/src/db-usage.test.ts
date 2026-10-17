import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { listActivity } from './activity';
import { type Db, createDb } from './client';
import { checkDbBudget, monthUsage, setRowsReadBudget } from './db-usage';
import { migrateDb } from './migrate';
import { UsageMeter, countRows } from './usage';

let db: Db;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-usage-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

it('reads the counts in a reply, not in its values', () => {
  const body = JSON.stringify({
    results: [
      {
        response: {
          result: { rows: [[{ value: '"rows_read":999' }]], rows_read: 12, rows_written: 0 },
        },
      },
      { response: { result: { step_results: [{ rows_read: 3, rows_written: 2 }] } } },
    ],
  });
  expect(countRows(body)).toEqual({ read: 15, written: 2 });
});

it('saves the counts per day and origin, and alerts once a day past the budget', async () => {
  const meter = new UsageMeter('collect');
  meter.client = db.$client;
  meter.add(40_000_000, 1_000, '2026-10-01');
  meter.add(20_000_000, 500, '2026-10-02');
  await meter.save();
  meter.add(5_000_000, 0, '2026-10-02');
  await meter.save();
  const pages = new UsageMeter('pages');
  pages.client = db.$client;
  pages.add(1_000_000, 0, '2026-10-02');
  await pages.save();

  const now = new Date('2026-10-05T12:00:00Z');
  const usage = await monthUsage(db, now);
  expect(usage).toMatchObject({ month: '2026-10', read: 66_000_000, written: 1_500 });
  expect(usage.byOrigin.map((o) => [o.origin, o.read])).toEqual([
    ['collect', 65_000_000],
    ['pages', 1_000_000],
  ]);
  // 66M in 4.5 days: about 455M by the end of October, past the default 150M.
  expect(usage.projectedRead).toBe(Math.round((66_000_000 / 4.5) * 31));
  expect(await checkDbBudget(db, now)).not.toBeNull();
  expect(await checkDbBudget(db, now)).toBeNull();
  const [entry] = await listActivity(db, { id: 'x', admin: true }, { kind: 'check' });
  expect(entry).toMatchObject({ action: 'db_budget', level: 'failed' });

  await setRowsReadBudget(db, 500_000_000);
  expect(await checkDbBudget(db, new Date('2026-10-07T12:00:00Z'))).toBeNull();
});
