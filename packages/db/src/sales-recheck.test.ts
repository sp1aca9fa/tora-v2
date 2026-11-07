import { localDate, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { sharpDrops } from './alerts';
import { type Db, createDb } from './client';
import { loadItemSales, refreshItemSales } from './item-sales';
import { migrateDb } from './migrate';
import { createHolding, createProduct, mergeProducts } from './mutations';
import { readSetting, saveSetting, saveSourceInfos } from './registry';
import {
  type RecheckChange,
  VALUE_SERIES_BREAK_KEY,
  type ValueSeriesBreak,
  finishRecheckRun,
  nextRecheckBatch,
  openRecheckRun,
  readRecheckRuns,
  readStoredSales,
  recheckRunSources,
  undoRecheckRun,
  writeRecheckBatch,
  writeValueSeriesBreak,
} from './sales-recheck';
import { bucketValues, priceObservations, signals } from './schema';
import { insertObservations, setObservationExcluded } from './sources';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';
import { savedBucketValues } from './valuation';
import { addWatch } from './watches';

let db: Db;
let uid: string;
const now = new Date('2026-11-06T12:00:00+09:00');
const ago = (days: number) => toLocalIso(new Date(now.getTime() - days * 86_400_000));

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-recheck-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const box = (name: string) =>
  createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name, franchise: 'pokemon' });

let ref = 0;
/** A stored sale with its raw exactly as given, and how it reads for a run. */
async function stored(productId: string, price: number, raw: string, daysAgo = 5) {
  const r = `r${ref++}`;
  await insertObservations(db, [
    {
      productId,
      source: 'mercari',
      observationType: 'sold',
      bucket: 'sealed:shrink',
      priceBase: price,
      currency: 'JPY',
      observedAt: ago(daysAgo),
      fetchedAt: ago(daysAgo),
      externalRef: r,
    },
  ]);
  await db.$client.execute({
    sql: `update price_observations set raw = ? where external_ref = ?`,
    args: [raw, r],
  });
  const row = (await readStoredSales(db, 'mercari')).find(
    (s) => s.rawText === raw && s.price === price,
  )!;
  const change: RecheckChange = {
    id: row.id,
    source: 'mercari',
    reason: 'mismatch',
    filter: 'bundle',
    rawText: raw,
    updatedAt: row.updatedAt,
  };
  return change;
}

const rowOf = async (id: string) =>
  (
    await db.$client.execute({
      sql: `select excluded, excluded_reason, raw, updated_at, price_base, bucket, observed_at, product_id
            from price_observations where id = ?`,
      args: [id],
    })
  ).rows[0];

const runWith = async (changes: RecheckChange[], rules = 'rules', at = now) => {
  const { run } = await openRecheckRun(db, rules, at);
  const items = await Promise.all(changes.map(async (c) => (await rowOf(c.id))!.product_id));
  await writeValueSeriesBreak(db, [...new Set(items as string[])], at);
  await writeRecheckBatch(db, run.id, await nextRecheckBatch(db, run.id), changes, at);
  const end = await finishRecheckRun(db, run, at);
  return { run, end };
};

it('excludes only by adding keys, and counts a row that changed since it was read as skipped', async () => {
  const p = await box('Box');
  const a = await stored(p.id, 1000, '{"name":"a"}');
  const b = await stored(p.id, 1100, '{"name":"b"}');
  const before = await rowOf(a.id);
  await db.$client.execute({
    sql: `update price_observations set updated_at = ? where id = ?`,
    args: [ago(1), b.id],
  });
  const { run, end } = await runWith([a, b]);
  expect(end).toMatchObject({ changed: 1, meanwhile: 1 });
  const after = await rowOf(a.id);
  expect(after).toMatchObject({ excluded: 1, excluded_reason: 'mismatch' });
  expect(JSON.parse(after!.raw as string)).toEqual({
    name: 'a',
    filter: 'bundle',
    recheck: run.id,
  });
  // Nothing else on the row.
  for (const c of ['price_base', 'bucket', 'observed_at', 'product_id']) {
    expect(after![c]).toEqual(before![c]);
  }
  expect((await rowOf(b.id))!.excluded).toBe(0);
  expect((await readRecheckRuns(db)).map((r) => r.status)).toEqual(['done']);
  expect(await recheckRunSources(db, run.id)).toEqual(['mercari']);
});

