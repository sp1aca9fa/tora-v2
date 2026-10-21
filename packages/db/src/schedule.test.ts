import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { recordActivity } from './activity';
import { type Db, createDb } from './client';
import { requestCollect } from './collect-request';
import { migrateDb } from './migrate';
import { collectSchedule, recordCheck } from './schedule';
import { collectorRuns } from './schema';
import { createUser } from './users';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-schedule-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(`${iso}+09:00`);

it('works out the next check, the next daily collect and each collector', async () => {
  expect(await collectSchedule(db, at('2026-10-21T15:30:00'))).toMatchObject({
    lastCheck: null,
    nextCheck: null,
    collectors: [],
  });
  for (const h of ['12', '13', '14', '15']) await recordCheck(db, at(`2026-10-21T${h}:05:00`));
  // Last night's collect: two collectors, the second 40 minutes after the first.
  await db.insert(collectorRuns).values([
    {
      source: 'a',
      startedAt: '2026-10-21T00:07:00.000+09:00',
      finishedAt: '2026-10-21T00:47:00.000+09:00',
      status: 'ok' as const,
      activeMs: 40 * 60_000,
    },
    {
      source: 'b',
      startedAt: '2026-10-21T00:47:00.000+09:00',
      finishedAt: '2026-10-21T00:50:00.000+09:00',
      status: 'partial' as const,
    },
  ]);
  await recordActivity(db, {
    kind: 'collect',
    level: 'ok',
    occurredAt: '2026-10-21T00:55:00.000+09:00',
  });
  const s = await collectSchedule(db, at('2026-10-21T15:30:00'));
  expect(s).toMatchObject({
    lastCheck: '2026-10-21T15:05:00.000+09:00',
    intervalMinutes: 60,
    nextCheck: '2026-10-21T16:05:00.000+09:00',
    stale: false,
    doneToday: true,
    // Today's ran: the first check after midnight.
    nextCollect: '2026-10-22T00:05:00.000+09:00',
    requested: false,
  });
  expect(s.collectors.map((c) => [c.source, c.nextStart, c.lastMs, c.status])).toEqual([
    ['a', '2026-10-22T00:05:00.000+09:00', 40 * 60_000, 'ok'],
    ['b', '2026-10-22T00:45:00.000+09:00', 3 * 60_000, 'partial'],
  ]);
  // A "collect now" runs at the next check; a silent server is told.
  await requestCollect(db, uid);
  expect((await collectSchedule(db, at('2026-10-21T15:30:00'))).requested).toBe(true);
  expect((await collectSchedule(db, at('2026-10-21T19:30:00'))).stale).toBe(true);
});
