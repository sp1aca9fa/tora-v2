import { baseCurrency, localDate } from '@tora/core';
import {
  type Db,
  VALUE_SERIES_BREAK_KEY,
  createDb,
  createHolding,
  createProduct,
  createUser,
  fileSuggestion,
  insertObservations,
  loadSourceRegistry,
  mergeProducts,
  readRecheckRuns,
  readSetting,
  refreshItemSales,
  saveSourceInfos,
  schema,
  setObservationExcluded,
  sharpDrops,
  startRun,
  undoRecheckRun,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdCollectLocks, lockSource, stateDir } from './lock';
import {
  type RecheckPlan,
  applyRecheck,
  checkedLimits,
  holdRecheckLocks,
  limitsBroken,
  limitsOf,
  planRecheck,
  protectedBy,
  refusedDatabase,
  unstampedLimits,
  verdictFamily,
} from './recheck';
import type { SalesRechecker, StoredPeer, StoredSale } from './types';

let db: Db;
let dir: string;
let uid: string;
let productId: string;
const now = new Date('2026-11-06T12:00:00+09:00');
const stamp = (at: Date) => at.toISOString().replace('Z', '+00:00');

const SOURCES = [
  { key: 'flea', label: 'Flea', market: 'jp', currency: 'JPY', roles: { sealed: 'supporting' } },
  {
    key: 'auction',
    label: 'Auction',
    market: 'jp',
    currency: 'JPY',
    roles: { sealed: 'supporting' },
  },
  { key: 'shop', label: 'Shop', market: 'jp', currency: 'JPY', roles: { sealed: 'reference' } },
  { key: 'abroad', label: 'Abroad', market: 'us', currency: 'USD', noAi: true },
] as Parameters<typeof saveSourceInfos>[1];

/** Rules of a made-up plug-in: "wrong" in a title rejects, "maybe" rejects with low confidence. */
const rechecker = (over: Partial<SalesRechecker> = {}): SalesRechecker => ({
  sources: ['flea', 'auction'],
  rulesId: () => 'rules-1',
  farDetail: 'price far from the history',
  assess(_source, _product, link, sales: StoredSale[]) {
    if (link.query?.keywords?.[0] === 'none') return { skipped: 'no search words' };
    return sales.map((s) => {
      const title = s.title ?? (s.raw?.name as string | undefined);
      if (!s.raw) return { id: s.id, skipped: 'broken raw' };
      if (!title) return { id: s.id, skipped: 'no title' };
      const bucket = s.raw.today === undefined ? s.bucket : (s.raw.today as string | null);
      if (title.includes('maybe')) {
        return { id: s.id, ok: false, detail: 'not named', bucket, low: true };
      }
      if (title.includes('wrong')) {
        return { id: s.id, ok: false, detail: 'bundle (2 pieces)', bucket };
      }
      return { id: s.id, ok: true, bucket };
    });
  },
  // Far: over 10x the median of history. Marks only what may be marked.
  far(peersBySource, history) {
    const prices = history.map((h) => h.price).toSorted((a, b) => a - b);
    const median = prices[prices.length >> 1] ?? Infinity;
    return new Set(
      peersBySource
        .flat()
        .filter((p) => p.markable && p.price > median * 10)
        .map((p) => p.id),
    );
  },
  ...over,
});

let ref = 0;
const sale = (raw: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  productId,
  source: 'flea',
  observationType: 'sold' as const,
  bucket: 'sealed:shrink',
  priceBase: 1000,
  priceOriginal: 1000,
  currency: 'JPY',
  observedAt: stamp(new Date(now.getTime() - 5 * 86_400_000)),
  fetchedAt: now.toISOString(),
  externalRef: `r${ref++}`,
  raw: raw as never,
  ...extra,
});

const insertSales = async (...rows: ReturnType<typeof sale>[]) => {
  await insertObservations(db, rows);
  const stored = await db.select().from(schema.priceObservations);
  return rows.map((r) => stored.find((s) => s.externalRef === r.externalRef)!);
};
const plan = async (over: Partial<SalesRechecker> = {}, flags: object = {}) =>
  planRecheck(db, [rechecker(over)], await loadSourceRegistry(db), { now, ...flags });
const row = async (id: string) =>
  (await db.select().from(schema.priceObservations).where(eq(schema.priceObservations.id, id)))[0]!;
