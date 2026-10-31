import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import {
  CANDIDATE_TOP,
  type RankedEntry,
  latestRanks,
  rankedProductIds,
  rankingsSavedOn,
  rankingBoards,
  saveRanking,
  saveRankingSources,
  setNameOf,
} from './rankings';
import { productSources } from './schema';
import { linkSource } from './sources';
import { createUser } from './users';
import { addWatch } from './watches';
import { eq } from 'drizzle-orm';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-rankings-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const info = {
  key: 'site-boxes',
  source: 'site',
  item: { category: 'tcg' as const, franchise: 'pokemon', region: 'jp' as const },
};
const box = (id: string, title: string, listings = 10): RankedEntry => ({
  externalId: id,
  title,
  kind: 'booster_box',
  url: `https://site.test/${id}`,
  price: 10000,
  numbers: { listings, favorites: 5 },
});
const day = (d: string) => new Date(`${d}T12:00:00+09:00`);

it('reads the set a box title names', () => {
  expect(setNameOf('ポケモンカードゲーム 拡張パック「黒炎の支配者」ボックス')).toBe('黒炎の支配者');
  expect(setNameOf('ソード&シールド 拡張パック フュージョンアーツ ボックス')).toBe(
    'フュージョンアーツ',
  );
  expect(setNameOf('拡張パック 「クレイバースト (クレバ) 」 ボックス')).toBe('クレイバースト');
  expect(setNameOf('何かのボックス')).toBeNull();
});

it('matches ranked items to known ones and makes candidates of the top ones nobody tracks', async () => {
  const product = (name: string) =>
    createProduct(db, uid, {
      category: 'tcg',
      kind: 'booster_box',
      name,
      franchise: 'pokemon',
      region: 'jp',
    });
  const linked = await product('Box A');
  await linkSource(db, linked.id, { source: 'site', externalId: '1' });
  const named = await product('拡張パック「Box B」ボックス');
  const items = [
    box('1', 'Box A on the site'),
    box('2', '拡張パック 「Box B」 ボックス'),
    box('3', 'Box C'),
    ...Array.from({ length: CANDIDATE_TOP }, (_, i) => box(`x${i}`, `Other ${i}`)),
  ];
  const r = await saveRanking(db, info, items, day('2026-10-21'));
  // Linked by its id, the same name; the rest of the top new, the last three not.
  expect(r).toEqual({ saved: items.length, matched: 2, candidates: CANDIDATE_TOP - 2 });
  const [link] = await db.select().from(productSources).where(eq(productSources.externalId, '3'));
  expect(link?.source).toBe('site');
  // A candidate is collected while it is in the top (30 days), the known ones too.
  const ranked = await rankedProductIds(db, day('2026-10-21'));
  expect(ranked).toHaveLength(CANDIDATE_TOP);
  expect(ranked).toContain(named.id);
  expect(await rankedProductIds(db, day('2026-11-25'))).toEqual([]);
  // A second read the same day replaces the day; nothing is made twice.
  const again = await saveRanking(db, info, items.slice(0, 3), day('2026-10-21'));
  expect(again).toMatchObject({ saved: 3, matched: 3, candidates: 0 });

  // A week later: the rank then and a week before.
  await saveRanking(db, info, [items[2]!, items[0]!, items[1]!], day('2026-10-28'));
  const ranks = await latestRanks(db, [linked.id], day('2026-10-28'));
  expect(ranks.get(linked.id)).toEqual([
    expect.objectContaining({ ranking: 'site-boxes', rank: 2, weekAgo: 1, day: '2026-10-28' }),
  ]);

  // The page's board: names, what the person has, candidates.
  await saveRankingSources(db, [{ key: 'site-boxes', label: 'Site boxes', source: 'site' }]);
  await addWatch(db, uid, { productId: named.id }, { packagingState: 'sealed_shrink' });
  const [board] = await rankingBoards(db, uid, day('2026-10-28'));
  expect(board).toMatchObject({ label: 'Site boxes', day: '2026-10-28' });
  expect(board!.items.map((i) => [i.rank, i.title, i.watching, i.candidate, i.weekAgo])).toEqual([
    [1, 'Box C', false, true, 3],
    [2, 'Box A', false, false, 1],
    [3, '拡張パック「Box B」ボックス', true, false, 2],
  ]);
});

it('tells which rankings were already saved today', async () => {
  expect(await rankingsSavedOn(db, [], day('2026-10-02'))).toEqual(new Set());
  await saveRanking(db, info, [box('1', 'A')], day('2026-10-01'));
  // Saved yesterday only: due today.
  expect(await rankingsSavedOn(db, ['site-boxes', 'site-cards'], day('2026-10-02'))).toEqual(
    new Set(),
  );
  await saveRanking(db, info, [box('1', 'A')], day('2026-10-02'));
  expect(await rankingsSavedOn(db, ['site-boxes', 'site-cards'], day('2026-10-02'))).toEqual(
    new Set(['site-boxes']),
  );
  // Another ranking's key is not asked about.
  expect(await rankingsSavedOn(db, ['site-cards'], day('2026-10-02'))).toEqual(new Set());
});
