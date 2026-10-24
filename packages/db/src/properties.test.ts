// Rules that must always hold, tried on random chains of lot changes (requirements S15).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONDITIONS, GRADERS, toLocalIso } from '@tora/core';
import { eq, inArray } from 'drizzle-orm';
import fc from 'fast-check';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { refreshItemSales } from './item-sales';
import { migrateDb } from './migrate';
import {
  DomainError,
  changeCondition,
  createHolding,
  createProduct,
  returnGrading,
  sellHolding,
  splitOff,
  submitGrading,
} from './mutations';
import { type PackedGroup, holdings, itemSales, priceObservations } from './schema';
import { insertObservations, setObservationExcluded } from './sources';
import { createUser } from './users';

let db: Db;
let dir: string;
let people = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tora-properties-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const AT = '2026-10-01T12:00:00.000+09:00';

/** One change to the lot at `pick` (among the person's lots), with its numbers. */
const step = fc.oneof(
  fc.record({
    kind: fc.constant('split'),
    pick: fc.nat(),
    quantity: fc.integer({ min: 1, max: 12 }),
  }),
  fc.record({
    kind: fc.constant('sell'),
    pick: fc.nat(),
    quantity: fc.integer({ min: 1, max: 12 }),
    price: fc.integer({ min: 0, max: 1_000_000 }),
    fees: fc.integer({ min: 0, max: 50_000 }),
  }),
  fc.record({
    kind: fc.constant('grade'),
    pick: fc.nat(),
    quantity: fc.integer({ min: 1, max: 12 }),
    fee: fc.integer({ min: 0, max: 20_000 }),
    extra: fc.integer({ min: 0, max: 5_000 }),
  }),
  fc.record({
    kind: fc.constant('condition'),
    pick: fc.nat(),
    quantity: fc.integer({ min: 1, max: 12 }),
    condition: fc.constantFrom(...CONDITIONS),
  }),
);