const allRows = () => db.select().from(schema.priceObservations);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tora-recheck-sdk-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, SOURCES);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  productId = (
    await createProduct(db, uid, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box',
      franchise: 'pokemon',
    })
  ).id;
  for (const source of ['flea', 'auction']) {
    await db.insert(schema.productSources).values({
      productId,
      source,
      query: { keywords: ['box'] },
    } as never);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('what a re-check leaves alone', () => {
  it("never changes a pasted reference, a person's exclude or include, or a dismissed suggestion", async () => {
    const [reference, excluded, included, touched, dismissed, plain, already] = await insertSales(
      sale({ name: 'wrong pasted', reference: true }),
      sale({ name: 'wrong excluded' }),
      sale({ name: 'wrong included', filter: 'bundle' }),
      sale({ name: 'wrong touched' }),
      sale({ name: 'wrong dismissed' }),
      sale({ name: 'wrong plain' }),
      sale({ name: 'wrong already' }, { excluded: true, excludedReason: 'outlier' }),
    );
    await setObservationExcluded(db, excluded!.id, true);
    await setObservationExcluded(db, included!.id, false);
    await db
      .update(schema.priceObservations)
      .set({ updatedAt: stamp(new Date(Date.now() + 3_600_000)) })
      .where(eq(schema.priceObservations.id, touched!.id));
    await fileSuggestion(db, {
      userId: uid,
      kind: 'exclude_sale',
      targetKey: dismissed!.id,
      productId,
      reason: 'looks wrong',
    } as never);
    await db
      .update(schema.suggestions)
      .set({ status: 'dismissed' })
      .where(eq(schema.suggestions.targetKey, dismissed!.id));

    const p = await plan();
    expect(p.changes.map((c) => c.id)).toEqual([plain!.id]);
    expect(p.changes[0]).toMatchObject({
      reason: 'mismatch',
      filter: 'bundle (2 pieces)',
      family: 'bundle',
    });
    expect(p.protectedRejected).toEqual({
      'pasted reference': 1,
      'person included': 1,
      'touched later': 1,
      'suggestion dismissed': 1,
    });
    expect(p.families).toEqual({ 'flea|bundle': 1 });
    expect(p.detail.rejected[already!.id]).toBeDefined();
    expect(p.detail.rejected[reference!.id]).toBeUndefined();
  });

  it('reads a date it cannot parse as touched', () => {
    const r = { id: 'x', createdAt: 'unknown', updatedAt: '2026-11-06T00:00:00+09:00' };
    expect(protectedBy(r, {}, new Set())).toBe('touched later');
    expect(protectedBy({ ...r, createdAt: r.updatedAt }, {}, new Set())).toBeNull();
    expect(protectedBy({ ...r, createdAt: r.updatedAt }, {}, new Set(['x']))).toBe(
      'suggestion dismissed',
    );
  });

  it('skips a listing without search words, and rows it cannot read, counted and never rejected', async () => {
    await insertSales(
      sale({ name: 'wrong' }, { source: 'auction' }),
      sale(null),
      sale({ other: 1 }),
    );
    await db
      .update(schema.productSources)
      .set({ query: { keywords: ['none'] } })
      .where(eq(schema.productSources.source, 'auction'));
    const p = await plan();
    expect(p.changes).toEqual([]);
    expect(p.unread).toEqual({ 'no search words': 1, 'broken raw': 1, 'no title': 1 });
  });

  it('leaves rows without a listing, and sources it does not judge', async () => {
    const [shop, abroad] = await insertSales(
      sale({ name: 'wrong' }, { source: 'shop' }),
      sale({ name: 'wrong' }, { source: 'abroad' }),
    );
    expect(await plan()).toMatchObject({ read: 0, changes: [] });
    await insertSales(sale({ name: 'wrong' }));
    await db.delete(schema.productSources).where(eq(schema.productSources.source, 'flea'));
    expect(await plan()).toMatchObject({ read: 1, changes: [], unread: { 'no listing': 1 } });
    expect((await row(shop!.id)).excluded).toBe(false);
    expect((await row(abroad!.id)).excluded).toBe(false);
  });

  it('holds back low confidence unless asked, and skips a family on request', async () => {
    const [low, wrong] = await insertSales(sale({ name: 'maybe' }), sale({ name: 'wrong' }));
    const p = await plan();
    expect(p.changes.map((c) => c.id)).toEqual([wrong!.id]);
    expect(p.low).toEqual({ 'not named': 1 });
    expect(p.detail.low).toEqual([low!.id]);
    const all = await plan({}, { includeLow: true });
    expect(all.changes.map((c) => c.id).toSorted()).toEqual([low!.id, wrong!.id].toSorted());
    const skipped = await plan({}, { skipFamilies: ['bundle'] });
    expect(skipped.changes).toEqual([]);
    expect(skipped.skippedFamilies).toEqual({ 'flea|bundle': 1 });
  });

  it('counts rows that now pass and rows reading another condition; neither is changed', async () => {
    await insertSales(
      sale({ name: 'fine' }, { excluded: true, excludedReason: 'mismatch' }),
      sale({ name: 'fine', today: 'sealed:no_shrink' }),
    );
    expect(await plan()).toMatchObject({ nowPassing: 1, bucketMoves: 1, changes: [] });
  });

  it('refuses a noAi source outright, and the analysis copy for writes', async () => {
    await expect(plan({ sources: ['abroad'] })).rejects.toThrow('noAi');
    expect(refusedDatabase('file:/home/x/.local/share/tora/analysis/tora.db')).toMatch(/analysis/);
    expect(refusedDatabase('file:/home/x/tora.db')).toBeNull();
  });

  it('limits without a copy date pass only on a real file under $TMPDIR', () => {
    const limits = {
      rulesId: 'r',
      maxChanges: 1,
      minChanges: 1,
      families: {},
      options: { includeLow: false, skipFamilies: [], far: false },
    };
    const tmp = join(dir, 'tmp');
    const out = join(dir, 'out');
    mkdirSync(tmp);
    mkdirSync(out);
    writeFileSync(join(tmp, 'copy.db'), '');
    writeFileSync(join(out, 'real.db'), '');
    symlinkSync(join(out, 'real.db'), join(tmp, 'link.db'));
    expect(unstampedLimits(limits, `file:${join(tmp, 'copy.db')}`, tmp)).toBeNull();
    for (const [url, folder] of [
      [`file:${join(out, 'real.db')}`, tmp],
      // Through a link in $TMPDIR it is still the real one.
      [`file:${join(tmp, 'link.db')}`, tmp],
      ['libsql://example.invalid', tmp],
      [`file:${join(tmp, 'copy.db')}`, ''],
      [`file:${join(tmp, 'copy.db')}`, 'relative'],
      [`file:${tmp}`, tmp],
    ] as const) {
      expect(unstampedLimits(limits, url, folder), url).toContain('no copy date');
    }
    expect(unstampedLimits({ ...limits, copyOf: 'x' }, 'libsql://example.invalid', tmp)).toBeNull();
  });

  it('knows the analysis copy by its real file, under any name or through a link', () => {
    const copy = join(dir, 'copy.db');
    writeFileSync(copy, '');
    const link = join(dir, 'link.db');
    symlinkSync(copy, link);
    expect(refusedDatabase(`file:${copy}`, copy)).toMatch(/analysis/);
    expect(refusedDatabase(`file:${link}`, copy)).toMatch(/analysis/);
    expect(refusedDatabase(`file:${link}`, link)).toMatch(/analysis/);
    expect(refusedDatabase(`file:${join(dir, 'other.db')}`, copy)).toBeNull();
    // Not there yet: compared by name.
    expect(refusedDatabase(`file:${join(dir, 'gone.db')}`, join(dir, 'gone.db'))).toMatch(
      /analysis/,
    );
  });
});

describe('the far check', () => {
  let peers: StoredPeer[][] = [];
  let history: { id?: string; price: number }[] = [];
  const capturing: Partial<SalesRechecker> = {
    far(p, h) {
      peers = p;
      history = h;
      return new Set();
    },
  };

  it('stays out unless asked: a far sale stays kept and the check never runs', async () => {
    const rows = await insertSales(
      sale({ name: 'fine' }),
      sale({ name: 'fine' }),
      sale({ name: 'fine' }),
      sale({ name: 'wrong' }),
      sale({ name: 'fine' }, { priceBase: 99_000 }),
    );
    const rulesAlone = await plan({
      far() {
        throw new Error('must not run');
      },
    });
    expect(rulesAlone.changes.map((c) => c.id)).toEqual([rows[3]!.id]);
    expect(rulesAlone.options.far).toBe(false);
    expect(rulesAlone.farChecked).toEqual({});
    expect(limitsOf(rulesAlone).options.far).toBe(false);
    await applyRecheck(db, rulesAlone, now);
    expect(await row(rows[4]!.id)).toMatchObject({ excluded: false, excludedReason: null });
    // Asked for, it takes up the same sale, and the limits say so.
    const withFar = await plan({}, { far: true });
    expect(withFar.changes.map((c) => c.id)).toEqual([rows[4]!.id]);
    expect(withFar.changes[0]!.reason).toBe('outlier');
    expect(limitsOf(withFar).options.far).toBe(true);
  });

  it('history is the rows that stay kept: the protected and the held back stay, rejected rows leave', async () => {
    const [plain, wrong, low, pasted, outlier, estimated, noBucket] = await insertSales(
      sale({ name: 'fine' }),
      sale({ name: 'wrong' }),
      sale({ name: 'maybe' }),
      sale({ name: 'wrong pasted', reference: true }),
      sale({ name: 'fine' }, { excluded: true, excludedReason: 'outlier' }),
      sale({ name: 'fine' }, { quantityInferred: true }),
      sale({ name: 'fine' }, { bucket: null, source: 'auction' }),
      sale({ name: 'fine' }, { source: 'shop' }),
      sale({ name: 'fine' }, { source: 'abroad', priceBase: 5 }),
      sale({ name: 'fine' }, { excluded: true, excludedReason: 'manual' }),
    );
    await refreshItemSales(db, { full: true, now });
    await plan(capturing, { far: true });
    const ids = history.map((h) => h.id);
    for (const r of [plain, low, pasted, noBucket]) expect(ids).toContain(r!.id);
    for (const r of [wrong, outlier, estimated]) expect(ids).not.toContain(r!.id);
    // The other same-market source through its packed row, never the other market's.
    expect(history.filter((h) => !h.id)).toHaveLength(1);
    // Peers: rows passing today, kept or not, with a condition; a person's exclude is out.
    expect(peers[0]!.map((p) => p.id).toSorted()).toEqual([plain!.id, outlier!.id].toSorted());
    expect(peers[0]!.find((p) => p.id === plain!.id)!.markable).toBe(true);
    expect(peers[0]!.find((p) => p.id === outlier!.id)!.markable).toBe(false);
    expect(peers[1]).toEqual([]);
  });

  it('a protected row can be a peer, never marked; a row reading another condition is no peer', async () => {
    const [pasted, other] = await insertSales(
      sale({ name: 'fine', reference: true }),
      sale({ name: 'fine', today: 'sealed:no_shrink' }),
    );
    await plan(capturing, { far: true });
    expect(peers[0]!.map((p) => [p.id, p.markable])).toEqual([[pasted!.id, false]]);
    expect(history.map((h) => h.id).toSorted()).toEqual([pasted!.id, other!.id].toSorted());
  });

  it('marks what it returns as outliers; a second run finds nothing', async () => {
    const rows = await insertSales(
      sale({ name: 'fine' }),
      sale({ name: 'fine' }),
      sale({ name: 'fine' }),
      sale({ name: 'fine' }, { priceBase: 99_000 }),
    );
    const p = await plan({}, { far: true });
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]).toMatchObject({
      id: rows[3]!.id,
      reason: 'outlier',
      filter: 'price far from the history',
    });
    expect((await applyRecheck(db, p, now))!.end.changed).toBe(1);
    expect((await plan({}, { far: true })).changes).toEqual([]);
    expect(await applyRecheck(db, await plan({}, { far: true }), now)).toBeNull();
  });

  it('leaves a source in another currency unchecked; rules still apply, its rows stay history', async () => {
    await saveSourceInfos(
      db,
      SOURCES.map((s) => (s.key === 'flea' ? { ...s, currency: 'USD' } : s)),
    );
    await insertSales(
      sale({ name: 'fine' }),
      sale({ name: 'wrong' }),
      sale({ name: 'fine' }, { source: 'auction' }),
    );
    const registry = await loadSourceRegistry(db);
    expect(baseCurrency(registry)).toBe('JPY');
    const p = await plan(capturing, { far: true });
    expect(p.farChecked).toEqual({ flea: false, auction: true });
    expect(p.changes.map((c) => c.family)).toEqual(['bundle']);
    expect(history).toHaveLength(2);
    expect(peers).toHaveLength(1);
  });

  it('no market at all: the far check does not run', async () => {
    await saveSourceInfos(
      db,
      SOURCES.map((s) => ({ ...s, market: undefined })),
    );
    await insertSales(sale({ name: 'fine' }, { priceBase: 99_000 }));
    const p = await plan(
      {
        far() {
          throw new Error('must not run');
        },
      },
      { far: true },
    );
    expect(p.farChecked).toEqual({ flea: false, auction: false });
  });
});

