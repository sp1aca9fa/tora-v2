// The registration check of a game wish (requirements S36 B1; plan W9, section 9 C): what Tora found
// for the item, per source, and the person's actions on it. Sales: the 20 cheapest and the 20 nearest
// the median of the kept sales of the last 12 months (the labeled check's sampling, `cheapestOf` and
// `nearestMedianOf` in `@tora/core`), and a sample of the dropped ones with why. Listings: per
// search-based source the 20 cheapest stored ones now, and the dropped ones. Every action here checks
// on the server that the person owns the wish or is an admin (`wishForAction`); the rules are the
// item's, shared by everyone who wishes it.
import {
  CHECK_SAMPLE_SIZE,
  type EffectiveRules,
  type ItemRulesRow,
  cheapestOf,
  effectiveRules,
  failsRules,
  isGameItem,
  localDate,
  nearestMedianOf,
  overlayQuery,
  rulesHash,
  toLocalIso,
} from '@tora/core';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { listConsoles } from './consoles';
import {
  confirmations as itemConfirmations,
  confirmationsMany,
  currentRules,
  failureStands,
  getItemRules,
  recordItemCheck,
  saveItemRules,
} from './item-rules';
import { queueWishReadsSafely } from './deep-reads';
import { DomainError } from './mutations';
import { markNotItem, unmarkNotItem } from './not-item';
import { RULE_MARK_PREFIX, type RuleHold, gameRulesOn, isHeld, releaseHeld } from './rule-marks';
import { collectSchedule } from './schedule';
import {
  type Product,
  type ProductSource,
  type SourceQuery,
  type User,
  type Watch,
  itemChecks,
  priceObservations,
  itemRuleState,
  itemRules,
  notItemMarks,
  productSources,
  saleCoverage,
} from './schema';
import { QUERY_SOURCE_ID, setObservationExcluded, updateSourceQuery } from './sources';
import { SUPPLY_FRESH_DAYS, type SupplyOffer } from './supply';
import {
  type WishSale,
  awaitsRead,
  rowsItemOf,
  searchEdited,
  wishForAction,
  wishOffers,
  wishSales,
} from './wishes';

/** How far back the check reads sales (S36 B1: "the last 12 months", as the labeled check). */
export const WISH_CHECK_SALES_DAYS = 365;

/**
 * Why a stored sale is not counted: `rules` marked by the item's rules at the closing step, `manual`
 * a person's "not the item", `mismatch` a sale a check found was another item, `outlier` an outlier.
 * `would` is not stored: a kept sale the rules shown would drop (judged by its title only, here;
 * the closing step judges the category too) while they are not applied to the stored sales yet.
 */
export type DropReason = 'rules' | 'manual' | 'mismatch' | 'outlier' | 'would';

export interface CheckSale {
  id: string;
  /**
   * Dropped sales of a boxed wish: who marked it "not the item" on the boxed item (null: no user
   * kept); unset when the drop is not such a mark.
   */
  markedBy?: string | null;
  /** A dropped sale a labeled check excluded: only an admin takes it back. */
  byCheck?: true;
  title: string | null;
  url: string | null;
  priceBase: number;
  observedAt: string;
  /** Kept sales: which samples it is in. */
  sets: ('cheap' | 'median')[];
}

export interface CheckSalesSource {
  source: string;
  kept: number;
  sample: CheckSale[];
  /** Not counted now (stored as excluded). */
  dropped: number;
  /** Counted now, but the rules shown would drop them (reason `would`). */
  would: number;
  /** The newest dropped ones, up to the sample size. */
  droppedSample: (CheckSale & { reason: DropReason })[];
}

export interface CheckListing extends SupplyOffer {
  /** `rules`: the rules drop it at the read; `would`: they would, while the admin's switch is off. */
  reason?: 'not_item' | 'rules' | 'would';
}

export interface CheckListingsSource {
  source: string;
  day: string;
  kept: number;
  /** The cheapest kept listings now, up to the sample size. */
  sample: CheckListing[];
  dropped: CheckListing[];
  /** Of `dropped`, those the rules would drop while the admin's switch is off. */
  would: number;
  hash: string;
  confirmed: boolean;
  /** A failed labeled check stands under today's rules: only an admin confirms. */
  failureStands: boolean;
}

