import type { CollectorRunStatus } from '@tora/core';
import {
  type Db,
  activeSources,
  finishRun,
  insertObservations,
  productsToMatch,
  saveCandidates,
  startRun,
  syncProductDetails,
  updateSourceProgress,
} from '@tora/db';
import { BlockedError, PoliteHttp, type PoliteHttpOptions, RequestCapError } from './http';
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

/** One run of one collector: match unlinked products, then collect linked listings. */
export async function runCollector(
  db: Db,
  collector: Collector,
  options: RunOptions = {},
): Promise<RunSummary> {
  const log = options.log ?? ((m: string) => console.log(`[${collector.source}] ${m}`));
  const http = new PoliteHttp(options.http);
  let added = 0;
  const ctx: CollectorContext = {
    http,
    now: options.now ?? new Date(),
    log,
    save: async (rows) => {
      const n = await insertObservations(db, rows);
      added += n;
      return n;
    },
  };
  const runId = await startRun(db, collector.source);
  const summary: RunSummary = {
    source: collector.source,
    status: 'ok',
    requests: 0,
    candidates: 0,
    observationsAdded: 0,
    errors: [],
  };
  const fail = (what: string, e: unknown) => {
    summary.errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    log(`error ${what}: ${e instanceof Error ? e.message : String(e)}`);
  };

  try {
    if (!options.collectOnly) {
      const toMatch = (
        await productsToMatch(db, collector.source, { productId: options.productId })
      ).filter((p) => collector.supports(p));
      for (const product of toMatch) {
        try {
          const found = await collector.findCandidates(product, ctx);
          const n = await saveCandidates(db, product.id, collector.source, found.slice(0, 8));
          summary.candidates += n;
          log(`match "${product.name}": ${found.length} found, ${n} new`);
        } catch (e) {
          if (e instanceof BlockedError || e instanceof RequestCapError) throw e;
          fail(`match ${product.name}`, e);
        }
      }
    }
    if (!options.matchOnly) {
      for (const { source: link, product } of await activeSources(db, collector.source, {
        productId: options.productId,
      })) {
        try {
          const before = added;
          const result = await collector.collect(link, product, ctx);
          await updateSourceProgress(db, link.id, {
            state: result.state,
            success: true,
            title: result.title,
            url: result.url,
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
