// Read-only views of one user's data for Claude (requirements S4b). Plain functions over the
// database, so the MCP server (server.ts) and the tests share them. Results are compact JSON:
// amounts as integers in the base currency's smallest unit, dates as ISO strings, lists limited.
import { judge, noAiSources, productClass, strategyOf } from '@tora/core';
import {
  type Db,
  type Holding,
  type Product,
  cardGradeCounts,
  cardNumberKey,
  collectorHealth,
  getProduct,
  holdingBucket,
  listPendingCandidates,
  listProductSources,
  loadMarketData,
  rawMarketData,
  openSuggestionCount,
  reviewNotes,
  oddSales,
  pendingImportReview,
  missingPriceSources,
  pendingMatchesForUser,
  portfolioSeries,
  portfolioValuation,
  priceHistory,
  sameNameKey,
  productLots,
  productLines,
  releaseDates,
  latestSignals,
  latestRanks,
  loadOpportunities,
  rankingLabels,
  getUserById,
  similarKey,
  similarProducts,
  schema,
  summarizeByProduct,
  valueHolding,
  loadSourceRegistry,
  listWatches,
  listingsIn,
  lowestAsk,
  currentSupply,
  savedBucketValues,
  bucketValueKey,
  QUERY_SOURCE_ID,
} from '@tora/db';
import { and, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';

const { holdings, products, priceObservations, productImages, productSources, watches } = schema;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
/** In place of numbers from a source whose terms keep its data from AI models. */
const HIDDEN = 'from a source Claude may not read';

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** What a valuation says, in a few fields; none of it when its source is kept from AI. */
function valuationFacts(v: ReturnType<typeof valueHolding>, noAi: string[]) {
  if (v.source && noAi.includes(v.source)) return { hidden: HIDDEN };
  return {
    valueBase: v.valueBase,
    unitBase: v.unitBase,
    method: v.method,
    source: v.source,
    bucket: v.bucket,
    sales: v.sampleSize,
    windowDays: v.windowDays,
    pooled: v.pooled,
    confidence: v.confidence,
    estimatedLotSales: v.estimatedSamples,
    lastSale:
      v.last && !noAi.includes(v.last.source)
        ? { priceBase: v.last.priceBase, source: v.last.source, at: day(v.last.observedAt) }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------

export async function portfolioSummary(db: Db, userId: string) {
  const p = await portfolioValuation(db, userId);
  const valuations = new Map(p.rows.map((r) => [r.holding.id, r.valuation]));
  const summaries = summarizeByProduct(p.rows, valuations);
  const withPl = summaries.filter((s) => s.unrealizedBase !== null);
  const byPl = withPl.toSorted((a, b) => b.unrealizedBase! - a.unrealizedBase!);
  const row = (s: (typeof summaries)[number]) => ({
    productId: s.product.id,
    name: s.product.name,
    kind: s.product.kind,
    units: s.units,
    spentBase: s.spentBase,
    valueBase: s.valuedLots ? s.valueBase : null,
    unrealizedBase: s.unrealizedBase,
    unrealizedPct: s.unrealizedBase === null ? null : pct(s.unrealizedBase, s.valuedCostBase),
  });
  const series = await portfolioSeries(db, userId);
  // The chart, thinned: the first of each month, plus every day of the last 30.
  const recentFrom = series.at(-30)?.date ?? '';
  const chart = series
    .filter((s) => s.date.endsWith('-01') || s.date >= recentFrom)
    .map((s) => ({
      date: s.date,
      valueBase: Number(s.valueBase),
      costBase: Number(s.costBase),
      atCostBase: Number(s.atCostBase),
    }));
  return {
    totals: p.totals,
    byKind: p.breakdown,
    products: summaries.length,
    topByValue: summaries.slice(0, 10).map(row),
    biggestGains: byPl.slice(0, 5).map(row),
    biggestLosses: byPl.slice(-5).reverse().map(row),
    valueOverTime: chart,
  };
}

export async function listProducts(
  db: Db,
  userId: string,
  filter: {
    kind?: string;
    franchise?: string;
    status?: 'owned' | 'all';
    unvalued?: boolean;
    q?: string;
  } = {},
) {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        filter.status === 'all' ? undefined : eq(holdings.status, 'owned'),
        filter.kind ? eq(products.kind, filter.kind as Product['kind']) : undefined,
        filter.franchise ? eq(products.franchise, filter.franchise) : undefined,
      ),
    );
  const q = filter.q ? sameNameKey(filter.q) : null;
  const picked = rows.filter((r) => !q || sameNameKey(r.product.name).includes(q));
  const market = await loadMarketData(db, userId, [...new Set(picked.map((r) => r.product.id))]);
  const valuations = new Map(
    picked.map((r) => [r.holding.id, valueHolding(r.holding, r.product, market)]),
  );
  const noAi = noAiSources(await loadSourceRegistry(db));
  return summarizeByProduct(picked, valuations)
    .map((s) => {
      const first = valuations.get(s.lots[0]!.holding.id)!;
      const hidden = !!first.source && noAi.includes(first.source);
      return {
        productId: s.product.id,
        name: s.product.name,
        kind: s.product.kind,
        franchise: s.product.franchise,
        lots: s.lots.length,
        units: s.units,
        spentBase: s.spentBase,
        valueBase: s.valuedLots && !hidden ? s.valueBase : null,
        unrealizedBase: hidden ? null : s.unrealizedBase,
        valuedLots: s.valuedLots,
        valuation: hidden
          ? { hidden: HIDDEN }
          : {
              method: first.method,
              source: first.source,
              sales: first.sampleSize,
              windowDays: first.windowDays,
              pooled: first.pooled,
              confidence: first.confidence,
            },
      };
    })
    .filter((p) => !filter.unvalued || p.valuedLots < p.lots);
}

export async function productDetail(db: Db, userId: string, productId: string) {
  const product = await getProduct(db, productId);
  if (!product) return { error: 'not found' };
  const noAi = noAiSources(await loadSourceRegistry(db));
  const [lots, sources, candidates, market, released, similar, lines] = await Promise.all([
    productLots(db, userId, productId),
    listProductSources(db, productId),
    listPendingCandidates(db, productId),
    loadMarketData(db, userId, [productId]),
    releaseDates(db, [product]),
    similarProducts(db, product),
    productLines(db, [product]),
  ]);
  return {
    product,
    class: productClass(product),
    // S9: the set catalog's date, else the item's own, else its first collected sale.
    release: released.get(productId) ?? null,
    similarItems: { group: similarKey(product), count: similar.length },
    // S9: its set line (by hand, else from the Pokemon set title); group studies use it.
    line: lines.get(productId) ?? null,
    lots: lots.map((h) => ({
      holdingId: h.id,
      status: h.status,
      quantity: h.quantity,
      costBase: h.costTotalBase,
      acquiredAt: day(h.acquiredAt),
      acquiredFrom: h.acquiredFrom,
      orderId: h.orderId,
      condition: h.condition,
      packaging: h.packagingState,
      grading:
        h.grading === 'graded' ? `${h.grader} ${h.grade}` : h.rawGrade ? `raw ${h.rawGrade}` : null,
      reviewPending: h.reviewPending,
      reviewReason: h.reviewReason,
      valuation:
        h.status === 'owned' ? valuationFacts(valueHolding(h, product, market), noAi) : null,
    })),
    sources: sources.map((s) => ({
      source: s.source,
      active: s.active,
      listing: s.externalId,
      title: s.title,
      url: s.url,
      query: s.query,
      lastCollected: day(s.lastSuccessAt),
      sales: s.observations,
      latestSale: day(s.latestObservation),
      learned:
        s.state && typeof s.state === 'object'
          ? pickLearned(s.state as Record<string, unknown>)
          : null,
    })),
    pendingSuggestions: candidates.map((c) => ({
      source: c.source,
      title: c.title,
      score: c.score,
      url: c.url,
    })),
  };
}

/** The parts of a collector's state that explain its behavior (not cursors). */
function pickLearned(state: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of [
    'categories',
    'references',
    'tradesSince',
    'catalogId',
    'ingestedThrough',
    'mode',
  ]) {
    if (k in state) out[k] = state[k];
  }
  return out;
}