/** One marketplace search of the item, as the check page shows it. */
export interface CheckSearch {
  source: string;
  /** The stored words, as one line. */
  words: string;
  /** The words the item's rules add when the search is sent; none while the game rules do not apply. */
  added: string[];
  /** The search is sent inside a category (the console's, or one stored with the search). */
  inCategory: boolean;
  /** How many stored sales of the item a save of other words would remove (`updateSourceQuery`). */
  stored: number;
  /** When this marketplace was last read for the item with these words; null: not since they were saved. */
  readAt: string | null;
}

/** How long a search's words may be (as the item page's own search form). */
export const SEARCH_WORDS_MAX = 200;

/** Search words as typed: NFKC, single spaces, trimmed. */
export const searchWordsOf = (text: unknown): string =>
  String(text ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

export interface RegistrationCheck {
  watch: Watch;
  product: Product;
  /** The item's own rules row (null: by its platform, no words) and the rules it gives. */
  own: ItemRulesRow | null;
  rules: EffectiveRules;
  /** The item is a game by its rules; `kindOff`: a game of another kind, rules not turned on. */
  game: boolean;
  kindOff: boolean;
  /** The admin switch of the game rules (S36 A1). */
  switchOn: boolean;
  /** The rules shown are the ones the stored sales were judged under. */
  applied: boolean;
  /** The per-item stop's record while it stands (the item whose rows are read). */
  held: RuleHold | null;
  /** The item whose rows are read (a boxed item's plain item), when it is another. */
  rowsOf: string | null;
  /** Tora read the item at least once (a night covered, or a sale stored). */
  firstRead: boolean;
  nextCollect: string | null;
  sales: CheckSalesSource[];
  listings: CheckListingsSource[];
  /**
   * The active marketplace searches of the item whose rows are read (a boxed item's plain item),
   * by source. Empty until the first collect made them.
   */
  searches: CheckSearch[];
  salesHash: string;
  salesConfirmed: boolean;
  salesFailureStands: boolean;
  /** For a game kind whose rules are off: how many kept sales the rules would drop (by title). */
  wouldDrop: number;
  /**
   * The rules changed after the last read (`awaitsRead`): a confirmation waits for the next read,
   * since what the page shows was not read under them.
   */
  awaitsRead: boolean;
}

const reasonOf = (s: WishSale): DropReason =>
  s.ruleMark?.startsWith(RULE_MARK_PREFIX)
    ? 'rules'
    : s.excludedReason === 'manual' || s.excludedReason === 'mismatch'
      ? s.excludedReason
      : 'outlier';

/**
 * The sales a labeled check excluded on an item (S36 A2: its check rows keep their ids). They are
 * stored as a hand exclusion, so this is what tells them from a person's "not the item".
 */
async function checkExcluded(db: Pick<Db, 'select'>, productId: string): Promise<Set<string>> {
  const rows = await db
    .select({ counts: itemChecks.counts })
    .from(itemChecks)
    .where(
      and(
        eq(itemChecks.productId, productId),
        eq(itemChecks.kind, 'sales'),
        eq(itemChecks.by, 'check'),
      ),
    );
  const ids = new Set<string>();
  for (const { counts } of rows) {
    const excluded = (counts as { excluded?: unknown } | null)?.excluded;
    if (Array.isArray(excluded)) for (const id of excluded) if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

const toSale = (s: WishSale): CheckSale => ({
  id: s.id,
  title: s.title,
  url: s.url,
  priceBase: s.priceBase,
  observedAt: s.observedAt,
  sets: [],
  ...(s.markedBy !== undefined && { markedBy: s.markedBy }),
});

/**
 * Whether the stored sales were judged under these rules (`item_rule_state.applied_hash` lists each
 * judged source with `rulesHash(rules, source)`, S36 A1): every source in it reads today's hash.
 */
export function rulesApplied(appliedHash: string | null, rules: EffectiveRules): boolean {
  if (!appliedHash) return false;
  return appliedHash
    .split(' ')
    .filter(Boolean)
    .every((part) => {
      const at = part.lastIndexOf('=');
      return at > 0 && part.slice(at + 1) === rulesHash(rules, part.slice(0, at));
    });
}

/** The registration check of a wish (the caller made sure the person may see it). */
export async function registrationCheck(
  db: Db,
  wish: { watch: Watch; product: Product },
  now = new Date(),
): Promise<RegistrationCheck> {
  const { product } = wish;
  const consoles = await listConsoles(db);
  const own = await getItemRules(db, product.id);
  const rules = effectiveRules(product, own, consoles);
  const game = isGameItem(product, own);
  const kindOff = product.category === 'game' && !game;
  const { from } = await rowsItemOf(db, product.id);
  const [switchOn, [state], [covered], schedule, many] = await Promise.all([
    gameRulesOn(db),
    db.select().from(itemRuleState).where(eq(itemRuleState.productId, from)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(saleCoverage)
      .where(eq(saleCoverage.productId, from)),
    collectSchedule(db, now),
    confirmationsMany(db, [product]),
  ]);
  const held = (state?.held ?? null) as unknown as RuleHold | null;
  const standing = isHeld(held) ? held : null;
  // The rules the stored rows were judged under: a boxed item's plain item's, from the plain item's
  // own platform and region (fix 4); a plain item that no longer exists reads not applied.
  const plainRules =
    from === product.id ? rules : ((await currentRules(db, product.id))?.plain ?? null);
  const applied =
    switchOn &&
    game &&
    !standing &&
    !!plainRules &&
    rulesApplied(state?.appliedHash ?? null, plainRules);

  const since = toLocalIso(new Date(now.getTime() - WISH_CHECK_SALES_DAYS * 86_400_000));
  const all = await wishSales(db, product.id, { since, withExcluded: true });
  const byCheck = await checkExcluded(db, from);
  const bySource = new Map<string, WishSale[]>();
  for (const s of all) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  let wouldDrop = 0;
  const sales: CheckSalesSource[] = [];
  for (const [source, rows] of [...bySource].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const kept: WishSale[] = [];
    const dropped: (CheckSale & { reason: DropReason })[] = [];
    let would = 0;
    for (const s of rows) {
      if (s.excluded)
        dropped.push({
          ...toSale(s),
          reason: reasonOf(s),
          ...(byCheck.has(s.id) && { byCheck: true as const }),
        });
      else if (!applied && failsRules({ title: s.title, category: null }, rules, source)) {
        wouldDrop++;
        would++;
        dropped.push({ ...toSale(s), reason: 'would' });
      } else kept.push(s);
    }
    const priced = kept.map((s) => ({
      ...toSale(s),
      price: s.priceBase,
      source,
      ref: s.externalRef,
    }));
    const sets = new Map<string, CheckSale>();
    for (const [set, list] of [
      ['cheap', cheapestOf(priced)],
      ['median', nearestMedianOf(priced)],
    ] as const)
      for (const s of list) {
        const have = sets.get(s.id) ?? { ...s, sets: [] };
        have.sets = [...have.sets, set];
        sets.set(s.id, have);
      }
    sales.push({
      source,
      kept: kept.length,
      sample: [...sets.values()]
        .map(({ id, title, url, priceBase, observedAt, sets: in_ }) => ({
          id,
          title,
          url,
          priceBase,
          observedAt,
          sets: in_,
        }))
        .toSorted((a, b) => a.priceBase - b.priceBase || (a.id < b.id ? -1 : 1)),
      dropped: dropped.length - would,
      would,
      droppedSample: dropped
        .toSorted((a, b) =>
          a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0,
        )
        .slice(0, CHECK_SAMPLE_SIZE),
    });
  }

  const confirmations = many.get(product.id)!.confirmations;
  const fails = (kind: 'sales' | 'listings', source: string) =>
    failureStands(
      confirmations.checks.get(`${kind}|${source}`) ?? [],
      confirmations.hashFor(kind, source),
    );
  const day = localDate(new Date(now.getTime() - SUPPLY_FRESH_DAYS * 86_400_000));
  const offerRows = await wishOffers(db, product.id, { since: day });
  const latest = new Map<string, string>();
  for (const r of offerRows) if ((latest.get(r.source) ?? '') < r.day) latest.set(r.source, r.day);
  const listings: CheckListingsSource[] = [...latest]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([source, at]) => {
      const rows = offerRows.filter((r) => r.source === source && r.day === at);
      const seen = new Set<string>();
      const kept: CheckListing[] = [];
      const dropped: CheckListing[] = [];
      for (const r of rows) {
        for (const o of r.marked) {
          if (seen.has(o.ref)) continue;
          seen.add(o.ref);
          dropped.push({ ...o, reason: 'not_item' });
        }
        for (const o of r.offers) {
          if (seen.has(o.ref)) continue;
          seen.add(o.ref);
          if (failsRules({ title: o.title, category: null }, rules, source))
            dropped.push({ ...o, reason: switchOn && game ? 'rules' : 'would' });
          else kept.push(o);
        }
      }
      const hash = confirmations.hashFor('listings', source);
      return {
        source,
        day: at,
        kept: kept.length,
        sample: kept
          .toSorted((a, b) => a.priceBase - b.priceBase || (a.ref < b.ref ? -1 : 1))
          .slice(0, CHECK_SAMPLE_SIZE),
        dropped: dropped.slice(0, CHECK_SAMPLE_SIZE),
        would: dropped.filter((o) => o.reason === 'would').length,
        hash,
        confirmed: confirmations.isConfirmed('listings', source),
        failureStands: fails('listings', source),
      };
    });

  // The searches as stored, and what the collect lays over them (S36 A1: only for a game by its
  // rules, with the switch on; the stored search is never rewritten with it).
  const links = await db
    .select({ source: productSources.source, query: productSources.query })
    .from(productSources)
    .where(
      and(
        eq(productSources.productId, from),
        eq(productSources.externalId, QUERY_SOURCE_ID),
        eq(productSources.active, true),
      ),
    )
    .orderBy(asc(productSources.source));
  // What a save would remove (the rows `updateSourceQuery` deletes, sales only) and the last read.
  const [storedRows, readRows] = await Promise.all([
    db
      .select({ source: priceObservations.source, n: sql<number>`count(*)` })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.productId, from),
          eq(priceObservations.observationType, 'sold'),
          or(
            isNull(priceObservations.excludedReason),
            ne(priceObservations.excludedReason, 'manual'),
          ),
        ),
      )
      .groupBy(priceObservations.source),
    db
      .select({ source: saleCoverage.source, at: saleCoverage.updatedAt })
      .from(saleCoverage)
      .where(eq(saleCoverage.productId, from)),
  ]);
  const storedOf = new Map(storedRows.map((r) => [r.source, Number(r.n)]));
  const readOf = new Map(readRows.map((r) => [r.source, r.at]));
  const searches: CheckSearch[] = links.flatMap(({ source, query }) => {
    const keywords = query?.keywords;
    if (!Array.isArray(keywords) || !keywords.length || keywords.some((w) => typeof w !== 'string'))
      return [];
    const stored = {
      keywords,
      ...(typeof query?.categoryId === 'string' && { categoryId: query.categoryId }),
    };
    const sent = switchOn && game && plainRules ? overlayQuery(stored, plainRules, source) : stored;
    return [
      {
        source,
        words: keywords.join(' '),
        added: (sent.keywords ?? []).slice(keywords.length),
        inCategory: !!sent.categoryId,
        stored: storedOf.get(source) ?? 0,
        readAt: readOf.get(source) ?? null,
      },
    ];
  });

  return {
    ...wish,
    own,
    rules,
    game,
    kindOff,
    switchOn,
    applied,
    held: standing,
    rowsOf: from === product.id ? null : from,
    firstRead: Number(covered?.n ?? 0) > 0 || all.length > 0 || offerRows.length > 0,
    nextCollect: schedule.nextCollect,
    sales,
    listings,
    searches,
    salesHash: confirmations.hashFor('sales', ''),
    salesConfirmed: confirmations.isConfirmed('sales', ''),
    salesFailureStands: fails('sales', ''),
    wouldDrop: kindOff ? wouldDrop : 0,
    awaitsRead: await awaitsRead(db, product.id),
  };
}

