// A game item's stored listings (requirements S36 A2, A4; plan section 9 D): the plug-in returns
// what its own filter kept from its for-sale search (`CollectResult.found`) beside its own supply
// rows, and the SDK chooses: for a game with the rules on and not held it stores rows from the found
// listings, filtered here; otherwise the plug-in's rows as given (the runner). A listing is kept
// when its title and category pass the item's rules (`failsRules`, as for sales), a person did not
// mark it "not the item" at that source, and it is not under the plug-in's line (`foundFloor`). The
// cheapest 20 are stored while that source's listings are not confirmed for the item, 5 once they
// are; the condition's lowest ask is the cheapest of them and its count how many passed. A condition
// the search found listings in but where none passed, or one the source's current report holds that
// the search found nothing in tonight, gets a row with no ask and 0 listings: an earlier report
// (yesterday's, or an earlier collect today) never stands as tonight's.
import type { SupplyOffer } from '@tora/db';
import { failsRules } from './game-rules';
import type { FoundListing, FoundSearch, ItemRulesContext, SupplyInput } from './types';

/** Listings stored per source and condition until that source's listings are confirmed (S36 A2). */
export const OFFERS_UNCONFIRMED = 20;
/** Once confirmed (S36 A2: "then 3 to 5"). */
export const OFFERS_CONFIRMED = 5;

/** A supply row as the runner converts and saves it, with the kept listings when it has them. */
export type SupplyWithOffers = SupplyInput & {
  offers?: FoundListing[] | null;
  listingsCapped?: boolean | null;
};

/**
 * The listings of one condition that pass, cheapest first, all of them. Equal prices keep the
 * plug-in's order (a stable sort), so with no rules and no marks the first is the plug-in's own ask.
 */
export function passingListings(
  found: readonly FoundListing[],
  floor: number | null | undefined,
  itemRules: ItemRulesContext,
  source: string,
): FoundListing[] {
  return found
    .filter(
      (l) =>
        Number.isFinite(l.price) &&
        !itemRules.notItemRefs.has(l.ref) &&
        // Same line as the plug-in's own ask: under it is not taken as a price.
        !(floor != null && l.price < floor) &&
        !failsRules({ title: l.title, category: l.category }, itemRules.rules, source),
    )
    .toSorted((a, b) => a.price - b.price);
}

/**
 * The supply rows to store for a game item with the rules on and not held (S36 A2, A4): one per
 * condition the search found listings in, its listings filtered and cut to the cheapest 20 or 5,
 * `lowestAsk`, `url` and `listings` from them. A condition where none passed has no ask: 0 listings
 * when the search showed everything, an unknown count when it may hold more (real copies may sit
 * past what was read). A condition the search found nothing in gets no row, as for any item. Every
 * row carries the search's cap.
 */
export function supplyWithOffers(
  search: FoundSearch,
  itemRules: ItemRulesContext,
  source: string,
): SupplyWithOffers[] {
  const keep = itemRules.listingsConfirmed ? OFFERS_CONFIRMED : OFFERS_UNCONFIRMED;
  const listingsCapped = search.foundCapped ?? null;
  return search.buckets.map((b): SupplyWithOffers => {
    const passed = passingListings(b.found, b.foundFloor, itemRules, source);
    if (!passed.length)
      return {
        bucket: b.bucket,
        lowestAsk: null,
        currency: search.currency,
        listings: listingsCapped === false ? 0 : null,
        url: null,
        raw: search.raw,
        offers: [],
        listingsCapped,
      };
    const offers = passed.slice(0, keep);
    return {
      bucket: b.bucket,
      lowestAsk: offers[0]!.price,
      currency: offers[0]!.currency,
      listings: passed.length,
      url: offers[0]!.url,
      raw: search.raw,
      offers,
      listingsCapped,
    };
  });
}

/**
 * A found listing as stored, once its price is in the base currency. Shipping is what the plug-in
 * states per listing, else `unknown`: the source's payer id is kept as given, and which id means
 * "the seller pays" is not known yet.
 */
export function storedOffer(l: FoundListing, priceBase: number): SupplyOffer {
  return {
    ref: l.ref,
    title: l.title,
    url: l.url,
    priceBase,
    priceOriginal: l.price,
    currency: l.currency,
    seller: l.seller,
    category: l.category,
    shipping: l.shipping ?? 'unknown',
    shippingPayerId: l.shippingPayerId,
    // The identity shop's fields (S36 A6), only on its entries: the marketplaces' rows stay as they were.
    ...(l.own && {
      own: l.own,
      stock: l.stock ?? null,
      count: l.count ?? null,
      condition: l.condition ?? null,
    }),
  };
}
