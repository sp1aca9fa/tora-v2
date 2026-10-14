import { type CollectorRunStatus, sourceInfo } from '@tora/core';
import {
  type Db,
  activeSources,
  createQuerySource,
  heldBuckets,
  finishRun,
  listProductSources,
  setSourceQuery,
  insertObservations,
  loadSourceRegistry,
  productSetInfo,
  productsToMatch,
  productsWithoutSource,
  QUERY_SOURCE_ID,
  updateSourceQuery,
  saveCandidates,
  suggestFromKnownProducts,
  startRun,
  syncProductDetails,
  updateSourceProgress,
} from '@tora/db';
import {
  BlockedError,
  PoliteHttp,
  type PoliteHttpOptions,
  RequestCapError,
  errorText,
} from './http';
import { baseConverter } from './money';
import type { Collector, CollectorContext } from './types';

export interface RunOptions {
  /** Only this product (matching and collection). */
  productId?: string;
  /** Search for candidates only; skip collecting. */
  matchOnly?: boolean;
  /** Collect only; skip searching for candidates. */
  collectOnly?: boolean;
  http?: PoliteHttpOptions;
  log?: (message: string) => void;
  /**
   * After each product: how far the run is (products done, or requests used when the request
   * budget is what will end it).
   */
  onProgress?: (p: { fraction: number; done: number; total: number }) => void;
  now?: Date;
}

export interface RunSummary {
  source: string;
  status: CollectorRunStatus;
  requests: number;
  candidates: number;
  observationsAdded: number;
  errors: string[];
}

/** Products searched per source per run (the rest wait for the next run). */
const MATCH_PER_RUN = 50;

