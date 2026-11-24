// The labeled checks of a game item (requirements S36 Terms "Confirmed", "Checked listing"; steps A1
// and A2; plan W7 and section 9 B). `sample` writes what a person (or an agent on the analysis copy)
// labels: for sales the 20 cheapest clean sales of the last 12 months and the 20 nearest their median
// (all conditions; the two sets may overlap, and with fewer than 20 both are all of them); for
// listings, per source, the 20 cheapest distinct listings stored over the nights read, once that
// source was read on 7 or more nights. `record` reads the labels back: per (item, kind, source) one
// `item_checks` row by the check. A judged block (passed or failed) also excludes every entry labeled
// "not the item" (a sale by the manual exclusion, the raw row kept; a listing by a "not the item"
// mark); a block not judged writes only its row, nothing excluded or marked, so a relabel never has
// anything to undo.
//
// A label file is never trusted for what it holds: `record` rebuilds the sample from the database as
// of the file's `sampledAt` (the sampled database's newest write, `databaseClock`) and refuses an item
// whose entries differ (removed, added or made up).
// Sales are sampled and recorded only once the item's game rules are applied to them
// (`rulesApplied`), and a sample judged once is never recorded again with other labels (one recorded
// as not judged may be, once its labels are complete). After a
// failed check, a pass under the same rules does not confirm: only an admin does (`failureStands`).
//
// Rules of the outcome (S36 A1): a set passes when 18 or more of its 20 are the item; a set of fewer
// than 20 needs 90 % rounded up; fewer than 10, or any entry not labeled, is not judged. Sales pass
// when both sets pass; a set that failed fails the check; otherwise it is not judged.
//
// Only game items are sampled or recorded (S36 Scope rule); sources whose data may not reach an AI
// model (`noAi`) are never sampled, since the labels are made by agents. A label file is data: its
// titles and links are never opened or followed, and nothing here prints a title.
import {
  type EffectiveRules,
  type ItemCheckKind,
  type ItemCheckOutcome,
  type SourceRegistry,
  CHECK_SAMPLE_SIZE,
  baseCurrency,
  cheapestOf,
  isGameItem,
  localDate,
  nearestMedianOf,
  noAiSources,
  rulesHash,
} from '@tora/core';
import {
  type Db,
  type RuleState,
  RULE_MARK_PREFIX,
  addCheckMarks,
  clearBucketValues,
  currentRules,
  dismissedExclusions,
  failureStands,
  gameRulesOn,
  getItemRules,
  isHeld,
  loadSourceRegistry,
  notItemKey,
  notItemRefs,
  recordItemCheck,
  refreshItemSales,
  ruleStates,
  schema,
  searchOffers,
} from '@tora/db';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { failsRules, marksNewSales } from './game-rules';
import { protectedBy } from './recheck';

/** What the file says it is. */
export const CHECK_FILE_KIND = 'tora-item-check';
export const CHECK_FILE_VERSION = 1;
/** Entries per set (S36 A1, A2). */
export const SAMPLE_SIZE = CHECK_SAMPLE_SIZE;
/** Of `SAMPLE_SIZE`, how many must be the item. */
export const SAMPLE_PASS = 18;
/** Fewer read than this: the set is not judged. */
export const SAMPLE_MIN = 10;
/** Nights a source must have been read with its listings stored before they are checked ("to start"). */
export const LISTING_NIGHTS_MIN = 7;
/** How far back a sale counts (S36 A1: "of the last 12 months"). */
export const SALES_DAYS = 365;

export type CheckSet = 'cheap' | 'median';
const SETS_OF: Record<ItemCheckKind, readonly CheckSet[]> = {
  sales: ['cheap', 'median'],
  listings: ['cheap'],
};

/** One sale or listing to label. */
export interface CheckEntry {
  source: string;
  /** The sale's or listing's id at the source (`external_ref`, `SupplyOffer.ref`). */
  ref: string;
  title: string;
  /** Per unit, in `currency` (the base currency). */
  price: number;
  currency: string;
  /** The sale's day, or the last night the listing was stored. */
  day: string;
  url: string | null;
  /** The sets it was sampled in. */
  sets: CheckSet[];
  /** The label: true when it is the item, false when not; null until labeled. */
  item: boolean | null;
}

/** One (item, kind, source) of the file: sales have the source ''. */
export interface CheckBlock {
  kind: ItemCheckKind;
  source: string;
  /** The rules hash it was sampled under (`checkHash`); `record` refuses on a difference. */
  hash: string;
  /** Listings: the nights read with listings stored. */
  nights?: number;
  /** Listings: read on fewer than `LISTING_NIGHTS_MIN` nights, so nothing sampled. */
  tooFewNights?: boolean;
  entries: CheckEntry[];
}

export interface CheckItem {
  productId: string;
  name: string;
  checks: CheckBlock[];
}

/** An item named for sampling and left out, with why (never labeled, never recorded). */
export interface CheckSkip {
  productId: string;
  name: string;
  why: string;
}

export interface CheckFile {
  kind: typeof CHECK_FILE_KIND;
  version: typeof CHECK_FILE_VERSION;
  check: ItemCheckKind;
  /** The sample's id: a file recorded twice writes nothing new. */
  sample: string;
  sampledAt: string;
  items: CheckItem[];
  /** Named and not sampled (sales whose rules are not applied yet); read back as nothing. */
  skipped?: CheckSkip[];
}

