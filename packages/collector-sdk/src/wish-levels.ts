// The collect's closing step for game wishes' levels (S36 Terms "Level", "Record", "Covered day",
// "Clean sale", "As paid", "Young game"; C1; plan W14). The math is pure (@tora/core
// `wish-level.ts`); this reads each confirmed game wish's inputs, hashes them, and rebuilds the row
// of `wish_levels` only when the hash changed (a night with no change writes nothing).
import {
  type EffectiveRules,
  type LevelSale,
  type PaidRule,
  asPaid,
  baseCurrency,
  bornOn,
  costKnown,
  effectiveRules,
  levelSeries,
  localDate,
  marketSourceKeys,
  recordOf,
  rowShipping,
  salesRule,
  toLocalIso,
} from '@tora/core';
import {
  type Db,
  type WishInfo,
  addedCostSamples,
  coverageOf,
  dropWishLevels,
  gameRulesOn,
  listConsoles,
  loadSourceRegistry,
  ruleStates,
  saveWishLevel,
  schema,
  wishLevelHashes,
  wishSalesMany,
  wishStates,
} from '@tora/db';
import { inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { appliedRulesHash, judgedSources } from './game-rules';
import { rulesApplied } from './item-check';
import type { Collector } from './types';

/** Bumped when the level's rules change, so every row is rebuilt once. */
// 2: a night dated D covers D-1 (`coveredOf`); a day names only the sources counted and stores the
// ones left out; a sampled source is read per row (fix round 1, items 1, 2, 5).
const LEVEL_VERSION = 2;

export interface WishLevelsResult {
  written: number;
  unchanged: number;
  removed: number;
}

const keyOf = (productId: string, bucket: string) => `${productId}|${bucket}`;

/**
 * Rebuilds the levels of every game wish whose sales are confirmed (`wishState`) and whose item's
 * rules are applied to its stored sales (the Game rules switch on, the item not held, today's hash
 * applied at every judged source: `rulesApplied`, the gate of the labeled check), in the wish's
 * bucket. Any other row is removed: a wish "check needed", a card or sealed item, a wish gone. Sales
 * are read through `wishSales` (a boxed item's are its plain item's rows that pass its rules).
 */
export async function refreshWishLevels(
  db: Db,
  collectors: readonly Collector[],
  options: { now?: Date } = {},
): Promise<WishLevelsResult> {
  const result: WishLevelsResult = { written: 0, unchanged: 0, removed: 0 };
  const stored = await wishLevelHashes(db);
  const wanted = await db
    .selectDistinct({ productId: schema.watches.productId, bucket: schema.watches.bucket })
    .from(schema.watches);
  if (!wanted.length && !stored.size) return result;

  // Every read below is batched by item list (S19): a fixed number of reads a night, not per wish.
  const items = await itemsOf(db, [...new Set(wanted.map((w) => w.productId))]);
  const states = await wishStates(db, items);
  // A wish with no condition (bucket '') has no level and no reason stored: a level needs a
  // condition (Terms "Condition"; fix round 1, item 8). Its row, if any, is removed below.
  const confirmed = wanted.filter(
    (w) => w.bucket !== '' && states.get(w.productId)?.state === 'confirmed',
  );
  const keep = new Set<string>();

  if (confirmed.length) {
    const judged = await judgedSources(db, collectors);
    const gate = {
      on: await gameRulesOn(db),
      states: await ruleStates(db),
      judged: new Set(judged.keys()),
    };
    const registry = await loadSourceRegistry(db);
    const base = baseCurrency(registry);
    // Terms "Level": "from every source of the home market whose sales' added cost is known": the
    // home market's judged sources (only their sales are checked against the item's rules).
    const home = new Set(marketSourceKeys(registry));
    const candidates = [...judged.keys()].filter((s) => home.has(s)).toSorted();
    const samples = await addedCostSamples(db);
    const rules = new Map<string, PaidRule>(
      candidates.map((s) => [
        s,
        salesRule(collectors.find((c) => c.source === s)?.addedCost, samples[s]),
      ]),
    );
    const costUnknown = candidates.filter((s) => !costKnown(rules.get(s)!));
    const current = await rulesOf(db, items, states, [
      ...new Set(confirmed.map((w) => w.productId)),
    ]);

    // A boxed item's rows are its plain item's, judged under the plain item's rules (S36 B1).
    const applied = confirmed.filter((w) => {
      const c = current.get(w.productId);
      return !!c && rulesApplied(gate, c.from, c.plain ?? c.rules, judged.keys());
    });
    for (const w of applied) keep.add(keyOf(w.productId, w.bucket));
    const ids = [...new Set(applied.map((w) => w.productId))];
    const coverage = await coverageOf(db, [...new Set(ids.map((id) => current.get(id)!.from))]);
    const salesOf = await wishSalesMany(
      db,
      ids.map((id) => {
        const c = current.get(id)!;
        return { productId: id, from: c.from, boxedRules: c.from === id ? null : c.rules };
      }),
      { withRaw: true },
    );
    const release = new Map(items.map((p) => [p.id, p.releaseDate]));

    for (const wish of applied) {
      const { from, rules: own, plain } = current.get(wish.productId)!;
      const judgedRules = plain ?? own;
      // Terms "Clean sale": "a kept sale (not excluded) of one unit that passes the item's rules and
      // the re-check of S30" (both mark the row excluded); a row whose units were not reported is not
      // known to be one unit. Only judged sources' sales are checked against the rules.
      const clean = (salesOf.get(wish.productId) ?? [])
        .filter((s) => !s.excluded && !s.quantityInferred && judged.has(s.source))
        .map((s) => {
          const seen = new Date(s.observedAt);
          return { ...s, day: Number.isNaN(seen.getTime()) ? null : localDate(seen) };
        })
        .filter((s): s is typeof s & { day: string } => s.day !== null);
      const sales: (LevelSale & { id: string })[] = clean
        .filter((s) => rules.has(s.source))
        .map((s) => ({
          id: s.id,
          day: s.day,
          source: s.source,
          bucket: s.bucket ?? '',
          paid: asPaid(
            { price: s.priceBase, ...rowShipping(s.raw, s.currency, base) },
            rules.get(s.source)!,
          ).amount,
        }));
      const firstSale = clean.map((s) => s.day).toSorted()[0] ?? null;
      const born = bornOn(release.get(wish.productId), firstSale);
      // Terms "Covered day", through `coveredOf` (`coverageOf`): a night dated D covers D-1.
      const covered = new Map(
        candidates.map((s) => [s, coverage.get(from)?.get(s) ?? []] as const),
      );

      const inBucket = sales
        .filter((s) => s.bucket === wish.bucket)
        .map((s) => [s.id, s.day, s.source, s.paid] as const)
        .toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            v: LEVEL_VERSION,
            bucket: wish.bucket,
            rules: appliedRulesHash(judgedRules, judged.keys()),
            paid: candidates.map((s) => [s, rules.get(s), samples[s] ?? null]),
            covered: [...covered],
            born,
            latest: clean.reduce((m, s) => (s.updatedAt > m ? s.updatedAt : m), ''),
            sales: inBucket,
          }),
        )
        .digest('hex');
      if (stored.get(keyOf(wish.productId, wish.bucket)) === hash) {
        result.unchanged++;
        continue;
      }

      // The days a level is worked out for: from the first covered day to the last (no later day's
      // window can be whole) of the home market's judged sources.
      const days = [...covered.values()].flat();
      const first = days.map((r) => r[0]).toSorted()[0];
      const last = days
        .map((r) => r[1])
        .toSorted()
        .at(-1);
      const series =
        first && last
          ? levelSeries(first, last, sales, covered, {
              sources: candidates,
              costUnknown,
              bucket: wish.bucket,
            })
          : [];
      await saveWishLevel(db, {
        productId: wish.productId,
        bucket: wish.bucket,
        series,
        record: recordOf(series, born),
        bornOn: born,
        inputsHash: hash,
        computedAt: toLocalIso(options.now ?? new Date()),
      });
      result.written++;
    }
  }

  const gone = [...stored.keys()]
    .filter((k) => !keep.has(k))
    .map((k) => {
      const at = k.indexOf('|');
      return { productId: k.slice(0, at), bucket: k.slice(at + 1) };
    });
  if (gone.length) result.removed = await dropWishLevels(db, gone);
  return result;
}

