import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The install's state folder (collect log, locks, the schedule's stamps): `TORA_STATE_DIR`, so a
 * second Tora on the same PC keeps its own, else `~/.local/state/tora`.
 */
export const stateDir = () =>
  process.env.TORA_STATE_DIR ||
  join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'tora');

/** Where the home PC keeps one lock per site (next to the collect log). */
export const defaultLockDir = () => join(stateDir(), 'locks');

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
 * per source holding the running process's ID. A lock left by a process that is gone (the PC
 * turned off, the run stopped) is taken over. Returns `release`, or the process holding it.
 */
export function lockSource(
  source: string,
  dir: string = defaultLockDir(),
  pid: number = process.pid,
): { release: () => void } | { heldBy: number } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${source.replace(/[^\w-]/g, '_')}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(pid), { flag: 'wx' });
      return {
        release: () => {
          try {
            if (readFileSync(file, 'utf8') === String(pid)) rmSync(file);
          } catch {
            // Already gone.
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const holder = Number(readFileSync(file, 'utf8'));
      if (holder && holder !== pid && alive(holder)) return { heldBy: holder };
      rmSync(file, { force: true });
    }
  }
  throw new Error(`could not lock ${source}`);
}