// ---------------------------------------------------------------------------------------------
// Judging (pure)

/**
 * How many of `read` labeled entries must be the item (S36 A1): 18 of 20; under 20, 90 % rounded up
 * (19 read: 18); null under 10 (not judged).
 */
export function neededOf(read: number): number | null {
  if (read < SAMPLE_MIN) return null;
  if (read >= SAMPLE_SIZE) return SAMPLE_PASS;
  return Math.ceil((read * 9) / 10);
}

export interface SetJudgment {
  read: number;
  item: number;
  unlabeled: number;
  needed: number | null;
  outcome: Exclude<ItemCheckOutcome, 'confirmed'>;
}

/** One set's outcome: any unlabeled entry, or too few read, leaves it not judged. */
export function judgeSet(entries: readonly Pick<CheckEntry, 'item'>[]): SetJudgment {
  const read = entries.length;
  const item = entries.filter((e) => e.item === true).length;
  const unlabeled = entries.filter((e) => e.item === null).length;
  const needed = neededOf(read);
  const outcome =
    unlabeled > 0 || needed === null ? 'not_judged' : item >= needed ? 'passed' : 'failed';
  return { read, item, unlabeled, needed, outcome };
}

/** A block's outcome over its sets: a failed set fails it; all passed passes it; else not judged. */
export function judgeBlock(block: Pick<CheckBlock, 'kind' | 'entries'>): {
  outcome: SetJudgment['outcome'];
  sets: Partial<Record<CheckSet, SetJudgment>>;
} {
  const sets: Partial<Record<CheckSet, SetJudgment>> = {};
  for (const name of SETS_OF[block.kind])
    sets[name] = judgeSet(block.entries.filter((e) => e.sets.includes(name)));
  const all = Object.values(sets);
  const outcome = all.some((s) => s.outcome === 'failed')
    ? 'failed'
    : all.every((s) => s.outcome === 'passed')
      ? 'passed'
      : 'not_judged';
  return { outcome, sets };
}

/** The labels of a block as one digest: the same labels recorded twice are one check. */
export function labelsDigest(entries: readonly Pick<CheckEntry, 'source' | 'ref' | 'item'>[]) {
  const lines = entries.map((e) => `${e.source}\t${e.ref}\t${e.item}`).toSorted();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------------------------
// Sampling

/** The sampling of the labeled check, shared with the registration check (`@tora/core`). */
export { cheapestOf, nearestMedianOf };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sources a sample may read: one the registry knows (an unknown one is unknown: not sampled, for
 * sales and listings alike), never a noAi one; sales only the home market's (S36 Assumed).
 */
function sampleSources(registry: SourceRegistry, kind: ItemCheckKind): (source: string) => boolean {
  const noAi = new Set(noAiSources(registry));
  const primary = registry.markets?.primary;
  const known = new Map(registry.sources.map((s) => [s.key, s]));
  return (source) => {
    const info = known.get(source);
    if (!info || noAi.has(source)) return false;
    if (kind === 'listings') return true;
    return !primary || info.market === primary;
  };
}

interface GameRow {
  id: string;
  name: string;
}

export interface SampleTarget {
  /** Explicit ids, or every item someone wishes. */
  ids: string[] | 'wished';
}

/** Items to sample: games only. `refused`: the items that are not games, by name. */
export async function sampleItems(
  db: Pick<Db, 'select'>,
  target: SampleTarget,
): Promise<{ games: GameRow[]; refused: string[]; unknown: string[] }> {
  const ids =
    target.ids === 'wished'
      ? [
          ...new Set(
            (await db.select({ id: schema.watches.productId }).from(schema.watches)).map(
              (r) => r.id,
            ),
          ),
        ]
      : [...new Set(target.ids)];
  const rows = ids.length
    ? await db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          category: schema.products.category,
          kind: schema.products.kind,
        })
        .from(schema.products)
        .where(inArray(schema.products.id, ids))
        .orderBy(asc(schema.products.name))
    : [];
  const found = new Set(rows.map((r) => r.id));
  const games: GameRow[] = [];
  const refused: string[] = [];
  for (const r of rows) {
    if (isGameItem(r, await getItemRules(db, r.id))) games.push({ id: r.id, name: r.name });
    else refused.push(`${r.name} (${r.id})`);
  }
  return { games, refused, unknown: ids.filter((id) => !found.has(id)) };
}

/** What sampling sales waits for: the "Game rules" switch, the items' rule states, the judged sources. */
export interface SalesGate {
  on: boolean;
  states: ReadonlyMap<string, RuleState>;
  /** The sources whose sales the rules judge (`judgedSources`: a plug-in with `saleText`). */
  judged: ReadonlySet<string>;
}

/**
 * Whether the item's rules are applied to its stored sales at `sources` (S36 A1; plan 9 A): the
 * switch on, the item not held, and at every judged source among them its stored sales judged under
 * today's rules (`marksNewSales`, as the collect reads it). Until then a sample holds sales the rules
 * will mark, and its failure would stand under the same hash once they are applied.
 */
export function rulesApplied(
  gate: SalesGate,
  productId: string,
  rules: EffectiveRules,
  sources: Iterable<string>,
): boolean {
  if (!gate.on) return false;
  const state = gate.states.get(productId) ?? null;
  if (isHeld(state?.held)) return false;
  for (const source of sources)
    if (gate.judged.has(source) && !marksNewSales(state, source, rulesHash(rules, source)))
      return false;
  return true;
}