export async function priceHistoryOf(
  db: Db,
  productId: string,
  filter: { bucket?: string; source?: string; days?: number } = {},
) {
  const points = await priceHistory(db, productId, filter.days ?? 365);
  const noAi = noAiSources(await loadSourceRegistry(db));
  return points.filter(
    (p) =>
      !noAi.includes(p.source) &&
      (!filter.bucket || p.bucket === filter.bucket) &&
      (!filter.source || p.source === filter.source),
  );
}

export async function sales(
  db: Db,
  productId: string,
  filter: { source?: string; status?: 'kept' | 'excluded' | 'all'; limit?: number } = {},
) {
  const limit = Math.min(filter.limit ?? 50, 300);
  const noAi = noAiSources(await loadSourceRegistry(db));
  const rows = await db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        filter.source ? eq(priceObservations.source, filter.source) : undefined,
        // Sources whose terms forbid giving their data to AI models (this is read by Claude).
        noAi.length ? notInArray(priceObservations.source, noAi) : undefined,
        filter.status === 'kept'
          ? eq(priceObservations.excluded, false)
          : filter.status === 'excluded'
            ? eq(priceObservations.excluded, true)
            : undefined,
      ),
    )
    .orderBy(desc(priceObservations.observedAt))
    .limit(limit);
  return rows.map((r) => {
    const raw = (r.raw ?? {}) as {
      name?: string;
      filter?: string;
      reference?: boolean;
      categoryId?: number;
    };
    return {
      at: day(r.observedAt),
      source: r.source,
      priceBase: r.priceBase,
      lotPriceBase: r.priceOriginal !== r.priceBase ? r.priceOriginal : undefined,
      bucket: r.bucket,
      kept: !r.excluded,
      why: r.excluded ? (raw.filter ?? r.excludedReason) : undefined,
      title: raw.name,
      estimatedLot: r.quantityInferred || undefined,
      pasted: raw.reference || undefined,
      category: raw.categoryId,
      url: r.url,
    };
  });
}