describe('a crash partway', () => {
  const many = (n: number) =>
    insertSales(...Array.from({ length: n }, (_, i) => sale({ name: `wrong ${i}` })));

  it('keeps finished batches, continues under the same id, ends like an uninterrupted run', async () => {
    await many(450);
    let id = '';
    await expect(
      applyRecheck(db, await plan(), now, {
        onRun: (run) => (id = run.id),
        onBatch: (done) => {
          if (done === 1) throw new Error('killed');
        },
      }),
    ).rejects.toThrow('killed');
    expect(id).not.toBe('');
    expect((await readRecheckRuns(db)).map((r) => r.status)).toEqual(['running']);
    const remaining = await plan();
    expect(remaining.changes).toHaveLength(250);

    const continued: boolean[] = [];
    const result = await applyRecheck(db, remaining, now, {
      onRun: (run, again) => {
        expect(run.id).toBe(id);
        continued.push(again);
      },
    });
    expect(continued).toEqual([true]);
    expect(result!.end).toMatchObject({ changed: 450, meanwhile: 0 });
    expect((await readRecheckRuns(db)).map((r) => [r.id, r.status])).toEqual([[id, 'done']]);
    expect((await allRows()).every((r) => r.excluded && r.excludedReason === 'mismatch')).toBe(
      true,
    );
    // One undo brings back what each attempt wrote.
    expect(await undoRecheckRun(db, id, { apply: true, now })).toMatchObject({ restored: 450 });
    expect((await allRows()).every((r) => !r.excluded)).toBe(true);
  });

  it('a crash after the last batch finishes on the next run, with nothing left to write', async () => {
    await many(3);
    await expect(
      applyRecheck(db, await plan(), now, {
        onBatch: () => {
          throw new Error('killed');
        },
      }),
    ).rejects.toThrow('killed');
    const again = await plan();
    expect(again.changes).toEqual([]);
    expect((await applyRecheck(db, again, now))!.end.changed).toBe(3);
    expect((await readRecheckRuns(db)).map((r) => r.status)).toEqual(['done']);
  });

  describe('and the break in the value series', () => {
    const on = (days: number) => new Date(now.getTime() + days * 86_400_000);
    const night = (id: string, days: number, fair: number) =>
      db.insert(schema.signals).values({
        productId: id,
        bucket: 'sealed:shrink',
        day: localDate(on(days)),
        stats: { fair } as never,
      });
    const hold = (id: string) =>
      createHolding(
        db,
        uid,
        { productId: id },
        {
          quantity: 1,
          costTotalBase: 1000,
          acquiredAt: now.toISOString(),
          packagingState: 'sealed_shrink',
        },
      );
    const told = async (days: number) =>
      (await sharpDrops(db, uid, {}, on(days))).map((d) => d.key);
    const breaks = () => readSetting<Record<string, string>>(db, VALUE_SERIES_BREAK_KEY);

    it('killed after the last batch, then a night: nothing false is told', async () => {
      await hold(productId);
      await night(productId, -6, 9000);
      await many(3);
      await expect(
        applyRecheck(db, await plan(), now, {
          onBatch: () => {
            throw new Error('killed');
          },
        }),
      ).rejects.toThrow('killed');
      expect((await readRecheckRuns(db))[0]!.status).toBe('running');
      await night(productId, 1, 1000);
      expect(await told(1)).toEqual([]);
    });

    it('killed at batch 5, then a night: a real fall outside the plan is told; a rerun moves the break', async () => {
      const outside = await createProduct(db, uid, {
        category: 'tcg',
        kind: 'booster_box',
        name: 'Outside',
        franchise: 'pokemon',
      });
      await hold(productId);
      await hold(outside.id);
      await many(1001);
      for (const id of [productId, outside.id]) await night(id, -6, 9000);
      await expect(
        applyRecheck(db, await plan(), now, {
          onBatch: (done) => {
            if (done === 5) throw new Error('killed');
          },
        }),
      ).rejects.toThrow('killed');
      // Every item in the plan and no other.
      expect(await breaks()).toEqual({ [productId]: localDate(now) });
      for (const id of [productId, outside.id]) await night(id, 1, 1000);
      expect(await told(1)).toEqual([`${outside.id}|sealed:shrink`]);

      // The night's row is from the middle of the run: the rerun's day takes it out as well.
      await applyRecheck(db, await plan(), on(1));
      expect((await breaks())![productId]).toBe(localDate(on(1)));
      await night(productId, 2, 5000);
      await night(productId, 8, 1000);
      const drop = (await sharpDrops(db, uid, {}, on(8))).find((d) => d.product.id === productId);
      expect(drop?.change).toBeCloseTo(1000 / 5000 - 1);
    });

    it('a run that cannot save the break writes no row; its next attempt goes on', async () => {
      await many(3);
      await db.$client.execute(`create trigger stop_save before insert on app_settings
        when new.key = '${VALUE_SERIES_BREAK_KEY}' begin select raise(abort, 'killed'); end`);
      let id = '';
      await expect(
        applyRecheck(db, await plan(), now, { onRun: (run) => (id = run.id) }),
      ).rejects.toThrow();
      expect(id).not.toBe('');
      expect((await allRows()).some((r) => r.excluded)).toBe(false);
      await db.$client.execute('drop trigger stop_save');
      const result = await applyRecheck(db, await plan(), now);
      expect(result).toMatchObject({ run: { id }, end: { changed: 3 } });
      expect(await readSetting(db, 'alertDrops')).toBeNull();
    });
  });

  it('a row merged since the run keeps the merge date through an undo and is protected next run', async () => {
    const product = (name: string) =>
      createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name, franchise: 'pokemon' });
    const [other, target] = [await product('Other'), await product('Target')];
    for (const p of [other, target]) {
      await db.insert(schema.productSources).values({
        productId: p.id,
        source: 'flea',
        query: { keywords: ['box'] },
      } as never);
    }
    const [merged, plain] = await insertSales(
      sale({ name: 'wrong' }),
      sale({ name: 'wrong' }, { productId: other.id }),
    );
    // Stored a while ago, as real rows are: the trace is a date long after the insert.
    const long = stamp(new Date(now.getTime() - 30 * 86_400_000));
    await db.$client.execute({
      sql: 'update price_observations set created_at = ?, updated_at = ?',
      args: [long, long],
    });
    const id = (await applyRecheck(db, await plan(), now))!.run.id;
    await mergeProducts(db, { id: uid, role: 'admin' }, productId, target.id);
    expect(await undoRecheckRun(db, id, { apply: true, now })).toMatchObject({ restored: 2 });
    const next = await plan();
    expect(next.changes.map((c) => c.id)).toEqual([plain!.id]);
    expect(next.protected).toEqual({ 'touched later': 1 });
    expect(next.detail.protectedRows.map((r) => r.id)).toEqual([merged!.id]);
    expect((await row(plain!.id)).updatedAt).toBe(long);
  });

  it('a row a person changed after it was read is skipped, not overwritten', async () => {
    const [a, b] = await many(2);
    const p = await plan();
    await setObservationExcluded(db, a!.id, true);
    expect((await applyRecheck(db, p, now))!.end).toMatchObject({ changed: 1, meanwhile: 1 });
    expect((await row(a!.id)).excludedReason).toBe('manual');
    expect((await row(b!.id)).excludedReason).toBe('mismatch');
  });
});

