// `pnpm import-ai <folder or files> --user <username> [--dry-run] [--yes] [--sample 0.1]`
// Import purchases from any shop through Claude (requirements S4c): screenshots of order lists,
// PDFs, CSV or text in one folder. Haiku reads them, the code checks every row, Sonnet reads
// again the files with flagged rows; then the usual import plan, shown before anything is
// written. Runs on the home PC with the Claude Code login. Imported lots wait in Review import.
import { localDate, toLocalIso } from '@tora/core';
import { createDb, getUserByUsername, loadTimeZone } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { FILE_TYPES, checkContext, fileHash, readPurchases } from '../ai-import';
import { loadAndRegister } from '../registry';
import { applyAiImport, planAiImport } from '../ai-import-plan';
import { askClaude } from '../claude';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    user: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    sample: { type: 'string', default: '0.1' },
  },
});
if (positionals.length === 0 || !values.user) {
  console.error(
    'Usage: pnpm import-ai <folder or files> --user <username> [--dry-run] [--yes] [--sample 0.1]',
  );
  process.exit(1);
}

// Windows paths (C:\Users\...) as WSL sees them; relative to where the command was typed.
const toLocal = (p: string) => {
  const m = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (m) return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, '/')}`;
  return resolve(process.env.INIT_CWD ?? process.cwd(), p);
};
const paths = positionals.map(toLocal);
let dir: string;
let names: string[];
if (paths.length === 1 && (await stat(paths[0]!)).isDirectory()) {
  dir = paths[0]!;
  names = (await readdir(dir)).filter((f) => FILE_TYPES.test(f) && !f.startsWith('.')).sort();
} else {
  dir = dirname(paths[0]!);
  if (paths.some((p) => dirname(p) !== dir)) {
    console.error('Put the files in one folder (or pass the folder).');
    process.exit(1);
  }
  names = paths.map((p) => basename(p)).filter((f) => FILE_TYPES.test(f) && !f.startsWith('.'));
}
if (names.length === 0) {
  console.error(`No screenshots, PDFs or text files in ${dir}.`);
  process.exit(1);
}

loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
await exitIfUnmigrated(db);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
// The plug-ins' shops (names, aliases, ID shapes) for reading purchases.
await loadAndRegister(db);
const user = await getUserByUsername(db, values.user.trim().toLowerCase());
if (!user) {
  console.error(`No user "${values.user}".`);
  process.exit(1);
}
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
console.log(`User: ${user.username}`);
console.log(`Folder: ${dir} (${names.length} file(s))\n`);

const files = await Promise.all(
  names.map(async (name) => ({ name, hash: fileHash(await readFile(join(dir, name))) })),
);
const cachePath = join(dir, '.tora-import.json');
const ctx = await checkContext(db, user.id);
const read = await readPurchases(ctx, dir, files, askClaude, {
  sample: Number(values.sample),
  log: (m) => console.log(m),
  loadCache: async () => {
    try {
      return JSON.parse(await readFile(cachePath, 'utf8'));
    } catch {
      return null;
    }
  },
  saveCache: (cache) => writeFile(cachePath, JSON.stringify(cache, null, 1)),
});
// No date at all: the file's date, checked in review.
const mtimes = new Map(
  await Promise.all(
    names.map(async (n) => [n, toLocalIso((await stat(join(dir, n))).mtime)] as const),
  ),
);
const plan = await planAiImport(
  db,
  user.id,
  read,
  ctx.products,
  (f) => mtimes.get(f.split(' + ')[0]!) ?? toLocalIso(),
);

const yen = (n: number) => `¥${n.toLocaleString('en-US')}`;
console.log('');
for (const s of plan.shops) {
  console.log(`${s.importer.label}:`);
  for (const entry of s.plan) {
    const row = s.rows.find((r) => r.receipt.orderId === entry.receipt.orderId);
    const r = entry.receipt;
    const what =
      entry.type === 'new'
        ? 'existing' in entry.ref
          ? `new lot of "${entry.ref.existing.name}"`
          : `new lot, new item "${entry.ref.create.name}"`
        : entry.type === 'likely'
          ? `already registered (${localDate(new Date(entry.existing.acquiredAt))}, ${yen(entry.existing.costTotalBase)})${r.noOrderId ? '' : ': its order ID is added'}`
          : entry.type === 'duplicate'
            ? 'already registered'
            : entry.type === 'conflict'
              ? `registered with different ${entry.diffs.map((d) => d.field).join(' / ')}: kept as registered`
              : entry.type === 'unclassified'
                ? 'could not tell what item this is: not imported'
                : 'canceled';
    console.log(
      `  ${localDate(new Date(r.orderedAt))}${r.dateApprox ? '?' : ' '} ${yen(r.total)}${r.quantity > 1 ? ` x${r.quantity}` : ''}  ${r.title}`,
    );
    console.log(
      `      -> ${what}${entry.flags?.length ? `  [check: ${entry.flags.join(', ')}]` : ''}${row?.reviewedBy ? `  (Sonnet: ${row.reviewedBy})` : ''}`,
    );
  }
}
const skippedBy = (why: string) => plan.skipped.filter((s) => s.why === why);
for (const [why, label] of [
  ['not_collectible', 'Not collectibles (left out)'],
  ['canceled', 'Canceled or returned (left out)'],
] as const) {
  const list = skippedBy(why);
  if (list.length) {
    console.log(`${label}:`);
    for (const { row } of list) console.log(`  ${row.date ?? '?'}  ${row.title}`);
  }
}
if (read.merged.length) {
  console.log('One purchase in several files (joined):');
  for (const files of read.merged) console.log(`  ${files.join(' + ')}`);
}
const newLots = plan.shops.flatMap((s) => s.plan.filter((e) => e.type === 'new')).length;
const calls = read.calls.map((c) => `${c.model} ${Math.round(c.tokens / 1000)}k tokens`).join(', ');
console.log(
  `\n${read.rows.length} row(s) read from ${read.files} file(s); Sonnet read ${read.reviewed.length} file(s) again; ${newLots} new lot(s). Cost $${read.costUsd.toFixed(3)}${calls ? ` (${calls})` : ' (all from cache)'}.`,
);

if (values['dry-run'] || plan.shops.flatMap((s) => s.plan).length === 0) {
  console.log(values['dry-run'] ? 'Dry run: nothing written.' : 'Nothing to import.');
  process.exit(0);
}
if (!values.yes) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stdout.write('Import this into Review import? [y/N] ');
  const next = await rl[Symbol.asyncIterator]().next();
  rl.close();
  if (next.done || next.value.trim().toLowerCase() !== 'y') {
    console.log('Nothing written.');
    process.exit(0);
  }
}
const reviewedNote = read.reviewed.length
  ? `Sonnet read again: ${read.reviewed.map((r) => `${r.file} (${r.why})`).join('; ')}.`
  : 'Sonnet read nothing again.';
const outcome = await applyAiImport(
  db,
  user.id,
  plan,
  `Haiku read ${read.files} file(s). ${reviewedNote} Cost $${read.costUsd.toFixed(3)}.`,
);
console.log(
  `Done: ${Object.entries(outcome.counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(
      ', ',
    )}${outcome.linksResolved ? `; ${outcome.linksResolved} failed purchase link(s) resolved` : ''}. Check the new lots in Imports > Review.`,
);
for (const f of outcome.failed) console.log(`  failed ${f.orderId}: ${f.error}`);
process.exit(0);
