import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

it('takes over a lock from an earlier boot, even when its process ID is in use again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tora-lock-'));
  // This test's parent process stands in for an unrelated process that got the old run's ID.
  writeFileSync(join(dir, 'snkrdunk.lock'), `${process.ppid} boot-before`);
  expect('release' in lockSource('snkrdunk', dir, process.pid, 'boot-now')).toBe(true);
  // The same boot: the run is still going.
  writeFileSync(join(dir, 'mercari.lock'), `${process.ppid} boot-now`);
  expect(lockSource('mercari', dir, process.pid, 'boot-now')).toEqual({ heldBy: process.ppid });
  // Where the boot cannot be read, the process alone decides.
  expect(lockSource('mercari', dir, process.pid, null)).toEqual({ heldBy: process.ppid });
  // A lock written with the boot is released by its run.
  const held = lockSource('yahoo', dir, process.pid, 'boot-now');
  expect(readFileSync(join(dir, 'yahoo.lock'), 'utf8')).toBe(`${process.pid} boot-now`);
  if ('release' in held) held.release();
  expect(existsSync(join(dir, 'yahoo.lock'))).toBe(false);
});