/** Why an item's sales are not sampled or recorded yet. */
export const NOT_APPLIED = 'rules not applied yet';

interface SampleContext {
  kind: ItemCheckKind;
  allowed: (source: string) => boolean;
  currency: string;
  /** Sales only. */
  gate: SalesGate | null;
}

export interface SampleOptions {
  now?: Date;
  registry?: SourceRegistry;
  /** The judged sources (`judgedSources` over the plug-ins); read for sales only. */
  judged: ReadonlySet<string>;
}

async function sampleContext(
  db: Pick<Db, 'select'>,
  kind: ItemCheckKind,
  options: Pick<SampleOptions, 'registry' | 'judged'>,
): Promise<SampleContext> {
  const reg = options.registry ?? (await loadSourceRegistry(db));
  return {
    kind,
    allowed: sampleSources(reg, kind),
    currency: baseCurrency(reg),
    gate:
      kind === 'sales'
        ? { on: await gameRulesOn(db), states: await ruleStates(db), judged: options.judged }
        : null,
  };
}

type Rules = NonNullable<Awaited<ReturnType<typeof currentRules>>>;

/**
 * A game's sales block as of `at`: clean sales of the 12 months before it (kept, at the home market's
 * sources, stored by then). `keep`: sales this sample's earlier recording excluded, read as kept, so
 * the same file rebuilds the same sample. Null when the rules are not applied (`rulesApplied`).
 */
async function salesBlock(
  db: Pick<Db, 'select'>,
  productId: string,
  current: Rules,
  ctx: SampleContext,
  at: Date,
  keep: ReadonlySet<string>,
): Promise<CheckBlock | null> {
  const o = schema.priceObservations;
  const until = at.getTime();
  const since = until - SALES_DAYS * 86_400_000;
  const kept = keep.size
    ? or(eq(o.excluded, false), inArray(o.id, [...keep]))
    : eq(o.excluded, false);
  const rows = (
    await db
      .select({
        source: o.source,
        ref: o.externalRef,
        title: o.title,
        url: o.url,
        price: o.priceBase,
        observedAt: o.observedAt,
        createdAt: o.createdAt,
      })
      .from(o)
      .where(and(eq(o.productId, productId), eq(o.observationType, 'sold'), kept))
  ).filter((r) => {
    const seen = Date.parse(r.observedAt);
    // A date that cannot be read is not "of the last 12 months"; a sale stored after `at` was not
    // there to sample.
    return (
      ctx.allowed(r.source) &&
      Number.isFinite(seen) &&
      seen >= since &&
      seen <= until &&
      Date.parse(r.createdAt) <= until
    );
  });
  const sources = new Set(rows.map((r) => r.source));
  if (!rulesApplied(ctx.gate!, productId, current.rules, sources)) return null;
  const cheap = cheapestOf(rows);
  const near = nearestMedianOf(rows);
  const sets = new Map<string, CheckSet[]>();
  for (const [name, list] of [
    ['cheap', cheap],
    ['median', near],
  ] as const)
    for (const r of list) {
      const key = `${r.source}|${r.ref}`;
      sets.set(key, [...(sets.get(key) ?? []), name]);
    }
  const entries = cheapestOf(
    rows.filter((r) => sets.has(`${r.source}|${r.ref}`)),
    SAMPLE_SIZE * 2,
  ).map((r): CheckEntry => ({
    source: r.source,
    ref: r.ref,
    title: r.title ?? '',
    price: r.price,
    currency: ctx.currency,
    day: localDate(new Date(r.observedAt)),
    url: r.url,
    sets: sets.get(`${r.source}|${r.ref}`)!,
    item: null,
  }));
  return { kind: 'sales', source: '', hash: current.hashFor('sales', ''), entries };
}

/**
 * A game's listings blocks as of `at`, one per source with stored listings: the distinct listings (by
 * ref, each once, as last stored) over every night whose row was written by then (`supply.updated_at`,
 * the write time; `fetched_at` is the collect's start, earlier than rows it writes later), that pass
 * today's rules and were not marked "not the item" by then; the 20 cheapest. The nights: the days
 * the source's search listings for the item were stored, each counted only when they were written by
 * `at` (S36 A2 "stored over 7 or more nights"; not `sale_coverage`, which a search save drops while
 * the listings stay: fix round 2, item 4). A mark
 * made after `at` (this sample's own recording, or a person's click while it was labeled) leaves the
 * rebuilt sample as it was.
 */
