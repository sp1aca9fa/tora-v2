import type {
  CatalogSetEntry,
  CodeMeaning,
  ReprintHint,
  SignalRule,
  SourceInfo,
  SuggestedRates,
} from '@tora/core';
import type {
  CandidateInput,
  FoundSetCard,
  ListedStore,
  HoldingInput,
  NewPriceObservation,
  Product,
  ProductInput,
  ProductSource,
  RankedEntry,
  RankingInfo,
  RecentSale,
  SourceQuery,
} from '@tora/db';
import type { PoliteHttp, PoliteHttpOptions } from './http';
import type { Email } from './mbox';

export interface CollectorContext {
  http: PoliteHttp;
  now: Date;
  log: (message: string) => void;
  /**
   * Stores observations as they are parsed (idempotent; converted to the base currency with the
   * rate of their day); returns how many were new.
   */
  save: (rows: PriceInput[]) => Promise<number>;
  /**
   * The catalog set of a product (its own set code and release date first, else the catalog set
   * it points to or is named after); null when unknown.
   */
  setOf?: (product: Product) => Promise<{ code: string | null; releaseDate: string | null } | null>;
  /** The product's active listings on other sources (e.g. TCGplayer's English title). */
  linkedListings?: (productId: string) => Promise<{ source: string; title: string | null }[]>;
  /**
   * For collectors with `historyPhase`: `fresh` asks for the new sales, what is for sale and the
   * last sale only (older history left for later: `complete: false`); `history` asks only to
   * catch up older history, with the requests left once every listing had its fresh pass.
   * Undefined for other collectors (one pass doing everything).
   */
  phase?: 'fresh' | 'history';
}

/**
 * A price as a plug-in reports it: in its own currency, never converted (requirements S16); the
 * collect converts it to the base currency and keeps the rate used.
 */
export type PriceInput = Omit<NewPriceObservation, 'priceBase' | 'fxRate' | 'currency'> & {
  /** Per unit, in the currency's smallest unit (yen; cents for dollars). */
  price: number;
  /** ISO 4217 code of `price` and `priceOriginal`. */
  currency: string;
};

/** A listing found by a search, its price in the source's own currency. */
export type FoundCandidate = Omit<CandidateInput, 'priceBase'> & {
  /** In the source's currency's smallest unit. */
  price?: number | null;
};

/** A recent trade as the source shows it, its price in the source's own currency. */
export type FoundSale = Omit<RecentSale, 'priceBase'> & { price: number };

export interface CollectResult {
  /** Progress to persist on the product source (e.g. backfill cursor). */
  state: unknown;
  /** True when the listing is fully up to date (false when a page budget cut the run short). */
  complete: boolean;
  title?: string | null;
  url?: string | null;
  /** Newest trades as seen now (may have approximate times); shown as "last sale". */
  recentSales?: FoundSale[];
  /** The listing's picture (stored on the listing; the product shows its first listing's). */
  imageUrl?: string | null;
  /** Search-based sources: the search actually run, when the collector filled it in. */
  query?: SourceQuery;
  /**
   * What is for sale now (S9 part 2): the lowest ask and the number of listings per condition,
   * every condition with something for sale. Left out when the source cannot tell.
   */
  supply?: SupplyInput[];
}

/** One condition's listings on a source today, in the source's own currency. */
export interface SupplyInput {
  /** Valuation bucket (e.g. `raw:A`, `sealed:shrink`); null when the source does not say. */
  bucket: string | null;
  /** Per unit, in `currency`'s smallest unit; null when the source shows none (e.g. lots only). */
  lowestAsk: number | null;
  /** ISO 4217. */
  currency: string;
  /** Null when the source does not say how many. */
  listings: number | null;
  /** The cheapest listing, or the page listing them. */
  url?: string | null;
  raw?: unknown;
}

