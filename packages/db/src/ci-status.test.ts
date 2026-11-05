import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SCRIPT = join(ROOT, 'ops/ci-status.sh');
const SHA = 'a'.repeat(40);

// Fake git: answers `remote get-url origin` with the file "remote" (fails when it is missing).
const FAKE_GIT = `#!/usr/bin/env bash
[ "$*" = "remote get-url origin" ] && [ -e "$FAKE_DIR/remote" ] && { cat "$FAKE_DIR/remote"; exit 0; }
exit 1
`;

// Fake curl: records its arguments, writes the file "body" to -o and prints the file "code"
// (default 200) for -w; exits with the file "curl-exit" when it exists, printing nothing.
const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_DIR/curl-args"
[ -e "$FAKE_DIR/curl-exit" ] && exit "$(cat "$FAKE_DIR/curl-exit")"
out=""
while [ $# -gt 0 ]; do
  [ "$1" = "-o" ] && out="$2"
  shift
done
cat "$FAKE_DIR/body" >"$out"
if [ -e "$FAKE_DIR/code" ]; then cat "$FAKE_DIR/code"; else printf 200; fi
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tora-ci-'));
  mkdirSync(join(dir, 'bin'));
  for (const [name, body] of [
    ['git', FAKE_GIT],
    ['curl', FAKE_CURL],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  writeFileSync(join(dir, 'remote'), 'git@github.com:example-org/example-app.git\n');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[] = [SHA]) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_DIR: dir, HOME: dir, TMPDIR: dir },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const curlArgs = () => readFileSync(join(dir, 'curl-args'), 'utf8').trim().split('\n');
const runOf = (status: string, conclusion: string | null = null, name = 'check') => ({
  id: 1,
  name,
  status,
  conclusion,
});
const processRun = (status: string, conclusion: string | null = null) =>
  runOf(status, conclusion, 'process-check');
const otherRun = (status: string, conclusion: string | null = null) =>
  runOf(status, conclusion, 'other-job');
function answer(runs: object[], total = runs.length) {
  writeFileSync(join(dir, 'body'), JSON.stringify({ total_count: total, check_runs: runs }));
}

/** The script's whole output must be the one word (and nothing on stderr). */
function expectWord(word: string, args?: string[]) {
  const r = run(args);
  expect(r).toEqual({ status: 0, out: `${word}\n`, err: '' });
}

describe('ops/ci-status.sh', () => {
  it('success: every run completed as success, neutral or skipped', () => {
    answer([
      runOf('completed', 'success'),
      runOf('completed', 'skipped'),
      runOf('completed', 'neutral'),
    ]);
    expectWord('success');
  });

  it('asks the check runs of that commit, with the JSON Accept header, a 20 s limit and no token', () => {
    answer([runOf('completed', 'success')]);
    run();
    const args = curlArgs();
    expect(args).toContain(
      `https://api.github.com/repos/example-org/example-app/commits/${SHA}/check-runs?per_page=100`,
    );
    expect(args).toContain('Accept: application/vnd.github+json');
    expect(args.join(' ')).toContain('-m 20');
    // A renamed repo answers 301: followed (https only, a few hops); the final answer counts.
    expect(args.join(' ')).toContain('-L --max-redirs 3 --proto-redir =https');
    expect(args.join(' ').toLowerCase()).not.toContain('authorization');
  });

  it('reads the owner and repo from ssh and https remotes', () => {
    answer([runOf('completed', 'success')]);
    for (const remote of [
      'git@github.com:example-org/example-app.git',
      'git@github.com:example-org/example-app',
      'ssh://git@github.com/example-org/example-app.git',
      'ssh://git@github.com:22/example-org/example-app',
      'https://github.com/example-org/example-app.git',
      'https://github.com/example-org/example-app/',
      'https://someone@github.com/example-org/example-app.git',
    ]) {
      writeFileSync(join(dir, 'remote'), `${remote}\n`);
      rmSync(join(dir, 'curl-args'), { force: true });
      expectWord('success');
      expect(curlArgs()).toContain(
        `https://api.github.com/repos/example-org/example-app/commits/${SHA}/check-runs?per_page=100`,
      );
    }
  });

  it('failure: a completed run with any other conclusion, even while others still run', () => {
    for (const conclusion of [
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'stale',
      null,
    ]) {
      answer([runOf('completed', 'success'), runOf('completed', conclusion), runOf('in_progress')]);
      expectWord('failure');
    }
  });

  it('pending: a run not completed yet, or no runs at all', () => {
    for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
      answer([runOf('completed', 'success'), runOf(status)]);
      expectWord('pending');
    }
    answer([]);
    expectWord('pending');
  });

  it('unknown: curl fails (no network, timeout)', () => {
    answer([runOf('completed', 'success')]);
    // 47: too many redirects.
    for (const code of ['6', '28', '47']) {
      writeFileSync(join(dir, 'curl-exit'), code);
      expectWord('unknown');
    }
  });

  it('unknown: an HTTP error or rate limit, without printing the answer', () => {
    for (const code of ['403', '429', '404', '500', '000', '301']) {
      writeFileSync(
        join(dir, 'body'),
        JSON.stringify({
          message: 'API rate limit exceeded for 203.0.113.9',
          total_count: 1,
          check_runs: [runOf('completed', 'success')],
        }),
      );
      writeFileSync(join(dir, 'code'), code);
      expectWord('unknown');
    }
  });

  it('unknown: an answer it cannot read', () => {
    for (const body of [
      'not json',
      '',
      'null',
      '[]',
      '{"total_count":1}',
      '{"check_runs":[]}',
      '{"total_count":"1","check_runs":[]}',
      '{"total_count":1,"check_runs":[null]}',
      '{"total_count":1,"check_runs":[{"conclusion":"success"}]}',
    ]) {
      writeFileSync(join(dir, 'body'), body);
      expectWord('unknown');
    }
  });

  it('unknown: more runs than the page shows, unless a visible one failed', () => {
    answer([runOf('completed', 'success')], 101);
    expectWord('unknown');
    answer([runOf('completed', 'failure')], 101);
    expectWord('failure');
  });

  it('unknown without calling GitHub: a remote that is not github.com, or none', () => {
    answer([runOf('completed', 'success')]);
    for (const remote of [
      'git@gitlab.example:example-org/example-app.git',
      'https://github.com.example/example-org/example-app.git',
      'https://example.com/@github.com/example-org/example-app.git',
      'https://github.com/example-org/example-app/extra',
      'https://github.com/../example-app',
      'https://github.com/example-org/..',
      '/srv/git/example-app.git',
    ]) {
      writeFileSync(join(dir, 'remote'), `${remote}\n`);
      expectWord('unknown');
    }
    rmSync(join(dir, 'remote'));
    expectWord('unknown');
    expect(existsSync(join(dir, 'curl-args'))).toBe(false);
  });

  it('unknown without calling GitHub: not a full lowercase sha', () => {
    answer([runOf('completed', 'success')]);
    for (const sha of [
      '',
      'abc1234',
      'A'.repeat(40),
      `${SHA}0`,
      'g'.repeat(40),
      `$(touch x)${SHA}`,
    ]) {
      expectWord('unknown', [sha]);
    }
    expectWord('unknown', []);
    expect(existsSync(join(dir, 'curl-args'))).toBe(false);
  });

  it('unknown when node gives something other than a verdict', () => {
    answer([runOf('completed', 'success')]);
    writeFileSync(join(dir, 'bin', 'node'), '#!/usr/bin/env bash\necho "success extra"\n');
    chmodSync(join(dir, 'bin', 'node'), 0o755);
    expectWord('unknown');
    writeFileSync(join(dir, 'bin', 'node'), '#!/usr/bin/env bash\nexit 1\n');
    expectWord('unknown');
  });
});