/** The items' fields the level reads, in reads of 500 (S19). */
async function itemsOf(db: Db, ids: readonly string[]) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500)
    out.push(
      ...(await db
        .select({
          id: schema.products.id,
          category: schema.products.category,
          kind: schema.products.kind,
          platform: schema.products.platform,
          region: schema.products.region,
          releaseDate: schema.products.releaseDate,
        })
        .from(schema.products)
        .where(inArray(schema.products.id, ids.slice(i, i + 500)))),
    );
  return out;
}

/**
 * Each wished item's rules today, as `currentRules` gives them, for many items in one pass (S19: one
 * console table read, the boxed items' plain items read together): its effective rules, a boxed
 * item's plain item's (null: not boxed, or its plain item is gone) and the item whose rows are read.
 * An item that no longer exists is left out.
 */
async function rulesOf(
  db: Db,
  items: Awaited<ReturnType<typeof itemsOf>>,
  states: ReadonlyMap<string, WishInfo>,
  ids: readonly string[],
): Promise<Map<string, { rules: EffectiveRules; plain: EffectiveRules | null; from: string }>> {
  const byId = new Map(items.map((p) => [p.id, p]));
  const boxedOf = (id: string) => {
    const own = states.get(id)?.rules;
    return own?.boxed && own.boxedOf ? own.boxedOf : null;
  };
  const plainIds = [...new Set(ids.flatMap((id) => boxedOf(id) ?? []))];
  const plainItems = plainIds.length ? await itemsOf(db, plainIds) : [];
  const plainStates = plainItems.length
    ? await wishStates(db, plainItems)
    : new Map<string, WishInfo>();
  const plains = new Map(plainItems.map((p) => [p.id, p]));
  const consoles = await listConsoles(db);
  const out = new Map<
    string,
    { rules: EffectiveRules; plain: EffectiveRules | null; from: string }
  >();
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const box = boxedOf(id);
    const plainItem = box ? plains.get(box) : undefined;
    out.set(id, {
      rules: effectiveRules(item, states.get(id)?.rules ?? null, consoles),
      plain: plainItem
        ? effectiveRules(plainItem, plainStates.get(plainItem.id)?.rules ?? null, consoles)
        : null,
      from: box ?? id,
    });
  }
  return out;
}
