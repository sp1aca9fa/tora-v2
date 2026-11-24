// Stored levels of game wishes and the settings around them (S36 Terms "Level", "Record", C1; plan
// W14). The math is in @tora/core `wish-level.ts`; the nightly step that fills `wish_levels` is in
// @tora/collector-sdk `wish-levels.ts`.
import {
  type AddedCostSample,
  type LevelDay,
  type WishRecord,
  sampleIncludes,
  toLocalIso,
} from '@tora/core';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import { type DayRange, coveredOf } from './sale-coverage';
import { saleCoverage, saleSpans, wishLevels } from './schema';

const IDS_PER_READ = 500;

/** Setting: each source's shipping sample (S36 C1), by source key. */
export const ADDED_COST_SAMPLED_KEY = 'addedCostSampled';
/** Setting: whether a wish shows its record (W14: off until the owner answers the measurement). */
export const WISH_RECORD_SHOWN_KEY = 'wishRecordShown';

/** Every recorded shipping sample, by source (none recorded: empty). */
export async function addedCostSamples(
  db: Pick<Db, 'select'>,
): Promise<Record<string, AddedCostSample>> {
  return (await readSetting<Record<string, AddedCostSample>>(db, ADDED_COST_SAMPLED_KEY)) ?? {};
}

/**
 * Stores a source's shipping sample (S36 C1; the owner's command `shipping-sample.ts --record`).
 * Counts that cannot be right are refused. Returns whether the sample turns "included" on (100 or
 * more, 95 % or more: `sampleIncludes`); a smaller sample is kept, and changes nothing.
 */
export async function recordAddedCostSample(
  db: Db,
  source: string,
  sample: Omit<AddedCostSample, 'at'> & { at?: string },
): Promise<boolean> {
  const { counted, included } = sample;
  if (!source || !Number.isInteger(counted) || !Number.isInteger(included))
    throw new Error('a sample is whole counts');
  if (counted <= 0 || included < 0 || included > counted)
    throw new Error('a sample counts at least one sale, and no more included than counted');
  const row: AddedCostSample = { ...sample, at: sample.at ?? toLocalIso() };
  await saveSetting(db, ADDED_COST_SAMPLED_KEY, { ...(await addedCostSamples(db)), [source]: row });
  return sampleIncludes(row);
}

/** Whether a wish shows its record (setting `wishRecordShown`; unset: off). */
export async function wishRecordShown(db: Pick<Db, 'select'>): Promise<boolean> {
  return (await readSetting<boolean>(db, WISH_RECORD_SHOWN_KEY)) === true;
}

export async function setWishRecordShown(db: Db, on: boolean): Promise<void> {
  await saveSetting(db, WISH_RECORD_SHOWN_KEY, on);
}

/** One item and bucket's stored levels. */
export interface WishLevel {
  productId: string;
  bucket: string;
  series: LevelDay[];
  record: WishRecord | null;
  bornOn: string | null;
  inputsHash: string;
  computedAt: string;
}

const key = (productId: string, bucket: string) => `${productId}|${bucket}`;

/**
 * The stored levels of many items and buckets at once (S19: batched by item), by `id|bucket`. An
 * item and bucket with no row has no level (its wish is not confirmed or its rules are not applied).
 */
export async function wishLevelsOf(
  db: Pick<Db, 'select'>,
  wanted: readonly { productId: string; bucket: string }[],
): Promise<Map<string, WishLevel>> {
  const out = new Map<string, WishLevel>();
  const want = new Set(wanted.map((w) => key(w.productId, w.bucket)));
  const ids = [...new Set(wanted.map((w) => w.productId))];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const rows = await db
      .select()
      .from(wishLevels)
      .where(inArray(wishLevels.productId, ids.slice(i, i + IDS_PER_READ)));
    for (const r of rows)
      if (want.has(key(r.productId, r.bucket)))
        out.set(key(r.productId, r.bucket), { ...r, record: r.record ?? null });
  }
  return out;
}

/** Every stored row's key and inputs hash (the nightly step compares them; hashes only). */
export async function wishLevelHashes(db: Pick<Db, 'select'>): Promise<Map<string, string>> {
  const rows = await db
    .select({
      productId: wishLevels.productId,
      bucket: wishLevels.bucket,
      inputsHash: wishLevels.inputsHash,
    })
    .from(wishLevels);
  return new Map(rows.map((r) => [key(r.productId, r.bucket), r.inputsHash]));
}

/** Writes one item and bucket's levels (replacing its row: levels are rebuilt, never edited). */
export async function saveWishLevel(db: Pick<Db, 'insert'>, level: WishLevel): Promise<void> {
  const { productId: _id, bucket: _bucket, ...rest } = level;
  await db
    .insert(wishLevels)
    .values(level)
    .onConflictDoUpdate({ target: [wishLevels.productId, wishLevels.bucket], set: rest });
}

/** Removes the rows of these items and buckets (a wish no longer confirmed, or gone). */
export async function dropWishLevels(
  db: Pick<Db, 'delete'>,
  keys: readonly { productId: string; bucket: string }[],
): Promise<number> {
  let n = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    const gone = await db
      .delete(wishLevels)
      .where(
        or(
          ...part.map((k) =>
            and(eq(wishLevels.productId, k.productId), eq(wishLevels.bucket, k.bucket)),
          ),
        ),
      )
      .returning({ productId: wishLevels.productId });
    n += gone.length;
  }
  return n;
}

/**
 * The covered days of many items (S36 Terms "Covered day"), by item then source, in two batched
 * reads per 500 items (S19). Read only through `coveredOf`: a night dated D covers D-1, spans as they
 * are, joined.
 */
export async function coverageOf(
  db: Pick<Db, 'select'>,
  productIds: readonly string[],
): Promise<Map<string, Map<string, DayRange[]>>> {
  const nights = new Map<string, DayRange[]>();
  const spans = new Map<string, DayRange[]>();
  const add = (to: Map<string, DayRange[]>, productId: string, source: string, r: DayRange[]) =>
    to.set(key(productId, source), [...(to.get(key(productId, source)) ?? []), ...r]);
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const part = ids.slice(i, i + IDS_PER_READ);
    for (const r of await db
      .select({
        productId: saleCoverage.productId,
        source: saleCoverage.source,
        nights: saleCoverage.nights,
      })
      .from(saleCoverage)
      .where(inArray(saleCoverage.productId, part)))
      add(nights, r.productId, r.source, r.nights ?? []);
    for (const r of await db
      .select({
        productId: saleSpans.productId,
        source: saleSpans.source,
        from: saleSpans.fromDay,
        to: saleSpans.toDay,
      })
      .from(saleSpans)
      .where(inArray(saleSpans.productId, part)))
      add(spans, r.productId, r.source, [[r.from, r.to]]);
  }
  const out = new Map<string, Map<string, DayRange[]>>();
  for (const k of new Set([...nights.keys(), ...spans.keys()])) {
    const at = k.indexOf('|');
    const productId = k.slice(0, at);
    const item = out.get(productId) ?? new Map<string, DayRange[]>();
    item.set(k.slice(at + 1), coveredOf(nights.get(k) ?? [], spans.get(k) ?? []));
    out.set(productId, item);
  }
  return out;
}
