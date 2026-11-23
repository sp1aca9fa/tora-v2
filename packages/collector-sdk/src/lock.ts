import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
 * may now belong to another process. Returns `release`, or the process holding it. `tag` 'job': a
 * daytime job holds it for one request (S36 B4), and a collect waits for it (`lockSourceWaiting`).
 */
export function lockSource(
  source: string,
  dir: string = defaultLockDir(),
  pid: number = process.pid,
  boot: string | null = bootId(),
  tag?: 'job',
): { release: () => void } | { heldBy: number } {
  mkdirSync(dir, { recursive: true });
  const file = lockFile(dir, source);
  // A tag goes third, so code that reads two words still reads the process and the boot.
  const mine = tag ? `${pid} ${boot ?? '-'} ${tag}` : boot ? `${pid} ${boot}` : String(pid);
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
      const holder = heldBy(readFileSync(file, 'utf8'), pid, boot);
      if (holder) return { heldBy: holder.pid };
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not lock ${source}`);
}

const lockFile = (dir: string, source: string) =>
  join(dir, `${source.replace(/[^\w-]/g, '_')}.lock`);

/**
 * The live process holding a lock file's content, other than `pid`, or null. "<pid> <boot> [tag]";
 * a lock written before boots were kept holds the ID only (then alive decides); `-`: no boot.
 */
function heldBy(
  content: string,
  pid: number,
  boot: string | null,
): { pid: number; tag: string | null } | null {
  const [held, rawBoot, tag] = content.trim().split(/\s+/);
  const holder = Number(held);
  const heldBoot = rawBoot === '-' ? undefined : rawBoot;
  const sameBoot = !heldBoot || !boot || heldBoot === boot;
  return holder && holder !== pid && sameBoot && alive(holder)
    ? { pid: holder, tag: tag ?? null }
    : null;
}

/**
 * `lockSource` for a collect: a lock a daytime job holds (tag `job`, one request at most) is waited
 * for, up to `waitMs`; any other holder is answered at once, as before (S36 B4, plan section 8).
 */
export async function lockSourceWaiting(
  source: string,
  options: {
    dir?: string;
    pid?: number;
    boot?: string | null;
    waitMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ release: () => void } | { heldBy: number }> {
  const { dir = defaultLockDir(), pid = process.pid, waitMs = 60_000, pollMs = 500 } = options;
  const boot = options.boot === undefined ? bootId() : options.boot;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let waited = 0; ; waited += pollMs) {
    const lock = lockSource(source, dir, pid, boot);
    if ('release' in lock || waited >= waitMs) return lock;
    let tag: string | null = null;
    try {
      tag = heldBy(readFileSync(lockFile(dir, source), 'utf8'), pid, boot)?.tag ?? null;
    } catch {
      tag = 'job'; // Let go meanwhile: try again at once.
    }
    if (tag !== 'job') return lock;
    await sleep(pollMs);
  }
}

/** The file a daytime job run holds its `flock` on for its whole run (not a `collect*.lock`). */
export const RUN_LOCK = 'market-jobs.lock';

/**
 * Holds the daytime job runner's lock (`$STATE/market-jobs.lock`): one run at a time. `release`
 * resolves once the lock is let go; `pid`: the `flock` helper's, as `/proc/locks` names the holder
 * (`collectBusy` finds its own line by it).
 */
export async function holdRunLock(
  dir: string = stateDir(),
): Promise<{ release: () => Promise<void>; pid: number } | 'held' | 'no flock'> {
  mkdirSync(dir, { recursive: true });
  const lock = await holdFlock(join(dir, RUN_LOCK));
  if (typeof lock !== 'object') return lock;
  return {
    pid: lock.pid,
    release: () => {
      lock.release();
      return lock.closed;
    },
  };
}

/**
 * Whether a collect holds or is about to take the locks, read from `/proc/locks` (never by taking
 * a lock: probing the schedule's `flock -n` would make it skip). A `flock` on `collect.lock` or a
 * `collect-*.lock` in the state folder (the schedule takes it before its wait, so a coming collect
 * shows up to 5 minutes ahead), matched by the device of this run's own lock (`RUN_LOCK`, held by
 * `runLockPid`: its line is found by that pid and the file's inode, as an inode alone may repeat
 * on another file system) and the file's inode; or a site lock in `locks/` held by another live
 * process. Returns what holds it, or null. Throws when the locks cannot be seen (the runner must
 * not run then).
 */
export function collectBusy({
  runLockPid,
  dir = stateDir(),
  pid = process.pid,
  procLocks = '/proc/locks',
}: {
  runLockPid: number;
  dir?: string;
  pid?: number;
  procLocks?: string;
}): string | null {
  let table: string[][];
  try {
    table = readFileSync(procLocks, 'utf8')
      .split('\n')
      .map((l) =>
        l
          .trim()
          .split(/\s+/)
          .filter((w) => w !== '->'),
      );
  } catch {
    throw new Error(`cannot read ${procLocks}`);
  }
  // "1: FLOCK ADVISORY WRITE <pid> <major>:<minor>:<inode> 0 EOF"
  const lines = table.filter((w) => w[1] === 'FLOCK');
  const flocks = lines.map((w) => w[5] ?? '');
  const inode = (file: string) => {
    try {
      return statSync(file).ino;
    } catch {
      return null;
    }
  };
  const own = inode(join(dir, RUN_LOCK));
  const ownLine =
    own === null
      ? undefined
      : lines.find((w) => w[4] === String(runLockPid) && (w[5] ?? '').endsWith(`:${own}`))?.[5];
  if (!ownLine)
    throw new Error(
      'cannot see locks on this file system (its own run lock is not in /proc/locks)',
    );
  const device = ownLine.slice(0, ownLine.lastIndexOf(':'));
  for (const file of readdirSync(dir).filter((f) => /^collect(-.*)?\.lock$/.test(f))) {
    const ino = inode(join(dir, file));
    if (ino !== null && flocks.includes(`${device}:${ino}`)) return `${file} is held`;
  }
  const locks = join(dir, 'locks');
  let files: string[] = [];
  try {
    files = readdirSync(locks).filter((f) => f.endsWith('.lock'));
  } catch {
    // No site lock yet.
  }
  const boot = bootId();
  for (const file of files) {
    let content = '';
    try {
      content = readFileSync(join(locks, file), 'utf8');
    } catch {
      continue;
    }
    const holder = heldBy(content, pid, boot);
    if (holder) return `${file} is held by process ${holder.pid}`;
  }
  return null;
}

/**
 * Holds one file's `flock` for this process's life: a child takes the lock and waits on a pipe from
 * us, so when we end, however we end, the pipe closes and the lock is let go. Says `ok` first, which
 * is how a lock already held (flock exits silently) is told from one taken.
 */
function holdFlock(
  file: string,
): Promise<{ release: () => void; closed: Promise<void>; pid: number } | 'held' | 'no flock'> {
  return new Promise((resolve) => {
    const child = spawn('flock', ['-n', file, 'sh', '-c', 'echo ok; exec cat'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const release = () => child.stdin.end();
    const closed = new Promise<void>((r) => child.on('close', () => r()));
    child.on('error', () => resolve('no flock'));
    child.on('close', () => resolve('held'));
    child.stdout.once('data', () => resolve({ release, closed, pid: child.pid! }));
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