describe('the limits', () => {
  const planOf = (over: Partial<RecheckPlan>) =>
    ({
      rulesId: 'r',
      options: { includeLow: false, skipFamilies: [], far: false },
      changes: [],
      families: {},
      ...over,
    }) as unknown as RecheckPlan;
  const changes = (n: number) => Array.from({ length: n }, () => ({})) as RecheckPlan['changes'];

  it('allows the count plus 2 %, down to 90 %, each family up to 125 %', () => {
    const base = planOf({ changes: changes(1000), families: { 'a|x': 800, 'a|y': 200 } });
    const limits = limitsOf(base);
    expect(limits).toEqual({
      rulesId: 'r',
      maxChanges: 1020,
      minChanges: 900,
      families: { 'a|x': 1000, 'a|y': 250 },
      options: { includeLow: false, skipFamilies: [], far: false },
    });
    expect(limitsBroken(base, limits)).toEqual([]);
    expect(limitsBroken({ ...base, changes: changes(1020) }, limits)).toEqual([]);
    expect(limitsBroken({ ...base, changes: changes(1021) }, limits)).toEqual([
      'Would change 1021, limit 1020.',
    ]);
    expect(limitsBroken({ ...base, changes: changes(899) }, limits)).toEqual([
      'Would change 899, at least 900 expected.',
    ]);
    expect(limitsBroken({ ...base, families: { 'a|x': 800, 'a|y': 251 } }, limits)).toEqual([
      'Would change 251 in a|y, limit 250.',
    ]);
    expect(limitsBroken({ ...base, families: { 'a|z': 1 } }, limits)).toEqual([
      'Would change 1 in a|z, which was not rehearsed.',
    ]);
    expect(limitsBroken({ ...base, rulesId: 'other' }, limits)[0]).toMatch(/^Rules differ/);
    expect(
      limitsBroken(
        { ...base, options: { includeLow: true, skipFamilies: [], far: false } },
        limits,
      ),
    ).toEqual(['Options differ from what was rehearsed (--include-low, --skip-reason, --far).']);
    expect(
      limitsBroken(
        { ...base, options: { includeLow: false, skipFamilies: ['x'], far: false } },
        limits,
      ),
    ).toEqual(['Options differ from what was rehearsed (--include-low, --skip-reason, --far).']);
    // Continuing a crash: what it wrote already counts towards both ends.
    expect(limitsBroken({ ...base, changes: changes(300) }, limits, 700)).toEqual([]);
    expect(limitsBroken({ ...base, changes: changes(300) }, limits)).toEqual([
      'Would change 300, at least 900 expected.',
    ]);
    expect(limitsBroken({ ...base, changes: changes(400) }, limits, 700)).toEqual([
      'Would change 1100, limit 1020.',
    ]);
  });

  it('a small plan still has a floor of one row', () => {
    expect(limitsOf(planOf({ changes: changes(1) }))).toMatchObject({
      maxChanges: 2,
      minChanges: 1,
    });
  });

  it("makes one family out of one verdict's variations", () => {
    expect(verdictFamily('bundle (2枚)')).toBe('bundle');
    expect(verdictFamily('excluded word "x"')).toBe('excluded word');
    expect(verdictFamily('not this item')).toBe('not this item');
    expect(verdictFamily("price far from the item's recent sales")).toBe(
      "price far from the item's recent sales",
    );
  });
});

