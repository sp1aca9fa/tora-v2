// Claude Code run non-interactively (`claude -p`) on the home PC, with the user's own Claude
// login: the model behind the data review (S4d) and the import through Claude (S4c). No MCP
// servers and no saved session; the only tool ever allowed is Read, confined to the folder given.
import { spawn } from 'node:child_process';
import {
  ANSWER_SCHEMA,
  INSTRUCTIONS,
  type Judge,
  type ReviewAnswer,
  SYSTEM_PROMPT,
} from './review';

const TIMEOUT_MS = 10 * 60_000;

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
  if (options.readDir) {
    args.push('--tools', 'Read', '--allowedTools', 'Read', '--add-dir', options.readDir);
  } else {
    args.push('--tools', '');
  }
  const out = await run(args, options.prompt, options.readDir);
  const result = JSON.parse(out) as {
    is_error?: boolean;
    result?: string;
    structured_output?: T;
    total_cost_usd?: number;
    usage?: Record<string, number | undefined>;
    modelUsage?: Record<string, unknown>;
  };
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
