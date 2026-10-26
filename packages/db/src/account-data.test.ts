// "Download my data" loaded into an empty account (requirements S15): everything comes back, on
// the same install and on another one.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRADERS } from '@tora/core';
import { beforeEach, expect, it } from 'vitest';
import { accountData, loadAccountData } from './account-data';
import { type Db, createDb } from './client';
import { startImportRun } from './imports';
import { migrateDb } from './migrate';
import {
  addNote,
  createHolding,
  returnGrading,
  sellHolding,
  splitOff,
  submitGrading,
} from './mutations';
import { seedCollection } from './seed';
import { linkSource } from './sources';
import { setPreferences } from './users';
import { createUser } from './users';
import { setManualPrice } from './valuation';
import { addWatch } from './watches';

let dir: string;
let db: Db;
let owner: string;

const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
const AT = '2026-10-01T12:00:00.000+09:00';

async function install(name: string) {
  const d = createDb({ url: `file:${join(dir, `${name}.db`)}` });
  await migrateDb(d);
  return d;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tora-account-'));
  db = await install('main');
  owner = (await createUser(db, 'owner', creds)).user.id;
  await seedCollection(db, owner);
  const run = await startImportRun(db, { userId: owner, method: 'file', note: 'sheet' });
  const { holding, product } = await createHolding(
    db,
    owner,
    { product: { category: 'tcg', kind: 'single', name: 'Card', franchise: 'pokemon' } },
    { quantity: 6, costTotalBase: 6_000, acquiredAt: AT, importRunId: run } as never,
  );
  await addNote(db, owner, holding.id, { text: 'a note', occurredAt: AT });
  await splitOff(db, owner, holding.id, 2, AT);
  await sellHolding(db, owner, holding.id, {
    quantity: 1,
    priceBase: 2_000,
    feesBase: 100,
    occurredAt: AT,
  });
  const sent = await submitGrading(db, owner, holding.id, {
    quantity: 1,
    grader: GRADERS[0],
    feeBase: 3_000,
    occurredAt: AT,
  });
  await returnGrading(db, owner, sent.id, { grader: GRADERS[0], grade: '10', occurredAt: AT });
  await setManualPrice(db, owner, product.id, 'raw:A', 1_500, 'by hand');
  await addWatch(db, owner, { productId: product.id }, { targetPriceBase: 900, note: 'cheap' });
  await linkSource(db, product.id, { source: 'mercari', externalId: 'm1', title: 'Card' });
  await setPreferences(db, owner, { amountsHidden: true } as never);
  return () => rm(dir, { recursive: true, force: true });
});

/**
 * A download with the person's ids replaced by their place in it (they get new ones on load),
 * and what differs by design left out.
 */
function comparable(file: Awaited<ReturnType<typeof accountData>>, otherInstall = false) {
  const label = new Map<string, string>();
  const name = (rows: { id: string }[]) => {
    for (const r of rows) label.set(r.id, `#${label.size}`);
  };
  // The role stays the account's own; added items are the loader's, their listings new rows, and
  // their values wait for the next collect.
  const drop = new Set(['userId', 'exportedAt', 'username', 'createdAt', 'role']);
  if (otherInstall) for (const k of ['createdBy', 'currentValueBase', 'valueMethod']) drop.add(k);
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return label.get(v) ?? v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v)
          .filter(([k]) => !drop.has(k) && !(otherInstall && key === 'listings' && k === 'id'))
          .map(([k, x]) => [k, walk(x, k)]),
      );
    }
    return v;
  };
  name(file.lots);
  name([
    ...file.manualPrices,
    ...file.watches,
    ...file.importRuns,
    ...file.purchaseLinks,
    ...file.canceledOrders,
  ]);
  // Events at the same moment come in any order: sorted by what they say.
  const said = (e: (typeof file.history)[number]) => JSON.stringify(walk({ ...e, id: '' }));
  const history = file.history.toSorted((a, b) => said(a).localeCompare(said(b)));
  name(history);
  return walk({ ...file, history }) as Record<string, unknown>;
}

it('loads a download into an empty account on the same install, everything back', async () => {
  const file = JSON.parse(JSON.stringify(await accountData(db, owner)));
  const fresh = (await createUser(db, 'fresh', creds)).user.id;
  const result = await loadAccountData(db, fresh, file);
  expect(result).toMatchObject({ itemsAdded: 0, lots: file.lots.length, watches: 1 });
  expect(file.lots.length).toBeGreaterThan(5);
  expect(file.history.length).toBeGreaterThan(10);
  expect(comparable(await accountData(db, fresh))).toEqual(comparable(file));
  // The original account is untouched.
  expect(comparable(await accountData(db, owner))).toEqual(comparable(file));
});

it('loads a file saved before the US spelling (cancelled)', async () => {
  const file = JSON.parse(JSON.stringify(await accountData(db, owner)));
  const { canceledOrders, ...rest } = file;
  const old = { ...rest, cancelledOrders: canceledOrders };
  if (old.importRuns[0]) old.importRuns[0].counts = { imported: 1, cancelled: 2 };
  const fresh = (await createUser(db, 'fresh', creds)).user.id;
  expect(await loadAccountData(db, fresh, old)).toMatchObject({ lots: file.lots.length });
  const back = await accountData(db, fresh);
  expect(back.canceledOrders).toHaveLength(canceledOrders.length);
  if (old.importRuns[0])
    expect(back.importRuns.map((r) => r.counts)).toContainEqual({ imported: 1, canceled: 2 });
});

it('loads a download on another install, adding its items and their listings', async () => {
  const file = JSON.parse(JSON.stringify(await accountData(db, owner)));
  const other = await install('other');
  const moved = (await createUser(other, 'moved', creds)).user.id;
  const result = await loadAccountData(other, moved, file);
  expect(result).toMatchObject({ items: file.items.length, itemsAdded: file.items.length });
  const back = await accountData(other, moved);
  expect(comparable(back, true)).toEqual(comparable(file, true));
  expect(back.items.every((i) => i.createdBy === moved)).toBe(true);
  other.$client.close();
});

it('refuses a file it cannot load, and an account with data', async () => {
  const file = JSON.parse(JSON.stringify(await accountData(db, owner)));
  const fresh = (await createUser(db, 'fresh', creds)).user.id;
  expect(await loadAccountData(db, fresh, { ...file, format: 'other' })).toEqual({
    error: 'format',
  });
  expect(await loadAccountData(db, fresh, { ...file, version: 99 })).toEqual({ error: 'version' });
  expect(
    await loadAccountData(db, fresh, { ...file, app: { ...file.app, baseCurrency: 'USD' } }),
  ).toEqual({ error: 'currency' });
  expect(await loadAccountData(db, owner, file)).toEqual({ error: 'notEmpty' });
  expect(await loadAccountData(db, fresh, '[]')).toEqual({ error: 'format' });
});