export async function collectorStatus(db: Db) {
  const health = await collectorHealth(db);
  const runs = await db
    .select()
    .from(schema.collectorRuns)
    .orderBy(desc(schema.collectorRuns.startedAt))
    .limit(10);
  return {
    health,
    recentRuns: runs.map((r) => ({
      source: r.source,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      requests: r.requests,
      newSales: r.observationsAdded,
      error: r.error,
    })),
  };
}

export async function reviewQueue(db: Db, userId: string) {
  const [imports, matches, grades] = await Promise.all([
    pendingImportReview(db, userId),
    pendingMatchesForUser(db, userId),
    cardGradeCounts(db, userId),
  ]);
  return {
    importsToReview: imports.map(({ holding, product }) => ({
      holdingId: holding.id,
      name: product.name,
      orderId: holding.orderId,
      acquiredAt: day(holding.acquiredAt),
      reasons: holding.reviewReason,
    })),
    pendingMatches: matches.map((m) => ({ productId: m.product.id, name: m.product.name })),
    cards: grades,
  };
}

// ---------------------------------------------------------------------------------------------
// data checks

interface Finding {
  check: string;
  severity: 'warn' | 'info';
  about: string;
  count: number;
  items: unknown[];
}

const SHOWN = 20;
const finding = (
  check: string,
  severity: Finding['severity'],
  about: string,
  items: unknown[],
): Finding => ({
  check,
  severity,
  about,
  count: items.length,
  items: items.slice(0, SHOWN),
});

