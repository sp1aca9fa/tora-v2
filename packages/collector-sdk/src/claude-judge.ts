// The model behind the data review: Claude Code run non-interactively (`claude -p`) on the
// home PC, with the user's own Claude login. No tools, no MCP servers, no saved session: it only
// reads the cases it is given and answers in the review's JSON shape.
import { spawn } from 'node:child_process';
import {
  ANSWER_SCHEMA,
  INSTRUCTIONS,
  type Judge,
  type ReviewAnswer,
  SYSTEM_PROMPT,
} from './review';

const TIMEOUT_MS = 5 * 60_000;

function run(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.TORA_CLAUDE_BIN ?? 'claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
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

export const claudeJudge: Judge = async (model, input) => {
  const out = await run(
    [
      '-p',
      '--model',
      model,
      '--output-format',
      'json',
      '--tools',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt',
      SYSTEM_PROMPT,
      '--json-schema',
      JSON.stringify(ANSWER_SCHEMA),
    ],
    INSTRUCTIONS + JSON.stringify(input),
  );
  const result = JSON.parse(out) as {
    is_error?: boolean;
    result?: string;
    structured_output?: ReviewAnswer;
    total_cost_usd?: number;
    usage?: Record<string, unknown>;
    modelUsage?: Record<string, unknown>;
  };
  if (result.is_error || !result.structured_output) {
    throw new Error(`claude gave no answer: ${String(result.result ?? '').slice(0, 300)}`);
  }
  const u = (result.usage ?? {}) as Record<string, number | undefined>;
  return {
    answer: result.structured_output,
    costUsd: result.total_cost_usd ?? 0,
    tokens:
      (u.input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.output_tokens ?? 0),
    modelName: Object.keys(result.modelUsage ?? {})[0] ?? model,
  };
};
