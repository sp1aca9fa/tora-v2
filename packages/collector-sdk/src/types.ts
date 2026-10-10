import type {
  CandidateInput,
  HoldingInput,
  NewPriceObservation,
  Product,
  ProductInput,
  ProductSource,
  RecentSale,
  SourceQuery,
} from '@tora/db';
import type { PoliteHttp } from './http';
import type { Email } from './mbox';

export interface CollectorContext {
  http: PoliteHttp;
  now: Date;
  log: (message: string) => void;
  /** Stores observations as they are parsed (idempotent); returns how many were new. */
  save: (rows: NewPriceObservation[]) => Promise<number>;
}

export interface CollectResult {
  /** Progress to persist on the product source (e.g. backfill cursor). */
  state: unknown;
  /** True when the listing is fully up to date (false when a page budget cut the run short). */
  complete: boolean;
  title?: string | null;
  url?: string | null;
  /** Newest trades as seen now (may have approximate times); shown as "last sale". */
  recentSales?: RecentSale[];
  /** The listing's picture (stored on the listing; the product shows its first listing's). */
  imageUrl?: string | null;
}

/** A price source (requirements section 7). Implementations live in collectors packages. */
export interface Collector {
  /** Matches `product_sources.source` and `price_observations.source`. */
  source: string;
  label: string;
  /** Whether this source can price the product (e.g. SNKRDUNK: TCG only). */
  supports(product: Product): boolean;
  /** Searches the site for listings that may be this product, best first, with a 0-1 score. */
  findCandidates(product: Product, ctx: CollectorContext): Promise<CandidateInput[]>;
  /**
   * Search-based sources (no listing per product, e.g. a flea market): the query a product starts
   * with. When defined, every supported product gets an active source with this query at once
   * (no candidates to confirm); the user tunes or unlinks it in the app.
   */
  defaultQuery?(product: Product): SourceQuery | null;
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
}

export type ProductDetails = Partial<
  Pick<Product, 'name' | 'rarity' | 'setName' | 'setCode' | 'cardNumber' | 'variant' | 'imageUrl'>
>;

/** One purchase read from an order confirmation email. */
export interface PurchaseReceipt {
  /** Transaction / order ID at the marketplace (e.g. a SNKRDUNK 取引ID). */
  orderId: string;
  /** Tokyo ISO timestamp of the order. */
  orderedAt: string;
  /** Item title as shown on the receipt (usually the listing title). */
  title: string;
  quantity: number;
  /** Amount paid, fees and shipping included; becomes the holding's cost. */
  totalJpy: number;
  /** Item price alone, when the receipt shows it (manual entries may have used it). */
  itemPriceJpy?: number | null;
  /** Listing at the marketplace (the price source to link the product to). */
  listing?: { externalId: string; url: string } | null;
  /** Condition as the marketplace shows it (e.g. "A", "PSA10"). */
  condition?: string | null;
}

export type ReceiptMail =
  | { kind: 'purchase'; receipt: PurchaseReceipt }
  | { kind: 'cancel'; orderId: string }
  /** Looked like a receipt but could not be read; reported, never guessed. */
  | { kind: 'unreadable'; subject: string; reason: string }
  /** An item arrived. Shops may not say which order (SNKRDUNK does not): matched per item. */
  | { kind: 'delivered'; title: string; quantity: number; at: string }
  /** Something about an order worth a look, e.g. `deadline_missed` (the buyer may cancel). */
  | { kind: 'notice'; orderId: string; reason: string };

/** Reads a marketplace's emails into purchases (requirements S5b). */
export interface PurchaseImporter {
  /** Order source key (`holdings.order_source`, `product_sources.source`). */
  source: string;
  /** Stored as the holding's "acquired from". */
  label: string;
  /** Cheap pre-filter on a raw header block (e.g. the sender domain). */
  matchesHeader(rawHeader: string): boolean;
  /** Null for mails that are not receipts or cancellations. */
  parse(mail: Email): ReceiptMail | null;
  /** Product to create when no product is linked to the listing yet; null when unclear. */
  productFor(receipt: PurchaseReceipt): ProductInput | null;
  /** Holding fields read from the receipt for that product (condition, grading, packaging). */
  holdingFor?(
    receipt: PurchaseReceipt,
    product: Pick<Product, 'category' | 'kind'>,
  ): Partial<HoldingInput>;
}

/** Shape every collectors package (public or private) exports from its entry point. */
export interface CollectorModule {
  collectors: Collector[];
  importers?: PurchaseImporter[];
}
