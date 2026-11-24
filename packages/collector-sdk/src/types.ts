import type {
  AddedCost,
  CatalogSetEntry,
  CodeMeaning,
  EffectiveRules,
  MarketJobKind,
  ReprintHint,
  SignalRule,
  SourceInfo,
  SuggestedRates,
} from '@tora/core';
import type {
  CandidateInput,
  ConsoleInput,
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
  SourceFactsInput,
  SourceQuery,
} from '@tora/db';

export type { ConsoleInput, SourceFactsInput } from '@tora/db';
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
   * A game item's product code (JAN) as its identity shop's active link in this source's market
   * stored it (S36 A5, `product_sources.facts.jan`); null when none is stored. Read only (S36 B5).
   */
  productCode?: (product: Product) => Promise<string | null>;
  /**
   * The item's kept sales in the source's own market since `since` (ms), in the source's currency,
   * for judging far prices against its own history (S30). One packed row read per item. Empty when
   * they cannot be compared: the source declares no market, or its currency is not the base.
   */
  keptSales?: (
    productId: string,
    since: number,
  ) => Promise<{ bucket: string | null; price: number; at: number }[]>;
  /**
   * For collectors with `historyPhase`: `fresh` asks for the new sales, what is for sale and the
   * last sale only (older history left for later: `complete: false`); `history` asks only to
   * catch up older history, with the requests left once every listing had its fresh pass.
   * Undefined for other collectors (one pass doing everything).
   */
  phase?: 'fresh' | 'history';
  /**
   * A game item's rules (S36 A1, A2), with the admin's "Game rules" switch on; absent for every other
   * item and with the switch off. The search the plug-in gets already carries the console's category
   * and the required words (never the excluded ones); the SDK judges the sales it saves.
   */
  itemRules?: ItemRulesContext;
}

/** What a plug-in is told about a game item's rules (`CollectorContext.itemRules`). */
export interface ItemRulesContext {
  /** The item's effective rules (S36 Terms "The item's rules"). */
  rules: EffectiveRules;
  /** `rulesHash(rules, source)`: this source's rules, the hash its sales here are marked under. */
  hash: string;
  /** Whether this source's listings are confirmed for the item (S36 Terms "Confirmed"). */
  listingsConfirmed: boolean;
  /** Listing refs at this source a person marked "not the item". */
  notItemRefs: ReadonlySet<string>;
}

/** A stored or new sale's title and category as the source gave them (S36 A1; in `@tora/core`). */
export type { SaleText } from '@tora/core';
import type { SaleText } from '@tora/core';

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
  /** A game's found listings with the rules on (`FoundSearch`); left out otherwise. */
  found?: FoundSearch;
  /**
   * What the pages read show about the item beside its prices (S36 A5); a field not shown is null.
   * The SDK stores them (`product_sources.facts`) and fills the item's empty release date for a game
   * item only (`isGameItem`); for any other item they are dropped.
   */
  facts?: SourceFactsInput;
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
  /**
   * The row's listings, cheapest first (S36 A6, B2: the identity shop's own copy and its outside
   * seller as separate entries). Stored (`supply.offers`) for a game item only (`isGameItem`); for
   * any other item the SDK drops them and stores the row as before.
   */
  offers?: FoundListing[];
}

/**
 * A game item's for-sale search with the rules on (`CollectorContext.itemRules`; S36 A2, A4), given
 * beside `CollectResult.supply`, which stays the plug-in's own rows. Per condition, the listings the
 * plug-in's own filter keeps (as for its supply rows) from every page it read, without its line
 * under which an ask is not taken as a price (`foundFloor`). The SDK applies the item's rules, the
 * "not the item" marks and that line, and stores rows from these for a game whose rules are not
 * held; otherwise it stores `supply` as given.
 */
export interface FoundSearch {
  /** Every condition with a listing the plug-in kept; empty when it kept none. */
  buckets: FoundBucket[];
  /** The search had more than it read (S36 A4: the count is "at least"); null: not known. */
  foundCapped: boolean | null;
  /** ISO 4217: the currency of a condition's row where no listing passed. */
  currency: string;
  /** Stored on each row, as a supply row's `raw`. */
  raw?: unknown;
}