// ---------------------------------------------------------------------------------------------
// Actions (each checks the wish: its owner or an admin)

type Who = Pick<User, 'id' | 'role'>;

/** A wish whose item is a game by its rules (`forbidden` for a card or sealed wish). */
async function gameWish(db: Db, user: Who, wishId: string) {
  const wish = await wishForAction(db, user, wishId);
  if (!isGameItem(wish.product, await getItemRules(db, wish.product.id)))
    throw new DomainError('forbidden');
  return wish;
}

/**
 * Confirms the wish's sales, or one source's listings, under the hash the page showed (S36 B1). A
 * person's confirmation is refused (`forbidden`) after a failed labeled check under the same rules;
 * an admin's is the admin's word. Rules changed since the page was read, or since Tora last read
 * the item (`awaitsRead`, for an admin too): `invalid_input`.
 */
export async function confirmWish(
  db: Db,
  user: Who,
  input: { wishId: string; kind: 'sales' | 'listings'; source?: string; hash: string },
) {
  const wish = await gameWish(db, user, input.wishId);
  const source = input.kind === 'sales' ? '' : String(input.source ?? '').slice(0, 60);
  if (await awaitsRead(db, wish.product.id)) throw new DomainError('invalid_input');
  const check = await recordItemCheck(db, {
    productId: wish.product.id,
    kind: input.kind,
    source,
    outcome: 'confirmed',
    by: user.role === 'admin' ? 'admin' : 'person',
    rulesHash: String(input.hash ?? ''),
    userId: user.id,
  });
  // An existing game watch gets its deep reads at its registration check (S36 B3).
  await queueWishReadsSafely(db, wish.product.id);
  return check;
}