it('never touches another source through a wrong source name', async () => {
  const p = await box('Box');
  const a = await stored(p.id, 1000, '{"name":"a"}');
  const { end } = await runWith([{ ...a, source: 'snkrdunk' }]);
  expect(end.changed).toBe(0);
  expect((await rowOf(a.id))!.excluded).toBe(0);
});

it('undo brings back raw byte for byte, with its old date, and twice is the same as once', async () => {
  const p = await box('Box');
  const odd = '{ "z" : 1,   "a":[1, 2.50],"name":"日本語"  }';
  const a = await stored(p.id, 1000, odd);
  const before = await rowOf(a.id);
  const { run } = await runWith([a]);
  // json_set normalizes what it writes; the ledger keeps the original.
  expect((await rowOf(a.id))!.raw).not.toBe(odd);
  const dry = await undoRecheckRun(db, run.id, { apply: false, now });
  expect(dry).toMatchObject({ restored: 1 });
  expect((await rowOf(a.id))!.excluded).toBe(1);
  expect(await undoRecheckRun(db, run.id, { apply: true, now })).toMatchObject({ restored: 1 });
  expect(await rowOf(a.id)).toEqual(before);
  expect(await undoRecheckRun(db, run.id, { apply: true, now })).toMatchObject({
    restored: 0,
    alreadyBack: 1,
    changedByPerson: 0,
    gone: 0,
  });
  expect(await rowOf(a.id)).toEqual(before);
  const [saved] = await readRecheckRuns(db);
  expect(saved).toMatchObject({ status: 'undone', undo: { restored: 1 } });
});

it('undo leaves what a person did after the run, and what was deleted', async () => {
  const p = await box('Box');
  const included = await stored(p.id, 1000, '{"name":"included"}');
  const excluded = await stored(p.id, 1100, '{"name":"excluded"}');
  const pasted = await stored(p.id, 1200, '{"name":"pasted"}');
  const deleted = await stored(p.id, 1300, '{"name":"deleted"}');
  const untouched = await stored(p.id, 1400, '{"name":"untouched"}');
  const { run } = await runWith([included, excluded, pasted, deleted, untouched]);

  await setObservationExcluded(db, included.id, false);
  await setObservationExcluded(db, excluded.id, false);
  await setObservationExcluded(db, excluded.id, true);
  // A pasted sale goes through the vouched path: the same listing, included, with new raw.
  const [pastedRow] = await db
    .select()
    .from(priceObservations)
    .where(eq(priceObservations.id, pasted.id));
  await insertObservations(db, [{ ...pastedRow!, raw: { name: 'pasted', reference: true } }]);
  await db.delete(priceObservations).where(eq(priceObservations.id, deleted.id));

  const counts = await undoRecheckRun(db, run.id, { apply: true, now });
  expect(counts).toMatchObject({ restored: 1, changedByPerson: 3, gone: 1, alreadyBack: 0 });
  expect(await rowOf(included.id)).toMatchObject({ excluded: 0, excluded_reason: null });
  // Included, its rejection still in raw: that is how the next run knows.
  expect(JSON.parse((await rowOf(included.id))!.raw as string).filter).toBe('bundle');
  expect(await rowOf(excluded.id)).toMatchObject({ excluded: 1, excluded_reason: 'manual' });
  expect(JSON.parse((await rowOf(pasted.id))!.raw as string).reference).toBe(true);
  expect(await rowOf(deleted.id)).toBeUndefined();
  expect(await rowOf(untouched.id)).toMatchObject({ excluded: 0, raw: '{"name":"untouched"}' });
});

it('a row marked by a later run is not the earlier run to undo', async () => {
  const p = await box('Box');
  const a = await stored(p.id, 1000, '{"name":"a"}');
  const { run: first } = await runWith([a]);
  await undoRecheckRun(db, first.id, { apply: true, now });
  const { run: second } = await runWith([a], 'other rules');
  expect(await undoRecheckRun(db, first.id, { apply: true, now })).toMatchObject({
    restored: 0,
    changedByPerson: 1,
  });
  expect(await rowOf(a.id)).toMatchObject({ excluded: 1 });
  expect(await undoRecheckRun(db, second.id, { apply: true, now })).toMatchObject({ restored: 1 });
  expect(await rowOf(a.id)).toMatchObject({ excluded: 0, raw: '{"name":"a"}' });
});

