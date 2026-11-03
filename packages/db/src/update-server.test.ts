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

// The CI gate of ops/update-server.sh, on throwaway local git repos (no network): a bare
// "origin", a clone that pushes, and the server's clone holding a copy of the script. pnpm, sudo,
// sleep, curl (the app's answer) and ops/ci-status.sh are fakes.
const ROOT = join(import.meta.dirname, '../../..');
const SCRIPT = join(ROOT, 'ops', 'update-server.sh');

// Fake pnpm: records each call; every step succeeds unless the file "pnpm-fails" names it.
const FAKE_PNPM = `#!/usr/bin/env bash
echo "$*" >>"$FAKE_DIR/pnpm-calls"
[ -e "$FAKE_DIR/pnpm-fails" ] && [[ "$*" == *"$(cat "$FAKE_DIR/pnpm-fails")"* ]] && exit 1
exit 0
`;

// Fake ci-status: records the sha, prints the file "ci" (the verdict); with "ci-push" it first
// pushes a newer commit, as if one arrived while CI was being read.
const FAKE_CI = `#!/usr/bin/env bash
echo "$1" >>"$FAKE_DIR/ci-calls"
if [ -e "$FAKE_DIR/ci-push" ]; then
  rm -f "$FAKE_DIR/ci-push"
  echo later >>"$FAKE_DIR/work/file.txt"
  git -C "$FAKE_DIR/work" commit -qam later && git -C "$FAKE_DIR/work" push -q origin main
fi
cat "$FAKE_DIR/ci"
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
  dir = mkdtempSync(join(tmpdir(), 'tora-update-'));
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
  copyFileSync(SCRIPT, join(repo, 'ops', 'update-server.sh'));
  copyFileSync(join(ROOT, 'ops', 'env-value.sh'), join(repo, 'ops', 'env-value.sh'));
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(join(ROOT, 'scripts', 'collect-cron.sh'), join(repo, 'scripts', 'collect-cron.sh'));
  writeFileSync(join(repo, 'ops', 'ci-status.sh'), FAKE_CI);
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'ops/\nscripts/\n.env\n');
  for (const [name, body] of [
    ['pnpm', FAKE_PNPM],
    ['sudo', '#!/usr/bin/env bash\necho "$*" >>"$FAKE_DIR/sudo-calls"\n'],
    ['sleep', '#!/usr/bin/env bash\nexit 0\n'],
    ['curl', '#!/usr/bin/env bash\nexit 0\n'],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the script; `under` runs it under `flock <file>` (a collect holding that lock). */
function run(args: string[] = ['--auto'], extra: Record<string, string> = {}, under?: string) {
  const env: Record<string, string | undefined> = {
    ...gitEnv(),
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    FAKE_DIR: dir,
    XDG_STATE_HOME: join(dir, 'xdg'),
    XDG_DATA_HOME: join(dir, 'data'),
    NVM_DIR: join(dir, 'no-nvm'),
    ...extra,
  };
  for (const k of ['TORA_UPDATE_REQUIRE_CI', 'TORA_STATE_DIR', 'CI', 'VERCEL']) {
    if (!(k in extra)) delete env[k];
  }
  const script = [join(repo, 'ops', 'update-server.sh'), ...args];
  const r = under
    ? spawnSync('flock', [under, 'bash', ...script], { encoding: 'utf8', env, timeout: 60000 })
    : spawnSync('bash', script, { encoding: 'utf8', env, timeout: 60000 });
  return { status: r.status, out: r.stdout + r.stderr };
}

const read = (name: string) => {
  const f = join(dir, name);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
const head = () => git(repo, 'rev-parse', 'HEAD');
const log = () => {
  const f = join(state, 'update.log');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
const ci = (verdict: string) => writeFileSync(join(dir, 'ci'), `${verdict}\n`);
const shortOf = (sha: string) => git(repo, 'rev-parse', '--short', sha);
const ciState = () => readFileSync(join(state, 'update-ci'), 'utf8');
const count = (re: RegExp) => read('pnpm-calls').match(re)?.length ?? 0;
const installed = () => read('pnpm-calls').includes('install --frozen-lockfile');

describe('ops/update-server.sh --auto: the CI gate', () => {
  it('success: updates to the checked commit, not a later one that arrived meanwhile', () => {
    const checked = push('second');
    ci('success');
    writeFileSync(join(dir, 'ci-push'), '');
    const r = run();
    expect(r.status).toBe(0);
    expect(read('ci-calls').trim()).toBe(checked);
    expect(head()).toBe(checked);
    expect(git(join(dir, 'work'), 'rev-parse', 'HEAD')).not.toBe(checked);
    expect(installed()).toBe(true);
    expect(read('pnpm-calls')).toContain('build');
    expect(read('sudo-calls')).toContain('systemctl restart tora-app');
    expect(existsSync(join(state, 'update-failed'))).toBe(false);
    expect(log()).toContain('Tora is up');
  });

  it('pending: no change, exit 0, one log line per status change', () => {
    const before = head();
    const waiting = push('second');
    ci('pending');
    for (let i = 0; i < 3; i++) expect(run().status).toBe(0);
    expect(head()).toBe(before);
    expect(installed()).toBe(false);
    expect(read('ci-calls').trim().split('\n')).toEqual([waiting, waiting, waiting]);
    expect(log().match(/waiting: CI is pending/g)).toHaveLength(1);
    expect(existsSync(join(state, 'update-failed'))).toBe(false);

    ci('unknown');
    expect(run().status).toBe(0);
    expect(run().status).toBe(0);
    expect(log().match(/waiting: CI is unknown/g)).toHaveLength(1);
    expect(head()).toBe(before);

    // A newer commit, still pending: logged again.
    push('third');
    ci('pending');
    expect(run().status).toBe(0);
    expect(log().match(/waiting: CI is pending/g)).toHaveLength(2);
    expect(head()).toBe(before);
  });

  it('anything but a verdict counts as unknown', () => {
    const before = head();
    push('second');
    for (const word of ['', 'SUCCESS', 'success now', 'green']) {
      ci(word);
      expect(run().status).toBe(0);
    }
    expect(head()).toBe(before);
    expect(installed()).toBe(false);
  });

  it('failure: no change, the sha recorded, admins told once with step ci', () => {
    const before = head();
    const failed = push('second');
    ci('failure');
    expect(run().status).toBe(0);
    expect(head()).toBe(before);
    expect(installed()).toBe(false);
    expect(read('sudo-calls')).toBe('');
    expect(readFileSync(join(state, 'update-failed'), 'utf8').trim()).toBe(failed);
    const short = git(repo, 'rev-parse', '--short', failed);
    const here = git(repo, 'rev-parse', '--short', before);
    expect(read('pnpm-calls')).toContain(`alerts update --from ${here} --to ${short} --failed ci`);
    expect(log()).toContain(`CI failed on ${short}`);

    // Not tried again (no API call, no second alert) until a newer push.
    expect(run().status).toBe(0);
    expect(read('ci-calls').trim().split('\n')).toEqual([failed]);
    expect(read('pnpm-calls').match(/alerts update/g)).toHaveLength(1);

    const newer = push('third');
    ci('success');
    expect(run().status).toBe(0);
    expect(head()).toBe(newer);
    expect(existsSync(join(state, 'update-failed'))).toBe(false);
  });

  it('failure while a collect runs: recorded and told at once (no code changes, no lock needed)', () => {
    const before = head();
    const failed = push('second');
    ci('failure');
    mkdirSync(state, { recursive: true });
    expect(run(['--auto'], {}, join(state, 'collect.lock')).status).toBe(0);
    expect(head()).toBe(before);
    expect(readFileSync(join(state, 'update-failed'), 'utf8').trim()).toBe(failed);
    expect(ciState()).toMatch(new RegExp(`^${shortOf(before)} ${failed} failure \\d+ 1\n$`));
    expect(read('pnpm-calls')).toContain('alerts update');
    // A later tick sees update-failed: no API call, no second alert.
    expect(run().status).toBe(0);
    expect(read('ci-calls').trim().split('\n')).toEqual([failed]);
    expect(count(/--failed ci/g)).toBe(1);
  });

  it('a CI-failure alert no channel took is tried again at each check until sent', () => {
    const before = head();
    const failed = push('second');
    ci('failure');
    writeFileSync(join(dir, 'pnpm-fails'), '--failed ci');
    for (let i = 0; i < 3; i++) expect(run().status).toBe(0);
    expect(count(/--failed ci/g)).toBe(3);
    // The retries say so (one activity entry).
    expect(count(/--failed ci --retry/g)).toBe(2);
    expect(ciState()).toMatch(/ failure \d+ 2\n$/);
    expect(log().match(/telling admins: CI failed/g)).toHaveLength(1);
    expect(log().match(/could not tell admins/g)).toHaveLength(1);
    rmSync(join(dir, 'pnpm-fails'));
    expect(run().status).toBe(0);
    expect(count(/--failed ci/g)).toBe(4);
    expect(ciState()).toMatch(/ failure \d+ 1\n$/);
    expect(log()).toContain('admins are told: CI failed');
    expect(run().status).toBe(0);
    expect(count(/--failed ci/g)).toBe(4);
    expect(read('ci-calls').trim().split('\n')).toEqual([failed]);
    expect(head()).toBe(before);
  });

  it('success while a collect runs: waits for it', () => {
    const before = head();
    push('second');
    ci('success');
    mkdirSync(state, { recursive: true });
    expect(run(['--auto'], {}, join(state, 'collect.lock')).status).toBe(0);
    expect(head()).toBe(before);
    expect(log()).toContain('waiting: a collect is running (collect.lock)');
    expect(read('pnpm-calls')).toBe('');
  });

  it('uncommitted changes after a green CI: refused, the full sha recorded, --to the short one', () => {
    const before = head();
    const checked = push('second');
    ci('success');
    writeFileSync(join(repo, 'file.txt'), 'edited on the server\n');
    expect(run().status).not.toBe(0);
    expect(head()).toBe(before);
    expect(readFileSync(join(state, 'update-failed'), 'utf8').trim()).toBe(checked);
    expect(read('pnpm-calls')).toContain(
      `alerts update --from ${git(repo, 'rev-parse', '--short', before)} --to ${git(repo, 'rev-parse', '--short', checked)} --failed uncommitted`,
    );
    expect(installed()).toBe(false);
  });

  describe('24 h without an update while CI is not green', () => {
    const seen = (target: string, status: string, ago: number, told = 0) => {
      mkdirSync(state, { recursive: true });
      writeFileSync(
        join(state, 'update-ci'),
        `${shortOf(head())} ${target} ${status} ${Math.floor(Date.now() / 1000) - ago} ${told}\n`,
      );
    };
    const waits = () => count(/--waiting/g);

    it('tells admins once, then keeps waiting', () => {
      const before = head();
      const waiting = push('second');
      ci('pending');
      seen(waiting, 'pending', 86_401);
      expect(run().status).toBe(0);
      const short = shortOf(waiting);
      expect(read('pnpm-calls')).toContain(
        `alerts update --from ${shortOf(before)} --to ${short} --waiting pending`,
      );
      expect(log()).toContain(
        `telling admins: no update for 24 h; ${short} waits for CI (pending)`,
      );
      expect(run().status).toBe(0);
      ci('unknown');
      expect(run().status).toBe(0);
      expect(waits()).toBe(1);
      expect(head()).toBe(before);
      expect(ciState()).toMatch(/ unknown \d+ 1\n$/);
    });

    it("runs from the server's commit: daily pushes do not restart it", () => {
      const before = head();
      const first = push('second');
      ci('unknown');
      seen(first, 'unknown', 80_000);
      expect(run().status).toBe(0);
      const since = ciState().split(' ')[3];
      push('third');
      ci('pending');
      expect(run().status).toBe(0);
      expect(waits()).toBe(0);
      expect(ciState().split(' ')[3]).toBe(since);
      const last = push('fourth');
      seen(last, 'pending', 86_401);
      expect(run().status).toBe(0);
      expect(waits()).toBe(1);
      expect(read('pnpm-calls')).toContain(`--to ${shortOf(last)} --waiting pending`);
      expect(head()).toBe(before);
    });

    it('a reported CI failure starts the clock again for the next commit', () => {
      const failed = push('second');
      seen(failed, 'failure', 90_000, 1);
      push('third');
      ci('pending');
      expect(run().status).toBe(0);
      expect(waits()).toBe(0);
      const since = Number(ciState().split(' ')[3]);
      expect(Math.floor(Date.now() / 1000) - since).toBeLessThan(600);
    });

    it('an update moves the server: the clock starts again', () => {
      const waiting = push('second');
      ci('pending');
      seen(waiting, 'pending', 80_000);
      expect(run([]).status).toBe(0);
      expect(head()).toBe(waiting);
      expect(existsSync(join(state, 'update-ci'))).toBe(false);
      push('third');
      expect(run().status).toBe(0);
      const since = Number(ciState().split(' ')[3]);
      expect(Math.abs(since - Date.now() / 1000)).toBeLessThan(120);
      expect(ciState().startsWith(`${shortOf(waiting)} `)).toBe(true);
    });

    it('nothing waiting any more clears it', () => {
      const waiting = push('second');
      ci('pending');
      seen(waiting, 'pending', 80_000);
      git(repo, 'fetch', '-q', 'origin');
      git(repo, 'merge', '-q', '--ff-only', waiting);
      expect(run().status).toBe(0);
      expect(existsSync(join(state, 'update-ci'))).toBe(false);
    });

    it('not before 24 h', () => {
      const waiting = push('second');
      ci('unknown');
      seen(waiting, 'unknown', 86_000);
      expect(run().status).toBe(0);
      expect(waits()).toBe(0);
    });

    it('an alert no channel took is tried at each check, logged once', () => {
      const waiting = push('second');
      ci('pending');
      seen(waiting, 'pending', 86_401);
      writeFileSync(join(dir, 'pnpm-fails'), '--waiting');
      expect(run().status).toBe(0);
      expect(run().status).toBe(0);
      expect(ciState()).toMatch(/ 2\n$/);
      expect(log().match(/telling admins/g)).toHaveLength(1);
      expect(log().match(/could not tell admins/g)).toHaveLength(1);
      rmSync(join(dir, 'pnpm-fails'));
      expect(run().status).toBe(0);
      expect(run().status).toBe(0);
      expect(waits()).toBe(3);
      expect(count(/--waiting pending --retry/g)).toBe(2);
      expect(ciState()).toMatch(/ 1\n$/);
      expect(log()).toContain('admins are told');
    });
  });

  it('collect-cron.sh and --auto read a quoted, commented TORA_STATE_DIR alike: a collect blocks it', () => {
    const before = head();
    push('second');
    ci('success');
    const other = join(dir, 'other state');
    writeFileSync(join(repo, '.env'), `TORA_STATE_DIR="${other}"  # second copy\r\n`);
    // The collect runs the update while it holds its lock.
    writeFileSync(
      join(dir, 'bin', 'pnpm'),
      `#!/usr/bin/env bash
echo "$*" >>"$FAKE_DIR/pnpm-calls"
[ "$1 $2" = "--silent collect:request" ] && exit 1
if [ "$1 $2" = "--silent collect" ]; then
  bash "$FAKE_DIR/repo/ops/update-server.sh" --auto
  echo "update exit $?" >>"$FAKE_DIR/nested"
fi
exit 0
`,
    );
    const r = spawnSync('bash', [join(repo, 'scripts', 'collect-cron.sh')], {
      encoding: 'utf8',
      env: {
        ...gitEnv(),
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        FAKE_DIR: dir,
        XDG_STATE_HOME: join(dir, 'xdg'),
        NVM_DIR: join(dir, 'no-nvm'),
        MAX_JITTER_SECONDS: '0',
        FORCE: '1',
      },
      timeout: 60000,
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(other, 'collect.lock'))).toBe(true);
    expect(existsSync(join(other, 'collect.log'))).toBe(true);
    expect(read('nested')).toBe('update exit 0\n');
    expect(log()).toContain('waiting: a collect is running (collect.lock)');
    expect(head()).toBe(before);
  });

  it('a failed step after a green CI still goes back and records the checked sha', () => {
    const before = head();
    const checked = push('second');
    ci('success');
    writeFileSync(join(dir, 'ci-push'), '');
    writeFileSync(join(dir, 'pnpm-fails'), 'db:migrate');
    expect(run().status).not.toBe(0);
    expect(head()).toBe(before);
    expect(readFileSync(join(state, 'update-failed'), 'utf8').trim()).toBe(checked);
    expect(read('pnpm-calls')).toContain(
      `--to ${git(repo, 'rev-parse', '--short', checked)} --failed migrate`,
    );
  });

  it('nothing new: no CI call', () => {
    ci('success');
    expect(run().status).toBe(0);
    expect(read('ci-calls')).toBe('');
  });

  it('runs without a .env, in the default state folder', () => {
    const second = push('second');
    ci('success');
    expect(existsSync(join(repo, '.env'))).toBe(false);
    expect(run(['--auto'], { XDG_STATE_HOME: '' }).status).toBe(0);
    expect(head()).toBe(second);
    expect(
      readFileSync(join(dir, 'home', '.local', 'state', 'tora', 'update.log'), 'utf8'),
    ).toContain('Tora is up');
  });

  it('reads .env as the app does: quotes, # comments, CR, export', () => {
    ci('failure');
    const second = push('second');
    writeFileSync(join(repo, '.env'), 'TORA_UPDATE_REQUIRE_CI=0  # no CI on this fork\n');
    expect(run().status).toBe(0);
    expect(head()).toBe(second);

    // The collects' lock folder from .env (quoted, with a comment after it).
    const other = join(dir, 'other state');
    mkdirSync(other);
    push('third');
    writeFileSync(
      join(repo, '.env'),
      `export TORA_STATE_DIR="${other}" # second copy\r\nTORA_UPDATE_REQUIRE_CI='0'\r\n`,
    );
    expect(run(['--auto'], {}, join(other, 'collect.lock')).status).toBe(0);
    expect(log()).toContain('waiting: a collect is running (collect.lock)');
  });

  it('TORA_UPDATE_REQUIRE_CI=0 (environment or .env) turns the gate off', () => {
    ci('failure');
    const second = push('second');
    expect(run(['--auto'], { TORA_UPDATE_REQUIRE_CI: '0' }).status).toBe(0);
    expect(head()).toBe(second);

    const third = push('third');
    writeFileSync(join(repo, '.env'), 'TORA_UPDATE_REQUIRE_CI="0"\r\n');
    expect(run().status).toBe(0);
    expect(head()).toBe(third);
    expect(read('ci-calls')).toBe('');

    // The environment wins over .env; any other value keeps the gate on.
    const fourth = push('fourth');
    expect(run(['--auto'], { TORA_UPDATE_REQUIRE_CI: '1' }).status).toBe(0);
    expect(head()).toBe(third);
    expect(read('ci-calls').trim()).toBe(fourth);
  });
});

