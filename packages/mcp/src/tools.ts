// Read-only views of one user's data for Claude (requirements S4b). Plain functions over the
// database, so the MCP server (server.ts) and the tests share them. Results are compact JSON:
// yen as integers, dates as ISO strings, lists limited.
import { productClass } from '@tora/core';
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
  openSuggestionCount,
  reviewNotes,
  oddSales,
  pendingImportReview,
  STORE_LINK_MIN_COST,
  missingPriceSources,
  pendingMatchesForUser,
  portfolioSeries,
  portfolioValuation,
  priceHistory,
  sameNameKey,
  productLots,
  schema,
  summarizeByProduct,
  valueHolding,
} from '@tora/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

const { holdings, products, priceObservations, productImages, productSources } = schema;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** What a valuation says, in a few fields. */
function valuationFacts(v: ReturnType<typeof valueHolding>) {
  return {
    valueJpy: v.valueJpy,
    unitJpy: v.unitJpy,
    method: v.method,
    source: v.source,
    bucket: v.bucket,
    sales: v.sampleSize,
    windowDays: v.windowDays,
    pooled: v.pooled,
    confidence: v.confidence,
    estimatedLotSales: v.estimatedSamples,
    lastSale: v.last
      ? { priceJpy: v.last.priceJpy, source: v.last.source, at: day(v.last.observedAt) }
      : null,
  };
}

// ---------------------------------------------------------------------------------------------

export async function portfolioSummary(db: Db, userId: string) {
  const p = await portfolioValuation(db, userId);
  const valuations = new Map(p.rows.map((r) => [r.holding.id, r.valuation]));
  const summaries = summarizeByProduct(p.rows, valuations);
  const withPl = summaries.filter((s) => s.unrealizedJpy !== null);
  const byPl = withPl.toSorted((a, b) => b.unrealizedJpy! - a.unrealizedJpy!);
  const row = (s: (typeof summaries)[number]) => ({
    productId: s.product.id,
    name: s.product.name,
    kind: s.product.kind,
    units: s.units,
    spentJpy: s.spentJpy,
    valueJpy: s.valuedLots ? s.valueJpy : null,
    unrealizedJpy: s.unrealizedJpy,
    unrealizedPct: s.unrealizedJpy === null ? null : pct(s.unrealizedJpy, s.valuedCostJpy),
  });
  const series = await portfolioSeries(db, userId);
  // The chart, thinned: the first of each month, plus every day of the last 30.
  const recentFrom = series.at(-30)?.date ?? '';
  const chart = series
    .filter((s) => s.date.endsWith('-01') || s.date >= recentFrom)
    .map((s) => ({
      date: s.date,
      valueJpy: Number(s.valueJpy),
      costJpy: Number(s.costJpy),
      atCostJpy: Number(s.atCostJpy),
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
  return summarizeByProduct(picked, valuations)
    .map((s) => {
      const first = valuations.get(s.lots[0]!.holding.id)!;
      return {
        productId: s.product.id,
        name: s.product.name,
        kind: s.product.kind,
        franchise: s.product.franchise,
        lots: s.lots.length,
        units: s.units,
        spentJpy: s.spentJpy,
        valueJpy: s.valuedLots ? s.valueJpy : null,
        unrealizedJpy: s.unrealizedJpy,
        valuedLots: s.valuedLots,
        valuation: {
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
  const [lots, sources, candidates, market] = await Promise.all([
    productLots(db, userId, productId),
    listProductSources(db, productId),
    listPendingCandidates(db, productId),
    loadMarketData(db, userId, [productId]),
  ]);
  return {
    product,
    class: productClass(product),
    lots: lots.map((h) => ({
      holdingId: h.id,
      status: h.status,
      quantity: h.quantity,
      costJpy: h.costTotalJpy,
      acquiredAt: day(h.acquiredAt),
      acquiredFrom: h.acquiredFrom,
      orderId: h.orderId,
      condition: h.condition,
      packaging: h.packagingState,
      grading:
        h.grading === 'graded' ? `${h.grader} ${h.grade}` : h.rawGrade ? `raw ${h.rawGrade}` : null,
      reviewPending: h.reviewPending,
      reviewReason: h.reviewReason,
      valuation: h.status === 'owned' ? valuationFacts(valueHolding(h, product, market)) : null,
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
  return points.filter(
    (p) =>
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
  const rows = await db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        filter.source ? eq(priceObservations.source, filter.source) : undefined,
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
      priceJpy: r.priceJpy,
      lotPriceJpy: r.priceOriginal !== r.priceJpy ? r.priceOriginal : undefined,
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
  const market = await loadMarketData(db, userId, productIds, now);
  const valued = owned.map((r) => ({ ...r, v: valueHolding(r.holding, r.product, market, now) }));
  const lot = (h: Holding, p: Product) => ({ holdingId: h.id, productId: p.id, name: p.name });
  const findings: Finding[] = [];

  findings.push(
    finding(
      'unvalued',
      'warn',
      'Owned lots with no market value (no condition / grade, or no sales and no retail price).',
      valued
        .filter((x) => x.v.valueJpy === null)
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
        .filter((x) => x.v.method === 'median' && (x.v.confidence === 'low' || x.v.pooled))
        .map((x) => ({
          ...lot(x.holding, x.product),
          source: x.v.source,
          sales: x.v.sampleSize,
          windowDays: x.v.windowDays,
          pooled: x.v.pooled,
        })),
    ),
  );

  // Look-alikes: the same name (and card number) registered as separate products.
  const groups = new Map<string, Product[]>();
  for (const p of new Map(rows.map((r) => [r.product.id, r.product])).values()) {
    const key = `${p.kind}|${sameNameKey(p.name)}|${cardNumberKey(p.cardNumber) ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  findings.push(
    finding(
      'look_alikes',
      'warn',
      'Separate products with the same name and number: probably duplicates (merge them from the product edit page).',
      [...groups.values()]
        .filter((g) => g.length > 1)
        .map((g) => g.map((p) => ({ productId: p.id, name: p.name, setCode: p.setCode }))),
    ),
  );

  findings.push(
    finding(
      'odd_sales',
      'info',
      'Sales of the last 30 days at over 3x or under 1/3 of the value (the median ignores them, but they may be mismatches to exclude).',
      oddSales(valued, market, now).map((o) => ({
        ...lot(o.holding, o.product),
        source: o.source,
        priceJpy: o.priceJpy,
        valueJpy: o.valueJpy,
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
    if (!source.lastSuccessAt) continue;
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
      `Owned items without their stable price source: cards not linked to SNKRDUNK, other items costing more than ¥${STORE_LINK_MIN_COST} not linked to 駿河屋.`,
      (await missingPriceSources(db, userId)).map((m) => ({
        productId: m.product.id,
        name: m.product.name,
        needs: m.source,
        costJpy: m.costJpy,
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
 * One read-only SELECT (or WITH ... SELECT), run in a read transaction (writes fail) with a row
 * limit. Not scoped to the user: the database holds this household's data only.
 */
export async function querySql(db: Db, sql: string, limit = 200) {
  const text = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text) || text.includes(';')) {
    return { error: 'Only one SELECT (or WITH ... SELECT) statement is allowed.' };
  }
  const tx = await db.$client.transaction('read');
  try {
    const rs = await tx.execute(
      `select * from (${text}) limit ${Math.min(Math.max(1, limit), 1000)}`,
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