it('a merged row is restored and the item it belongs to now is valued again', async () => {
  const from = await box('From');
  const into = await box('Into');
  const a = await stored(from.id, 1000, '{"name":"a"}');
  const { run } = await runWith([a]);
  await mergeProducts(db, { id: uid, role: 'admin' }, from.id, into.id);
  await db.insert(bucketValues).values({
    productId: into.id,
    bucket: 'sealed:shrink',
    value: { valuation: { unitBase: 1 } } as never,
    computedAt: toLocalIso(now),
  });
  expect(await undoRecheckRun(db, run.id, { apply: true, now })).toMatchObject({
    restored: 1,
    items: 1,
  });
  expect(await rowOf(a.id)).toMatchObject({ excluded: 0, product_id: into.id });
  expect(
    await db.select().from(bucketValues).where(eq(bucketValues.productId, into.id)),
  ).toHaveLength(0);
});

it('undoes a run that never finished, row by row from its ledger', async () => {
  const p = await box('Box');
  const a = await stored(p.id, 1000, '{"name":"a"}');
  const b = await stored(p.id, 1100, '{"name":"b"}');
  const { run } = await openRecheckRun(db, 'rules', now);
  await writeRecheckBatch(db, run.id, 1, [a], now);
  expect((await readRecheckRuns(db))[0]!.status).toBe('running');
  expect(await undoRecheckRun(db, run.id, { apply: true, now })).toMatchObject({ restored: 1 });
  expect(await rowOf(a.id)).toMatchObject({ excluded: 0 });
  expect(await rowOf(b.id)).toMatchObject({ excluded: 0 });
  expect((await readRecheckRuns(db))[0]!.status).toBe('undone');
  await expect(undoRecheckRun(db, 'nope', { apply: true, now })).rejects.toThrow('No re-check run');
});

it('continues an interrupted run under its id; other rules leave it partial and start anew', async () => {
  const p = await box('Box');
  const a = await stored(p.id, 1000, '{"name":"a"}');
  const b = await stored(p.id, 1100, '{"name":"b"}');
  const c = await stored(p.id, 1200, '{"name":"c"}');
  const first = await openRecheckRun(db, 'rules', now);
  expect(first.continued).toBe(false);
  await writeRecheckBatch(db, first.run.id, 1, [a], now);
  const again = await openRecheckRun(db, 'rules', now);
  expect(again).toMatchObject({ continued: true, run: { id: first.run.id } });
  expect(await nextRecheckBatch(db, first.run.id)).toBe(2);
  await writeRecheckBatch(db, first.run.id, 2, [b], now);
  const other = await openRecheckRun(db, 'other rules', now);
  expect(other).toMatchObject({ continued: false, left: first.run.id });
  expect(other.run.id).not.toBe(first.run.id);
  expect((await readRecheckRuns(db)).map((r) => r.status)).toEqual(['partial', 'running']);
  await writeRecheckBatch(db, other.run.id, 1, [c], now);
  const end = await finishRecheckRun(db, other.run, now);
  expect(end.changed).toBe(1);
  // Each undoes by its own id.
  expect(await undoRecheckRun(db, first.run.id, { apply: true, now })).toMatchObject({
    restored: 2,
  });
  expect(await rowOf(c.id)).toMatchObject({ excluded: 1 });
});

/** A held item valued from its sales: five at `price`, plus the listed changes. */
async function heldItem(prices: number[]) {
  const p = await box('Held box');
  await createHolding(
    db,
    uid,
    { productId: p.id },
    { quantity: 1, costTotalBase: 5000, acquiredAt: ago(60), packagingState: 'sealed_shrink' },
  );
  const rows: RecheckChange[] = [];
  for (const price of prices) rows.push(await stored(p.id, price, `{"name":"${price}-${ref}"}`));
  await refreshItemSales(db, { full: true, now });
  await savedBucketValues(db, [{ product: p, bucket: 'sealed:shrink' }], now);
  return { p, rows };
}
const unit = async (productId: string) => {
  const [row] = await db.select().from(bucketValues).where(eq(bucketValues.productId, productId));
  return (row?.value as { valuation: { unitBase: number | null } } | undefined)?.valuation.unitBase;
};

