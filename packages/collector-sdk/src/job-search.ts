// The search a daytime job reads for an item (requirements S36 B3; plan-deep-read.md step 5): the
// one the nightly read would send now, so a deep read and a read-back read the same sales.
import { type JobResult, atLeastAsBroad } from '@tora/core';
import {
  type Db,
  type Product,
  type SourceQuery,
  gameRuleInputs,
  gameRulesOn,
  getProduct,
  removeSpan,
  schema,
  searchLink,
} from '@tora/db';
import { eq, isNotNull } from 'drizzle-orm';
import { overlayQuery } from './game-rules';
import type { Collector } from './types';

/**
 * The item's search at the plug-in's marketplace as `runCollector` builds it: the stored search or
 * the plug-in's default; an outdated auto search renewed the same way (kept extras, such as pasted
 * listings, stay), but never written; the game rules laid over it with the admin's switch on (a
 * held item too, as the nightly does). `references`: the pasted listings' titles the link's state
 * already holds (read by no request). Null: the item has no active search there.
 */
export async function jobSearch(
  db: Db,
  collector: Collector,
  product: Product,
): Promise<{ search: SourceQuery | null; references: string[] } | null> {
  const source = collector.source;
  const link = await searchLink(db, product.id, source);
  if (!link) return null;
  let search = link.query ?? collector.defaultQuery?.(product) ?? null;
  const extra = link.query?.extra as { edited?: boolean; v?: number } | undefined;
  if (
    collector.defaultQuery &&
    collector.queryVersion &&
    !extra?.edited &&
    (extra?.v ?? 1) < collector.queryVersion
  ) {
    const fresh = collector.defaultQuery(product);
    const { auto: _auto, v: _v, ...kept } = (link.query?.extra ?? {}) as Record<string, unknown>;
    if (fresh) search = { ...fresh, extra: { ...kept, ...fresh.extra } };
  }
  if (search && product.category === 'game' && (await gameRulesOn(db))) {
    const rules = (await gameRuleInputs(db, [product], source)).get(product.id);
    if (rules) search = overlayQuery(search, rules.rules, source);
  }
  const known = (link.state as { references?: Record<string, { name?: unknown }> } | null)
    ?.references;
  const references = Object.values(known ?? {}).flatMap((r) =>
    typeof r?.name === 'string' ? [r.name] : [],
  );
  return { search, references };
}

/**
 * The closing step's check of the spans (fix round 1, rule c): a span stays only while the search
 * its job read (`result.read`) reads at least what the item's search reads today (`atLeastAsBroad`,
 * the loader's rule), so a console category corrected, a required word dropped, the rules switch
 * turned off or a merge bringing another item's span takes it back. A job that did not record its
 * search loses its span too. The item's search off (none, or no words): the span stays (its rows
 * are there). Only marketplaces with a loaded plug-in. Known limit: excluded words and price bounds
 * are not compared, as the loader does not. A span removed: its job's result loses `span` and gets
 * why 'narrower_search', in one transaction. Returns the spans removed. No request.
 */
export async function dropUncoveredSpans(
  db: Db,
  collectors: readonly Collector[],
): Promise<number> {
  const bySource = new Map(collectors.map((c) => [c.source, c]));
  const spans = await db
    .select({
      productId: schema.saleSpans.productId,
      source: schema.saleSpans.source,
      jobId: schema.saleSpans.jobId,
      result: schema.marketJobs.result,
    })
    .from(schema.saleSpans)
    .leftJoin(schema.marketJobs, eq(schema.marketJobs.id, schema.saleSpans.jobId))
    .where(isNotNull(schema.saleSpans.jobId));
  const today = new Map<string, SourceQuery | null>();
  let dropped = 0;
  for (const span of spans) {
    const collector = bySource.get(span.source);
    if (!collector || !span.jobId) continue;
    const key = `${span.productId} ${span.source}`;
    if (!today.has(key)) {
      const product = await getProduct(db, span.productId);
      today.set(key, product ? ((await jobSearch(db, collector, product))?.search ?? null) : null);
    }
    const search = today.get(key);
    if (!search?.keywords?.length) continue;
    const read = span.result?.read;
    if (read && atLeastAsBroad(read, search)) continue;
    const jobId = span.jobId;
    dropped += await db.transaction(async (tx) => {
      const gone = await removeSpan(tx, jobId);
      const [job] = await tx
        .select({ result: schema.marketJobs.result })
        .from(schema.marketJobs)
        .where(eq(schema.marketJobs.id, jobId));
      if (job) {
        const { span: _s, ...rest }: JobResult = job.result ?? {};
        await tx
          .update(schema.marketJobs)
          .set({ result: { ...rest, why: 'narrower_search' } })
          .where(eq(schema.marketJobs.id, jobId));
      }
      return gone;
    });
  }
  return dropped;
}
