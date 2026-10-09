import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadCollectors } from './registry';

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