/** One run of one collector: match unlinked products, then collect linked listings. */
export async function runCollector(
  db: Db,
  collector: Collector,
  options: RunOptions = {},
): Promise<RunSummary> {
  const log = options.log ?? ((m: string) => console.log(`[${collector.source}] ${m}`));
  const http = new PoliteHttp(options.http);
  let added = 0;
  const now = options.now ?? new Date();
  // Plug-ins report amounts in their own currency; they are stored in the base (S16).
  const toBase = await baseConverter(db);
  const own = sourceInfo(await loadSourceRegistry(db), collector.source)?.currency;
  const ctx: CollectorContext = {
    http,
    now,
    log,
    save: async (rows) => {
      const converted = [];
      for (const { price, ...row } of rows) {
        const c = await toBase(price, row.currency, row.observedAt);
        converted.push({
          ...row,
          priceBase: c.amount,
          fxRate: c.rate,
          raw: c.rateDate ? { ...(row.raw as object), fxDate: c.rateDate } : row.raw,
        });
      }
      const n = await insertObservations(db, converted);
      added += n;
      return n;
    },
    setOf: (product) => productSetInfo(db, product),
    linkedListings: async (productId) =>
      (await listProductSources(db, productId))
        .filter((s) => s.active)
        .map((s) => ({ source: s.source, title: s.title })),
  };
  const runId = await startRun(db, collector.source);
  // Progress: items (products to match + listings to collect) done before the current one.
  let total = 0;
  let done = 0;
  const report = () => {
    if (!options.onProgress || total === 0) return;
    const fraction = Math.max(done / total, http.requests / http.limit);
    options.onProgress({ fraction: Math.min(1, fraction), done, total });
  };
  const tick = () => {
    report();
    done++;
  };
  const summary: RunSummary = {
    source: collector.source,
    status: 'ok',
    requests: 0,
    candidates: 0,
    observationsAdded: 0,
    errors: [],
  };
  const fail = (what: string, e: unknown) => {
    summary.errors.push(`${what}: ${errorText(e)}`);
    log(`error ${what}: ${errorText(e)}`);
  };

  try {
    if (!options.collectOnly && collector.defaultQuery) {
      // Search-based source: every supported product starts with its default query, once (an
      // unlinked source stays off).
      for (const product of await productsWithoutSource(db, collector.source, {
        productId: options.productId,
      })) {
        if (!collector.supports(product)) continue;
        const query = collector.defaultQuery(product);
        if (!query) continue;
        await createQuerySource(db, product.id, collector.source, query);
        summary.candidates++;
        log(`search set up for "${product.name}": ${(query.keywords ?? []).join(' ')}`);
      }
    } else if (!options.collectOnly) {
      // Items the source does not handle are left out before the cap: otherwise the oldest of
      // them (e.g. cards, for a shop of games) took every slot and newer items never got searched.
      const toMatch = (
        await productsToMatch(db, collector.source, { productId: options.productId })
      )
        .filter((p) => collector.supports(p))
        .slice(0, MATCH_PER_RUN);
      total += toMatch.length;
      for (const product of toMatch) {
        tick();
        try {
          // A linked look-alike (same card or item) is offered first, without searching the site;
          // the search runs on a later run if the user dismisses it.
          const known = await suggestFromKnownProducts(db, product.id, collector.source);
          if (known > 0) {
            summary.candidates += known;
            log(`match "${product.name}": ${known} suggested from a linked look-alike`);
            continue;
          }
          const found = [];
          for (const { price, ...c } of (await collector.findCandidates(product, ctx)).slice(0, 8))
            found.push({
              ...c,
              priceBase: price == null ? null : (await toBase(price, own, now)).amount,
            });
          const n = await saveCandidates(db, product.id, collector.source, found);
          summary.candidates += n;
          log(`match "${product.name}": ${found.length} kept, ${n} new`);
        } catch (e) {
          if (e instanceof BlockedError || e instanceof RequestCapError) throw e;
          fail(`match ${product.name}`, e);
        }
      }
    }
    if (!options.matchOnly) {
      const sources = await activeSources(db, collector.source, {
        productId: options.productId,
      });
      total += sources.length;
      for (const { source: listing, product } of sources) {
        tick();
        let link = listing;
        try {
          // An auto-made query from an older version of the collector's defaults is regenerated.
          const extra = link.query?.extra as { edited?: boolean; v?: number } | undefined;
          if (
            collector.defaultQuery &&
            collector.queryVersion &&
            link.externalId === QUERY_SOURCE_ID &&
            !extra?.edited &&
            (extra?.v ?? 1) < collector.queryVersion
          ) {
            const fresh = collector.defaultQuery(product);
            // Keep what the user added to the old query (e.g. pasted reference listings).
            const {
              auto: _auto,
              v: _v,
              ...kept
            } = (link.query?.extra ?? {}) as Record<string, unknown>;
            const query = fresh && { ...fresh, extra: { ...kept, ...fresh.extra } };
            if (query) {
              await updateSourceQuery(db, link.id, query);
              link = { ...link, query, state: null };
              log(`search for "${product.name}" updated: ${(query.keywords ?? []).join(' ')}`);
            }
          }
          const before = added;
          const result = await collector.collect(
            link,
            product,
            ctx,
            await heldBuckets(db, product.id),
          );
          if (result.query) await setSourceQuery(db, link.id, result.query);
          await updateSourceProgress(db, link.id, {
            state: result.state,
            success: true,
            title: result.title,
            url: result.url,
            recentSales:
              result.recentSales &&
              (await Promise.all(
                result.recentSales.map(async ({ price, ...r }) => ({
                  ...r,
                  priceBase: (await toBase(price, own, r.observedAt)).amount,
                })),
              )),
            imageUrl: result.imageUrl,
          });
          const title = result.title ?? link.title;
          if (!link.detailsSyncedAt && title && collector.productDetails) {
            const changed = await syncProductDetails(
              db,
              link,
              collector.productDetails(title, product),
            );
            if (changed) log(`details of "${product.name}" updated from the linked listing`);
          }
          log(
            `collect "${product.name}": +${added - before} observations${result.complete ? '' : ' (continues next run)'}`,
          );
        } catch (e) {
          if (e instanceof BlockedError || e instanceof RequestCapError) throw e;
          fail(`collect ${product.name}`, e);
        }
      }
    }
    done = total;
    report();
    if (summary.errors.length) summary.status = 'partial';
  } catch (e) {
    if (e instanceof BlockedError) {
      summary.status = 'blocked';
      fail('blocked', e);
    } else if (e instanceof RequestCapError) {
      summary.status = 'partial';
      log('request cap reached; the rest continues next run');
    } else {
      summary.status = 'failed';
      fail('run', e);
    }
  }

  summary.requests = http.requests;
  summary.observationsAdded = added;
  await finishRun(db, runId, {
    status: summary.status,
    requests: summary.requests,
    observationsAdded: added,
    error: summary.errors.join('\n') || null,
  });
  return summary;
}
