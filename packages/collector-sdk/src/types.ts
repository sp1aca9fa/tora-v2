import type {
  CandidateInput,
  NewPriceObservation,
  Product,
  ProductSource,
  RecentSale,
} from '@tora/db';
import type { PoliteHttp } from './http';

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
  /** Fetches new observations for a linked listing and saves them through `ctx.save`. */
  collect(link: ProductSource, product: Product, ctx: CollectorContext): Promise<CollectResult>;
  /**
   * Product details read from a confirmed listing's title, applied once per link (the linked
   * listing is the source of truth). Null when the title says nothing reliable (e.g. a variant).
   */
  productDetails?(title: string, product: Product): ProductDetails | null;
}

export type ProductDetails = Partial<
  Pick<Product, 'name' | 'rarity' | 'setName' | 'setCode' | 'cardNumber' | 'variant' | 'imageUrl'>
>;

/** Shape every collectors package (public or private) exports from its entry point. */
export interface CollectorModule {
  collectors: Collector[];
}
