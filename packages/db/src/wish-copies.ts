// A game wish's copies (requirements S36 C2, C3; plan W16 9.A): the one selection the page, the
// Wishlist's card and the alert step read. Pure over the rows `wishViews` read.
import {
  type EffectiveRules,
  type Paid,
  type PaidRule,
  type WishNightCopy,
  addDays,
  asPaid,
  atOrBetter,
  failsRules,
  validCopy,
  wishCost,
} from '@tora/core';
import type { AskStatus } from './ask-check';
import { type DayRange, coversDay } from './sale-coverage';
import { type SupplyOffer, supplyOffers } from './supply';
import type {
  WishCheapest,
  WishCopy,
  WishShopEntry,
  WishShopView,
  WishSourceView,
} from './wish-view';

/** Copies listed per search-based source (spec W15: "the cheapest 3 to 5 ... (to start: 5)"). */
export const WISH_COPIES = 5;

/**
 * How a listing's price as paid is read (S36 Terms "As paid", C1). The plug-ins' `addedCost`
 * declarations are not reachable from the app, so a listing counts as paid only when its own row
 * says the seller pays shipping; a buyer-paid or unstated shipping is not known ("plus shipping").
 */
const LISTING_RULE: PaidRule = { rule: 'per_row', unstated: 'unknown' };

export const paidOf = (price: number, shipping: SupplyOffer['shipping'] | null | undefined): Paid =>
  asPaid({ price, shipping: shipping ?? 'unknown' }, LISTING_RULE);

/** A row's stock on one read day: in, out, or the row does not tell. */
export type DayStock = 'in' | 'out' | 'unknown';

export interface SupplyRead {
  productId: string;
  source: string;
  bucket: string | null;
  day: string;
  lowestAskBase: number | null;
  listings: number | null;
  listingsCapped: boolean | number | null;
  offers: unknown;
  url: string | null;
  /** When its run started: every row one run stored for an item and source carries the same. */
  fetchedAt: string;
}

export function shopEntries(row: SupplyRead): WishShopEntry[] {
  const bucket = row.bucket ?? '';
  const offers = supplyOffers(row);
  if (offers && offers.length)
    return offers.map((o) => ({
      bucket,
      kind: o.own ?? null,
      price: o.priceBase,
      paid: paidOf(o.priceBase, o.shipping),
      stock: o.stock ?? null,
      count: o.count ?? null,
      condition: o.condition ?? null,
      seller: o.seller ?? null,
      url: o.url,
    }));
  if (row.lowestAskBase === null) return [];
  // An ask stored without its entries (before S36): whose copy it is is not said.
  return [
    {
      bucket,
      kind: null,
      price: row.lowestAskBase,
      paid: paidOf(row.lowestAskBase, null),
      stock: null,
      count: null,
      condition: null,
      seller: null,
      url: row.url,
    },
  ];
}

/**
 * The shop's own copy on one read day, over its rows in the wish's condition or a better one: in
 * when one has an own entry; out when none does and each is either the stated "out of stock" (no
 * ask, no entries) or lists only outside sellers; not told when a row has an ask with no entries.
 */
export function shopStock(rows: readonly SupplyRead[]): DayStock {
  if (!rows.length) return 'unknown';
  let told = true;
  for (const r of rows) {
    const offers = supplyOffers(r);
    if (offers?.some((o) => o.own === 'own')) return 'in';
    if (!offers && r.lowestAskBase !== null) told = false;
  }
  return told ? 'out' : 'unknown';
}

export interface WishCopiesInput {
  /** The wished item. */
  productId: string;
  /** The item whose search rows are read: a boxed item's plain item (S36 B1), else the wished one. */
  from: string;
  /** The wished item's rules when its rows are another item's; null: its own rows. */
  rules: EffectiveRules | null;
  /** The wish's bucket. */
  wanted: string;
  /** N, the last run's day; null: none in the last days. */
  lastRun: string | null;
  checkNeeded: boolean;
  /** The item the identity shop's rows are read from: the wished one when it has a link there. */
  shopItem: string;
  shopRows: SupplyRead[];
  searchRows: SupplyRead[];
  /** The nights a source read an item (none read: an empty list). */
  nightsOf: (item: string, source: string) => readonly DayRange[];
  isMarked: (source: string, ref: string) => boolean;
  /** The wished item's ask status at a source. */
  status: (source: string) => AskStatus;
}