async function listingsBlocks(
  db: Pick<Db, 'select'>,
  productId: string,
  current: Rules,
  ctx: SampleContext,
  at: Date,
): Promise<CheckBlock[]> {
  const until = at.getTime();
  const lastDay = localDate(at);
  const rows = (
    await db
      .select({
        source: schema.supply.source,
        day: schema.supply.day,
        updatedAt: schema.supply.updatedAt,
        offers: schema.supply.offers,
      })
      .from(schema.supply)
      .where(and(eq(schema.supply.productId, productId), isNotNull(schema.supply.offers)))
      .orderBy(asc(schema.supply.day))
  ).filter(
    // The shop's own copy and outside seller (S36 A6) are not search listings: never sampled.
    (r) => r.day <= lastDay && Date.parse(r.updatedAt) <= until && searchOffers(r) !== null,
  );
  const marks = new Set(
    (
      await db
        .select({
          source: schema.notItemMarks.source,
          ref: schema.notItemMarks.externalRef,
          at: schema.notItemMarks.at,
        })
        .from(schema.notItemMarks)
        .where(eq(schema.notItemMarks.productId, productId))
    )
      .filter((m) => Date.parse(m.at) <= until)
      .map((m) => `${m.source}|${m.ref}`),
  );
  type Seen = { entry: CheckEntry; category: string | null };
  const bySource = new Map<string, { listings: Map<string, Seen> }>();
  for (const r of rows) {
    if (!ctx.allowed(r.source)) continue;
    const seen = bySource.get(r.source) ?? { listings: new Map<string, Seen>() };
    bySource.set(r.source, seen);
    for (const offer of searchOffers(r) ?? []) {
      if (marks.has(`${r.source}|${offer.ref}`)) continue;
      // Rows are read oldest first: a listing seen again keeps its latest title, price and night.
      seen.listings.set(offer.ref, {
        category: offer.category,
        entry: {
          source: r.source,
          ref: offer.ref,
          title: offer.title,
          price: offer.priceBase,
          currency: ctx.currency,
          day: r.day,
          url: offer.url,
          sets: ['cheap'],
          item: null,
        },
      });
    }
  }
  const out: CheckBlock[] = [];
  for (const [source, { listings }] of [...bySource].toSorted(([a], [b]) => cmp(a, b))) {
    // Nights as of `at` too: a day counts only when the source's listings of that day were written
    // by `at` (`rows` holds only those).
    const nights = new Set(rows.filter((r) => r.source === source).map((r) => r.day)).size;
    const hash = current.hashFor('listings', source);
    if (nights < LISTING_NIGHTS_MIN) {
      out.push({ kind: 'listings', source, hash, nights, tooFewNights: true, entries: [] });
      continue;
    }
    // Stored under earlier rules, judged by today's (as tonight's read would).
    const passing = [...listings.values()]
      .filter(
        ({ entry, category }) =>
          !failsRules({ title: entry.title, category }, current.rules, source),
      )
      .map((s) => s.entry);
    out.push({ kind: 'listings', source, hash, nights, entries: cheapestOf(passing) });
  }
  return out;
}

/** One game's sample as of `at` (null: sales whose rules are not applied yet). */
async function itemSample(
  db: Pick<Db, 'select'>,
  productId: string,
  current: Rules,
  ctx: SampleContext,
  at: Date,
  keep: ReadonlySet<string> = new Set(),
): Promise<CheckBlock[] | null> {
  if (ctx.kind === 'listings') return listingsBlocks(db, productId, current, ctx, at);
  const block = await salesBlock(db, productId, current, ctx, at, keep);
  return block && [block];
}

/**
 * The instant a sample is "as of": the newest write the database holds (a sale stored or touched, a
 * night's listings written, a "not the item" mark), never later than `now`; `now` when it holds none.
 * Never the wall clock: a sample taken on a copy hours or days behind the server rebuilds the same on
 * the server, where the rows written since have later times (stored times sort as text, `toLocalIso`).
 * A sale's update counts too, so a sample taken after a recording excluded sales is a new sample.
 */
export async function databaseClock(db: Pick<Db, 'select'>, now = new Date()): Promise<Date> {
  const o = schema.priceObservations;
  const [sales] = await db
    .select({
      created: sql<string | null>`max(${o.createdAt})`,
      updated: sql<string | null>`max(${o.updatedAt})`,
    })
    .from(o);
  const [nights] = await db
    .select({ at: sql<string | null>`max(${schema.supply.updatedAt})` })
    .from(schema.supply);
  const [marks] = await db
    .select({ at: sql<string | null>`max(${schema.notItemMarks.at})` })
    .from(schema.notItemMarks);
  const times = [sales?.created, sales?.updated, nights?.at, marks?.at]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter(Number.isFinite);
  if (!times.length) return now;
  return new Date(Math.min(Math.max(...times), now.getTime()));
}

/**
 * The sample file for `games` (read only; no network), as of `databaseClock`. Items not sampled are
 * named in `skipped`.
 */
