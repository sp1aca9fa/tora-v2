// The server's status (S10, 2026-10-24): what a self-hosted Tora's admin, or a helper holding the
// read-only status token, needs to check the server without a terminal. The running version, the
// services and timers (systemd units named `tora-*`, or `TORA_UNITS`), disk space, and the end of
// each log in the state folder. Nothing here changes anything.
import { execFile } from 'node:child_process';
import { open, readdir, statfs } from 'node:fs/promises';
import { arch, loadavg, platform, totalmem, freemem, uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { stateDir } from '@tora/collector-sdk/lock';
import { type Db, lastActivity, loadSourceRegistry } from '@tora/db';

const run = promisify(execFile);

export interface ServerUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface ServerTimer {
  unit: string;
  activates: string;
  next: string | null;
  last: string | null;
}

export interface ServerStatus {
  at: string;
  version: { commit: string | null; date: string | null; subject: string | null; node: string };
  host: {
    platform: string;
    uptimeHours: number;
    appUptimeHours: number;
    load: number[];
    memoryFreeMb: number;
    memoryTotalMb: number;
  };
  disks: { name: string; freeGb: number; totalGb: number }[];
  /** Null where systemd cannot be asked (not Linux, or no systemctl), with why. */
  units: ServerUnit[] | null;
  timers: ServerTimer[] | null;
  unitsError: string | null;
  last: { collect: string | null; backup: string | null };
  logs: { name: string; lines: string[] }[];
}

const MB = 1024 * 1024;
const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

async function git(args: string[]): Promise<string | null> {
  try {
    return (await run('git', args, { timeout: 5000 })).stdout.trim() || null;
  } catch {
    return null;
  }
}

async function systemctl(args: string[]): Promise<unknown[]> {
  const { stdout } = await run('systemctl', [...args, '--all', '--no-pager', '--output=json'], {
    timeout: 5000,
  });
  return JSON.parse(stdout) as unknown[];
}

/** systemd's times are microseconds since the epoch; 0 or none is never. */
const usec = (v: unknown) =>
  typeof v === 'number' && v > 0 ? new Date(v / 1000).toISOString() : null;

/** The last `count` lines of a file, reading only its end. */
async function tail(path: string, count: number): Promise<string[]> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const length = Math.min(size, count * 400);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift();
    if (lines.at(-1) === '') lines.pop();
    return lines.slice(-count);
  } finally {
    await file.close();
  }
}

/**
 * What must never leave the server: values of secret settings (keys, tokens, passwords, the
 * database's address), and lines naming a source whose terms keep its data from AI models.
 */
async function redactor(db: Db): Promise<(line: string) => string> {
  const secrets = Object.entries(process.env)
    .filter(
      ([k, v]) => /SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL|_ENC/i.test(k) && v && v.length >= 8,
    )
    .map(([, v]) => v!);
  const noAi = (await loadSourceRegistry(db)).sources.filter((s) => s.noAi).map((s) => s.key);
  const noAiLine = noAi.length ? new RegExp(`\\b(${noAi.join('|')})\\b`, 'i') : null;
  return (line) => {
    if (noAiLine?.test(line)) return '[left out: a line about a source kept from AI models]';
    let out = line;
    for (const s of secrets) out = out.split(s).join('[hidden]');
    return out;
  };
}

export async function serverStatus(
  db: Db,
  options: { lines?: number; log?: string | null } = {},
): Promise<ServerStatus> {
  const lines = Math.min(Math.max(options.lines ?? 60, 1), 1000);
  const dir = stateDir();
  const clean = await redactor(db);

  const [commit, info, collect, backup] = await Promise.all([
    git(['rev-parse', '--short', 'HEAD']),
    git(['log', '-1', '--format=%cI%n%s']),
    lastActivity(db, 'collect'),
    lastActivity(db, 'backup'),
  ]);
  const [date, subject] = info ? info.split('\n') : [null, null];

  const disks: ServerStatus['disks'] = [];
  const dbUrl = process.env.DATABASE_URL ?? '';
  const places: [string, string][] = [['state', dir]];
  if (dbUrl.startsWith('file:')) places.push(['database', dirname(dbUrl.slice(5))]);
  for (const [name, path] of places) {
    try {
      const s = await statfs(path);
      disks.push({
        name,
        freeGb: round((s.bavail * s.bsize) / 1024 / MB),
        totalGb: round((s.blocks * s.bsize) / 1024 / MB),
      });
    } catch {
      // Not there (a hosted app has no state folder).
    }
  }

  let units: ServerUnit[] | null = null;
  let timers: ServerTimer[] | null = null;
  let unitsError: string | null = null;
  const pattern = process.env.TORA_UNITS || 'tora-*';
  if (platform() !== 'linux') unitsError = `no systemd on ${platform()}`;
  else {
    try {
      units = ((await systemctl(['list-units', pattern])) as Record<string, string>[]).map((u) => ({
        unit: u.unit ?? '',
        load: u.load ?? '',
        active: u.active ?? '',
        sub: u.sub ?? '',
        description: u.description ?? '',
      }));
      timers = ((await systemctl(['list-timers', pattern])) as Record<string, unknown>[]).map(
        (t) => ({
          unit: String(t.unit ?? ''),
          activates: String(t.activates ?? ''),
          next: usec(t.next),
          last: usec(t.last),
        }),
      );
    } catch (error) {
      unitsError = (error as Error).message.split('\n')[0] ?? 'systemctl failed';
    }
  }

  const logs: ServerStatus['logs'] = [];
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.log')).sort();
    for (const name of names) {
      if (options.log && name !== `${options.log}.log` && name !== options.log) continue;
      logs.push({ name, lines: (await tail(join(dir, name), lines)).map(clean) });
    }
  } catch {
    // No state folder.
  }

  return {
    at: new Date().toISOString(),
    version: {
      commit,
      date: date ?? null,
      subject: subject ? clean(subject) : null,
      node: process.version,
    },
    host: {
      platform: `${platform()} ${arch()}`,
      uptimeHours: round(uptime() / 3600),
      appUptimeHours: round(process.uptime() / 3600),
      load: loadavg().map((n) => round(n, 2)),
      memoryFreeMb: Math.round(freemem() / MB),
      memoryTotalMb: Math.round(totalmem() / MB),
    },
    disks,
    units,
    timers,
    unitsError,
    last: { collect: collect?.occurredAt ?? null, backup: backup?.occurredAt ?? null },
    logs,
  };
}