export interface WishCopies {
  shop: WishShopView[];
  /** Empty while check needed. */
  sources: WishSourceView[];
  cheapest: WishCheapest | null;
  /** The checked copies dated N in the wish's condition or a better one: the only ones an alert names. */
  tonight: WishNightCopy[];
  /** The checked copies of each checked source's last read before N (the in/out state only). */
  kept: WishNightCopy[];
  /** The checked sources read on N, of the listed ones (a sales-only source's nights are no read). */
  read: string[];
  /**
   * Every shop slot (`source|ref`) the alert's shop sources stored on N, in every condition, marked
   * or not: a shop entry's in-stock run ends only when its slot is not here (fix round 1, item 3).
   */
  shopSeen: string[];
}

/** Two reads the same day (the nightly, then a "collect now"): only the newer one's rows. */
function newestRun(rows: readonly SupplyRead[]): SupplyRead[] {
  const at = rows.reduce((t, r) => (r.fetchedAt > t ? r.fetchedAt : t), '');
  return rows.filter((r) => r.fetchedAt === at);
}

/** The newest night before `day` the ranges hold; null: none. */
function coveredBefore(ranges: readonly DayRange[], day: string): string | null {
  const last = addDays(day, -1);
  let found: string | null = null;
  for (const [from, to] of ranges) {
    const d = to < last ? to : last;
    if (from <= d && (found === null || d > found)) found = d;
  }
  return found;
}