/** One condition's found listings (`FoundSearch`). */
export interface FoundBucket {
  /** Valuation bucket; null when the source does not say. */
  bucket: string | null;
  /** In the search's order (cheapest first): the first of equal prices is the condition's ask. */
  found: FoundListing[];
  /** The plug-in's own line: a listing under it is not taken as a price; null: none. */
  foundFloor: number | null;
}

/** A listing a for-sale search found (S36 A2), its price in the source's own currency. */
export interface FoundListing {
  /** The listing's id at the source (what a "not the item" mark names). */
  ref: string;
  title: string;
  url: string | null;
  /** Per unit, in `currency`'s smallest unit. */
  price: number;
  /** ISO 4217. */
  currency: string;
  /** Null when the search does not say. */
  seller: string | null;
  /** The source's category id, as text; null when the listing does not say. */
  category: string | null;
  /**
   * The source's own id of who pays shipping, opaque; null when the listing does not say. Which id
   * means "the seller pays" is not known yet, so it is kept as given and never read as either.
   */
  shippingPayerId: string | null;
  /**
   * Who pays shipping, only when the source states it per listing (S36 C1); left out: `unknown`.
   * Never inferred from `shippingPayerId`.
   */
  shipping?: 'included' | 'buyer' | 'unknown';
  /** The identity shop's entries only (`SupplyOffer.own`, S36 A6): its own copy or an outside seller. */
  own?: 'own' | 'outside';
  /** The shop's own copy: how many it has, when shown; null: not shown. */
  stock?: number | null;
  /** An outside seller's entry: how many copies its site lists, when shown; null: not shown. */
  count?: number | null;
  /** An outside seller's entry: the condition the page states; null: not shown. */
  condition?: string | null;
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
  http?: Pick<PoliteHttpOptions, 'minDelayMs' | 'maxDelayMs' | 'maxRequests' | 'retries'>;
  /**
   * Its link is the item's own product code read from stored facts (S36 B5: the JAN), not a search:
   * for items with no row at the source, `findCandidates` returns the code without any request (or
   * nothing) and the runner links the first at once, with no person's confirmation and no
   * look-alike's listing offered first.
   */
  linksByCode?: boolean;
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
   * Search-based sources: the address of the site's search for one category id (S36 Terms "Console
   * table"), so an admin can open it from the console page and see the number is right. Null, or not
   * declared: no link. The app only links to it; it never fetches it.
   */
  categoryUrl?(category: string): string | null;
  /**
   * How to read a sale's title and category from its row as stored (its `title` column and its raw,
   * parsed), for the game rules (S36 A1). Sources without it are never judged by item rules.
   */
  saleText?(sale: { title: string | null; raw: unknown }): SaleText;
  /**
   * What a buyer adds to this source's prices, for its sales and its listings (S36 Terms "As paid",
   * C1): `included`, `per_row` (each row's `raw.shipping`: `included`, `buyer` with
   * `raw.shippingAmount`, or `unknown`) or `unknown`. Not declared: unknown, so its sales stay out of a
   * wish's level until a shipping sample is recorded (`addedCostSampled`); a passing sample makes it
   * `per_row` with a row that does not tell counted as included. `raw.shipping` is the one payer field:
   * the level reads it (`rowShipping` in @tora/core) and so does the stored shipping sample.
   */
  addedCost?: AddedCost;
  /**
   * Keys of its state (`CollectResult.state`) the runner keeps as stored when it handed the plug-in a
   * game's search with the rules laid over it (S36 A1): what a narrowed search would teach it (e.g.
   * the categories it searches besides) must not outlive the admin's switch.
   */
  overlayKeeps?: readonly string[];
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
  /** Daytime job kinds it reads (S36 B4); a job of another kind waits. */
  jobKinds?: readonly MarketJobKind[];
  /**
   * Per kind, the days a job reads past its `wantedFrom` (default 0): the runner calls a job done
   * once a step's `oldestReached` is at or before `wantedFrom` minus these days, even when the
   * plug-in did not say so.
   */
  jobMarginDays?: Partial<Record<MarketJobKind, number>>;
  /**
   * One step of a daytime job (S36 B4): exactly one request, only through `ctx.http` (the runner
   * counts it against the marketplace's day, checks the hours and the collect before it, and
   * discards the step when the request failed, even if the plug-in caught the error). Returns the
   * rows to save (the SDK saves them; a plug-in never writes), the cursor to go on from and
   * whether the job is done. A cursor names the search it belongs to: given one of another search
   * (the item was merged or renamed), the plug-in starts over. A step that is not done must move
   * the cursor (the same cursor back stops the job).
   */
  runJob?(job: MarketJob, ctx: JobContext): Promise<JobStep>;
}