export async function buildSample(
  db: Pick<Db, 'select'>,
  kind: ItemCheckKind,
  games: readonly GameRow[],
  options: SampleOptions,
): Promise<CheckFile> {
  const now = await databaseClock(db, options.now ?? new Date());
  const ctx = await sampleContext(db, kind, options);
  const items: CheckItem[] = [];
  const skipped: CheckSkip[] = [];
  for (const g of games) {
    const current = await currentRules(db, g.id);
    if (!current) continue;
    const checks = await itemSample(db, g.id, current, ctx, now);
    if (checks) items.push({ productId: g.id, name: g.name, checks });
    else skipped.push({ productId: g.id, name: g.name, why: NOT_APPLIED });
  }
  return {
    kind: CHECK_FILE_KIND,
    version: CHECK_FILE_VERSION,
    check: kind,
    sample: randomUUID(),
    sampledAt: now.toISOString(),
    items,
    skipped,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading a label file back

const isText = (v: unknown): v is string => typeof v === 'string';

/** A label file read as data; anything of another shape refuses the whole file, naming where. */
export function parseCheckFile(
  value: unknown,
  now = new Date(),
): { file: CheckFile } | { invalid: string } {
  const bad = (where: string) => ({ invalid: where });
  if (!value || typeof value !== 'object') return bad('not an object');
  const f = value as Record<string, unknown>;
  if (f.kind !== CHECK_FILE_KIND || f.version !== CHECK_FILE_VERSION)
    return bad('not an item check file of this version');
  if (f.check !== 'sales' && f.check !== 'listings') return bad('check');
  if (!isText(f.sample) || !f.sample || !isText(f.sampledAt)) return bad('sample');
  // The sample is rebuilt as of this time: one that cannot be read, or is later than now, is refused.
  const sampledAt = Date.parse(f.sampledAt);
  if (!Number.isFinite(sampledAt) || sampledAt > now.getTime()) return bad('sampledAt');
  if (!Array.isArray(f.items)) return bad('items');
  const kind = f.check;
  const items: CheckItem[] = [];
  const seenItems = new Set<string>();
  for (const [i, raw] of f.items.entries()) {
    const it = raw as Record<string, unknown> | null;
    if (!it || !isText(it.productId) || !it.productId || !Array.isArray(it.checks))
      return bad(`items[${i}]`);
    if (seenItems.has(it.productId)) return bad(`items[${i}]: an item twice`);
    seenItems.add(it.productId);
    const checks: CheckBlock[] = [];
    const seenBlocks = new Set<string>();
    for (const [j, rawBlock] of it.checks.entries()) {
      const where = `items[${i}].checks[${j}]`;
      const b = rawBlock as Record<string, unknown> | null;
      if (!b || b.kind !== kind || !isText(b.source) || !isText(b.hash) || !b.hash)
        return bad(where);
      if (kind === 'sales' ? b.source !== '' : !b.source) return bad(`${where}.source`);
      if (seenBlocks.has(b.source)) return bad(`${where}: a source twice`);
      seenBlocks.add(b.source);
      if (!Array.isArray(b.entries)) return bad(`${where}.entries`);
      const entries: CheckEntry[] = [];
      const seen = new Set<string>();
      for (const [k, rawEntry] of b.entries.entries()) {
        const at = `${where}.entries[${k}]`;
        const e = rawEntry as Record<string, unknown> | null;
        if (!e || !isText(e.source) || !e.source || !isText(e.ref) || !e.ref) return bad(at);
        if (kind === 'listings' && e.source !== b.source) return bad(`${at}.source`);
        const item = e.item === undefined ? null : e.item;
        if (item !== null && item !== true && item !== false) return bad(`${at}.item`);
        const sets = Array.isArray(e.sets) ? e.sets : [];
        if (!sets.length || sets.some((s) => !SETS_OF[kind].includes(s as CheckSet)))
          return bad(`${at}.sets`);
        const key = `${e.source}|${e.ref}`;
        // Distinct sales and listings: each is counted once.
        if (seen.has(key)) return bad(`${at}: listed twice`);
        seen.add(key);
        entries.push({
          source: e.source,
          ref: e.ref,
          title: isText(e.title) ? e.title : '',
          price: typeof e.price === 'number' ? e.price : NaN,
          currency: isText(e.currency) ? e.currency : '',
          day: isText(e.day) ? e.day : '',
          url: isText(e.url) ? e.url : null,
          sets: [...new Set(sets as CheckSet[])],
          item,
        });
      }
      checks.push({
        kind,
        source: b.source,
        hash: b.hash,
        ...(typeof b.nights === 'number' && { nights: b.nights }),
        ...(b.tooFewNights === true && { tooFewNights: true }),
        entries,
      });
    }
    items.push({ productId: it.productId, name: isText(it.name) ? it.name : '', checks });
  }
  return {
    file: {
      kind: CHECK_FILE_KIND,
      version: CHECK_FILE_VERSION,
      check: kind,
      sample: f.sample,
      sampledAt: f.sampledAt,
      items,
    },
  };
}

/** What recording one block does. Refs are `source ref`, never a title. */
export interface BlockPlan {
  kind: ItemCheckKind;
  source: string;
  hash: string;
  /** Read on too few nights: nothing recorded. */
  tooFewNights?: number;
  outcome: SetJudgment['outcome'];
  sets: Partial<Record<CheckSet, SetJudgment>>;
  /** This sample with these labels is recorded already: no second row. */
  recorded: boolean;
  /**
   * A failed check stands under these rules (`failureStands`): this pass is recorded and does not
   * confirm; only an admin can (S36 Terms "Confirmed").
   */
  failureStands: boolean;
  /** The counts the row carries. */
  counts: Record<string, unknown>;
  /** Sales to exclude by hand (observation ids); none when not judged. */
  exclude: { id: string; source: string; ref: string }[];
  /** Listings to mark "not the item"; none when not judged. */
  mark: string[];
  /** Listings recorded already: their marks are left as they are (one taken back stays back). */
  marksLeft?: boolean;
  /** Of `already`, how many this sample's earlier run excluded: their items are cleared again. */
  excludedBefore: number;
  /** Labeled "not the item" and excluded or marked already. */
  already: string[];
  /** A person's include or a pasted reference stands: listed and skipped (S36 data rules). */
  conflicts: { ref: string; why: string }[];
  /** Not found for the item in this database: listed, never guessed, never counted as labeled. */
  missing: string[];
}

export interface ItemPlan {
  productId: string;
  name: string;
  /** Why nothing is recorded for the item (unknown, not a game, rules changed, not the sample). */
  refused: string | null;
  blocks: BlockPlan[];
}

const refOf = (e: Pick<CheckEntry, 'source' | 'ref'>) => `${e.source} ${e.ref}`;
const whereOf = (b: Pick<CheckBlock, 'kind' | 'source'>) =>
  b.kind === 'sales' ? 'sales' : `listings at ${b.source}`;

/**
 * How the file's blocks differ from the sample rebuilt from the database (null: none). Compared:
 * each block's source, whether it was read on too few nights, and its entries (source, ref) with
 * their sets. Prices, titles and days are not compared (they are not what is judged).
 */
export function sampleMismatch(
  given: readonly CheckBlock[],
  rebuilt: readonly CheckBlock[],
): string | null {
  const problems: string[] = [];
  const want = new Map(rebuilt.map((b) => [b.source, b]));
  for (const b of given) {
    const r = want.get(b.source);
    if (!r) {
      problems.push(`${whereOf(b)} was never sampled here`);
      continue;
    }
    if (!!b.tooFewNights !== !!r.tooFewNights) {
      problems.push(`${whereOf(b)}: too few nights is ${!!r.tooFewNights} here`);
      continue;
    }
    const setsOf = (list: readonly CheckEntry[]) =>
      new Map(list.map((e) => [refOf(e), e.sets.toSorted().join('+')]));
    const have = setsOf(b.entries);
    const should = setsOf(r.entries);
    const notIn = [...have.keys()].filter((k) => !should.has(k));
    const left = [...should.keys()].filter((k) => !have.has(k));
    const moved = [...have].filter(([k, v]) => should.has(k) && should.get(k) !== v);
    if (notIn.length) problems.push(`${whereOf(b)}: not in the sample ${notIn.join(', ')}`);
    if (left.length) problems.push(`${whereOf(b)}: left out ${left.join(', ')}`);
    if (moved.length)
      problems.push(`${whereOf(b)}: other sets ${moved.map(([k]) => k).join(', ')}`);
  }
  const named = new Set(given.map((b) => b.source));
  for (const r of rebuilt)
    if (!named.has(r.source)) problems.push(`${whereOf(r)} is left out of the file`);
  return problems.length
    ? `the file is not the sample this database gives: ${problems.join('; ')}. Sample again`
    : null;
}

export interface RecordOptions {
  /** The judged sources (`judgedSources` over the plug-ins); read for sales only. */
  judged: ReadonlySet<string>;
  registry?: SourceRegistry;
}

const textList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * What `record` would do with a label file, read only (the dry run prints it). An item is refused,
 * nothing recorded or excluded for it, when: it is not here or not a game; its rules changed since
 * the sample; its sales' rules are not applied (`rulesApplied`); the file is not the sample the
 * database gives as of `sampledAt` (`sampleMismatch`: entries removed, added or made up, a source
 * never sampled, the nights changed); or this sample was recorded already with other labels and
 * judged (a relabeled file never overturns a pass or a failure; over a not judged row it may, since
 * that row excluded and marked nothing).
 */
export async function planRecord(
  db: Db,
  file: CheckFile,
  options: RecordOptions,
): Promise<ItemPlan[]> {
  const dismissed = await dismissedExclusions(db);
  const ctx = await sampleContext(db, file.check, options);
  const at = new Date(file.sampledAt);
  const out: ItemPlan[] = [];
  for (const item of file.items) {
    const plan: ItemPlan = {
      productId: item.productId,
      name: item.name,
      refused: null,
      blocks: [],
    };
    out.push(plan);
    const [product] = await db
      .select({
        name: schema.products.name,
        category: schema.products.category,
        kind: schema.products.kind,
      })
      .from(schema.products)
      .where(eq(schema.products.id, item.productId));
    if (!product) {
      plan.refused = 'no such item in this database';
      continue;
    }
    plan.name = product.name;
    if (!isGameItem(product, await getItemRules(db, item.productId))) {
      plan.refused = 'not a game: never checked';
      continue;
    }
    const current = (await currentRules(db, item.productId))!;
    if (item.checks.some((b) => current.hashFor(b.kind, b.source) !== b.hash)) {
      plan.refused = 'rules changed since the sample: sample again';
      continue;
    }
    // Every check of the item, in the order `confirmations` reads them.
    const checks = await db
      .select({
        kind: schema.itemChecks.kind,
        source: schema.itemChecks.source,
        outcome: schema.itemChecks.outcome,
        by: schema.itemChecks.by,
        rulesHash: schema.itemChecks.rulesHash,
        counts: schema.itemChecks.counts,
      })
      .from(schema.itemChecks)
      .where(eq(schema.itemChecks.productId, item.productId))
      .orderBy(asc(schema.itemChecks.at), asc(sql`rowid`));
    // This sample's rows: the same sample time is the same sample, whatever its id.
    const ofSample = checks.filter(
      (c) =>
        c.by === 'check' &&
        (c.counts?.sampledAt === file.sampledAt || c.counts?.sample === file.sample),
    );
    const relabeled = item.checks.some((b) =>
      ofSample.some(
        (c) =>
          c.kind === b.kind &&
          c.source === b.source &&
          (c.outcome === 'passed' || c.outcome === 'failed') &&
          c.counts?.labels !== labelsDigest(b.entries),
      ),
    );
    if (relabeled) {
      plan.refused = 'this sample was recorded with other labels';
      continue;
    }
    const keep = new Set(ofSample.flatMap((c) => textList(c.counts?.excluded)));
    const rebuilt = await itemSample(db, item.productId, current, ctx, at, keep);
    if (!rebuilt) {
      plan.refused = NOT_APPLIED;
      continue;
    }
    const mismatch = sampleMismatch(item.checks, rebuilt);
    if (mismatch) {
      plan.refused = mismatch;
      continue;
    }
    const marks = await notItemRefs(db, [item.productId]);
    for (const block of item.checks) {
      const labels = labelsDigest(block.entries);
      const ofKey = checks.filter((c) => c.kind === block.kind && c.source === block.source);
      const bp: BlockPlan = {
        kind: block.kind,
        source: block.source,
        hash: block.hash,
        outcome: 'not_judged',
        sets: {},
        recorded: ofSample.some(
          (c) =>
            c.kind === block.kind &&
            c.source === block.source &&
            c.rulesHash === block.hash &&
            c.counts?.labels === labels,
        ),
        failureStands: false,
        counts: {},
        exclude: [],
        mark: [],
        excludedBefore: 0,
        already: [],
        conflicts: [],
        missing: [],
      };
      plan.blocks.push(bp);
      if (block.tooFewNights) {
        bp.tooFewNights = block.nights ?? 0;
        continue;
      }
      const notItem = block.entries.filter((e) => e.item === false);
      if (block.kind === 'listings') {
        // Marks are written before the block's row: a recorded block's marks were made, and one an
        // admin took back since is not made again.
        if (bp.recorded) bp.marksLeft = true;
        else await planMarks(db, item.productId, block.source, notItem, marks, bp);
      } else await planExclusions(db, item.productId, notItem, dismissed, keep, bp);
      // A ref not found here is never counted as labeled: its sets are not judged.
      const missing = new Set(bp.missing);
      const judged = judgeBlock({
        kind: block.kind,
        entries: block.entries.map((e) => (missing.has(refOf(e)) ? { ...e, item: null } : e)),
      });
      bp.outcome = judged.outcome;
      bp.sets = judged.sets;
      // Not judged: only the row is written, nothing excluded or marked (whatever the labels hold),
      // so completing the labels later never has an exclusion or a mark to undo.
      if (judged.outcome === 'not_judged') {
        bp.exclude = [];
        bp.mark = [];
      }
      bp.failureStands = judged.outcome === 'passed' && failureStands(ofKey, block.hash);
      bp.counts = {
        sample: file.sample,
        sampledAt: file.sampledAt,
        labels,
        sets: judged.sets,
        missing: bp.missing.length,
        conflicts: bp.conflicts.length,
        // Read back as kept when this sample is recorded again (`itemSample`'s `keep`).
        ...(bp.exclude.length && { excluded: bp.exclude.map((x) => x.id) }),
      };
    }
  }
  return out;
}

/**
 * The sources a plan writes at: its sales' and its listings' (the locks `record --apply` holds,
 * as `recheck-sales --apply` does).
 */
export function planSources(plans: readonly ItemPlan[]): string[] {
  const out = new Set<string>();
  for (const p of plans) {
    if (p.refused) continue;
    for (const b of p.blocks) {
      if (b.kind === 'listings') out.add(b.source);
      for (const x of b.exclude) out.add(x.source);
    }
  }
  return [...out].toSorted();
}

/** Sales labeled "not the item": excluded by hand unless a person's word stands. */
async function planExclusions(
  db: Db,
  productId: string,
  notItem: readonly CheckEntry[],
  dismissed: Set<string>,
  keep: ReadonlySet<string>,
  bp: BlockPlan,
) {
  const o = schema.priceObservations;
  const bySource = new Map<string, string[]>();
  for (const e of notItem) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e.ref]);
  const found = new Map<string, typeof o.$inferSelect>();
  for (const [source, refs] of bySource)
    for (let i = 0; i < refs.length; i += 400)
      for (const r of await db
        .select()
        .from(o)
        .where(and(eq(o.source, source), inArray(o.externalRef, refs.slice(i, i + 400)))))
        found.set(`${r.source}|${r.externalRef}`, r);
  for (const e of notItem) {
    const row = found.get(`${e.source}|${e.ref}`);
    // Stored under another item, or not here at all (a sample from another copy): never guessed.
    if (!row || row.productId !== productId || row.observationType !== 'sold') {
      bp.missing.push(refOf(e));
      continue;
    }
    if (row.excluded) {
      // A rules mark is taken back when the rules change; the label's exclusion is a person's and stays.
      const ruled =
        row.excludedReason === 'mismatch' && !!row.ruleMark?.startsWith(RULE_MARK_PREFIX);
      if (ruled) bp.exclude.push({ id: row.id, source: e.source, ref: refOf(e) });
      else {
        bp.already.push(refOf(e));
        // A run stopped after its exclusions: the rerun clears and refreshes the item again.
        if (keep.has(row.id)) bp.excludedBefore++;
      }
      continue;
    }
    const raw =
      row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : null;
    const why = protectedBy(row, raw, dismissed);
    if (why) bp.conflicts.push({ ref: refOf(e), why });
    else bp.exclude.push({ id: row.id, source: e.source, ref: refOf(e) });
  }
}

