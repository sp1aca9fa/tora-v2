import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { categoryUrls, loadCollectors } from './registry';
import type { Collector } from './types';

it('skips missing collector packages and loads present ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tora-collectors-'));
  try {
    await mkdir(join(root, 'collectors-public', 'src'), { recursive: true });
    await writeFile(
      join(root, 'collectors-public', 'src', 'index.ts'),
      "export const collectors = [{ source: 'fx', label: 'FX' }];",
    );
    const { collectors, missing } = await loadCollectors(root);
    expect(collectors.map((c) => c.source)).toEqual(['fx']);
    expect(missing).toEqual(['collectors']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('saves a search template per source that declares a category address', () => {
  const base = {
    label: 'x',
    supports: () => true,
    findCandidates: async () => [],
    collect: async () => ({ state: null, complete: true }),
  };
  const list: Collector[] = [
    {
      ...base,
      source: 'market',
      defaultQuery: () => null,
      categoryUrl: (c) => `https://market.example/search?c=${encodeURIComponent(c)}`,
    },
    { ...base, source: 'plain', defaultQuery: () => null },
    { ...base, source: 'listing', categoryUrl: (c) => `https://listing.example/${c}` },
    {
      ...base,
      source: 'broken',
      defaultQuery: () => null,
      categoryUrl: () => {
        throw new Error('no');
      },
    },
  ];
  expect(categoryUrls(list)).toEqual({
    market: 'https://market.example/search?c=TORA_CATEGORY_ID',
  });
});
