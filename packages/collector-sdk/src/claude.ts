// Claude Code run non-interactively (`claude -p`) on the home PC, with the user's own Claude
// login: the model behind the data review (S4d) and the import through Claude (S4c). No MCP
// servers and no saved session; the only tool ever allowed is Read, confined to the folder given.
import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  ANSWER_SCHEMA,
  INSTRUCTIONS,
  type Judge,
  type ReviewAnswer,
  SYSTEM_PROMPT,
} from './review';

const TIMEOUT_MS = 10 * 60_000;

const CONFINE_ARGS = ['--permission-mode', 'dontAsk', '--restricted'];
const CONFINE_SETTINGS = { permissions: { blockReadsOutsideWorkingDirectories: true } };

function run(args: string[], input: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.TORA_CLAUDE_BIN ?? 'claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`could not start claude (${e.message}); is Claude Code installed?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited with ${code}: ${(err || out).slice(0, 500)}`));
    });
    child.stdin.end(input);
  });
}

/** One refused tool call, as listed in `claude -p --output-format json`'s result. */
export interface PermissionDenial {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** "Read /etc/hostname, Read ../outside.txt" (the tool and its path, when it has one). */
export function describeDenials(denials: PermissionDenial[]): string {
  return denials
    .map((d) => {
      const input = d.tool_input ?? {};
      const target = input.file_path ?? input.path ?? input.pattern;
      return [d.tool_name ?? 'a tool', typeof target === 'string' ? target : '']
        .filter(Boolean)
        .join(' ');
    })
    .join(', ')
    .slice(0, 500);
}

/**
 * A run that was refused one or more tool calls; `denials` lists them, `answer` holds what the
 * model returned all the same (its structured output, else its text), never used as a result.
 */
export class ClaudeRefusedError extends Error {
  readonly denials: PermissionDenial[];
  readonly answer: unknown;
  constructor(denials: PermissionDenial[], answer?: unknown, readDir?: string) {
    // A refusal inside the folder is the setup's fault, not a file's: say which, guidance first
    // (the stored message is cut at 500 characters).
    const inside =
      readDir !== undefined &&
      denials.some((d) => {
        const t = d.tool_input?.file_path ?? d.tool_input?.path;
        if (typeof t !== 'string') return false;
        const rel = relative(readDir, resolve(readDir, t));
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
      });
    super(
      (inside
        ? 'Claude Code refused a read inside the upload folder: check its version (2.1.248 or ' +
          'later) and run `pnpm --filter @tora/collector-sdk confine-check`'
        : 'a file asked for a path outside its folder: remove that file and try again') +
        `. Refused: ${describeDenials(denials).slice(0, 300)}`,
    );
    this.denials = denials;
    this.answer = answer;
  }
}

export type ModelAlias = 'haiku' | 'sonnet';

export interface ClaudeResult<T> {
  output: T;
  costUsd: number;
  tokens: number;
  /** The model that answered, e.g. claude-haiku-5-5. */
  modelName: string;
}

/** One question to Claude, answered as JSON in the given schema. */
export async function askClaude<T>(options: {
  model: ModelAlias;
  system: string;
  prompt: string;
  schema: object;
  /** Let the model read files in this folder (images, PDFs, text): Read only, nothing else. */
  readDir?: string;
}): Promise<ClaudeResult<T>> {
  const args = [
    '-p',
    '--model',
    options.model,
    '--output-format',
    'json',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt',
    options.system,
    '--json-schema',
    JSON.stringify(options.schema),
  ];
  // An upload is untrusted: nothing it says may widen what the run can read. Reads inside the
  // working folder (cwd = readDir) and `--add-dir` need no approval in `-p` mode; anything that
  // would need one is denied (`dontAsk`). `--restricted` (Claude Code 2.1.248+) confines the file
  // tools to the working folders, and `blockReadsOutsideWorkingDirectories` refuses other paths
  // in every mode. Never `--allowedTools Read`: a bare Read allow approves reads of any path.
  // A CLI that rejects a flag exits nonzero and the call fails; it is never retried without them.
  if (options.readDir) {
    args.push(
      '--tools',
      'Read',
      ...CONFINE_ARGS,
      '--settings',
      JSON.stringify(CONFINE_SETTINGS),
      '--add-dir',
      options.readDir,
    );
  } else {
    args.push('--tools', '', '--permission-mode', 'dontAsk');
  }
  const out = await run(args, options.prompt, options.readDir);
  const result = JSON.parse(out) as {
    is_error?: boolean;
    result?: string;
    structured_output?: T;
    total_cost_usd?: number;
    usage?: Record<string, number | undefined>;
    modelUsage?: Record<string, unknown>;
    permission_denials?: PermissionDenial[];
  };
  // A refused tool call is never an empty answer: a read refused inside the folder (a path that
  // resolves elsewhere, a CLI that starts asking) would otherwise come back as "nothing found"
  // and the upload's files would be dropped as read. The call fails instead; the caller keeps
  // the data and the batch can be tried again.
  const denials = result.permission_denials ?? [];
  if (denials.length)
    throw new ClaudeRefusedError(
      denials,
      result.structured_output ?? result.result,
      options.readDir,
    );
  if (result.is_error || !result.structured_output) {
    throw new Error(`claude gave no answer: ${String(result.result ?? '').slice(0, 300)}`);
  }
  const u = result.usage ?? {};
  return {
    output: result.structured_output,
    costUsd: result.total_cost_usd ?? 0,
    tokens:
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.output_tokens ?? 0),
    // Several models may answer one call (Claude Code's own helpers): the biggest user wins.
    modelName:
      Object.entries((result.modelUsage ?? {}) as Record<string, { costUSD?: number }>).sort(
        (a, b) => (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0),
      )[0]?.[0] ?? options.model,
  };
}

export const claudeJudge: Judge = async (model, input) => {
  const r = await askClaude<ReviewAnswer>({
    model,
    system: SYSTEM_PROMPT,
    prompt: INSTRUCTIONS + JSON.stringify(input),
    schema: ANSWER_SCHEMA,
  });
  return { answer: r.output, costUsd: r.costUsd, tokens: r.tokens, modelName: r.modelName };
};
