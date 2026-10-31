import {
  type Db,
  createDb,
  createProduct,
  createUser,
  openingSetsDue,
  saveSuggestedRates,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { BlockedError, PoliteHttp } from './http';
import { readOpeningCards } from './opening';
import type { SetCardSource } from './types';

let db: Db;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-opening-read-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const uid = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  const tiers = [{ rarity: 'SAR', perBox: 0.25 }];
  await saveSuggestedRates(
    db,
    ['S1', 'S2'].map((code) => ({
      franchise: 'pokemon',
      region: 'jp',
      name: `set ${code}`,
      code,
      packsPerBox: 20,
      tiers,
      source: 'test',
    })),
  );
  for (const code of ['S1', 'S2']) {
    const [set] = await db
      .insert(schema.tcgSets)
      .values({
        franchise: 'pokemon',
        region: 'jp',
        code,
        name: `set ${code}`,
        setType: 'expansion',
        source: 't',
        sourceKey: code,
      })
      .returning();
    await createProduct(db, uid, {
      category: 'tcg',
      kind: 'booster_box',
      name: `box ${code}`,
      franchise: 'pokemon',
      region: 'jp',
      setId: set!.id,
    });
  }
  return () => rm(dir, { recursive: true, force: true });
});

it('stops every read of the step when a site refuses, and names the site', async () => {
  const now = new Date('2026-10-19T12:00:00+09:00');
  expect(await openingSetsDue(db, now)).toHaveLength(2);
  const asked: string[] = [];
  const source = (key: string, refuse: boolean): SetCardSource => ({
    source: key,
    cards: async (set) => {
      asked.push(`${key} ${set.code}`);
      if (refuse) throw new BlockedError('HTTP 403');
      return [];
    },
  });
  const read = await readOpeningCards(
    db,
    [source('megastore', false), source('arcade', true)],
    new PoliteHttp(),
    { log: () => {}, now },
  );
  expect(read).toMatchObject({ sets: 0, failed: 1, blocked: 'arcade' });
  // The second set is not read at all; both stay due.
  expect(asked).toHaveLength(2);
  expect(await openingSetsDue(db, now)).toHaveLength(2);
});