it(
  'keeps every unit and yen through splits, sales, grading and condition changes',
  { timeout: 120_000 },
  async () => {
    // Changes that went through, per kind: the rule means little if most were refused.
    const done: Record<string, number> = {};
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(step, { maxLength: 12 }),
        async (quantity, cost, steps) => {
          const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
          const uid = (await createUser(db, `p${people++}`, creds)).user.id;
          await createHolding(
            db,
            uid,
            { product: { category: 'tcg', kind: 'single', name: 'Card', franchise: 'pokemon' } },
            { quantity, costTotalBase: cost, acquiredAt: AT },
          );
          let added = 0;
          for (const s of steps) {
            const lots = (await db.select().from(holdings).where(eq(holdings.userId, uid))).sort(
              (a, b) => a.id.localeCompare(b.id),
            );
            const lot = lots[s.pick % lots.length]!;
            try {
              if (s.kind === 'split') await splitOff(db, uid, lot.id, s.quantity, AT);
              if (s.kind === 'sell') {
                await sellHolding(db, uid, lot.id, {
                  quantity: s.quantity,
                  priceBase: s.price,
                  feesBase: s.fees,
                  occurredAt: AT,
                });
              }
              if (s.kind === 'grade') {
                const sent = await submitGrading(db, uid, lot.id, {
                  quantity: s.quantity,
                  grader: GRADERS[0],
                  feeBase: s.fee,
                  occurredAt: AT,
                });
                added += s.fee;
                await returnGrading(db, uid, sent.id, {
                  grader: GRADERS[0],
                  grade: '10',
                  extraFeeBase: s.extra,
                  occurredAt: AT,
                });
                added += s.extra;
              }
              if (s.kind === 'condition') {
                await changeCondition(db, uid, lot.id, {
                  quantity: s.quantity,
                  condition: s.condition,
                  occurredAt: AT,
                });
              }
              done[s.kind] = (done[s.kind] ?? 0) + 1;
            } catch (e) {
              // Refused changes (more units than the lot has, a sold lot) change nothing.
              if (!(e instanceof DomainError || e instanceof RangeError)) throw e;
            }
            const after = await db.select().from(holdings).where(eq(holdings.userId, uid));
            expect(after.reduce((n, h) => n + h.quantity, 0)).toBe(quantity);
            expect(after.reduce((n, h) => n + h.costTotalBase, 0)).toBe(cost + added);
            expect(after.every((h) => h.quantity > 0 && h.costTotalBase >= 0)).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
    for (const kind of ['split', 'sell', 'grade', 'condition']) {
      expect(done[kind] ?? 0).toBeGreaterThan(0);
    }
  },
);

/** A change to the collected sales: new ones, one excluded or let back in, or a refresh. */
const salesStep = fc.oneof(
  fc.record({
    kind: fc.constant('add'),
    sales: fc.array(
      fc.record({
        item: fc.nat(2),
        daysAgo: fc.integer({ min: 0, max: 400 }),
        price: fc.integer({ min: 1, max: 1_000_000 }),
        bucket: fc.constantFrom('sealed:shrink', 'sealed:no_shrink'),
        source: fc.constantFrom('snkrdunk', 'mercari'),
        type: fc.constantFrom('sold', 'listing'),
      }),
      { minLength: 1, maxLength: 8 },
    ),
  }),
  fc.record({ kind: fc.constant('exclude'), pick: fc.nat(), excluded: fc.boolean() }),
  fc.record({ kind: fc.constant('refresh') }),
);

it('keeps the saved sales the same as a full rebuild', { timeout: 120_000 }, async () => {
  const now = new Date('2026-10-25T12:00:00Z');
  let ref = 0;
  await fc.assert(
    fc.asyncProperty(fc.array(salesStep, { maxLength: 10 }), async (steps) => {
      // A database of its own: a full rebuild covers every item.
      const sdb = createDb({ url: `file:${join(dir, `sales-${people++}.db`)}` });
      await migrateDb(sdb);
      const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
      const uid = (await createUser(sdb, `s${people++}`, creds, 'admin')).user.id;
      const items: string[] = [];
      for (let i = 0; i < 3; i++) {
        const box = {
          category: 'tcg',
          kind: 'booster_box',
          name: `Box ${i}`,
          franchise: 'pokemon',
        };
        items.push((await createProduct(sdb, uid, box as never)).id);
      }
      for (const s of steps) {
        if (s.kind === 'add') {
          await insertObservations(
            sdb,
            s.sales.map((x) => {
              const at = new Date(now.getTime() - x.daysAgo * 86_400_000);
              return {
                productId: items[x.item]!,
                source: x.source,
                observationType: x.type,
                bucket: x.bucket,
                priceBase: x.price,
                currency: 'JPY',
                observedAt: toLocalIso(at),
                fetchedAt: toLocalIso(now),
                externalRef: `p${ref++}`,
              };
            }),
          );
        }
        if (s.kind === 'exclude') {
          const rows = await sdb
            .select({ id: priceObservations.id })
            .from(priceObservations)
            .where(inArray(priceObservations.productId, items));
          const row = rows.sort((a, b) => a.id.localeCompare(b.id))[s.pick % (rows.length || 1)];
          if (row) await setObservationExcluded(sdb, row.id, s.excluded);
        }
        if (s.kind === 'refresh') await refreshItemSales(sdb, { now });
      }
      await refreshItemSales(sdb, { now });
      // As data, groups in one order: a rebuild lists them by source, an update by arrival.
      const key = (g: PackedGroup) => `${g.s}|${g.b}|${g.c}|${g.t}`;
      const saved = async () =>
        (await sdb.select().from(itemSales).where(inArray(itemSales.productId, items)))
          .map((r) => ({
            id: r.productId,
            sales: {
              ...r.sales,
              groups: r.sales.groups.toSorted((a, b) => key(a).localeCompare(key(b))),
            },
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
      const stepByStep = await saved();
      await refreshItemSales(sdb, { full: true, now });
      const full = await saved();
      sdb.$client.close();
      expect(stepByStep).toEqual(full);
    }),
    { numRuns: 30 },
  );
});
