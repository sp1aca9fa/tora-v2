import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { askClaude } from './claude';

// A fake `claude`: writes the arguments and working folder it was started with, then answers
// (or fails, when FAKE_CLAUDE_FAIL is set, as a CLI that rejects a flag does; or lists refused
// reads, when FAKE_CLAUDE_DENY is set, as a confined run that tried a path outside does).
let work: string;
let calls: string;
const oldBin = process.env.TORA_CLAUDE_BIN;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'tora-claude-test-'));
  calls = join(work, 'calls.jsonl');
  const bin = join(work, 'fake-claude.mjs');
  await writeFile(
    bin,
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (process.env.FAKE_CLAUDE_FAIL) {
  process.stderr.write("error: unknown option '--restricted'");
  process.exit(1);
}
const permission_denials = process.env.FAKE_CLAUDE_DENY
  ? [{ tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: process.env.FAKE_CLAUDE_DENY === '1' ? '/etc/hostname' : process.env.FAKE_CLAUDE_DENY } }]
  : [];
process.stdout.write(JSON.stringify({ structured_output: { ok: true }, total_cost_usd: 0.01, usage: {}, permission_denials }));
`,
  );
  await chmod(bin, 0o755);
  process.env.TORA_CLAUDE_BIN = bin;
  delete process.env.FAKE_CLAUDE_FAIL;
  delete process.env.FAKE_CLAUDE_DENY;
});

afterEach(async () => {
  if (oldBin === undefined) delete process.env.TORA_CLAUDE_BIN;
  else process.env.TORA_CLAUDE_BIN = oldBin;
  delete process.env.FAKE_CLAUDE_FAIL;
  delete process.env.FAKE_CLAUDE_DENY;
  await rm(work, { recursive: true, force: true });
});

const ask = (readDir?: string) =>
  askClaude<{ ok: boolean }>({ model: 'haiku', system: 's', prompt: 'p', schema: {}, readDir });

const allCalls = async () =>
  (await readFile(calls, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { args: string[]; cwd: string });
const lastCall = async () => (await allCalls()).at(-1)!;

/** The value after a flag, or undefined. */
const after = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};

/** One permission mode only (the CLI keeps the last one given), and no way to skip them. */
const expectOneModeNoBypass = (args: string[]) => {
  expect(
    args.filter((a) => a === '--permission-mode' || a.startsWith('--permission-mode=')),
  ).toEqual(['--permission-mode']);
  expect(after(args, '--permission-mode')).toBe('dontAsk');
  for (const a of args) expect(a).not.toMatch(/skip-permissions|bypassPermissions/);
};

it('confines a run with readDir to that folder: Read only, every other path refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-test-'));
  try {
    expect((await ask(dir)).output).toEqual({ ok: true });
    const { args, cwd } = await lastCall();
    // The working folders are the upload's folder (cwd) and --add-dir, both the same folder.
    expect(await realpath(cwd)).toBe(await realpath(dir));
    expect(after(args, '--add-dir')).toBe(dir);
    expect(args.filter((a) => a === '--add-dir')).toHaveLength(1);
    expect(after(args, '--tools')).toBe('Read');
    expectOneModeNoBypass(args);
    expect(args).toContain('--restricted');
    const settings = JSON.parse(after(args, '--settings')!) as {
      permissions: Record<string, unknown>;
    };
    expect(settings.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    // No allow rule anywhere: reads are allowed only by being inside the working folders.
    expect(settings.permissions.allow).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('never passes a bare Read allow rule (it would approve reads of any path)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-test-'));
  try {
    await ask(dir);
    const { args } = await lastCall();
    for (const flag of ['--allowedTools', '--allowed-tools', '--allowed_tools'])
      expect(args).not.toContain(flag);
    // "Read" appears once, as the one tool made available.
    expect(args.filter((a) => /^Read(\(|$)/.test(a))).toEqual(['Read']);
    expect(args[args.indexOf('Read') - 1]).toBe('--tools');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('without readDir, no tool at all and nothing may be approved', async () => {
  await ask();
  const { args } = await lastCall();
  expect(after(args, '--tools')).toBe('');
  expectOneModeNoBypass(args);
  expect(args).not.toContain('--add-dir');
  expect(args).not.toContain('--allowedTools');
});

it('fails closed when the CLI rejects a flag: the error surfaces, no retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-test-'));
  try {
    process.env.FAKE_CLAUDE_FAIL = '1';
    await expect(ask(dir)).rejects.toThrow(/claude exited with 1: .*unknown option '--restricted'/);
    // One call only, and it carried the confining flags.
    const made = await allCalls();
    expect(made).toHaveLength(1);
    expect(made[0]!.args).toContain('--restricted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('fails when the run was refused a read, naming the tool and path (never an empty answer)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-test-'));
  try {
    process.env.FAKE_CLAUDE_DENY = '1';
    await expect(ask(dir)).rejects.toThrow(
      'a file asked for a path outside its folder: remove that file and try again. Refused: Read /etc/hostname',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('names the setup, not a file, when a read inside the upload folder was refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-test-'));
  try {
    process.env.FAKE_CLAUDE_DENY = join(dir, '01-a.png');
    await expect(ask(dir)).rejects.toThrow(
      /^Claude Code refused a read inside the upload folder: check its version \(2\.1\.257 or later\) .*confine-check/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