/**
 * Listings labeled "not the item": marked, unless marked already. A listing never stored for the item
 * at the source is missing.
 */
async function planMarks(
  db: Pick<Db, 'select'>,
  productId: string,
  source: string,
  notItem: readonly CheckEntry[],
  marks: Map<string, Set<string>>,
  bp: BlockPlan,
) {
  if (!notItem.length) return;
  const stored = new Set<string>();
  for (const r of await db
    .select({ offers: schema.supply.offers })
    .from(schema.supply)
    .where(
      and(
        eq(schema.supply.productId, productId),
        eq(schema.supply.source, source),
        isNotNull(schema.supply.offers),
      ),
    ))
    for (const offer of searchOffers(r) ?? []) stored.add(offer.ref);
  const marked = marks.get(notItemKey(productId, source));
  for (const e of notItem) {
    if (marked?.has(e.ref)) bp.already.push(refOf(e));
    else if (!stored.has(e.ref)) bp.missing.push(refOf(e));
    else bp.mark.push(e.ref);
  }
}

export interface RecordResult {
  checks: number;
  excluded: number;
  marked: number;
}

/** How many ids go in one `IN (...)` list. */
const IDS_PER_WRITE = 400;

/**
 * Writes a planned record (`--apply`; the caller holds the locks): per block, in one transaction, its
 * listings marked, its sales excluded in batched updates (the manual exclusion, S36 A1: "excluded by
 * hand, the raw row stays") and, when not recorded yet, one `item_checks` row by the check (the hash
 * is checked again by `recordItemCheck`); then one clear of the changed items' values (and of items
 * whose earlier run of the sample excluded sales, so a run stopped before the clear is finished) and
 * one refresh (S19: never one per row). A block not judged plans no exclusion or mark, so it writes its row only; a block
 * read on too few nights writes nothing. Running the same plan again writes nothing new.
 */