/** Canned sanity checks over the user's data, each with what it means. */
export async function dataChecks(db: Db, userId: string, now = new Date()): Promise<Finding[]> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), inArray(holdings.status, ['owned', 'consumed'])));
  const owned = rows.filter((r) => r.holding.status === 'owned');
  const productIds = [...new Set(rows.map((r) => r.product.id))];
  const market = await rawMarketData(db, userId, productIds, now);
  const valued = owned.map((r) => ({ ...r, v: valueHolding(r.holding, r.product, market, now) }));
  // Numbers from a source whose terms keep its data from AI models are left out.
  const noAiKeys = noAiSources(await loadSourceRegistry(db));
  const lot = (h: Holding, p: Product) => ({ holdingId: h.id, productId: p.id, name: p.name });
  const findings: Finding[] = [];

  findings.push(
    finding(
      'unvalued',
      'warn',
      'Owned lots with no market value (no condition / grade, or no sales and no retail price).',
      valued
        .filter((x) => x.v.valueBase === null)
        .map((x) => ({
          ...lot(x.holding, x.product),
          bucket: holdingBucket(x.holding, x.product),
        })),
    ),
  );
  findings.push(
    finding(
      'low_confidence',
      'info',
      'Values from few or old sales, or with similar conditions pooled: treat as rough.',
      valued
        .filter(
          (x) =>
            x.v.method === 'median' &&
            (x.v.confidence === 'low' || x.v.pooled) &&
            !noAiKeys.includes(x.v.source ?? ''),
        )
        .map((x) => ({
          ...lot(x.holding, x.product),
          source: x.v.source,
          sales: x.v.sampleSize,
          windowDays: x.v.windowDays,
          pooled: x.v.pooled,
        })),
    ),
  );

  // Look-alikes: the same name (and card number) registered as separate products, among every
  // item (a twin nobody holds can still take the sales), shown when one is the user's.
  const mine = new Set([
    ...productIds,
    ...(
      await db.select({ id: watches.productId }).from(watches).where(eq(watches.userId, userId))
    ).map((w) => w.id),
  ]);
  const groups = new Map<string, Product[]>();
  for (const p of await db.select().from(products)) {
    const key = `${p.kind}|${sameNameKey(p.name)}|${cardNumberKey(p.cardNumber) ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  findings.push(
    finding(
      'look_alikes',
      'warn',
      'Separate products with the same name and number: probably duplicates (merge them from the product edit page).',
      [...groups.values()]
        .filter((g) => g.length > 1 && g.some((p) => mine.has(p.id)))
        .map((g) => g.map((p) => ({ productId: p.id, name: p.name, setCode: p.setCode }))),
    ),
  );

  // One listing linked to several items: its sales are stored once, under one of them.
  const links = await db
    .select({
      source: productSources.source,
      externalId: productSources.externalId,
      product: products,
    })
    .from(productSources)
    .innerJoin(products, eq(products.id, productSources.productId))
    .where(and(eq(productSources.active, true), ne(productSources.externalId, QUERY_SOURCE_ID)));
  const byListing = new Map<string, typeof links>();
  for (const l of links) {
    const key = `${l.source}|${l.externalId}`;
    byListing.set(key, [...(byListing.get(key) ?? []), l]);
  }
  findings.push(
    finding(
      'shared_listings',
      'warn',
      'One listing linked to several items: a sale is stored once, so only one item gets them. They are the same item: merge them from the product edit page.',
      [...byListing.values()]
        .filter((g) => g.length > 1 && g.some((l) => mine.has(l.product.id)))
        .map((g) => ({
          source: g[0]!.source,
          listing: g[0]!.externalId,
          items: g.map((l) => ({ productId: l.product.id, name: l.product.name })),
        })),
    ),
  );

  findings.push(
    finding(
      'odd_sales',
      'info',
      'Sales of the last 30 days at over 3x or under 1/3 of the value (the median ignores them, but they may be mismatches to exclude).',
      oddSales(valued, market, now)
        .filter((o) => !noAiKeys.includes(o.source))
        .map((o) => ({
          ...lot(o.holding, o.product),
          source: o.source,
          priceBase: o.priceBase,
          valueBase: o.valueBase,
          at: day(o.observedAt),
        })),
    ),
  );

  // Searches that keep little of what they find.
  const searches = await db
    .select({ source: productSources, product: products })
    .from(productSources)
    .innerJoin(products, eq(products.id, productSources.productId))
    .where(
      and(
        eq(productSources.externalId, 'search'),
        eq(productSources.active, true),
        inArray(productSources.productId, productIds),
      ),
    );
  const weak: unknown[] = [];
  for (const { source, product } of searches) {
    if (!source.lastSuccessAt || noAiKeys.includes(source.source)) continue;
    const obs = await db
      .select({ excluded: priceObservations.excluded })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.productId, product.id),
          eq(priceObservations.source, source.source),
        ),
      );
    const kept = obs.filter((o) => !o.excluded).length;
    if (obs.length && (kept === 0 || kept / obs.length < 0.15)) {
      weak.push({
        productId: product.id,
        name: product.name,
        source: source.source,
        query: source.query?.keywords,
        kept,
        found: obs.length,
      });
    }
  }
  findings.push(
    finding(
      'weak_searches',
      'warn',
      'Search-based sources keeping under 15% of what they find: the search words may need tuning, or a pasted reference listing.',
      weak,
    ),
  );

  const health = await collectorHealth(db, now);
  findings.push(
    finding(
      'collectors',
      'info',
      'Collector health (stale listings, pending matches, big moves).',
      health,
    ),
  );

  const images = new Set(
    (
      await db
        .select({ id: productImages.productId })
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
    ).map((r) => r.id),
  );
  const unique = [...new Map(owned.map((r) => [r.product.id, r.product])).values()];
  findings.push(
    finding(
      'missing_details',
      'info',
      'Products missing details that searches and matching rely on.',
      unique.flatMap((p) => {
        const missing = [
          productClass(p) === 'card' &&
            !p.cardNumber &&
            !/-\d{3}$/.test(p.setCode ?? '') &&
            'card number',
          p.category === 'tcg' && !p.setName && 'set name',
          !images.has(p.id) && 'picture',
        ].filter(Boolean);
        return missing.length ? [{ productId: p.id, name: p.name, missing }] : [];
      }),
    ),
  );

  const estimated = await db
    .select({
      productId: priceObservations.productId,
      inferred: priceObservations.quantityInferred,
    })
    .from(priceObservations)
    .where(
      and(inArray(priceObservations.productId, productIds), eq(priceObservations.excluded, false)),
    );
  const share = new Map<string, { n: number; inferred: number }>();
  for (const e of estimated) {
    const s = share.get(e.productId) ?? { n: 0, inferred: 0 };
    s.n++;
    if (e.inferred) s.inferred++;
    share.set(e.productId, s);
  }
  findings.push(
    finding(
      'estimated_lots',
      'info',
      'Products whose sales include estimated lot sizes (the source did not report quantities then).',
      [...share]
        .filter(([, s]) => s.inferred > 0)
        .map(([id, s]) => ({
          productId: id,
          name: unique.find((p) => p.id === id)?.name,
          estimated: s.inferred,
          of: s.n,
        })),
    ),
  );

  const review = await pendingImportReview(db, userId);
  findings.push(
    finding(
      'review_pending',
      'info',
      'Imported lots waiting in Review import.',
      review.map(({ holding, product }) => ({
        ...lot(holding, product),
        reasons: holding.reviewReason,
      })),
    ),
  );
  const [open, notes] = await Promise.all([
    openSuggestionCount(db, userId),
    reviewNotes(db, userId, SHOWN),
  ]);
  findings.push(
    finding(
      'missing_price_sources',
      'warn',
      `Owned items without their main price source (the reference source of their class in the source registry; other items only when they cost more than the identity amount set in Settings > Identity, base currency's smallest unit).`,
      (await missingPriceSources(db, userId)).map((m) => ({
        productId: m.product.id,
        name: m.product.name,
        needs: m.source,
        costBase: m.costBase,
        suggestions: m.suggestions,
      })),
    ),
  );
  findings.push(
    finding(
      'review_notes',
      'info',
      `The user's comments on data review suggestions (the review model follows them; ${open} suggestion(s) still open). Notes that keep coming up may belong in the filters as a rule.`,
      notes.map((n) => ({
        note: n.note,
        product: n.productName,
        suggestion: n.kind,
        decision: n.status,
        reason: n.reason,
        at: n.decidedAt ? day(n.decidedAt) : null,
      })),
    ),
  );
  return findings;
}

