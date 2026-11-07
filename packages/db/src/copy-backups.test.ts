import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SCRIPT = join(ROOT, 'ops/copy-backups.sh');

// Fake ssh: runs the remote command here, in the folder standing in for the server.
const FAKE_SSH = `#!/usr/bin/env bash
cd "$FAKE_DIR/server" && bash -c "\${@: -1}"
`;
// Fake rsync: records its arguments and copies nothing; each test puts the local files in place.
const FAKE_RSYNC = `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_DIR/rsync-args"
`;

let dir: string;
let backups: string;
let server: string;
let analysis: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tora-copy-'));
  backups = join(dir, 'backups');
  server = join(dir, 'server');
  analysis = join(dir, 'analysis', 'tora.db');
  mkdirSync(join(dir, 'bin'));
  mkdirSync(backups);
  mkdirSync(server);
  for (const [name, body] of [
    ['ssh', FAKE_SSH],
    ['rsync', FAKE_RSYNC],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run() {
  return spawnSync('bash', [SCRIPT, 'server-host', backups], {
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_DIR: dir,
      HOME: dir,
      XDG_STATE_HOME: join(dir, 'state'),
      XDG_DATA_HOME: join(dir, 'data'),
      REMOTE_BACKUP_DIR: '.',
      TORA_ANALYSIS_DB: analysis,
    },
  });
}
const rsyncArgs = () => readFileSync(join(dir, 'rsync-args'), 'utf8').trim().split('\n');
const log = () => readFileSync(join(dir, 'state', 'tora', 'copy-backups.log'), 'utf8');
const empty = (folder: string, ...names: string[]) => {
  for (const name of names) writeFileSync(join(folder, name), '');
};
const copiedBefore = () => writeFileSync(join(backups, 'tora-2026-11-01.db.gz'), gzipSync('old'));

describe('a backup kept by name (`pnpm backup --keep`)', () => {
  it('does not count as one of the server dated backups: 2 dated ones delete nothing here', () => {
    empty(server, 'tora-2026-11-05.db.gz', 'tora-2026-11-06.db.gz', 'pre-recheck.db.gz');
    copiedBefore();
    expect(run().status).toBe(0);
    expect(rsyncArgs()).not.toContain('--delete');
    expect(log()).toContain('the server holds 2 backup(s)');
  });

  it('three dated ones still mirror the folder', () => {
    empty(server, 'tora-2026-11-04.db.gz', 'tora-2026-11-05.db.gz', 'tora-2026-11-06.db.gz');
    copiedBefore();
    expect(run().status).toBe(0);
    expect(rsyncArgs()).toContain('--delete');
  });

  it('is copied here, and the analysis copy still follows the newest dated backup', () => {
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), gzipSync('dated'));
    // Sorts after every dated name, and it is the newest file too.
    writeFileSync(join(backups, 'zz-kept.db.gz'), gzipSync('kept'));
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(backups, 'zz-kept.db.gz'), later, later);
    expect(run().status).toBe(0);
    expect(rsyncArgs()).toContain('--include=*.db.gz');
    expect(readFileSync(analysis, 'utf8')).toBe('dated');
    expect(log()).toContain('newest tora-2026-11-06.db.gz');
  });

  it('alone leaves the analysis copy unmade', () => {
    writeFileSync(join(backups, 'pre-recheck.db.gz'), gzipSync('kept'));
    run();
    expect(existsSync(analysis)).toBe(false);
  });
});
