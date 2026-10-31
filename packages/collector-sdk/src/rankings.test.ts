import type { Db } from '@tora/db';
import { expect, it } from 'vitest';
import { BlockedError, PoliteHttp } from './http';
import { readRankings } from './rankings';
import type { RankingSource } from './types';

it('stops reading rankings when a site refuses, and names the site', async () => {
  const asked: string[] = [];
  const ranking = (key: string, source: string): RankingSource =>
    ({
      key,
      label: key,
      source,
      rank: async () => {
        asked.push(key);
        throw new BlockedError('HTTP 429');
      },
    }) as unknown as RankingSource;
  const read = await readRankings(
    {} as Db,
    [ranking('megastore-boxes', 'megastore'), ranking('megastore-cards', 'megastore')],
    new PoliteHttp(),
    { log: () => {} },
  );
  expect(read).toEqual({ read: 0, candidates: 0, failed: 1, blocked: 'megastore' });
  expect(asked).toEqual(['megastore-boxes']);
});
