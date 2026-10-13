// The import through Claude via the Claude API (requirements S8 step 5): for reading uploaded
// purchase files right away from the app, when an ANTHROPIC_API_KEY is set. Same questions and
// answers as `claude -p` on the home PC (claude.ts): the files are attached to the message
// instead of read with a tool, and the answer comes back as JSON in the given schema.
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AskClaude } from './ai-import';
import type { ClaudeResult, ModelAlias } from './claude';

const MODELS: Record<ModelAlias, { id: string; inputUsd: number; outputUsd: number }> = {
  // Prices per million tokens.
  haiku: { id: 'claude-haiku-5-5', inputUsd: 0.1, outputUsd: 0.5 },
  sonnet: { id: 'claude-sonnet-5-5', inputUsd: 2, outputUsd: 10 },
};

const IMAGE_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Whether the app can read uploads itself (else the home PC reads them on its next run). */
export const claudeApiAvailable = () => !!process.env.ANTHROPIC_API_KEY?.trim();

/** A file of the folder as message content: an image, a PDF, or its text. */
async function attach(dir: string, name: string): Promise<Anthropic.ContentBlockParam[]> {
  const data = await readFile(join(dir, name));
  const ext = extname(name).toLowerCase();
  const label: Anthropic.TextBlockParam = { type: 'text', text: `File: ${name}` };
  if (IMAGE_TYPES[ext]) {
    return [
      label,
      {
        type: 'image',
        source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: data.toString('base64') },
      },
    ];
  }
  if (ext === '.pdf') {
    return [
      label,
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') },
      },
    ];
  }
  return [{ type: 'text', text: `File: ${name}\n\n${data.toString('utf8')}` }];
}

/** `AskClaude` through the Claude API: the given files are attached in order. */
export const askClaudeApi: AskClaude = async <T>(options: {
  model: ModelAlias;
  system: string;
  prompt: string;
  schema: object;
  readDir?: string;
  files?: string[];
}): Promise<ClaudeResult<T>> => {
  const client = new Anthropic();
  const model = MODELS[options.model];
  const attached = options.readDir
    ? (await Promise.all((options.files ?? []).map((f) => attach(options.readDir!, f)))).flat()
    : [];
  const response = await client.messages.create({
    model: model.id,
    max_tokens: 16000,
    system: options.system,
    messages: [
      {
        role: 'user',
        content: [
          ...attached,
          {
            type: 'text',
            text: `${attached.length ? 'The files are attached above, each after a line with its name (they cannot be opened with tools: read them as attached).\n\n' : ''}${options.prompt}`,
          },
        ],
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: options.schema as Record<string, unknown> },
    },
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read these files');
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Claude gave no answer');
  const usage = response.usage;
  return {
    output: JSON.parse(text.text) as T,
    costUsd:
      (usage.input_tokens * model.inputUsd + usage.output_tokens * model.outputUsd) / 1_000_000,
    tokens: usage.input_tokens + usage.output_tokens,
    modelName: response.model,
  };
};