it('the last step refreshes packed rows, then clears, so the saved value is the cleaned one', async () => {
  const { p, rows } = await heldItem([1000, 1000, 1000, 9000, 9000, 9000, 9000]);
  const was = await unit(p.id);
  expect(was).toBeGreaterThan(5000);
  const { end } = await runWith(rows.slice(3));
  expect(end.items).toBe(1);
  expect(await unit(p.id)).toBe(1000);
  const packed = await loadItemSales(db, [p.id]);
  expect(packed.get(p.id)?.groups.flatMap((g) => g.p)).toEqual([1000, 1000, 1000]);
});

describe('the break in a value series', () => {
  const on = (days: number) => new Date(now.getTime() + days * 86_400_000);
  /** The number a night stored, `days` from the run: what `sharpDrops` compares. */
  const night = (productId: string, days: number, fair: number) =>
    db.insert(signals).values({
      productId,
      bucket: 'sealed:shrink',
      day: localDate(on(days)),
      stats: { fair } as never,
    });
  const told = (user: string, days: number) => sharpDrops(db, user, {}, on(days));
  const toldKeys = async (user: string, days: number) => (await told(user, days)).map((d) => d.key);
  const breaks = () => readSetting<ValueSeriesBreak>(db, VALUE_SERIES_BREAK_KEY);
  const holding = { quantity: 1, costTotalBase: 5000, acquiredAt: ago(60) };
  const someone = async (name: string) => {
    const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
    return (await createUser(db, name, creds)).user.id;
  };

  it('a value a run corrected is no fall: for the holder, a later watcher, a pair nobody held then', async () => {
    const { p, rows } = await heldItem([1000, 1000, 1000, 9000, 9000, 9000, 9000]);
    const free = await box('Held by nobody');
    const wrong = await stored(free.id, 9000, '{"name":"free"}');
    const outside = await heldItem([1000]);
    const shown = { [uid]: { other: '2026-10-01' } };
    await saveSetting(db, 'alertDrops', shown);
    for (const id of [p.id, free.id, outside.p.id]) await night(id, -6, 9000);
    await runWith([...rows.slice(3), wrong]);
    for (const id of [p.id, free.id, outside.p.id]) await night(id, 1, 1000);

    // The item outside the run really fell: told. The two the run corrected did not.
    expect(await toldKeys(uid, 1)).toEqual([`${outside.p.id}|sealed:shrink`]);
    const later = await someone('b');
    await addWatch(db, later, { productId: p.id }, { packagingState: 'sealed_shrink' });
    await createHolding(
      db,
      later,
      { productId: free.id },
      { ...holding, packagingState: 'sealed_shrink' },
    );
    expect(await toldKeys(later, 1)).toEqual([]);
    expect(await readSetting(db, 'alertDrops')).toEqual(shown);
  });

  it("the run's own day counts as before it: that night's collect wrote its row first", async () => {
    const { p, rows } = await heldItem([1000, 1000, 1000, 9000, 9000, 9000, 9000]);
    await night(p.id, 0, 9000);
    await runWith(rows.slice(3));
    expect((await breaks())![p.id]).toBe(localDate(now));
    for (let d = 1; d <= 9; d++) {
      await night(p.id, d, 1000);
      expect(await toldKeys(uid, d), `day ${d}`).toEqual([]);
    }
  });

  it('a real fall is told about a week after the run, against a number from after it', async () => {
    const { p, rows } = await heldItem([1000, 1000, 1000, 9000, 9000, 9000, 9000]);
    await night(p.id, 0, 9000);
    await runWith(rows.slice(3));
    for (let d = 1; d <= 5; d++) await night(p.id, d, 5000);
    // A fall in the first week has nothing from after the run to be compared with yet.
    await night(p.id, 6, 1000);
    expect(await told(uid, 6)).toEqual([]);
    await night(p.id, 7, 1000);
    await night(p.id, 8, 1000);
    const [drop] = await told(uid, 8);
    expect(drop?.key).toBe(`${p.id}|sealed:shrink`);
    // Against the first night after the run (5,000), not the 9,000 from before it.
    expect(drop?.change).toBeCloseTo(1000 / 5000 - 1);
  });

  it('run A, run B, undo B: no false fall, and each item keeps its latest day', async () => {
    const x = await heldItem([9000, 9000, 1000]);
    const y = await heldItem([9000]);
    await night(x.p.id, -1, 1000);
    await runWith([x.rows[2]!, y.rows[0]!], 'a', on(0));
    await night(x.p.id, 1, 9000);
    const b = await runWith([x.rows[0]!], 'b', on(3));
    await night(x.p.id, 4, 9000);
    await undoRecheckRun(db, b.run.id, { apply: true, now: on(5) });
    expect(await breaks()).toEqual({
      [x.p.id]: localDate(on(5)),
      [y.p.id]: localDate(on(0)),
    });
    for (let d = 6; d <= 14; d++) {
      await night(x.p.id, d, 1000);
      expect(await toldKeys(uid, d), `day ${d}`).toEqual([]);
    }
  });

  it('an undo tells nothing false, removes nothing, and a second one writes no later day', async () => {
    const { p, rows } = await heldItem([9000, 9000, 9000, 1000, 1000, 1000, 1000]);
    await night(p.id, -1, 9000);
    const { run } = await runWith(rows.slice(3));
    await undoRecheckRun(db, run.id, { apply: true, now: on(1) });
    const after = { [p.id]: localDate(on(1)) };
    expect(await breaks()).toEqual(after);
    for (let d = 2; d <= 10; d++) {
      await night(p.id, d, 1000);
      expect(await toldKeys(uid, d), `day ${d}`).toEqual([]);
    }
    expect(await undoRecheckRun(db, run.id, { apply: true, now: on(11) })).toMatchObject({
      restored: 0,
    });
    expect(await breaks()).toEqual(after);
    expect(await readSetting(db, 'alertDrops')).toBeNull();
  });

  it('the latest day wins, whatever order they come in', async () => {
    const p = await box('Box');
    await writeValueSeriesBreak(db, [p.id], on(3));
    await writeValueSeriesBreak(db, [p.id], on(1));
    expect((await breaks())![p.id]).toBe(localDate(on(3)));
    await writeValueSeriesBreak(db, [p.id], on(4));
    expect((await breaks())![p.id]).toBe(localDate(on(4)));
    await writeValueSeriesBreak(db, [], on(9));
    expect((await breaks())![p.id]).toBe(localDate(on(4)));
  });

  it('an undo that cannot save the break restores nothing; its next attempt does', async () => {
    const { p, rows } = await heldItem([9000, 1000]);
    const { run } = await runWith([rows[0]!]);
    await db.$client.execute(`create trigger stop_save before insert on app_settings
      when new.key = '${VALUE_SERIES_BREAK_KEY}' begin select raise(abort, 'killed'); end`);
    await expect(undoRecheckRun(db, run.id, { apply: true, now: on(1) })).rejects.toThrow();
    expect((await rowOf(rows[0]!.id))!.excluded).toBe(1);
    expect((await readRecheckRuns(db))[0]!.status).toBe('done');
    await db.$client.execute('drop trigger stop_save');
    expect(await undoRecheckRun(db, run.id, { apply: true, now: on(1) })).toMatchObject({
      restored: 1,
    });
    expect((await breaks())![p.id]).toBe(localDate(on(1)));
  });
});

it('undo keeps a later date on a row changed since, and puts back the date of one nobody touched', async () => {
  const from = await box('From');
  const into = await box('Into');
  const merged = await stored(from.id, 1000, '{"name":"a"}');
  const plain = await stored(into.id, 1100, '{"name":"b"}');
  const { run } = await runWith([merged, plain]);
  await mergeProducts(db, { id: uid, role: 'admin' }, from.id, into.id);
  const mergedAt = (await rowOf(merged.id))!.updated_at;
  expect(mergedAt).not.toBe(merged.updatedAt);
  expect(mergedAt).not.toBe(toLocalIso(now));
  expect(await undoRecheckRun(db, run.id, { apply: true, now })).toMatchObject({ restored: 2 });
  expect(await rowOf(merged.id)).toMatchObject({
    excluded: 0,
    raw: '{"name":"a"}',
    updated_at: mergedAt,
  });
  expect((await rowOf(plain.id))!.updated_at).toBe(plain.updatedAt);
});
