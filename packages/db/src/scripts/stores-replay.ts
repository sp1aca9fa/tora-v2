// `pnpm --silent --filter @tora/db stores-replay --user <name> --out <file>
//     [--from <day> --to <day> | --busiest <days>] [--words <file.json>]`
// What each store notice choice would have sent over stored posts (S29), for one person's area.
// Read-only: it sends nothing and writes nothing to the database. Without days: the busiest 7.
// --words: a JSON list of glossary entries to try besides the saved ones.
import { createClient } from '@libsql/client';
import type { CodeMeaning } from '@tora/core';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Db } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { loadTimeZone } from '../registry';
import * as schema from '../schema';
import { replayMarkdown, replayNotices, replayTotals } from '../stores-replay';

loadRootEnv();
const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    busiest: { type: 'string' },
    out: { type: 'string' },
    words: { type: 'string' },
  },
});
const usage =
  'usage: stores-replay --user <name> --out <file> [--from <day> --to <day> | --busiest <days>] [--words <file.json>]';
const day = /^\d{4}-\d{2}-\d{2}$/;
if (
  !values.user ||
  !values.out ||
  !!values.from !== !!values.to ||
  (values.from && (!day.test(values.from) || !day.test(values.to!)))
) {
  console.error(usage);
  process.exit(2);
}
const config = dbConfigFromEnv();
// Not the metered client: it saves its row counts to the database on the way out.
const client = createClient(config);
const db = drizzle(client, { schema }) as unknown as Db;
if (config.url.startsWith('file:')) await client.execute('PRAGMA query_only = ON');
await loadTimeZone(db);
const result = await replayNotices(db, {
  username: values.user,
  from: values.from,
  to: values.to,
  busiest: values.busiest ? Number(values.busiest) : undefined,
  words: values.words
    ? (JSON.parse(readFileSync(values.words, 'utf8')) as CodeMeaning[])
    : undefined,
});
writeFileSync(values.out, replayMarkdown(result, `Store notices replay: ${values.user}`));
console.log(JSON.stringify({ from: result.from, to: result.to, ...replayTotals(result) }, null, 2));
client.close();