/** A daytime job as a plug-in sees it. */
export interface MarketJob {
  id: string;
  source: string;
  kind: MarketJobKind;
  productId: string | null;
  /** The oldest day it wants (YYYY-MM-DD), or null for as far as the site goes. */
  wantedFrom: string | null;
  /** The last step's cursor; null at the start. */
  cursor: unknown;
}

export interface JobContext {
  http: Pick<PoliteHttp, 'text' | 'json' | 'postJson' | 'bytes'>;
  now: Date;
  log: (message: string) => void;
  /** The job's item now (it may have been merged since the job was queued); null: none. */
  product: Product | null;
  /**
   * The search the nightly read would send for the item now (its stored or default search, an
   * outdated auto search renewed, the game rules laid over it), never stored; null: none.
   */
  search: SourceQuery | null;
  /** Titles of the pasted listings already in the item's link state (read by no request). */
  references: string[];
}

export interface JobStep {
  rows: PriceInput[];
  cursor: unknown;
  done: boolean;
  /**
   * The oldest listing day the current search has surely read (YYYY-MM-DD), or null; reset when
   * the search changes (a merge, an edit), so a span never reaches back on another search.
   */
  oldestReached: string | null;
  /**
   * The search the step read (any key naming it) and the app-zone day its first page was read: a
   * finished job's covered days end the day before (S36 "Covered day"). Findings of another key are
   * dropped.
   */
  search?: { key: string; day: string };
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

/** A stored sold row, as the re-check of stored sales gives it to its plug-in (S30). */
export interface StoredSale {
  id: string;
  title: string | null;
  /** The row's `raw`, parsed; null when missing or broken. */
  raw: Record<string, unknown> | null;
  /** Its stored condition. */
  bucket: string | null;
  /** In the sale's own currency when known, else the base currency. */
  price: number;
  observedAt: string;
}

/**
 * What today's rules say of a stored row. `skipped`: it cannot be read as the live path wrote it,
 * so nothing is said (never a rejection). `bucket`: the condition its title reads as today. `low`:
 * the rejection is not applied unless asked (it rests on what a title does not show).
 */
export type StoredVerdict =
  | { id: string; skipped: string }
  | { id: string; ok: true; bucket: string | null }
  | { id: string; ok: false; detail: string; bucket: string | null; low?: boolean };

/** A stored sale in the far check's replay. `markable`: a kept row no person vouched for. */
export interface StoredPeer {
  id: string;
  bucket: string | null;
  price: number;
  at: number;
  markable: boolean;
}

/**
 * The plug-in's own rules, run again on the sales it stored (S30 step 5). Pure: it decides, the SDK
 * runs the flow and `@tora/db` writes. `assess` gets one listing's rows at a time, `far` one item's
 * rows; `id` on a history row lets a flag take it out.
 */
export interface SalesRechecker {
  /** The sources it can judge; never a noAi one. */
  sources: string[];
  /** Hash of the rules, so a run proves it uses the rules that were rehearsed. */
  rulesId(): string;
  /** Verdicts of a listing's stored rows, or why the whole listing is not judged. */
  assess(
    source: string,
    product: Product,
    link: ProductSource,
    sales: StoredSale[],
  ): StoredVerdict[] | { skipped: string };
  /** Kept rows to mark as far from the item's history: one list of peers per source. */
  far(
    peersBySource: StoredPeer[][],
    history: { id?: string; bucket: string | null; price: number; at: number }[],
    now: number,
  ): Set<string>;
  /** The live path's wording for such a row. */
  farDetail: string;
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
  /** Re-checks the sales it stored with today's rules (S30). */
  recheckers?: SalesRechecker[];
  /**
   * Suggested rows for the console table (S36 Terms "Console table"): names, other spellings, the
   * software category per marketplace. Offered on the admin page; saved only when an admin adds them.
   */
  consoles?: ConsoleInput[];
}