/** A price source (requirements section 7). Implementations live in collectors packages. */
export interface Collector {
  /** Matches `product_sources.source` and `price_observations.source`. */
  source: string;
  label: string;
  /**
   * This site's pace and request cap per run (default 2-5 s between requests, 500 requests). A
   * plug-in can only slow down: requests are never closer than 2 s.
   */
  http?: Pick<PoliteHttpOptions, 'minDelayMs' | 'maxDelayMs' | 'maxRequests'>;
  /** Whether this source can price the product (e.g. SNKRDUNK: TCG only). */
  supports(product: Product): boolean;
  /** Searches the site for listings that may be this product, best first, with a 0-1 score. */
  findCandidates(product: Product, ctx: CollectorContext): Promise<FoundCandidate[]>;
  /**
   * Search-based sources (no listing per product, e.g. a flea market): the query a product starts
   * with. When defined, every supported product gets an active source with this query at once
   * (no candidates to confirm); the user tunes or unlinks it in the app.
   */
  defaultQuery?(product: Product): SourceQuery | null;
  /**
   * Version of `defaultQuery`. Auto-made queries of an older version are regenerated on the next
   * run; queries the user edited (`extra.edited`) are kept.
   */
  queryVersion?: number;
  /**
   * The collector fills in older history apart from the new sales (`ctx.phase`): every listing
   * gets its fresh pass first, and the history is caught up with the requests left, so a long
   * backfill never keeps other listings from their daily prices.
   */
  historyPhase?: boolean;
  /**
   * Fetches new observations for a linked listing and saves them through `ctx.save`.
   * `heldBuckets`: the conditions users own of this product (e.g. `graded:PSA:10`), for sources
   * that only show a few trades per condition.
   */
  collect(
    link: ProductSource,
    product: Product,
    ctx: CollectorContext,
    heldBuckets?: string[],
  ): Promise<CollectResult>;
  /**
   * Product details read from a confirmed listing's title, applied once per link (the linked
   * listing is the source of truth). Null when the title says nothing reliable (e.g. a variant).
   */
  productDetails?(title: string, product: Product): ProductDetails | null;
  /**
   * Whether a listing shows the product in one condition only (e.g. SNKRDUNK's 【シュリンクなし】
   * boxes): its picture is never the product's while a plain listing has one.
   */
  variantListing?(title: string): boolean;
}

export type ProductDetails = Partial<
  Pick<Product, 'name' | 'rarity' | 'setName' | 'setCode' | 'cardNumber' | 'variant' | 'imageUrl'>
>;

/** One purchase read from an order confirmation email (or a pasted purchase link). */
export interface PurchaseReceipt {
  /** Transaction / order ID at the marketplace (e.g. a SNKRDUNK 取引ID). */
  orderId: string;
  /** ISO timestamp of the order (any offset; stored in the app's time zone). */
  orderedAt: string;
  /** Item title as shown on the receipt (usually the listing title). */
  title: string;
  quantity: number;
  /**
   * Amount paid, fees and shipping included, in `currency`'s smallest unit; becomes the
   * holding's cost (converted to the base currency).
   */
  total: number;
  /** Item price alone, when the receipt shows it (manual entries may have used it). */
  itemPrice?: number | null;
  /** ISO 4217 code of the amounts; default: the shop's (its source description), else the base. */
  currency?: string | null;
  /** Listing at the marketplace (the price source to link the product to). */
  listing?: { externalId: string; url: string } | null;
  /** Condition as the marketplace shows it (e.g. "A", "PSA10"). */
  condition?: string | null;
  /** The marketplace's category names, top level first (e.g. ["ゲーム・おもちゃ・グッズ", …]). */
  categoryPath?: string[];
  /** The listing of this exact item: becomes a reference sale on the product's search. */
  reference?: string | null;
  /** Photo of the item (the product's picture when it has none). */
  photo?: string | null;
  /** The date is approximate (e.g. read from the listing, not a receipt): checked in review. */
  dateApprox?: boolean;
  /**
   * The source showed no order ID: `orderId` is only a key for this import and is not stored.
   * Such a purchase is recognised again only by product, price and date (as a likely match).
   */
  noOrderId?: boolean;
}

/** What a pasted purchase link turned out to be. */
export type LinkRead =
  | { kind: 'purchase'; receipt: PurchaseReceipt }
  /** Not imported on purpose, with the reason shown to the user (e.g. not a collectible). */
  | { kind: 'skip'; reason: string }
  /** Could not be imported (e.g. the listing has not sold); shown to the user. */
  | { kind: 'fail'; reason: string };

export type ReceiptMail =
  | { kind: 'purchase'; receipt: PurchaseReceipt }
  | { kind: 'cancel'; orderId: string }
  /** Looked like a receipt but could not be read; reported, never guessed. */
  | { kind: 'unreadable'; subject: string; reason: string }
  /** An item arrived. Shops may not say which order (SNKRDUNK does not): matched per item. */
  | { kind: 'delivered'; title: string; quantity: number; at: string }
  /** Something about an order worth a look, e.g. `deadline_missed` (the buyer may cancel). */
  | { kind: 'notice'; orderId: string; reason: string }
  /** An item left out on purpose (e.g. not a collectible), with the reason; reported once. */
  | { kind: 'skip'; title: string; reason: string; orderId?: string };

/**
 * Reads a marketplace's purchases (requirements S5b): from receipt emails, from links the user
 * pasted in the app (shops that send no receipt email), or both.
 */