describe('ops/ci-status.sh and the process job', () => {
  const CHECK_GREEN = runOf('completed', 'success');
  const NAMELESS_FAILED = { id: 2, status: 'completed', conclusion: 'failure' };
  const rows: [string, object[], string][] = [
    ['check green, process red', [CHECK_GREEN, processRun('completed', 'failure')], 'success'],
    ['no check yet, process green', [processRun('completed', 'success')], 'pending'],
    ['no check yet, process red', [processRun('completed', 'failure')], 'pending'],
    ['no check yet, another job green', [otherRun('completed', 'success')], 'pending'],
    [
      'no check yet, process red, another job green',
      [processRun('completed', 'failure'), otherRun('completed', 'success')],
      'pending',
    ],
    [
      'check running, process green',
      [runOf('in_progress'), processRun('completed', 'success')],
      'pending',
    ],
    [
      'check running, process red',
      [runOf('in_progress'), processRun('completed', 'failure')],
      'pending',
    ],
    [
      'check red, process green',
      [runOf('completed', 'failure'), processRun('completed', 'success')],
      'failure',
    ],
    ['check green, process running', [CHECK_GREEN, processRun('in_progress')], 'success'],
    [
      'check green, process green, a nameless run failed',
      [CHECK_GREEN, processRun('completed', 'success'), NAMELESS_FAILED],
      'failure',
    ],
    // `check` skipped or neutral: CI did not test the commit, whatever else is green.
    ['check skipped', [runOf('completed', 'skipped')], 'pending'],
    ['check neutral', [runOf('completed', 'neutral')], 'pending'],
    [
      'check skipped, process green',
      [runOf('completed', 'skipped'), processRun('completed', 'success')],
      'pending',
    ],
    [
      'check skipped, process red',
      [runOf('completed', 'skipped'), processRun('completed', 'failure')],
      'pending',
    ],
    [
      'check neutral, process red',
      [runOf('completed', 'neutral'), processRun('completed', 'failure')],
      'pending',
    ],
    [
      'check skipped, another job green',
      [runOf('completed', 'skipped'), otherRun('completed', 'success')],
      'pending',
    ],
    // Other runs keep their rule: skipped and neutral count as passed.
    [
      'check green, another job skipped',
      [CHECK_GREEN, otherRun('completed', 'skipped')],
      'success',
    ],
    [
      'check green, another job neutral',
      [CHECK_GREEN, otherRun('completed', 'neutral')],
      'success',
    ],
    ['check green, process skipped', [CHECK_GREEN, processRun('completed', 'skipped')], 'success'],
    ['check cancelled', [runOf('completed', 'cancelled')], 'failure'],
    // Two runs named check (two workflows): one that really ran is enough, none is not.
    ['one check green, one check skipped', [CHECK_GREEN, runOf('completed', 'skipped')], 'success'],
    [
      'one check skipped, one check neutral',
      [runOf('completed', 'skipped'), runOf('completed', 'neutral')],
      'pending',
    ],
  ];
  for (const [title, runs, word] of rows) {
    it(`${title}: ${word}`, () => {
      answer(runs);
      expectWord(word);
    });
  }

  it('100 of 101 shown, all green: unknown', () => {
    answer(
      Array.from({ length: 100 }, () => CHECK_GREEN),
      101,
    );
    expectWord('unknown');
  });

  it('the page guard uses the unfiltered counts: process runs do not hide the missing run', () => {
    answer([CHECK_GREEN, processRun('completed', 'failure')], 3);
    expectWord('unknown');
  });

  it('only the exact name is dropped: any other name that failed is a failure', () => {
    for (const name of [
      'Process-Check',
      'process-check ',
      ' process-check',
      'process-check-2',
      'process',
      '',
      null,
      7,
      ['process-check'],
    ]) {
      answer([CHECK_GREEN, { id: 2, name, status: 'completed', conclusion: 'failure' }]);
      expectWord('failure');
    }
  });

  it('a run with a non-string name that is still running keeps the verdict pending', () => {
    answer([CHECK_GREEN, { id: 2, name: 7, status: 'in_progress', conclusion: null }]);
    expectWord('pending');
  });

  it('only a run named exactly check stands for CI', () => {
    for (const name of ['Check', 'check ', 'checks', 'check-all', '']) {
      answer([runOf('completed', 'success', name)]);
      expectWord('pending');
    }
    answer([{ id: 1, status: 'completed', conclusion: 'success' }]);
    expectWord('pending');
  });

  it('skipped next to a green run of another name does not stand for CI', () => {
    for (const name of ['Check', 'check ', 'checks']) {
      answer([runOf('completed', 'skipped'), runOf('completed', 'success', name)]);
      expectWord('pending');
    }
  });

  it('more runs than the page shows beat a skipped check: unknown, never pending or success', () => {
    answer([runOf('completed', 'skipped')], 2);
    expectWord('unknown');
  });

  it('a process run it cannot read leaves the verdict unknown', () => {
    answer([CHECK_GREEN, { id: 2, name: 'process-check', conclusion: 'failure' }]);
    expectWord('unknown');
  });

  it('the name of the process job is on exactly one line: the server check before it lands', () => {
    const lines = readFileSync(SCRIPT, 'utf8').split('\n');
    expect(lines.filter((line) => line.includes('process-check'))).toHaveLength(1);
  });

  // Job ids and job-level keys of a workflow, read by indent: no YAML parser here. A form this cannot
  // read gives no jobs, which the test below refuses.
  function readJobs(yaml: string) {
    const lines = yaml.split('\n');
    const jobs = new Map<string, { key: string; value: string }[]>();
    const start = lines.indexOf('jobs:');
    if (start === -1) return jobs;
    let id: string | null = null;
    for (const line of lines.slice(start + 1)) {
      if (/^[^\s#]/.test(line)) break;
      const job = /^ {2}['"]?([^\s'":#]+)['"]?\s*:/.exec(line);
      if (job) {
        id = String(job[1]);
        jobs.set(id, []);
        continue;
      }
      const key = /^ {4}([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (key && id !== null) {
        jobs.get(id)?.push({ key: String(key[1]), value: String(key[2]).trim() });
      }
    }
    return jobs;
  }
  const WORKFLOWS = join(ROOT, '.github/workflows');
  const workflowFiles = () => readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));

  it('the CI workflow has a job check, and nothing named like the process job', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/^jobs:\n {2}check:$/m);
    expect(ci).not.toMatch(/^ {2}process-check:/m);
    expect(ci).not.toMatch(/^\s+name:\s*process-check\s*$/m);
    // A job-level `if:` could conclude skipped, which the gate reads as CI not testing the commit.
    expect(ci).not.toMatch(/^ {4}if:/m);
  });

  it('nothing renames the check run: no job-level name or strategy in that job', () => {
    const jobs = readJobs(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8'));
    const keys = (jobs.get('check') ?? []).map(({ key }) => key);
    // Either would rename the run, so every commit would wait. A step's `name:` is deeper, and fine.
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('strategy');
    expect(keys).toContain('steps');
  });

  it('only ci.yml has a job check, and no other job takes either name', () => {
    const files = workflowFiles();
    expect(files).toContain('ci.yml');
    for (const file of files) {
      const jobs = readJobs(readFileSync(join(WORKFLOWS, file), 'utf8'));
      expect(jobs.size, `${file}: no jobs read`).toBeGreaterThan(0);
      // Any other job the gate would read as CI: a new workflow must not stand for a tested commit.
      expect(jobs.has('check'), `${file}: job id check`).toBe(file === 'ci.yml');
      if (file !== 'process.yml')
        expect(jobs.has('process-check'), `${file}: process job`).toBe(false);
      for (const [id, keys] of jobs) {
        for (const { key, value } of keys) {
          const named = key === 'name' ? value.replace(/^['"]|['"]$/g, '') : null;
          expect(['check', 'process-check'], `${file}: job ${id} is named`).not.toContain(named);
        }
      }
    }
  });
});
