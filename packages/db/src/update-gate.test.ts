import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The real ops/update-server.sh --auto with the real ops/ci-status.sh (update-server.test.ts fakes
// the second), on throwaway local git repos, so what GitHub answers is followed all the way to the
// server's state. Fakes: curl (GitHub's answer, and the app's), pnpm, sudo, sleep, and a git that
// answers only `remote get-url origin` and passes the rest to the real one (a local remote would
// give `unknown`).
const ROOT = join(import.meta.dirname, '../../..');

const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const FAKE_GIT = `#!/usr/bin/env bash
[ "$*" = "remote get-url origin" ] && { echo git@github.com:example-org/example-app.git; exit 0; }
exec ${REAL_GIT} "$@"
`;

// Fake curl: the app's answer is always yes. For GitHub it records its arguments, writes the file
// "body" to -o and prints the file "code" (default 200) for -w.
const FAKE_CURL = `#!/usr/bin/env bash
[[ "$*" == *api.github.com* ]] || exit 0
printf '%s\\n' "$@" >"$FAKE_DIR/curl-args"
out=""
while [ $# -gt 0 ]; do
  [ "$1" = "-o" ] && out="$2"
  shift
done
cat "$FAKE_DIR/body" >"$out"
if [ -e "$FAKE_DIR/code" ]; then cat "$FAKE_DIR/code"; else printf 200; fi
`;

const FAKE_PNPM = `#!/usr/bin/env bash
echo "$*" >>"$FAKE_DIR/pnpm-calls"
`;

let dir: string;
let repo: string;
let state: string;

function gitEnv(): Record<string, string | undefined> {
  // Without the caller's GIT_* (a git hook running the tests sets GIT_DIR and others).
  const outer = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  return {
    ...outer,
    GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: join(dir, 'home'),
  };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A new commit on origin's main; returns its sha. */
function push(text: string): string {
  writeFileSync(join(dir, 'work', 'file.txt'), `${text}\n`);
  git(join(dir, 'work'), 'commit', '-qam', text);
  git(join(dir, 'work'), 'push', '-q', 'origin', 'main');
  return git(join(dir, 'work'), 'rev-parse', 'HEAD');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tora-gate-'));
  repo = join(dir, 'repo');
  state = join(dir, 'xdg', 'tora');
  mkdirSync(join(dir, 'home'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(
    join(dir, 'gitconfig'),
    '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n',
  );
  git(dir, 'init', '-q', '--bare', 'origin.git');
  git(dir, 'clone', '-q', 'origin.git', 'work');
  writeFileSync(join(dir, 'work', 'file.txt'), 'first\n');
  git(join(dir, 'work'), 'add', 'file.txt');
  git(join(dir, 'work'), 'commit', '-qm', 'first');
  git(join(dir, 'work'), 'push', '-q', 'origin', 'main');
  git(dir, 'clone', '-q', 'origin.git', 'repo');
  mkdirSync(join(repo, 'ops'));
  for (const name of ['update-server.sh', 'ci-status.sh', 'env-value.sh']) {
    copyFileSync(join(ROOT, 'ops', name), join(repo, 'ops', name));
  }
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'ops/\n');
  for (const [name, body] of [
    ['git', FAKE_GIT],
    ['curl', FAKE_CURL],
    ['pnpm', FAKE_PNPM],
    ['sudo', '#!/usr/bin/env bash\nexit 0\n'],
    ['sleep', '#!/usr/bin/env bash\nexit 0\n'],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runOf = (name: string, conclusion: string | null, status = 'completed') => ({
  id: 1,
  name,
  status,
  conclusion,
});

function answer(runs: readonly object[]) {
  writeFileSync(join(dir, 'body'), JSON.stringify({ total_count: runs.length, check_runs: runs }));
}

/** One tick of the timer. */
function tick() {
  const env: Record<string, string | undefined> = {
    ...gitEnv(),
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    FAKE_DIR: dir,
    XDG_STATE_HOME: join(dir, 'xdg'),
    XDG_DATA_HOME: join(dir, 'data'),
    NVM_DIR: join(dir, 'no-nvm'),
  };
  for (const k of ['TORA_UPDATE_REQUIRE_CI', 'TORA_STATE_DIR', 'CI', 'VERCEL']) delete env[k];
  return spawnSync('bash', [join(repo, 'ops', 'update-server.sh'), '--auto'], {
    encoding: 'utf8',
    env,
    timeout: 60000,
  }).status;
}

const head = () => git(repo, 'rev-parse', 'HEAD');
const shortOf = (sha: string) => git(repo, 'rev-parse', '--short', sha);
const textOf = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const log = () => textOf(join(state, 'update.log'));
const failed = () => textOf(join(state, 'update-failed')).trim();
const pnpmCalls = () => textOf(join(dir, 'pnpm-calls'));

describe('ops/update-server.sh --auto with the real ops/ci-status.sh', () => {
  it('asks GitHub about the new commit, with the remote the fake git gives', () => {
    const target = push('second');
    answer([runOf('check', 'success')]);
    expect(tick()).toBe(0);
    expect(readFileSync(join(dir, 'curl-args'), 'utf8')).toContain(
      `https://api.github.com/repos/example-org/example-app/commits/${target}/check-runs?per_page=100`,
    );
  });

  for (const [title, runs] of [
    ['check green, process red', [runOf('check', 'success'), runOf('process-check', 'failure')]],
    ['check green, no process run', [runOf('check', 'success')]],
    ['check green, another job skipped', [runOf('check', 'success'), runOf('other', 'skipped')]],
  ] as const) {
    it(`${title}: updates, nothing recorded as failed`, () => {
      const before = head();
      const target = push('second');
      answer(runs);
      expect(tick()).toBe(0);
      expect(head()).toBe(target);
      expect(log()).toContain(`Tora is up: ${shortOf(before)} -> ${shortOf(target)} `);
      expect(failed()).toBe('');
    });
  }

  it('check red, process green: stays, the commit recorded, admins told with step ci', () => {
    const before = head();
    const target = push('second');
    answer([runOf('check', 'failure'), runOf('process-check', 'success')]);
    expect(tick()).toBe(0);
    expect(head()).toBe(before);
    expect(log()).toContain(`CI failed on ${shortOf(target)}`);
    expect(log()).not.toContain('Tora is up');
    expect(failed()).toBe(target);
    expect(pnpmCalls()).toContain(
      `alerts update --from ${shortOf(before)} --to ${shortOf(target)} --failed ci`,
    );
  });

  for (const [title, runs] of [
    ['no check yet, process green', [runOf('process-check', 'success')]],
    ['no check yet, process red', [runOf('process-check', 'failure')]],
    ['no check yet, another job green', [runOf('other', 'success')]],
    [
      'check running, process red',
      [runOf('check', null, 'in_progress'), runOf('process-check', 'failure')],
    ],
    ['check skipped', [runOf('check', 'skipped')]],
    ['check neutral', [runOf('check', 'neutral')]],
    [
      'check skipped, process green',
      [runOf('check', 'skipped'), runOf('process-check', 'success')],
    ],
    ['check skipped, process red', [runOf('check', 'skipped'), runOf('process-check', 'failure')]],
  ] as const) {
    it(`${title}: waits, a commit CI did not test is never installed`, () => {
      const before = head();
      const target = push('second');
      answer(runs);
      expect(tick()).toBe(0);
      expect(head()).toBe(before);
      expect(log()).toContain(`new commit ${shortOf(target)}, waiting: CI is pending`);
      expect(failed()).toBe('');
      expect(pnpmCalls()).not.toContain('install');
    });
  }

  it('a skipped check is not stuck: the next commit with a green check updates', () => {
    push('second');
    answer([runOf('check', 'skipped')]);
    expect(tick()).toBe(0);
    const newer = push('third');
    answer([runOf('check', 'success'), runOf('process-check', 'failure')]);
    expect(tick()).toBe(0);
    expect(head()).toBe(newer);
    expect(failed()).toBe('');
  });

  it('GitHub answers an error: waits, CI is unknown', () => {
    const before = head();
    const target = push('second');
    answer([runOf('check', 'success')]);
    writeFileSync(join(dir, 'code'), '403');
    expect(tick()).toBe(0);
    expect(head()).toBe(before);
    expect(log()).toContain(`new commit ${shortOf(target)}, waiting: CI is unknown`);
  });
});