export interface PurchaseImporter {
  /** Order source key (`holdings.order_source`, `product_sources.source`). */
  source: string;
  /** Stored as the holding's "acquired from". */
  label: string;
  /** Cheap pre-filter on a raw header block (e.g. the sender domain). */
  matchesHeader?(rawHeader: string): boolean;
  /** Null for mails that are not receipts or cancellations; a list for orders of several items. */
  parse?(mail: Email): ReceiptMail | ReceiptMail[] | null;
  /** Whether a pasted link is this marketplace's. */
  matchesLink?(url: string): boolean;
  /** Reads a pasted link to something the user bought. */
  readLink?(url: string, http: PoliteHttp): Promise<LinkRead>;
  /** Product to create when no product is linked to the listing yet; null when unclear. */
  productFor(receipt: PurchaseReceipt): ProductInput | null;
  /** Holding fields read from the receipt for that product (condition, grading, packaging). */
  holdingFor?(
    receipt: PurchaseReceipt,
    product: Pick<Product, 'category' | 'kind'> & { itemType?: string | null },
  ): Partial<HoldingInput>;
}

/** Daily exchange rates (requirements S16): prices in other currencies are converted with them. */
export interface RateSource {
  /** Chosen in Settings > Markets per currency; never changes. */
  key: string;
  label: string;
  /** Currencies it has rates between (ISO 4217). */
  currencies: string[];
  /**
   * Units of `to` per unit of `from` for the days between two dates (inclusive); days without a
   * rate are left out.
   */
  rates(
    http: PoliteHttp,
    pair: { from: string; to: string },
    start: string,
    end: string,
  ): Promise<{ date: string; rate: number }[]>;
}

/** Shape every collectors package (public or private) exports from its entry point. */
/**
 * A set catalog (S10): a list of sets (name, code, release date, region) for the set picker on
 * Add and the set-based features (release dates, set lines, box opening). Only the regions the
 * admin's set categories list are loaded; the collect loads it again when it changes.
 */
export interface SetCatalog {
  /** Stable key (the sets' `source` field says where each one came from). */
  key: string;
  label: string;
  sets(): Promise<CatalogSetEntry[]>;
}

/**
 * Lists a set's cards of one rarity with their prices, for the box opening value (S20). Run once a
 * week per set by the nightly collect.
 */
export interface SetCardSource {
  source: string;
  cards(
    set: { code: string; name: string; rarity: string },
    ctx: Pick<CollectorContext, 'http' | 'now' | 'log'>,
  ): Promise<FoundSetCard[]>;
  /** What a card sells for now: the median of its recent single raw sales, or null. */
  sold?(
    externalId: string,
    ctx: Pick<CollectorContext, 'http' | 'now' | 'log'>,
  ): Promise<{ price: number; sales: number } | null>;
}

/**
 * Lists physical stores for store notices (S25): a chain's stores with the codes posters use and
 * where they are. Saved each time the plug-ins are loaded.
 */
export interface StoreDirectory {
  /** Saved as the stores' source ("japan-stores"). */
  key: string;
  label: string;
  /** The language the stores' names are written in ("ja"), for their labels in other languages. */
  language?: string;
  stores(): ListedStore[] | Promise<ListedStore[]>;
  /** Codes posters use that are no store or place (states, chain marks, products). */
  glossary?: CodeMeaning[];
}

/**
 * Suggests pull rates for the box opening value (S20): per set, how many cards of each rarity a
 * box holds on average, naming where the numbers come from. Saved each time the plug-ins are
 * loaded; the admin corrects them in Settings > Admin > Box opening.
 */
export interface PullRateSource {
  key: string;
  label: string;
  rates(): SuggestedRates[] | Promise<SuggestedRates[]>;
}

/**
 * Reads a site's ranking once a day, with the nightly collect (S13): its items in rank order, each
 * with its id on the plug-in's `source` (the id that source's collector links items by), its page,
 * and any price and activity numbers the site shows. Tora saves the day's ranks; the top items
 * nobody tracks become candidates, created and collected like watched items while they stay in
 * the ranking (requirements S13, docs/collectors.md).
 */
export interface RankingSource {
  /** Saved with each rank ("snkrdunk-pokemon-boxes"). */
  key: string;
  label: string;
  /** The collector source whose ids the items carry ("snkrdunk"). */
  source: string;
  /** What a candidate made from it is. */
  item: RankingInfo['item'];
  rank(ctx: Pick<CollectorContext, 'http' | 'now' | 'log'>): Promise<RankedEntry[]>;
}

export interface CollectorModule {
  collectors: Collector[];
  importers?: PurchaseImporter[];
  rates?: RateSource[];
  /**
   * The package's price sources and shops, described for the app (label, role per item class,
   * links, aliases...; requirements S8, sources with roles). Saved to the database on each run.
   */
  sources?: SourceInfo[];
  setCards?: SetCardSource[];
  pullRates?: PullRateSource[];
  stores?: StoreDirectory[];
  rankings?: RankingSource[];
  catalogs?: SetCatalog[];
  /**
   * Signal plug-ins for Opportunities (S27): an admin's strategies, tested on past prices like the
   * built-in signals (docs/opportunities.md).
   */
  signals?: SignalRule[];
  /** Guesses whether items will be reprinted (S27), until an admin marks them. */
  reprintHints?: ReprintHint[];
}