export async function applyRecord(
  db: Db,
  plans: readonly ItemPlan[],
  now = new Date(),
): Promise<RecordResult> {
  const result: RecordResult = { checks: 0, excluded: 0, marked: 0 };
  const items = new Set<string>();
  const o = schema.priceObservations;
  for (const plan of plans) {
    if (plan.refused) continue;
    for (const b of plan.blocks) {
      if (b.tooFewNights !== undefined) continue;
      if (b.excludedBefore) items.add(plan.productId);
      // A block's marks, exclusions and row are one write: a stopped run leaves either all of a
      // block or none of it, so a rerun with other labels never meets marks without their row.
      const done = await db.transaction(async (tx) => {
        const marked = await addCheckMarks(tx, plan.productId, b.source, b.mark, now);
        let excluded = 0;
        const ids = b.exclude.map((e) => e.id);
        for (let i = 0; i < ids.length; i += IDS_PER_WRITE) {
          const rows = await tx
            .update(o)
            .set({ excluded: true, excludedReason: 'manual' })
            .where(inArray(o.id, ids.slice(i, i + IDS_PER_WRITE)))
            .returning({ id: o.id });
          excluded += rows.length;
        }
        if (!b.recorded)
          await recordItemCheck(tx, {
            productId: plan.productId,
            kind: b.kind,
            source: b.source,
            outcome: b.outcome,
            by: 'check',
            rulesHash: b.hash,
            counts: b.counts,
          });
        return { marked, excluded };
      });
      result.marked += done.marked;
      result.excluded += done.excluded;
      if (done.excluded) items.add(plan.productId);
      if (!b.recorded) result.checks++;
    }
  }
  if (items.size) {
    await clearBucketValues(db, [...items]);
    await refreshItemSales(db, { marksOnly: true });
  }
  return result;
}