// ---------------------------------------------------------------------------------------------
// read-only SQL

/**
 * Tables with a row per source (sales, asks, timing signals, link candidates): read through a
 * version without the rows of the sources kept from AI.
 */
const SALES_TABLES = [
  'price_observations',
  'price_days_dirty',
  'supply',
  'signals',
  'source_candidates',
];
/** Tables mixing every source's data in one row: never read through `query_sql`. */
const PACKED_TABLES: Record<string, string> = {
  item_sales: "holds every source's sales together: read price_observations instead.",
  holding_values:
    "holds each lot's value per day from every source: read portfolio_charts instead.",
};

/**
 * Tables whose rows are kept but some columns are rebuilt without the sources kept from AI:
 * column name to the expression replacing it (`l` is the quoted list of those sources).
 */
const HIDDEN_COLUMNS: Record<string, Record<string, (l: string) => string>> = {
  // Every row stays (which items have which listings); the trades last seen there and the
  // collector's opaque progress (which may hold page data) are left out for those sources.
  product_sources: {
    recent_sales: (l) => `case when source in (${l}) then null else recent_sales end`,
    state: (l) => `case when source in (${l}) then null else state end`,
  },
  // A saved value (BucketValue in @tora/db valuation.ts) carries the last sale, the buy price and
  // a summary per source besides the valuation: those of the sources are taken out.
  bucket_values: {
    value: (l) =>
      `json_set(value, ` +
      `'$.last', case when json_extract(value, '$.last.source') in (${l}) then null ` +
      `else json(json_extract(value, '$.last')) end, ` +
      `'$.buylist', case when json_extract(value, '$.buylist.source') in (${l}) then null ` +
      `else json(json_extract(value, '$.buylist')) end, ` +
      `'$.sources', json((select json_group_array(json(s.value)) ` +
      `from json_each(main.bucket_values.value, '$.sources') s ` +
      `where coalesce(json_extract(s.value, '$.source'), '') not in (${l}))))`,
  },
};

