import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The install's state folder (collect log, locks, the schedule's stamps): `TORA_STATE_DIR`, so a
 * second Tora on the same PC keeps its own, else `~/.local/state/tora`. Empty counts as unset, as in
 * `scripts/collect-cron.sh`: both must read the same folder for the locks to mean anything.
 */
export const stateDir = () =>
  process.env.TORA_STATE_DIR ||
  join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'tora');

/** Where the home PC keeps one lock per site (next to the collect log). */
export const defaultLockDir = () => join(stateDir(), 'locks');

/** This boot of the PC (Linux), or null where it cannot be read. */
export function bootId(): string | null {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Never two runs for the same site (S16), whether started by hand or by the schedule: a lock file
 * per source holding the running process's ID and the PC's boot. A lock left by a process that is
 * gone (the PC turned off, the run stopped) is taken over, as is one from an earlier boot: its ID
 * may now belong to another process. Returns `release`, or the process holding it.
 */
export function lockSource(
  source: string,
  dir: string = defaultLockDir(),
  pid: number = process.pid,
  boot: string | null = bootId(),
): { release: () => void } | { heldBy: number } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${source.replace(/[^\w-]/g, '_')}.lock`);
  const mine = boot ? `${pid} ${boot}` : String(pid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, mine, { flag: 'wx' });
      return {
        release: () => {
          try {
            if (readFileSync(file, 'utf8') === mine) rmSync(file);
          } catch {
            // Already gone.
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // "<pid> <boot>"; a lock written before boots were kept holds the ID only (then alive decides).
      const [held, heldBoot] = readFileSync(file, 'utf8').trim().split(/\s+/);
      const holder = Number(held);
      const sameBoot = !heldBoot || !boot || heldBoot === boot;
      if (holder && holder !== pid && sameBoot && alive(holder)) return { heldBy: holder };
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not lock ${source}`);
}

/**
 * Holds one file's `flock` for this process's life: a child takes the lock and waits on a pipe from
 * us, so when we end, however we end, the pipe closes and the lock is let go. Says `ok` first, which
 * is how a lock already held (flock exits silently) is told from one taken.
 */
function holdFlock(file: string): Promise<{ release: () => void } | 'held' | 'no flock'> {
  return new Promise((resolve) => {
    const child = spawn('flock', ['-n', file, 'sh', '-c', 'echo ok; exec cat'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const release = () => child.stdin.end();
    child.on('error', () => resolve('no flock'));
    child.on('close', () => resolve('held'));
    child.stdout.once('data', () => resolve({ release }));
  });
}

/**
 * Holds the lock the schedule's collect holds (`scripts/collect-cron.sh`, in the state folder: its
 * closing steps are covered by no site lock) and every per-market one, the same files
 * `ops/update-server.sh` waits for. A collect started meanwhile skips and the schedule retries.
 */
export async function holdCollectLocks(
  dir: string = stateDir(),
): Promise<{ release: () => void } | { refused: string }> {
  mkdirSync(dir, { recursive: true });
  // The lock file exists once a collect ran; made here so a collect after this waits for it too.
  closeSync(openSync(join(dir, 'collect.lock'), 'a'));
  const files = readdirSync(dir).filter((f) => /^collect(-.*)?\.lock$/.test(f));
  const held: { release: () => void }[] = [];
  const release = () => held.forEach((h) => h.release());
  for (const file of files) {
    const lock = await holdFlock(join(dir, file));
    if (typeof lock === 'object') {
      held.push(lock);
      continue;
    }
    release();
    return {
      refused: lock === 'held' ? `A collect holds ${file}.` : 'The flock command is not available.',
    };
  }
  return { release };
}
