/**
 * A price source. Minimal for now; search, fetchObservations and condition mapping
 * are added with the framework in S3.
 */
export interface Collector {
  /** Matches `product_sources.source` and `price_observations.source`. */
  source: string;
  label: string;
}

/** Shape every collectors package (public or private) exports from its entry point. */
export interface CollectorModule {
  collectors: Collector[];
}
