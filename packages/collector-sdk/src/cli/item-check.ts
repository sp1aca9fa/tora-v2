// `pnpm --silent item-check`: the labeled checks of game items (requirements S36 A1, A2; see
// `../item-check.ts` for the rules). Paths from the repo's root.
//
//   item-check sample sales|listings <product id>... --out <file.json>
//   item-check sample sales|listings --wished --out <file.json>
//       Reads only (no network, no write to the database): writes the sample to label. Each entry's
//       `item` is null; a labeler sets it to true (the item) or false (not the item). An existing
//       file is never overwritten (it may hold labels).
//   item-check record <file.json> [--apply]
//       Dry run unless --apply: per item, the outcome and what would be excluded or marked. With
//       --apply: one check row per item, kind and source; when judged (passed or failed), every "not
//       the item" excluded (sales, by the manual exclusion) or marked (listings); when not judged,
//       the row only. The same file twice writes nothing new. An item
//       is refused when the file is not the sample the database gives as of its time, its rules
//       changed or are not applied yet, or the sample was recorded with other labels. --apply holds
//       the locks `recheck-sales --apply` takes, and waits for none: a held one stops it.
//
// Sales: the plug-ins are loaded to know which sources the game rules judge (`judgedSources`).
import { createDb, loadTimeZone } from '@tora/db';
import { dbConfigFromEnv, findRepoRoot, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { judgedSources } from '../game-rules';
import {
  applyRecord,
  buildSample,
  describePlan,
  parseCheckFile,
  planRecord,
  planSources,
  sampleItems,
} from '../item-check';
import { holdRecheckLocks, refusedDatabase } from '../recheck';
import { loadCollectors } from '../registry';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    wished: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

let release = () => {};
function finish(): never {
  release();
  process.exit(0);
}
function stop(message: string): never {
  console.error(message);
  release();
  process.exit(1);
}
const fromRoot = (path: string) => resolve(findRepoRoot(), path);
const usage =
  'Usage: item-check sample sales|listings <ids...|--wished> --out <file.json>\n' +
  '       item-check record <file.json> [--apply]';

const [command, ...rest] = positionals;
if (command !== 'sample' && command !== 'record') stop(usage);

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
if (command === 'record' && values.apply) {
  const refused = refusedDatabase(config.url);
  if (refused) stop(refused);
}
const db = createDb(config);
await exitIfUnmigrated(db);
await loadTimeZone(db);

/** The sources the game rules judge: read for sales only (a listings check needs no plug-in). */
const judgedOf = async (kind: string) =>
  kind === 'sales'
    ? new Set((await judgedSources(db, (await loadCollectors()).collectors)).keys())
    : new Set<string>();

if (command === 'sample') {
  const [kind, ...ids] = rest;
  if (kind !== 'sales' && kind !== 'listings') stop(usage);
  if (!values.out) stop(`--out <file.json> is needed.\n${usage}`);
  if (values.wished === ids.length > 0) stop(`Give product ids or --wished, not both.\n${usage}`);
  const out = fromRoot(values.out);
  if (existsSync(out)) stop(`${values.out} exists: it may hold labels. Choose another file.`);
  const { games, refused, unknown } = await sampleItems(db, {
    ids: values.wished ? 'wished' : ids,
  });
  if (unknown.length) stop(`No such item: ${unknown.join(', ')}. Nothing written.`);
  if (refused.length) {
    const names = refused.join(', ');
    // Explicit ids name what to check: one that is not a game is a mistake, so nothing is written.
    if (!values.wished) stop(`Not a game, never sampled: ${names}. Nothing written.`);
    console.log(`Not a game, never sampled: ${names}.`);
  }
  if (!games.length) stop('No game item to sample. Nothing written.');
  const file = await buildSample(db, kind, games, { judged: await judgedOf(kind) });
  for (const s of file.skipped ?? []) console.log(`${s.name}: not sampled, ${s.why}.`);
  if (!file.items.length) stop('No game item to sample. Nothing written.');
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, { flag: 'wx' });
  for (const item of file.items) {
    for (const b of item.checks) {
      const where = b.kind === 'sales' ? 'sales' : `listings at ${b.source}`;
      console.log(
        b.tooFewNights
          ? `${item.name}: ${where}: too few nights (${b.nights ?? 0})`
          : `${item.name}: ${where}: ${b.entries.length} to label`,
      );
    }
  }
  console.log(`Sample ${file.sample} written to ${values.out}.`);
  finish();
}

const [path] = rest;
if (!path || rest.length > 1) stop(usage);
let read: unknown;
try {
  read = JSON.parse(readFileSync(fromRoot(path), 'utf8'));
} catch (error) {
  const why = (error as NodeJS.ErrnoException).code ?? 'not JSON';
  stop(`Label file could not be read (${why}). Nothing written.`);
}
const parsed = parseCheckFile(read);
if ('invalid' in parsed) stop(`Label file refused: ${parsed.invalid}. Nothing written.`);
const options = { judged: await judgedOf(parsed.file.check) };
let plans = await planRecord(db, parsed.file, options);
if (values.apply) {
  // The writes hold the locks the re-check of sales takes (no collect, no other run at these
  // sources), and the plan is made again under them, so nothing changed in between.
  const sources = planSources(plans);
  const locks = await holdRecheckLocks(db, sources);
  if ('refused' in locks) stop(`${locks.refused} Nothing written.`);
  for (const source of locks.interrupted)
    console.log(`A run of ${source} was interrupted earlier.`);
  release = locks.release;
  plans = await planRecord(db, parsed.file, options);
  const more = planSources(plans).filter((s) => !sources.includes(s));
  if (more.length)
    stop(
      `The plan changed while the locks were taken (${more.join(', ')}). Nothing written. Run it again.`,
    );
}
console.log(
  `Sample ${parsed.file.sample} (${parsed.file.check}, sampled ${parsed.file.sampledAt})`,
);
for (const line of describePlan(plans)) console.log(line);
if (!values.apply) {
  console.log('Dry run: nothing written. Add --apply.');
  finish();
}
const result = await applyRecord(db, plans);
console.log(
  `Written: ${result.checks} check row(s), ${result.excluded} sale(s) excluded, ${result.marked} listing(s) marked.`,
);
finish();