const tsxEntry = () =>
  pathToFileURL(resolve(__dirname, '../../../node_modules/tsx/dist/esm/index.mjs')).href;

describe('the locks', () => {
  /** The schedule's collect, as `flock` holds it. */
  const holdWithFlock = (file: string): Promise<ChildProcess> =>
    new Promise((res) => {
      const child = spawn('flock', ['-n', file, 'sh', '-c', 'echo ok; exec cat'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      child.stdout.once('data', () => res(child));
    });
  const ended = (child: ChildProcess) =>
    new Promise<void>((res) => {
      child.once('close', () => res());
      child.stdin!.end();
    });
  /** A state folder collects have used. */
  const paths = () => {
    const state = join(dir, 'state');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'collect.log'), '');
    return { state, locks: join(state, 'locks') };
  };

  it('refuses a state folder that is not absolute, or where no collect ever logged, taking nothing', async () => {
    const unused = join(dir, 'unused');
    const locks = join(unused, 'locks');
    mkdirSync(unused);
    expect(await holdRecheckLocks(db, ['flea'], { state: 'relative/state', locks })).toEqual({
      refused: 'The state folder is not an absolute path.',
    });
    expect(await holdRecheckLocks(db, ['flea'], { state: unused, locks })).toEqual({
      refused: 'The state folder holds no collect.log: it is not the one collects use.',
    });
    expect(existsSync(join(unused, 'collect.lock'))).toBe(false);
    expect(existsSync(locks)).toBe(false);
  });

  it('refuses a collect log over 3 days old, naming a server that has been off, taking nothing', async () => {
    const { state, locks } = paths();
    const log = join(state, 'collect.log');
    const aged = (days: number) => {
      const at = new Date(Date.now() - days * 86_400_000);
      utimesSync(log, at, at);
    };
    aged(4);
    const old = await holdRecheckLocks(db, ['flea'], { state, locks });
    expect(old).toEqual({ refused: expect.stringContaining('4 days old') });
    expect(old).toEqual({ refused: expect.stringContaining('a server that has been off') });
    // It says what to do, for an undo on such a server too.
    expect(old).toEqual({ refused: expect.stringContaining('run scripts/collect-cron.sh') });
    expect(existsSync(join(state, 'collect.lock'))).toBe(false);
    expect(existsSync(locks)).toBe(false);
    aged(2);
    const fresh = await holdRecheckLocks(db, ['flea'], { state, locks });
    if ('refused' in fresh) throw new Error(fresh.refused);
    fresh.release();
  });

  it('reads an empty XDG_STATE_HOME as unset, as the schedule does', () => {
    const saved = { state: process.env.TORA_STATE_DIR, xdg: process.env.XDG_STATE_HOME };
    delete process.env.TORA_STATE_DIR;
    process.env.XDG_STATE_HOME = '';
    expect(isAbsolute(stateDir())).toBe(true);
    process.env.XDG_STATE_HOME = '/somewhere';
    expect(stateDir()).toBe('/somewhere/tora');
    if (saved.state === undefined) delete process.env.TORA_STATE_DIR;
    else process.env.TORA_STATE_DIR = saved.state;
    if (saved.xdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved.xdg;
  });

  it('refuses while a collect holds its lock, a per-market one too, and takes it once free', async () => {
    const { state } = paths();
    mkdirSync(state, { recursive: true });
    for (const file of ['collect.lock', 'collect-market-us.lock']) {
      writeFileSync(join(state, file), '');
      const collect = await holdWithFlock(join(state, file));
      expect(await holdCollectLocks(state)).toEqual({ refused: `A collect holds ${file}.` });
      await ended(collect);
    }
    const held = await holdCollectLocks(state);
    expect('release' in held).toBe(true);
    // While we hold them, a collect's own `flock -n` fails: it skips and the schedule retries.
    const check = spawn('flock', ['-n', join(state, 'collect.lock'), 'true']);
    expect(await new Promise((res) => check.once('close', res))).toBe(1);
    if ('release' in held) held.release();
  });

  it('holds the lock file even before any collect ran', async () => {
    const held = await holdCollectLocks(join(dir, 'new-state'));
    expect('release' in held).toBe(true);
    if ('release' in held) held.release();
  });

  it(
    'lets go when its process dies, so a crash cannot block the next run',
    { timeout: 30_000 },
    async () => {
      const { state } = paths();
      const file = join(dir, 'hold.mts');
      writeFileSync(
        file,
        `import { holdCollectLocks } from ${JSON.stringify(pathToFileURL(resolve(__dirname, 'lock.ts')).href)};
       await holdCollectLocks(${JSON.stringify(state)}); console.log('held'); setInterval(() => {}, 1000);`,
      );
      const child = spawn(process.execPath, ['--import', tsxEntry(), file], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      await new Promise<void>((res) => child.stdout!.once('data', () => res()));
      expect(await holdCollectLocks(state)).toEqual({ refused: 'A collect holds collect.lock.' });
      child.kill('SIGKILL');
      await new Promise((res) => child.once('close', res));
      // The holder sees the pipe close a moment later.
      let again = await holdCollectLocks(state);
      for (let i = 0; i < 50 && 'refused' in again; i++) {
        await new Promise((res) => setTimeout(res, 100));
        again = await holdCollectLocks(state);
      }
      expect('release' in again).toBe(true);
      if ('release' in again) again.release();
    },
  );

  it('refuses while a site is being collected, and gives back what it took', async () => {
    const { state, locks } = paths();
    const site = lockSource('auction', locks, process.ppid);
    expect(await holdRecheckLocks(db, ['flea', 'auction'], { state, locks })).toEqual({
      refused: `auction is being collected (process ${process.ppid}).`,
    });
    const flea = lockSource('flea', locks, process.ppid);
    expect('release' in flea).toBe(true);
    if ('release' in flea) flea.release();
    if ('release' in site) site.release();
    let again = await holdCollectLocks(state);
    for (let i = 0; i < 50 && 'refused' in again; i++) {
      await new Promise((res) => setTimeout(res, 100));
      again = await holdCollectLocks(state);
    }
    expect('release' in again).toBe(true);
    if ('release' in again) again.release();
  });

  it('a run marked running: refused while its site lock is held, told as interrupted when free', async () => {
    const { state, locks } = paths();
    await startRun(db, 'shop');
    const site = lockSource('shop', locks, process.ppid);
    expect(await holdRecheckLocks(db, ['flea'], { state, locks })).toEqual({
      refused: `shop is being collected (process ${process.ppid}).`,
    });
    if ('release' in site) site.release();
    let held = await holdRecheckLocks(db, ['flea'], { state, locks });
    for (let i = 0; i < 50 && 'refused' in held; i++) {
      await new Promise((res) => setTimeout(res, 100));
      held = await holdRecheckLocks(db, ['flea'], { state, locks });
    }
    expect(held).toMatchObject({ interrupted: ['shop'] });
    if ('release' in held) held.release();
  });

  it('its own lock keeps a second re-check out', async () => {
    const { state, locks } = paths();
    const other = lockSource('recheck-sales', locks, process.ppid);
    expect(await holdRecheckLocks(db, ['flea'], { state, locks })).toEqual({
      refused: `recheck-sales is being collected (process ${process.ppid}).`,
    });
    if ('release' in other) other.release();
  });
});

describe('the command', () => {
  const cli = resolve(__dirname, 'cli/recheck-sales.ts');
  /** Runs it in a folder standing in for a repo; by default its plug-ins cannot even load. */
  async function run(
    args: string[],
    plugin = `throw new Error('broken plug-in');`,
    env: Record<string, string> = {},
  ) {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'collectors', 'src'), { recursive: true });
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(repo, 'collectors', 'src', 'index.ts'), plugin);
    mkdirSync(join(dir, 'state'), { recursive: true });
    writeFileSync(join(dir, 'state', 'collect.log'), '');
    return promisify(execFile)(process.execPath, ['--import', tsxEntry(), cli, ...args], {
      cwd: repo,
      env: {
        ...process.env,
        DATABASE_URL: `file:${join(dir, 'test.db')}`,
        TORA_STATE_DIR: join(dir, 'state'),
        TMPDIR: dir,
        ...env,
      },
    });
  }
  /** A plug-in rejecting every row. */
  const rejecting = `export const collectors = [];
    export const recheckers = [{
      sources: ['flea'], rulesId: () => 'rules-1', farDetail: 'far',
      assess: (_s, _p, _l, sales) => sales.map((s) => ({ id: s.id, ok: false, bucket: s.bucket, detail: 'x' })),
      far: () => new Set(),
    }];`;
  const goodLimits = {
    rulesId: 'rules-1',
    maxChanges: 5,
    minChanges: 1,
    families: { 'flea|x': 5 },
    options: { includeLow: false, skipFamilies: [], far: false },
  };

  it(
    'undo works with broken plug-ins, and without --apply writes nothing',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      const id = (await applyRecheck(db, await plan(), now))!.run.id;
      expect((await run(['--undo', id])).stdout).toContain('Would restore 1');
      expect((await row(a!.id)).excluded).toBe(true);
      expect((await run(['--undo', id, '--apply'])).stdout).toContain(
        'Restored 1, already back 0, changed by a person 0 (left alone), gone 0.',
      );
      expect((await row(a!.id)).excluded).toBe(false);
      // An unknown id lists the runs there are: a lost terminal is no lost undo.
      await expect(run(['--undo', 'nope'])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`Known runs: ${id} (`),
      });
    },
  );

  it(
    '--apply is refused without limits, before plug-ins load or anything is written',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      await expect(run(['--apply'])).rejects.toMatchObject({
        stderr: expect.stringContaining('--apply needs --limits'),
      });
      expect((await row(a!.id)).excluded).toBe(false);
    },
  );

  it(
    'a dry run prints counts and writes nothing; limits it wrote let the run through, once',
    { timeout: 60_000 },
    async () => {
      const plugin = `export const collectors = [];
        export const recheckers = [{
          sources: ['flea'],
          rulesId: () => 'rules-1',
          farDetail: 'far',
          assess: (_s, _p, _l, sales) => sales.map((s) => ({
            id: s.id, ok: false, bucket: s.bucket, detail: 'excluded word "' + s.raw.name + '"',
          })),
          far: () => new Set(),
        }];`;
      const [a] = await insertSales(sale({ name: 'TITLE-OF-A-SALE' }));
      const dump = join(dir, 'dump.json');
      const limits = join(dir, 'limits.json');
      const dry = await run(['--dump', dump, '--write-limits', limits], plugin);
      expect(dry.stdout).toContain('Changes: 1');
      expect(dry.stdout).toContain('flea  excluded word: 1');
      expect(dry.stdout).toContain('Dry run: nothing written.');
      // Titles stay out of what is printed; the private file has the verdict.
      expect(dry.stdout + dry.stderr).not.toContain('TITLE-OF-A-SALE');
      expect(readFileSync(dump, 'utf8')).toContain('TITLE-OF-A-SALE');
      expect((await row(a!.id)).excluded).toBe(false);

      const applied = await run(['--apply', '--limits', limits], plugin);
      expect(applied.stdout).toMatch(/^Run \S+$/m);
      expect(applied.stdout).toContain('1 rows changed, 0 changed meanwhile.');
      expect(applied.stdout).toContain('recheck-sales --undo');
      expect((await row(a!.id)).excludedReason).toBe('mismatch');
      // Nothing left to change is under the floor: a stray repeat says so and writes nothing.
      await expect(run(['--apply', '--limits', limits], plugin)).rejects.toMatchObject({
        stderr: expect.stringContaining('Would change 0'),
      });
    },
  );

  it('a limit trips with nothing written', { timeout: 60_000 }, async () => {
    const plugin = `export const collectors = [];
      export const recheckers = [{
        sources: ['flea'], rulesId: () => 'rules-1', farDetail: 'far',
        assess: (_s, _p, _l, sales) => sales.map((s) => ({ id: s.id, ok: false, bucket: null, detail: 'x' })),
        far: () => new Set(),
      }];`;
    const [a] = await insertSales(sale({ name: 'a' }));
    const limits = join(dir, 'limits.json');
    writeFileSync(
      limits,
      JSON.stringify({
        rulesId: 'other',
        maxChanges: 1,
        minChanges: 1,
        families: {},
        options: { includeLow: false, skipFamilies: [], far: false },
      }),
    );
    await expect(run(['--apply', '--limits', limits], plugin)).rejects.toMatchObject({
      stderr: expect.stringContaining('Rules differ'),
    });
    expect((await row(a!.id)).excluded).toBe(false);
    expect(await readRecheckRuns(db)).toEqual([]);
  });

  it(
    'a limits file that is not what it should be is refused, never read as no limit',
    { timeout: 120_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'a' }));
      const { rulesId, maxChanges, minChanges, families, options } = goodLimits;
      const shapes: Record<string, string> = {
        nothing: 'null',
        'a list': '[]',
        'no rules id': JSON.stringify({ maxChanges, minChanges, families, options }),
        'rules id not text': JSON.stringify({ ...goodLimits, rulesId: 1 }),
        'no counts': JSON.stringify({ rulesId, families, options }),
        'counts as text': JSON.stringify({ ...goodLimits, maxChanges: 'many', minChanges: 'few' }),
        'a count too big to read': `{"rulesId":"rules-1","maxChanges":1e999,"minChanges":1,"families":{},"options":{"far":false,"includeLow":false,"skipFamilies":[]}}`,
        'a count not whole': JSON.stringify({ ...goodLimits, maxChanges: 1.5 }),
        'a count of nothing': JSON.stringify({ ...goodLimits, minChanges: 0 }),
        'least over most': JSON.stringify({ ...goodLimits, minChanges: 6 }),
        'no families': JSON.stringify({ rulesId, maxChanges, minChanges, options }),
        'a family as text': JSON.stringify({ ...goodLimits, families: { 'flea|x': 'x' } }),
        'a null family': JSON.stringify({ ...goodLimits, families: { 'flea|x': null } }),
        'no options': JSON.stringify({ rulesId, maxChanges, minChanges, families }),
        'a copy date it cannot read': JSON.stringify({ ...goodLimits, copyOf: 'last week' }),
        'a copy date not text': JSON.stringify({ ...goodLimits, copyOf: 1 }),
        'options of the wrong kind': JSON.stringify({
          ...goodLimits,
          options: { includeLow: 'no' },
        }),
      };
      expect('limits' in checkedLimits(goodLimits)).toBe(true);
      await Promise.all(
        Object.entries(shapes).map(async ([what, text], i) => {
          expect('invalid' in checkedLimits(JSON.parse(text)), what).toBe(true);
          const file = join(dir, `limits-${i}.json`);
          writeFileSync(file, text);
          await expect(run(['--apply', '--limits', file], rejecting), what).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining('Limits file refused'),
          });
        }),
      );
      expect((await row(a!.id)).excluded).toBe(false);
      expect(await readRecheckRuns(db)).toEqual([]);
    },
  );

  it('a run with other options than the rehearsal is refused', { timeout: 60_000 }, async () => {
    const [a] = await insertSales(sale({ name: 'a' }));
    const limits = join(dir, 'limits.json');
    await run(['--write-limits', limits], rejecting);
    for (const extra of [['--include-low'], ['--skip-reason', 'y'], ['--far']]) {
      await expect(run(['--apply', '--limits', limits, ...extra], rejecting)).rejects.toMatchObject(
        {
          stderr: expect.stringContaining('Options differ'),
        },
      );
    }
    const skipping = join(dir, 'skipping.json');
    await run(['--write-limits', skipping, '--skip-reason', 'y'], rejecting);
    await expect(run(['--apply', '--limits', skipping], rejecting)).rejects.toMatchObject({
      stderr: expect.stringContaining('Options differ'),
    });
    const withFar = join(dir, 'with-far.json');
    await run(['--write-limits', withFar, '--far'], rejecting);
    expect(JSON.parse(readFileSync(withFar, 'utf8')).options.far).toBe(true);
    await expect(run(['--apply', '--limits', withFar], rejecting)).rejects.toMatchObject({
      stderr: expect.stringContaining('Options differ'),
    });
    // A file that does not say whether the far check was on is no file at all.
    const silent = join(dir, 'silent.json');
    const { far: _far, ...others } = JSON.parse(readFileSync(limits, 'utf8')).options;
    writeFileSync(
      silent,
      JSON.stringify({ ...JSON.parse(readFileSync(limits, 'utf8')), options: others }),
    );
    await expect(run(['--apply', '--limits', silent], rejecting)).rejects.toMatchObject({
      stderr: expect.stringContaining('what options'),
    });
    expect((await row(a!.id)).excluded).toBe(false);
    expect(await readRecheckRuns(db)).toEqual([]);
  });

  it(
    'refuses --apply and undo in a wrong state folder, with nothing written',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      const limits = join(dir, 'limits.json');
      await run(['--write-limits', limits], rejecting);
      const empty = join(dir, 'empty-state');
      mkdirSync(empty);
      const wrong = [
        ['relative/state', 'not an absolute path'],
        [empty, 'holds no collect.log'],
      ] as const;
      for (const [folder, why] of wrong) {
        await expect(
          run(['--apply', '--limits', limits], rejecting, { TORA_STATE_DIR: folder }),
        ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(why) });
        expect((await row(a!.id)).excluded).toBe(false);
        expect(await readRecheckRuns(db)).toEqual([]);
      }
      const id = (await applyRecheck(db, await plan(), now))!.run.id;
      const marked = await row(a!.id);
      expect(marked.excluded).toBe(true);
      for (const [folder, why] of wrong) {
        await expect(
          run(['--undo', id, '--apply'], undefined, { TORA_STATE_DIR: folder }),
        ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(why) });
        expect(await row(a!.id)).toEqual(marked);
      }
      // Only writing needs it: a dry undo still tells.
      expect((await run(['--undo', id], undefined, { TORA_STATE_DIR: empty })).stdout).toContain(
        'Would restore 1',
      );
    },
  );

  it(
    'prints no database path, and refuses a link to the analysis copy',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'a' }));
      const dry = await run([], rejecting);
      expect(dry.stdout).toContain('Database: local file');
      expect(dry.stdout + dry.stderr).not.toContain(dir);

      const copy = join(dir, 'copy.db');
      writeFileSync(copy, '');
      const link = join(dir, 'link.db');
      symlinkSync(copy, link);
      const limits = join(dir, 'limits.json');
      writeFileSync(limits, JSON.stringify(goodLimits));
      const refused = await run(['--apply', '--limits', limits], rejecting, {
        DATABASE_URL: `file:${link}`,
        TORA_ANALYSIS_DB: copy,
      }).catch((e: { code: number; stdout: string; stderr: string }) => e);
      expect(refused).toMatchObject({ code: 1, stderr: expect.stringContaining('analysis copy') });
      expect(refused.stdout + refused.stderr).not.toContain(dir);
      expect(readFileSync(copy, 'utf8')).toBe('');
      expect((await row(a!.id)).excluded).toBe(false);
    },
  );

  it(
    'refuses a --now later than the clock, or one it cannot read',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      const later = new Date(Date.now() + 3_600_000).toISOString();
      for (const [at, why] of [
        [later, 'later than the clock'],
        ['nope', 'cannot be read'],
      ] as const) {
        await expect(run(['--now', at], rejecting)).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(why),
        });
      }
      expect((await row(a!.id)).excluded).toBe(false);
      expect((await run(['--now', now.toISOString()], rejecting)).stdout).toContain('Changes: 1');
    },
  );

  it(
    'refuses limits without a copy date outside $TMPDIR; a stamped file passes',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      const limits = join(dir, 'limits.json');
      writeFileSync(limits, JSON.stringify(goodLimits));
      const elsewhere = { TMPDIR: join(dir, 'elsewhere') };
      await expect(
        run(['--apply', '--limits', limits], rejecting, elsewhere),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('no copy date') });
      expect((await row(a!.id)).excluded).toBe(false);
      expect(await readRecheckRuns(db)).toEqual([]);

      writeFileSync(limits, JSON.stringify({ ...goodLimits, copyOf: now.toISOString() }));
      const applied = await run(['--apply', '--limits', limits], rejecting, elsewhere);
      expect(applied.stdout).toContain('1 rows changed');
    },
  );

  it(
    'a stale collect log stops --apply and undo, with nothing written',
    { timeout: 60_000 },
    async () => {
      const [a] = await insertSales(sale({ name: 'wrong' }));
      const limits = join(dir, 'limits.json');
      await run(['--write-limits', limits], rejecting);
      const old = join(dir, 'old-state');
      mkdirSync(old);
      writeFileSync(join(old, 'collect.log'), '');
      const at = new Date(Date.now() - 4 * 86_400_000);
      utimesSync(join(old, 'collect.log'), at, at);
      const why = expect.stringContaining('a server that has been off');
      await expect(
        run(['--apply', '--limits', limits], rejecting, { TORA_STATE_DIR: old }),
      ).rejects.toMatchObject({ code: 1, stderr: why });
      expect((await row(a!.id)).excluded).toBe(false);
      const id = (await applyRecheck(db, await plan(), now))!.run.id;
      await expect(
        run(['--undo', id, '--apply'], undefined, { TORA_STATE_DIR: old }),
      ).rejects.toMatchObject({ code: 1, stderr: why });
      expect((await row(a!.id)).excluded).toBe(true);
    },
  );

  it('undo waits for a collect, with nothing written', { timeout: 60_000 }, async () => {
    const [a] = await insertSales(sale({ name: 'wrong' }));
    const id = (await applyRecheck(db, await plan(), now))!.run.id;
    const state = join(dir, 'state');
    mkdirSync(state, { recursive: true });
    const lock = join(state, 'collect.lock');
    writeFileSync(lock, '');
    const collect = spawn('flock', ['-n', lock, 'sh', '-c', 'echo ok; exec cat'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    await new Promise<void>((res) => collect.stdout.once('data', () => res()));
    await expect(run(['--undo', id, '--apply'])).rejects.toMatchObject({
      stderr: expect.stringContaining('A collect holds collect.lock.'),
    });
    expect((await row(a!.id)).excluded).toBe(true);
    collect.stdin.end();
  });
});