/** Rows left out (besides the sales tables' rows of those sources). */
const ROW_FILTERS: Record<string, (l: string) => string> = {
  // Valued from those sources' sales: the whole value is theirs.
  bucket_values: (l) => `coalesce(json_extract(value, '$.valuation.source'), '') not in (${l})`,
};

/** Tables `withoutSources` rebuilds columns of: their column names are needed (`columns`). */
export const REBUILT_TABLES = Object.keys(HIDDEN_COLUMNS);

/** The query as SQLite reads it, with its comments blanked (quoted text and names kept). */
function withoutComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      for (;;) {
        j = text.indexOf(close, j);
        if (j === -1) {
          j = text.length;
          break;
        }
        // A doubled quote is a quote inside the text.
        if (close !== ']' && text[j + 1] === close) {
          j += 2;
          continue;
        }
        j += 1;
        break;
      }
      out += text.slice(i, j);
      i = j;
    } else if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      out += ' ';
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * The query reading the tables that hold the given sources' data through versions without it
 * (requirements S4b; the sources' terms forbid giving their data to AI models): a common table
 * expression with each table's own name, which SQLite reads instead of the table everywhere in
 * the query. Only a schema prefix (`main.`) reaches the real table: refused, like the tables that
 * mix sources in a row. A query's own CTE named like a guarded table fails (a duplicate name).
 * `columns` lists the columns of the tables in `REBUILT_TABLES`.
 */
export function withoutSources(
  text: string,
  sources: string[],
  columns: Record<string, string[]> = {},
): { sql: string } | { error: string } {
  if (sources.length === 0) return { sql: text };
  const mentions = (table: string) => new RegExp(`\\b${table}\\b`, 'i').test(text);
  for (const [table, why] of Object.entries(PACKED_TABLES)) {
    if (mentions(table)) return { error: `${table} ${why}` };
  }
  const code = withoutComments(text);
  if (/(?:\b|["'`[])(?:main|temp)["'`\]]?\s*\./i.test(code)) {
    return { error: 'Read tables by their plain name (no main. or temp. prefix).' };
  }
  // Raw database pages and index samples would show every row.
  if (/\bsqlite_(?:dbpage|stat\d)\b/i.test(code)) {
    return { error: 'sqlite_dbpage and sqlite_stat tables are not readable here.' };
  }
  const list = sources.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  const guards: string[] = [];
  for (const table of SALES_TABLES) {
    if (!mentions(table)) continue;
    guards.push(
      `${table} as (select * from main.${table} where source is null or source not in (${list}))`,
    );
  }
  for (const [table, hidden] of Object.entries(HIDDEN_COLUMNS)) {
    if (!mentions(table)) continue;
    const names = columns[table] ?? [];
    if (!names.length) return { error: `${table} cannot be read now (its columns are unknown).` };
    const select = names
      .map((n) => (hidden[n] ? `${hidden[n](list)} as "${n}"` : `"${n.replace(/"/g, '""')}"`))
      .join(', ');
    const where = ROW_FILTERS[table] ? ` where ${ROW_FILTERS[table](list)}` : '';
    guards.push(`${table} as (select ${select} from main.${table}${where})`);
  }
  if (!guards.length) return { sql: text };
  // A query with its own WITH list gets the guards first in it (they read no CTE).
  const own = /^with(?:\s+recursive)?\b/i.exec(text);
  return own
    ? { sql: `${own[0]} ${guards.join(', ')},${text.slice(own[0].length)}` }
    : { sql: `with ${guards.join(', ')} ${text}` };
}

/**
 * One read-only SELECT (or WITH ... SELECT), run in a read transaction (writes fail) with a row
 * limit. Not scoped to the user: the database holds this household's data only.
 */
export async function querySql(db: Db, sql: string, limit = 200) {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text) || text.includes(';')) {
    return { error: 'Only one SELECT (or WITH ... SELECT) statement is allowed.' };
  }
  // Sources whose terms forbid giving their data to AI models: every read of their data goes
  // through a version of the table without it.
  const noAi = noAiSources(await loadSourceRegistry(db));
  const columns: Record<string, string[]> = {};
  if (noAi.length) {
    for (const table of REBUILT_TABLES) {
      const rs = await db.$client.execute({
        sql: 'select name from pragma_table_info(?)',
        args: [table],
      });
      columns[table] = rs.rows.map((r) => String(r.name));
    }
  }
  const guarded = withoutSources(text, noAi, columns);
  if ('error' in guarded) return guarded;
  const tx = await db.$client.transaction('read');
  try {
    const rs = await tx.execute(
      // The line break keeps a trailing -- comment from swallowing the closing parenthesis.
      `select * from (${guarded.sql}\n) limit ${Math.min(Math.max(1, limit), 1000)}`,
    );
    return {
      columns: rs.columns,
      rows: rs.rows.map((r) => Object.fromEntries(rs.columns.map((c) => [c, r[c]]))),
    };
  } catch (error) {
    return { error: String(error) };
  } finally {
    await tx.rollback().catch(() => {});
  }
}

/**
 * The user's watchlist (S9): each watched item and condition, the target price, and today's
 * market value and lowest ask in that condition (sources Claude may not read are left out).
 */
export async function watchlist(db: Db, userId: string) {
  const rows = await listWatches(db, userId);
  const noAi = noAiSources(await loadSourceRegistry(db));
  const values = await savedBucketValues(
    db,
    rows.map((r) => ({ product: r.product, bucket: r.watch.bucket || null })),
  );
  const supply = await currentSupply(
    db,
    rows.map((r) => r.product.id),
  );
  const [timing, user] = await Promise.all([
    latestSignals(
      db,
      rows.map((r) => ({ productId: r.product.id, bucket: r.watch.bucket || null })),
    ),
    getUserById(db, userId),
  ]);
  return rows.map(({ watch, product }) => {
    const signal = timing.get(`${product.id}|${watch.bucket}`);
    const choice = strategyOf(user?.preferences, productClass(product));
    // Numbers from a source Claude may not read are left out, as is the ask (given above).
    const stats =
      signal && !(signal.source && noAi.includes(signal.source))
        ? { ...signal.stats, ask: null }
        : null;
    const v = values.get(bucketValueKey(product.id, watch.bucket || null))?.valuation;
    const hidden = !!v?.source && noAi.includes(v.source);
    const asks = (supply.get(product.id) ?? []).filter((s) => !noAi.includes(s.source));
    const ask = lowestAsk(asks, watch.bucket);
    return {
      watchId: watch.id,
      productId: product.id,
      name: product.name,
      kind: product.kind,
      bucket: watch.bucket || null,
      targetPriceBase: watch.targetPriceBase,
      note: watch.note,
      watchedSince: day(watch.createdAt),
      market:
        v && !hidden
          ? {
              unitBase: v.unitBase,
              method: v.method,
              source: v.source,
              sales: v.sampleSize,
              windowDays: v.windowDays,
              confidence: v.confidence,
            }
          : null,
      // What is for sale now (asking prices, not sales), from the last nightly collect.
      lowestAsk: ask
        ? {
            unitBase: ask.lowestAskBase,
            source: ask.source,
            day: ask.day,
            listings: listingsIn(asks, watch.bucket),
          }
        : null,
      // Buy timing (S9 part 4): the person's strategy for the item's type, its verdict and zone
      // on the last saved numbers, and the numbers (fractions, not percents).
      buyTiming: stats
        ? (() => {
            const j = judge(stats, choice);
            return {
              day: signal!.day,
              strategy: choice,
              verdict: j.verdict,
              zoneTopBase: j.zone.top,
              zoneBasis: j.zone.basis,
              loweredByNewSetPattern: j.zone.pattern,
              fallingFast: j.falling,
              marketFalling: j.marketFalling,
              // Cheap for its year and its fall paused: the market's fall does not make it wait.
              cheapSteady: j.cheapSteady,
              // A new release waits until similar items' usual first-year low (else 90 days).
              newRelease: j.newRelease,
              newReleaseWaitDays: j.waitDays,
              limitedData: j.limited,
              numbers: stats,
            };
          })()
        : null,
    };
  });
}

/**
 * Opportunities (S13): items worth a look within their group of similar items, best first, from
 * the signals worked out after the last collect. Items priced from a source Claude may not read
 * are left out, as are such asks and shop buy prices.
 */
export async function opportunities(db: Db, filter: { itemType?: string; limit?: number } = {}) {
  const saved = await loadOpportunities(db);
  if (!saved) return { day: null, items: [] };
  const noAi = noAiSources(await loadSourceRegistry(db));
  const list = saved.items
    .filter((o) => !noAi.includes(o.source) && (!filter.itemType || o.itemType === filter.itemType))
    .slice(0, Math.min(Math.max(1, filter.limit ?? 30), 200));
  const names = new Map<string, Product>();
  for (const o of list) {
    const p = await getProduct(db, o.productId);
    if (p) names.set(o.productId, p);
  }
  const [ranks, labels] = await Promise.all([
    latestRanks(
      db,
      list.map((o) => o.productId),
    ),
    rankingLabels(db),
  ]);
  const record = (o: (typeof list)[number], key: string) => {
    const t = o.tests?.signals[key as keyof NonNullable<typeof o.tests>['signals']];
    return t ? { checked: t.checked, higher90d: t.higher, medianChange90d: t.change } : null;
  };
  return {
    day: saved.day,
    items: list.map((o) => ({
      productId: o.productId,
      name: names.get(o.productId)?.name ?? null,
      kind: names.get(o.productId)?.kind ?? null,
      itemType: o.itemType,
      // Made by Tora from a ranking's top (nobody added it), collected while it stays there.
      candidate: !names.get(o.productId)?.createdBy,
      bucket: o.bucket || null,
      priceSource: o.source,
      // Its place in the sites' rankings (rank today, a week before; the site's own numbers).
      rankings: (ranks.get(o.productId) ?? []).map((r) => ({
        ranking: labels.get(r.ranking) ?? r.ranking,
        day: r.day,
        rank: r.rank,
        weekAgo: r.weekAgo,
        numbers: r.numbers,
      })),
      // Signals proven on the group's past prices rank items; warnings count against; the rest
      // are on but not proven (too few checks, or no better than buying on any day).
      signals: o.proven,
      warnings: o.warnings,
      notProven: o.unproven,
      score: Math.round(o.score * 100) / 100,
      // Each signal's record: past signals checked 90 days later, how many were higher then.
      records: Object.fromEntries(
        [...o.proven, ...o.warnings, ...o.unproven].map((k) => [k, record(o, k)]),
      ),
      anyDay: o.tests
        ? {
            checked: o.tests.any.checked,
            higher90d: o.tests.any.higher,
            medianChange90d: o.tests.any.change,
          }
        : null,
      // Fractions, not percents: price is the last 30 days' typical sale on the price source.
      numbers: o.numbers,
      lowestAsk:
        o.ask && !noAi.includes(o.ask.source) ? { ...o.ask, underRecentPrice: o.askUnder } : null,
      shopBuyPrice:
        o.buylist && !noAi.includes(o.buylist.source)
          ? { ...o.buylist, nearRecentPrice: o.buylistNear }
          : null,
    })),
  };
}
