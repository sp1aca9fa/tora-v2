import { type CatalogSetEntry, resolveTaxonomy } from '@tora/core';
import { createDb, saveTaxonomy, schema } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { syncCatalogs } from './catalog';

const set = (region: string | null, name: string): CatalogSetEntry => ({
  franchise: 'pokemon',
  region,
  code: null,
  name,
  nameAlias: null,
  setType: 'expansion',
  releaseDate: '2026-01-01',
  source: 'test',
  sourceKey: `${region}:${name}`,
});
const catalog = {
  key: 'test',
  label: 'Test',
  sets: async () => [set('jp', 'A'), set('en', 'B'), set(null, 'C')],
};

it('loads only the sets the categories use, and again only when they change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-catalog-'));
  const db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const names = async () => (await db.select().from(schema.tcgSets)).map((s) => s.name).sort();
  // Built-in TCG lists every print language: all of it.
  expect(await syncCatalogs(db, [catalog])).toMatchObject({ sets: 3 });
  expect(await syncCatalogs(db, [catalog])).toBeNull();
  // An admin keeping English prints only: the Japanese set goes.
  const base = resolveTaxonomy(null);
  await saveTaxonomy(
    db,
    {
      ...base,
      categories: base.categories.map((c) => (c.setCatalog ? { ...c, regions: ['en'] } : c)),
    },
    true,
  );
  expect(await syncCatalogs(db, [catalog])).toMatchObject({ sets: 2 });
  expect(await names()).toEqual(['B', 'C']);
  // No set category at all (a watches setup): nothing loaded.
  await saveTaxonomy(
    db,
    {
      ...base,
      categories: base.categories.map((c) => ({ ...c, hidden: c.setCatalog ? true : c.hidden })),
    },
    true,
  );
  await syncCatalogs(db, [catalog]);
  expect(await names()).toEqual([]);
  // Plug-ins giving nothing never empty the table.
  expect(await syncCatalogs(db, [{ ...catalog, sets: async () => [] }])).toBeNull();
  await rm(dir, { recursive: true, force: true });
});
