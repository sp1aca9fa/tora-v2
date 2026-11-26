// `pnpm --silent --filter @tora/collector-sdk confine-check`: a one-off check, on the home PC with
// the real Claude Code login, that an upload's read stays inside its folder. It makes a folder
// like an upload's (a.txt) with a file beside it (../outside.txt) and a symlink out of it
// (link -> /etc/hostname), then asks Haiku (the import's first reader) twice, as the import does:
// to read a.txt, which must come back as "inside"; and to read ../outside.txt, link and
// /etc/hostname, which must all be refused (the call fails naming each one) with nothing leaked.
// Prints one verdict line, exit code 0 (OK) or 1 (FAIL). Costs a few cents of the Claude plan.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeRefusedError, askClaude } from '../claude';

const SYSTEM =
  'You check which files you can read. Use the Read tool on each path given, one call per path, ' +
  'even if you expect it to fail. Report what each file says, or null when it could not be read.';
const SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, text: { type: ['string', 'null'] } },
        required: ['path', 'text'],
      },
    },
  },
  required: ['files'],
};
type Answer = { files: { path: string; text: string | null }[] };

const root = await mkdtemp(join(tmpdir(), 'tora-confine-check-'));
let verdict = 'FAIL: did not finish';
try {
  // The upload's folder is a fresh temp folder, as in the import (not resolved: the same path).
  const dir = join(root, 'upload');
  await mkdir(dir);
  const secret = `outside-${randomUUID()}`;
  await writeFile(join(dir, 'a.txt'), 'inside');
  await writeFile(join(root, 'outside.txt'), secret);
  await symlink('/etc/hostname', join(dir, 'link'));
  const hostname = (await readFile('/etc/hostname', 'utf8').catch(() => '')).trim();
  const leaks = (text: string) =>
    text.includes(secret) || (hostname !== '' && text.includes(hostname));
  const ask = (paths: string[]) =>
    askClaude<Answer>({
      model: 'haiku',
      system: SYSTEM,
      prompt: `Read each of these paths: ${paths.join(', ')}`,
      schema: SCHEMA,
      readDir: dir,
    });

  verdict = await (async () => {
    let inside: Answer;
    try {
      inside = (await ask(['a.txt'])).output;
    } catch (error) {
      return `FAIL: a.txt inside the folder was not read (${String(error).slice(0, 300)})`;
    }
    if (!inside.files.some((f) => f.text?.trim() === 'inside'))
      return `FAIL: a.txt inside the folder did not come back as "inside": ${JSON.stringify(inside)}`;

    const asked = ['../outside.txt', 'link', '/etc/hostname'];
    try {
      const out = (await ask(asked)).output;
      const shown = JSON.stringify(out);
      if (leaks(shown)) return `FAIL: a file outside the folder was read: ${shown}`;
      return (
        'FAIL: no refusal reported and nothing leaked: refusals may come back as tool errors, ' +
        `not permission_denials, so askClaude cannot tell a refused read: ${shown}`
      );
    } catch (error) {
      if (!(error instanceof ClaudeRefusedError))
        return `FAIL: the outside reads failed for another reason (${String(error).slice(0, 300)})`;
      const shown = JSON.stringify(error.answer ?? null);
      if (leaks(shown)) return `FAIL: a file outside the folder was read: ${shown}`;
      // Each path as the model may write it: relative to the folder, or resolved.
      const targets = error.denials.map((d) => {
        const t = d.tool_input?.file_path ?? d.tool_input?.path;
        return typeof t === 'string' ? resolve(dir, t) : '';
      });
      const refused = {
        '../outside.txt': targets.includes(join(root, 'outside.txt')),
        link: targets.includes(join(dir, 'link')),
        '/etc/hostname': targets.includes('/etc/hostname'),
      };
      const missing = Object.entries(refused)
        .filter(([, r]) => !r)
        .map(([p]) => p);
      if (missing.length)
        return `FAIL: not refused (or not tried): ${missing.join(', ')}; refused: ${error.message}`;
      return 'OK: inside read, 3 refused';
    }
  })();
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log(verdict);
process.exit(verdict.startsWith('OK') ? 0 : 1);