describe('ops/update-server.sh by hand', () => {
  it('prints the CI status as a warning and updates anyway', () => {
    const second = push('second');
    ci('pending');
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      `Warning: CI on ${git(repo, 'rev-parse', '--short', second)} is pending (not passed)`,
    );
    expect(head()).toBe(second);
  });

  it('with failure: warns, updates, records nothing', () => {
    const second = push('second');
    ci('failure');
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('is failure (not passed); updating anyway, by hand.');
    expect(head()).toBe(second);
    expect(existsSync(join(state, 'update-failed'))).toBe(false);
  });

  it('nothing new: no CI call, the rest still runs', () => {
    ci('failure');
    expect(run([]).status).toBe(0);
    expect(read('ci-calls')).toBe('');
    expect(installed()).toBe(true);
  });

  it('origin unreachable: exit 1, nothing recorded, nothing run', () => {
    push('second');
    ci('success');
    git(repo, 'remote', 'set-url', 'origin', join(dir, 'gone.git'));
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Could not fetch from GitHub');
    expect(existsSync(join(state, 'update-failed'))).toBe(false);
    expect(read('pnpm-calls')).toBe('');
    expect(read('ci-calls')).toBe('');
  });

  it('says so when CI passed', () => {
    const second = push('second');
    ci('success');
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`CI passed on ${git(repo, 'rev-parse', '--short', second)}.`);
    expect(head()).toBe(second);
  });
});
