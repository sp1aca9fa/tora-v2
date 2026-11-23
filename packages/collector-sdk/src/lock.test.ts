import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { lockSource } from './lock';
import { describe } from 'vitest';
import { bootId, collectBusy, holdCollectLocks, holdRunLock, lockSourceWaiting } from './lock';

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

describe('daytime jobs and the collect (S36 B4)', () => {
  it("tags a job's lock, which a collect waits for and any other holder does not get", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tora-lock-'));
    const job = lockSource('marketa', dir, process.pid, 'boot-now', 'job');
    // Read as before by code that knows two words: the process and the boot.
    expect(readFileSync(join(dir, 'marketa.lock'), 'utf8')).toBe(`${process.pid} boot-now job`);
    expect(lockSource('marketa', dir, process.ppid, 'boot-now')).toEqual({ heldBy: process.pid });
    let slept = 0;
    const waited = await lockSourceWaiting('marketa', {
      dir,
      pid: process.ppid,
      boot: 'boot-now',
      sleep: async (ms) => {
        slept += ms;
        if (slept === 1500 && 'release' in job) job.release();
      },
    });
    expect('release' in waited).toBe(true);
    expect(slept).toBe(1500);
    if ('release' in waited) waited.release();
    // A job's lock never let go: the collect gives up after the wait, as it skips today.
    lockSource('marketb', dir, process.pid, 'boot-now', 'job');
    slept = 0;
    const sleep = async (ms: number) => void (slept += ms);
    const opts = { dir, pid: process.ppid, boot: 'boot-now', sleep };
    expect(await lockSourceWaiting('marketb', opts)).toEqual({ heldBy: process.pid });
    expect(slept).toBe(60_000);
    // Another collect's lock: answered at once.
    lockSource('marketc', dir, process.pid, 'boot-now');
    slept = 0;
    expect(await lockSourceWaiting('marketc', opts)).toEqual({ heldBy: process.pid });
    expect(slept).toBe(0);
    // No boot readable: "-" stands for it.
    lockSource('marketd', dir, process.pid, null, 'job');
    expect(readFileSync(join(dir, 'marketd.lock'), 'utf8')).toBe(`${process.pid} - job`);
    expect(lockSource('marketd', dir, process.ppid, 'boot-now')).toEqual({ heldBy: process.pid });
  });

  it('one job run at a time; sees a collect from /proc/locks without taking its lock', async () => {
    const state = mkdtempSync(join(tmpdir(), 'tora-state-'));
    // Without its own run lock held, the runner cannot prove it sees locks: it must not run.
    expect(() => collectBusy({ dir: state, runLockPid: 1 })).toThrow(/cannot see locks/);
    expect(() =>
      collectBusy({ dir: state, runLockPid: 1, procLocks: join(state, 'none') }),
    ).toThrow(/cannot read/);
    const run = await holdRunLock(state);
    if (typeof run !== 'object') throw new Error(`run lock: ${run}`);
    expect(await holdRunLock(state)).toBe('held');
    const busy = () => collectBusy({ dir: state, runLockPid: run.pid });
    expect(busy()).toBeNull();
    // Another pid's line is not its own.
    expect(() => collectBusy({ dir: state, runLockPid: run.pid + 100_000 })).toThrow(
      /cannot see locks/,
    );
    const collect = await holdCollectLocks(state);
    if (!('release' in collect)) throw new Error(collect.refused);
    expect(busy()).toBe('collect.lock is held');
    collect.release();
    for (let i = 0; i < 50 && busy(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(busy()).toBeNull();
    // A site lock: another live process's is busy; this run's own job lock is not.
    const own = lockSource('marketa', join(state, 'locks'), process.pid, bootId(), 'job');
    expect(busy()).toBeNull();
    if ('release' in own) own.release();
    lockSource('marketa', join(state, 'locks'), process.ppid, bootId());
    expect(busy()).toBe(`marketa.lock is held by process ${process.ppid}`);
    await run.release();
    const again = await holdRunLock(state);
    expect(typeof again).toBe('object');
    if (typeof again === 'object') await again.release();
  });

  it("finds its own lock line by the helper's pid and the inode, not the inode alone", () => {
    const state = mkdtempSync(join(tmpdir(), 'tora-state-'));
    closeSync(openSync(join(state, 'market-jobs.lock'), 'a'));
    closeSync(openSync(join(state, 'collect.lock'), 'a'));
    const own = statSync(join(state, 'market-jobs.lock')).ino;
    const collect = statSync(join(state, 'collect.lock')).ino;
    const procLocks = join(state, 'proc-locks');
    // First, another file system's file with the same inode, locked by another pid.
    writeFileSync(
      procLocks,
      [
        `1: FLOCK  ADVISORY  WRITE 4001 00:99:${own} 0 EOF`,
        `2: FLOCK  ADVISORY  WRITE 4002 08:30:${own} 0 EOF`,
        `3: FLOCK  ADVISORY  WRITE 4003 08:30:${collect} 0 EOF`,
        '',
      ].join('\n'),
    );
    expect(collectBusy({ dir: state, runLockPid: 4002, procLocks })).toBe('collect.lock is held');
    // No line with its pid: it cannot tell, so it does not run.
    expect(() => collectBusy({ dir: state, runLockPid: 4009, procLocks })).toThrow(
      /cannot see locks/,
    );
  });
});