/** The dry run's (and the run's) lines per item: counts and refs, never a title. */
export function describePlan(plans: readonly ItemPlan[]): string[] {
  const lines: string[] = [];
  for (const p of plans) {
    lines.push(`${p.name || '?'} (${p.productId})`);
    if (p.refused) {
      lines.push(`  refused: ${p.refused}`);
      continue;
    }
    for (const b of p.blocks) {
      const where = whereOf(b);
      if (b.tooFewNights !== undefined) {
        lines.push(`  ${where}: too few nights (${b.tooFewNights}), nothing recorded`);
        continue;
      }
      const sets = Object.entries(b.sets)
        .map(([name, s]) => {
          const of = s.unlabeled ? `, ${s.unlabeled} not labeled` : '';
          return `${name} ${s.item} of ${s.read}${s.needed === null ? '' : ` (${s.needed} needed)`}${of}`;
        })
        .join('; ');
      lines.push(
        `  ${where}: ${b.outcome.replace('_', ' ')}${b.recorded ? ' (recorded already)' : ''}: ${sets}`,
      );
      if (b.failureStands)
        lines.push('    a failed check stands for these rules: only an admin can confirm');
      if (b.outcome === 'not_judged')
        lines.push(
          '    not judged: nothing excluded or marked; complete the labels and record again',
        );
      const act = b.kind === 'sales' ? 'exclude' : 'mark';
      const todo =
        b.kind === 'sales' ? b.exclude.map((x) => x.ref) : b.mark.map((r) => `${b.source} ${r}`);
      if (todo.length) lines.push(`    ${act} ${todo.length}: ${todo.join(', ')}`);
      if (b.marksLeft) lines.push('    recorded already, marks left as they are');
      if (b.already.length)
        lines.push(`    already done ${b.already.length}: ${b.already.join(', ')}`);
      for (const c of b.conflicts) lines.push(`    conflict, left as it is: ${c.ref} (${c.why})`);
      if (b.missing.length)
        lines.push(`    missing here ${b.missing.length}: ${b.missing.join(', ')}`);
    }
  }
  return lines;
}