/** Words as typed: one per line or comma, trimmed, no repeats, at most 30 of up to 60 characters. */
export function wordsOf(text: string): string[] {
  const words = [
    ...new Set(
      String(text ?? '')
        .split(/[\n,、]/)
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ];
  if (words.length > 30 || words.some((w) => w.length > 60)) throw new DomainError('invalid_input');
  return words;
}

/**
 * Changes the item's words and edition (S36 B1). The rules are the item's: everyone who wishes it
 * sees the change, and the hash changes, so confirmations made under the old rules no longer count.
 */
export async function saveWishRules(
  db: Db,
  user: Who,
  input: { wishId: string; required: string; excluded: string; edition: string },
): Promise<void> {
  const wish = await gameWish(db, user, input.wishId);
  const edition = String(input.edition ?? '').trim() || null;
  if (edition && edition.length > 80) throw new DomainError('invalid_input');
  const own = await getItemRules(db, wish.product.id);
  const console = own?.console ?? (await rulesConsole(db, wish.product));
  const required = wordsOf(input.required);
  const excluded = wordsOf(input.excluded);
  // Saved as it was: nothing changed, so the check is not sent back to wait for a read.
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((w, i) => w === b[i]);
  if (
    own &&
    (own.edition ?? null) === edition &&
    same(own.required, required) &&
    same(own.excluded, excluded)
  )
    return;
  await saveItemRules(
    db,
    wish.product.id,
    {
      console,
      edition,
      required,
      excluded,
      boxed: own?.boxed ?? false,
      boxedOf: own?.boxedOf ?? null,
      gameRules: own?.gameRules ?? null,
    },
    user.id,
  );
}

/**
 * A search of the item was saved with other words: what was confirmed on the rows it read no longer
 * counts (S36 Terms "Confirmed"). Takes away the confirmation of the item's sales and of that
 * source's listings, for the item and for each boxed item reading its rows, by one `failed` row of
 * the person (or the admin) under today's hash, noted "search edited". Nothing is written where
 * nothing is confirmed, so an item that is not a game gets no row. A person's `failed` row never
 * blocks a later confirmation (`failureStands` counts the labeled check's only). Called before the
 * search is saved: a save that then fails leaves the item unconfirmed, never confirmed on rows
 * that are gone.
 */
export async function unconfirmForSearch(
  db: Db,
  user: Who,
  productId: string,
  source: string,
): Promise<number> {
  const boxed = await db
    .select({ id: itemRules.productId })
    .from(itemRules)
    .where(and(eq(itemRules.boxed, true), eq(itemRules.boxedOf, productId)));
  let written = 0;
  for (const id of [productId, ...boxed.map((b) => b.id)]) {
    const current = await itemConfirmations(db, id);
    if (!current) continue;
    for (const [kind, at] of [
      ['sales', ''],
      ['listings', source],
    ] as const) {
      if (!current.isConfirmed(kind, at)) continue;
      await recordItemCheck(db, {
        productId: id,
        kind,
        source: at,
        outcome: 'failed',
        by: user.role === 'admin' ? 'admin' : 'person',
        rulesHash: current.hashFor(kind, at),
        userId: user.id,
        note: 'search edited',
      });
      written++;
    }
  }
  return written;
}

/**
 * Changes the words one marketplace is searched with for the wish's item (the owner's request of
 * 2026-11-26). The search is the item's, shared by everyone: the words came from the item's name
 * when the search was first made, and a rename does not change them. A boxed item has no search of
 * its own (`forbidden`: its plain item's is changed from the plain item's wish). Saving goes
 * through `updateSourceQuery`: the item's stored rows at that source go (hand-excluded sales stay),
 * its reads are forgotten and its deep read is queued again; the search is marked edited, so a new
 * version of the plug-in's default never replaces it. The confirmations that rested on those rows
 * go first (`unconfirmForSearch`). False: the words are the stored ones, nothing changed.
 */
export async function saveWishSearch(
  db: Db,
  user: Who,
  input: { wishId: string; source: string; words: string },
): Promise<boolean> {
  const wish = await gameWish(db, user, input.wishId);
  const { from } = await rowsItemOf(db, wish.product.id);
  if (from !== wish.product.id) throw new DomainError('forbidden');
  const words = searchWordsOf(input.words);
  if (!words || words.length > SEARCH_WORDS_MAX) throw new DomainError('invalid_input');
  const [link] = await db
    .select()
    .from(productSources)
    .where(
      and(
        eq(productSources.productId, wish.product.id),
        eq(productSources.source, String(input.source ?? '').slice(0, 60)),
        eq(productSources.externalId, QUERY_SOURCE_ID),
        eq(productSources.active, true),
      ),
    );
  if (!link) throw new DomainError('not_found');
  return saveEditedSearch(db, user, link, { ...link.query, keywords: [words] });
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).join('\n') === (b ?? []).join('\n');

/**
 * Saves a search as a person changed it, from either page that can (the wish's check, the item's
 * page): the confirmations that rested on its rows go first (`unconfirmForSearch`), then the search
 * is saved marked edited (`searchEdited`, `updateSourceQuery`: its rows go and are read again). A
 * search that reads the same (the same words once normalized, excluded words, price range and
 * category) is not saved: nothing is deleted or un-confirmed for a save that changes nothing. The
 * caller checked who may. False: nothing changed.
 */
export async function saveEditedSearch(
  db: Db,
  user: Who,
  link: Pick<ProductSource, 'id' | 'productId' | 'source' | 'query'>,
  query: SourceQuery,
): Promise<boolean> {
  const old = link.query;
  if (
    old &&
    searchWordsOf((old.keywords ?? []).join(' ')) ===
      searchWordsOf((query.keywords ?? []).join(' ')) &&
    sameList(old.excludeKeywords, query.excludeKeywords) &&
    (old.priceMin ?? null) === (query.priceMin ?? null) &&
    (old.priceMax ?? null) === (query.priceMax ?? null) &&
    (old.categoryId ?? null) === (query.categoryId ?? null)
  )
    return false;
  await unconfirmForSearch(db, user, link.productId, link.source);
  await updateSourceQuery(db, link.id, searchEdited(query));
  return true;
}

async function rulesConsole(db: Db, product: Product): Promise<string | null> {
  return effectiveRules(product, null, await listConsoles(db)).console;
}

/**
 * Marks a sale of the wish "not the item" (S36 B1). A plain item's sale is excluded by hand (reason
 * `manual`). A boxed item's sales are its plain item's rows, which other wishes read too: the mark
 * is on the boxed item (`not_item_marks` with the boxed id; `wishSales` drops it for the boxed item)
 * and the stored row is untouched (fix C7).
 */
export async function markWishSale(
  db: Db,
  user: Who,
  input: { wishId: string; saleId: string },
): Promise<void> {
  const wish = await gameWish(db, user, input.wishId);
  const sale = (await wishSales(db, wish.product.id)).find((s) => s.id === input.saleId);
  if (!sale) throw new DomainError('not_found');
  if (sale.productId === wish.product.id) {
    await setObservationExcluded(db, sale.id, true);
    return;
  }
  await db
    .insert(notItemMarks)
    .values({
      productId: wish.product.id,
      source: sale.source,
      externalRef: sale.externalRef,
      userId: user.id,
      at: toLocalIso(),
    })
    .onConflictDoNothing();
}

/**
 * Takes back a sale's "not the item" on the check page (fix 3; the undo of `markWishSale`). A plain
 * wish's sale is included again (`setObservationExcluded(false)`): the hand exclusion keeps no
 * maker, so the wish's owner or an admin may, as on the item's page. A boxed wish's is its mark on
 * the boxed item (`unmarkNotItem`: the person's own mark, or any for an admin). Only a sale dropped
 * by hand (`manual`) is taken back, and one a labeled check excluded only by an admin; `not_found`
 * otherwise. Returns whether something changed.
 */
export async function unmarkWishSale(
  db: Db,
  user: Who,
  input: { wishId: string; saleId: string },
): Promise<boolean> {
  const wish = await gameWish(db, user, input.wishId);
  const sale = (await wishSales(db, wish.product.id, { withExcluded: true })).find(
    (s) => s.id === input.saleId,
  );
  if (!sale || !sale.excluded || reasonOf(sale) !== 'manual') throw new DomainError('not_found');
  if (sale.productId === wish.product.id) {
    // A labeled check's exclusion is not a person's: only an admin takes it back.
    if (user.role !== 'admin' && (await checkExcluded(db, sale.productId)).has(sale.id)) {
      throw new DomainError('not_found');
    }
    await setObservationExcluded(db, sale.id, false);
    return true;
  }
  // A boxed wish: the stored row is its plain item's; only the boxed item's own mark is undone here.
  if (sale.markedBy === undefined) throw new DomainError('not_found');
  return unmarkNotItem(db, user, {
    productId: wish.product.id,
    source: sale.source,
    ref: sale.externalRef,
  });
}

/** Marks a listing of the wish "not the item" (S36 A2: a mark on the wished item). */
export async function markWishListing(
  db: Db,
  user: Who,
  input: { wishId: string; source: string; ref: string },
): Promise<boolean> {
  const wish = await gameWish(db, user, input.wishId);
  return markNotItem(db, user, {
    productId: wish.product.id,
    source: input.source,
    ref: input.ref,
  });
}

/**
 * Turns the game rules on for a game of another kind (S36 Scope rule; `game_rules = 1`), after the
 * page showed what they would drop. Only a game item that is not one by its kind.
 */
export async function turnOnWishRules(db: Db, user: Who, wishId: string): Promise<void> {
  const wish = await wishForAction(db, user, wishId);
  const own = await getItemRules(db, wish.product.id);
  if (wish.product.category !== 'game' || isGameItem(wish.product, own))
    throw new DomainError('invalid_input');
  await saveItemRules(
    db,
    wish.product.id,
    {
      console: own?.console ?? (await rulesConsole(db, wish.product)),
      edition: own?.edition ?? null,
      required: own?.required ?? [],
      excluded: own?.excluded ?? [],
      boxed: own?.boxed ?? false,
      boxedOf: own?.boxedOf ?? null,
      gameRules: 1,
    },
    user.id,
  );
}

/**
 * Releases the held item (S36 A1: the per-item stop ends with a person's confirmation here): its
 * rules are applied at the next collect though they drop more than half its sales. For a boxed
 * wish the held item is its plain item, whose rows it reads. False when nothing was held.
 */
export async function releaseWish(db: Db, user: Who, wishId: string): Promise<boolean> {
  const wish = await gameWish(db, user, wishId);
  const { from } = await rowsItemOf(db, wish.product.id);
  return releaseHeld(db, from, user.id);
}
