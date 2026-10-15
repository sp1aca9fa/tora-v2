import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { lockSource } from './lock';

it('lets one run per site hold its lock, and takes over a lock left by a stopped run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tora-lock-'));
  const first = lockSource('snkrdunk', dir);
  expect('release' in first).toBe(true);
  // Another collect (this test's parent process stands in for it: it is alive).
  expect(lockSource('snkrdunk', dir, process.ppid)).toEqual({ heldBy: process.pid });
  // Other sites are free.
  expect('release' in lockSource('mercari', dir)).toBe(true);
  if ('release' in first) first.release();
  expect('release' in lockSource('snkrdunk', dir, process.ppid)).toBe(true);

  // A lock whose process is gone.
  writeFileSync(join(dir, 'surugaya.lock'), '999999999');
  expect('release' in lockSource('surugaya', dir)).toBe(true);
});
