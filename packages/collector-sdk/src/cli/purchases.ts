// `pnpm purchases <export.mbox> --user <username> [--source snkrdunk]`
// Imports marketplace purchases from a Google Takeout mail export (requirements S5b). Runs on
// the home PC; the app never gets Gmail access. Nothing is written before the summary is
// confirmed, and existing entries are never removed.
import { tokyoDate } from '@tora/core';
import { createDb, getUserByUsername } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { readMbox } from '../mbox';
import {
  type Decision,
  type PlanEntry,
  applyImport,
  gatherReceipts,
  planImport,
  reviewFlags,
} from '../purchases';
import { loadCollectors } from '../registry';
import type { PurchaseReceipt, ReceiptMail } from '../types';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { user: { type: 'string' }, source: { type: 'string' } },
});
const file = positionals[0];
if (!file || !values.user) {
  console.error('Usage: pnpm purchases <export.mbox> --user <username> [--source snkrdunk]');
  process.exit(1);
}

loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
await exitIfUnmigrated(db);
const user = await getUserByUsername(db, values.user.trim().toLowerCase());
if (!user) {
  console.error(`No user "${values.user}".`);
  process.exit(1);
}
const { importers, missing } = await loadCollectors();
for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
const selected = importers.filter((i) => !values.source || i.source === values.source);
if (selected.length === 0) {
  console.error('No purchase importer available (they live in the private collectors package).');
  process.exit(1);
}
// pnpm runs the script inside the package; paths are relative to where the command was typed.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
console.log(`User: ${user.username}\n`);

// Line iterator (not rl.question): buffered, so answers can also be piped in.
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const answers = rl[Symbol.asyncIterator]();
const yen = (n: number) => `¥${n.toLocaleString('en-US')}`;
const day = (iso: string) => tokyoDate(new Date(iso));
const line = (r: PurchaseReceipt) =>
  `  ${day(r.orderedAt)}  #${r.orderId}  ${yen(r.totalJpy)}${r.quantity > 1 ? ` x${r.quantity}` : ''}  ${r.title}`;
async function choose<T>(question: string, options: Record<string, T>): Promise<T> {
  for (;;) {
    process.stdout.write(`${question} `);
    const next = await answers.next();
    if (next.done) {
      console.log('\nNo answer; nothing written.');
      process.exit(1);
    }
    const answer = next.value.trim().toLowerCase();
    if (answer in options) return options[answer]!;
  }
}
const section = (title: string, entries: PlanEntry[], extra?: (e: PlanEntry) => string) => {
  if (entries.length === 0) return;
  console.log(`${title} (${entries.length}):`);
  for (const e of entries) console.log(line(e.receipt) + (extra ? extra(e) : ''));
  console.log('');
};