export function wishCopies(input: WishCopiesInput): WishCopies {
  const { productId, from, rules, wanted, lastRun: n, checkNeeded, shopItem, status } = input;
  const better = (bucket: string | null) => atOrBetter(bucket, wanted);

  // The read per source (fix round 2, items 2 and 3): a source is listed only when it stores
  // asks for the item (a row in the window), so a sales-only source never is. Read on N (its
  // stored nights for the rows' item hold N, as stamped, or a row is dated N): N's rows, and with
  // nothing in the condition "none found", never older copies. Not read on N: its newest earlier
  // day's rows, shown under that date.
  const reads = (list: SupplyRead[], item: string) => {
    const bySource = new Map<string, SupplyRead[]>();
    for (const r of list) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
    return [...bySource].flatMap(([source, all]) => {
      if (
        n !== null &&
        (all.some((r) => r.day === n) || coversDay(input.nightsOf(item, source), n))
      ) {
        // A read rewrites only the conditions it found, so an older row of the day can hold a
        // copy the newer read no longer saw.
        return [{ source, day: n, rows: newestRun(all.filter((r) => r.day === n)), current: true }];
      }
      const earlier = all.filter((r) => n === null || r.day < n);
      const day = earlier.reduce((d, r) => (r.day > d ? r.day : d), '');
      return earlier.length
        ? [{ source, day, rows: earlier.filter((r) => r.day === day), current: false }]
        : [];
    });
  };

  // The alert's copies (plan 9.A): a checked source read on N gives tonight's; one not read on N
  // keeps its last read's (9.H: as far back as the rows go, `WISH_VIEW_DAYS`), and none when a
  // night it read since stored nothing.
  const tonight: WishNightCopy[] = [];
  const kept: WishNightCopy[] = [];
  const read: string[] = [];
  const shopSeen: string[] = [];
  const toNight = (
    item: string,
    r: { source: string; day: string; rows: SupplyRead[]; current: boolean },
    copies: (rows: SupplyRead[], tonight: boolean) => WishNightCopy[],
  ) => {
    if (n === null) return;
    if (r.current) {
      read.push(r.source);
      tonight.push(...copies(r.rows, true));
      return;
    }
    const covered = coveredBefore(input.nightsOf(item, r.source), n);
    if (covered === null || covered <= r.day) kept.push(...copies(newestRun(r.rows), false));
  };

  const shop: WishShopView[] = reads(input.shopRows, shopItem).map((r) => {
    const { source, day, rows: dayRows, current } = r;
    const inCondition = dayRows.filter((x) => better(x.bucket));
    const stock = shopStock(inCondition);
    const entries = inCondition
      .flatMap(shopEntries)
      .toSorted((a, b) => a.price - b.price || (a.kind === 'own' ? -1 : 1));
    // An alert's shop copy is the wished item's own entry, read by its checked link there (plan
    // 9.D): a boxed wish's plain item's rows are the page's labeled fall-back only.
    if (shopItem === productId && status(source) === 'checked') {
      // A condition saved away and back, or a mark taken back, is no restock.
      if (current && n !== null)
        for (const x of dayRows)
          for (const o of supplyOffers(x) ?? []) shopSeen.push(`${source}|${o.ref}`);
      toNight(shopItem, r, (rows, isTonight) =>
        rows
          .filter((x) => better(x.bucket))
          .flatMap((x) => supplyOffers(x) ?? [])
          .filter((o) => !input.isMarked(source, o.ref))
          .map((o) => ({
            slot: `${source}|${o.ref}`,
            source,
            title: o.title,
            url: o.url,
            seller: o.seller,
            price: o.priceBase,
            paid: paidOf(o.priceBase, o.shipping),
            tonight: isTonight,
            run: true,
            own: o.own === 'own',
          })),
      );
    }
    return {
      source,
      day,
      current,
      none: current && !inCondition.length,
      entries,
      outOfStock: inCondition.length ? stock === 'out' : null,
    };
  });

  // The shop is listed once: a source of its block is not listed again as a search.
  const inShop = new Set(shop.map((s) => s.source));
  const searched: WishSourceView[] = reads(
    input.searchRows.filter((r) => !inShop.has(r.source)),
    from,
  ).map((r) => {
    const { source, day, rows: dayRows, current } = r;
    const pass = (o: SupplyOffer) =>
      !input.isMarked(source, o.ref) &&
      !(rules && failsRules({ title: o.title, category: null }, rules, source));
    const copiesOf = (list: SupplyRead[]) => {
      const seen = new Set<string>();
      return list
        .flatMap((x) =>
          (supplyOffers(x) ?? [])
            .filter((o) => !o.own && pass(o))
            .map((o): WishCopy => ({
              ref: o.ref,
              title: o.title,
              url: o.url,
              seller: o.seller,
              bucket: x.bucket ?? '',
              price: o.priceBase,
              paid: paidOf(o.priceBase, o.shipping),
            })),
        )
        .filter((c) => !seen.has(c.ref) && !!seen.add(c.ref))
        .toSorted((a, b) => a.price - b.price);
    };
    const inCondition = dayRows.filter((x) => better(x.bucket));
    const all = copiesOf(inCondition);
    // A row stores its cheapest listings only; its count may be larger. The stored
    // listings marked "not the item" (or failing the item's rules) are not counted (item 4).
    const count = Math.max(
      inCondition.reduce((k, x) => {
        const offers = supplyOffers(x) ?? [];
        const dropped = offers.filter((o) => !o.own && !pass(o)).length;
        return k + Math.max(Math.max(x.listings ?? 0, offers.length) - dropped, 0);
      }, 0),
      all.length,
    );
    const checked = status(source) === 'checked';
    if (checked)
      toNight(from, r, (rows, isTonight) =>
        (isTonight ? all : copiesOf(rows.filter((x) => better(x.bucket)))).map((c) => ({
          slot: `${source}|${c.ref}`,
          source,
          title: c.title,
          url: c.url,
          seller: c.seller,
          price: c.price,
          paid: c.paid,
          tonight: isTonight,
          run: false,
          own: false,
        })),
      );
    return {
      source,
      day,
      current,
      none: current && count === 0,
      status: checked ? 'checked' : 'unverified',
      copies: checked ? all.slice(0, WISH_COPIES) : [],
      count,
      capped: inCondition.some((x) => !!x.listingsCapped),
      unverifiedPrice: checked ? null : (all[0]?.price ?? null),
      apart: checked
        ? copiesOf(
            dayRows.filter((x) => !better(x.bucket) && !atOrBetter(x.bucket, 'cond:fair')),
          ).slice(0, WISH_COPIES)
        : [],
    };
  });

  // The cheapest checked copy (S36 C4, spec W16b): the cheapest copy an alert may name tonight
  // (every stored one, not only the ones listed), so the page, the card and the alert agree; while
  // check needed, the shop's only, as no search copy is shown. The lowest counted price; on a tie
  // the known one as paid first. A copy the alert step would not read (`validCopy`: a price of 0, a
  // paid amount of 0) is never the cheapest.
  const cheapest =
    tonight
      .filter((c) => validCopy(c) && (c.run || !checkNeeded))
      .map((c): WishCheapest => ({
        source: c.source,
        day: n!,
        price: c.price,
        paid: c.paid,
        counted: wishCost(c),
      }))
      .toSorted(
        (a, b) => a.counted - b.counted || Number(b.paid.known) - Number(a.paid.known),
      )[0] ?? null;
  return {
    shop,
    sources: checkNeeded ? [] : searched,
    cheapest,
    tonight,
    kept,
    read,
    shopSeen,
  };
}
