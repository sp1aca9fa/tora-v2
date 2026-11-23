import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The real scripts/market-jobs-cron.sh with a fake pnpm: what it runs, from where, and its exit.
const ROOT = join(import.meta.dirname, '../../..');

const FAKE_PNPM = `#!/usr/bin/env bash
echo "$PWD $*" >>"$FAKE_DIR/pnpm-calls"
[[ "$*" == *market-jobs* ]] && exit "$FAKE_CODE"
exit 0
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tora-jobs-cron-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'nvm'));
  writeFileSync(join(dir, 'bin', 'pnpm'), FAKE_PNPM);
  chmodSync(join(dir, 'bin', 'pnpm'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cron = (code: number) =>
  spawnSync('bash', [join(ROOT, 'scripts/market-jobs-cron.sh')], {
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      NVM_DIR: join(dir, 'nvm'),
      TORA_STATE_DIR: join(dir, 'state'),
      FAKE_DIR: dir,
      FAKE_CODE: String(code),
    },
    encoding: 'utf8',
  });
const calls = () => readFileSync(join(dir, 'pnpm-calls'), 'utf8').trim().split('\n');

describe('scripts/market-jobs-cron.sh', () => {
  it("runs the package's own script, so a refusal's exit 4 reaches it: not a failed unit", () => {
    expect(cron(4).status).toBe(0);
    expect(calls()).toEqual([
      `${join(ROOT, 'packages/collector-sdk')} --silent market-jobs`,
      `${ROOT} --silent alerts market-refusals`,
    ]);
  });

  it('a run that failed fails the unit, after the alert pass', () => {
    expect(cron(1).status).toBe(1);
    expect(calls()).toHaveLength(2);
    expect(cron(0).status).toBe(0);
  });
});