let exitCode = 0;
for (const importer of selected) {
  console.log(`== ${importer.label} ==`);
  const mails: ReceiptMail[] = [];
  let exportedAt: string | null = null;
  for await (const mail of readMbox(path, importer.matchesHeader)) {
    if (mail.date && (!exportedAt || mail.date.toISOString() > exportedAt)) {
      exportedAt = mail.date.toISOString();
    }
    const parsed = importer.parse(mail);
    if (parsed) mails.push(parsed);
  }
  const gathered = gatherReceipts(mails);
  const plan = await planImport(db, user.id, importer, gathered, { exportedAt });
  const of = <T extends PlanEntry['type']>(type: T) =>
    plan.filter((e): e is Extract<PlanEntry, { type: T }> => e.type === type);
  console.log(
    `Read ${gathered.receipts.length} purchase(s), ${gathered.cancelled.size} cancellation(s).\n`,
  );

  section('Already registered with the same data, not imported again', of('duplicate'));
  section('Cancelled, not imported', of('cancelled'));
  section('Marked as cancelled in the app, not imported', of('cancelledInApp'));
  section(
    'Cancelled per the emails but registered (left as is; check them)',
    of('cancelledRegistered'),
  );
  section(
    'Could not tell what product this is (add by hand with its order ID)',
    of('unclassified'),
  );
  if (gathered.unreadable.length) {
    console.log(`Emails that could not be read (${gathered.unreadable.length}):`);
    for (const u of gathered.unreadable) console.log(`  ${u.subject} (${u.reason})`);
    console.log('');
  }
  const { gaps } = reviewFlags(
    gathered,
    new Set(of('cancelledInApp').map((e) => e.receipt.orderId)),
  );
  if (gaps.length) {
    console.log('Fewer delivery emails than purchases (some may have been cancelled by you,');
    console.log('which sends no email). Their older purchases are flagged for review in the app:');
    for (const g of gaps) {
      console.log(
        `  ${g.title}: ${g.purchases} purchase(s), ${g.delivered} delivered${g.recent ? `, ${g.recent} recent (may still be on the way)` : ''}`,
      );
    }
    console.log('');
  }
  const deadline = plan.filter((e) => e.flags?.includes('deadline_missed'));
  section('The seller missed the shipping deadline (flagged for review)', deadline);
  section('New', of('new'), (e) =>
    e.type === 'new' && 'create' in e.ref ? '  [new product]' : '',
  );

  const decisions = new Map<string, Decision>();
  for (const e of of('conflict')) {
    console.log(`Transaction #${e.receipt.orderId} is registered with different data:`);
    console.log(line(e.receipt));
    for (const d of e.diffs) {
      const fmt = (v: string | number) => (d.field === 'cost' ? yen(Number(v)) : String(v));
      console.log(`    ${d.field}: registered ${fmt(d.existing)}, email ${fmt(d.imported)}`);
    }
    if (e.existing.length > 1) {
      console.log('    The lot was split; keeping the registered data (edit it in the app).\n');
      decisions.set(e.receipt.orderId, 'keep');
      continue;
    }
    decisions.set(
      e.receipt.orderId,
      await choose('    Which is correct? [r]egistered / [e]mail:', { r: 'keep', e: 'imported' }),
    );
    console.log('');
  }
  for (const e of of('likely')) {
    const h = e.existing;
    console.log(`Possibly already registered without its order ID:`);
    console.log(line(e.receipt));
    console.log(
      `    registered: ${day(h.acquiredAt)}  ${yen(h.costTotalJpy)}  ${e.product.name}${h.acquiredFrom ? ` (${h.acquiredFrom})` : ''}`,
    );
    const options: Record<string, Decision> = { s: 'same', k: 'skip' };
    if (e.ref) options.d = 'different';
    decisions.set(
      e.receipt.orderId,
      await choose(
        `    [s]ame purchase (add the order ID)${e.ref ? ' / [d]ifferent purchase (import)' : ''} / s[k]ip:`,
        options,
      ),
    );
    console.log('');
  }

  const decided = [...decisions.values()];
  const creates = of('new').length + decided.filter((d) => d === 'different').length;
  const updates = decided.filter((d) => d === 'imported').length;
  const attaches = decided.filter((d) => d === 'same').length;
  // Lots already in the app with a review reason (flagged once per reason).
  const toFlag = plan.filter(
    (e) => e.flags?.length && (e.type === 'duplicate' || e.type === 'conflict'),
  ).length;
  if (creates + updates + attaches + toFlag === 0) {
    console.log('Nothing to write.\n');
    continue;
  }
  const ok = await choose(
    `Write ${creates} new, ${updates} correction(s), ${attaches} order ID(s) added, review flags on up to ${toFlag} existing? [y/n]`,
    { y: true, n: false },
  );
  if (!ok) {
    console.log('Nothing written.\n');
    continue;
  }
  const outcome = await applyImport(db, user.id, importer, plan, decisions);
  console.log(
    `Done: ${outcome.created} created, ${outcome.updated} corrected, ${outcome.attached} order ID(s) added, ${outcome.flagged} review flag(s) added.`,
  );
  for (const f of outcome.failed) console.log(`  failed #${f.orderId}: ${f.error}`);
  if (outcome.failed.length) exitCode = 1;
  console.log(
    'Run `pnpm collect` to match new products to their listing (confirm under Matches).\n',
  );
}
rl.close();
process.exit(exitCode);
