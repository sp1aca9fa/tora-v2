import { noAiSources } from '@tora/core';
// Automated data review (requirements S4d). The checks flag what looks off (sales far from the
// value, searches that keep little of what they find); a cheap model (Haiku) judges only those,
// the cases it is unsure about go to a stronger one (Sonnet), and what they find is filed as
// suggestions for the user to accept or dismiss in the app. Nothing is changed here.
import {
  type Db,
  type Product,
  type ProductFix,
  type ProductSource,
  FIXABLE_FIELDS,
  fileSuggestion,
  judgedTargets,
  reviewNotes,
  suggestionListings,
  loadMarketData,
  oddSales,
  schema,
  valueHolding,
  loadSourceRegistry,
} from '@tora/db';
import { and, desc, eq, inArray } from 'drizzle-orm';

const { holdings, priceObservations, productSources, products } = schema;

/** At most this many sales and searches go to the model per run. */
export const LIMITS = { sales: 40, salesPerProduct: 8, searches: 10 };
/** A verdict under this confidence goes to the stronger model. */
export const SURE = 0.7;
/** A search judged fine is looked at again after this many days. */
const SEARCH_RECHECK_DAYS = 14;
/** A search keeping under this share of what it finds is reviewed. */
const WEAK_SHARE = 0.3;

const DAY = 86_400_000;

type Details = Pick<
  Product,
  | 'name'
  | 'kind'
  | 'franchise'
  | 'setName'
  | 'setCode'
  | 'cardNumber'
  | 'rarity'
  | 'variant'
  | 'platform'
>;
const details = (p: Product): Details => ({
  name: p.name,
  kind: p.kind,
  franchise: p.franchise,
  setName: p.setName,
  setCode: p.setCode,
  cardNumber: p.cardNumber,
  rarity: p.rarity,
  variant: p.variant,
  platform: p.platform,
});

export interface SaleCase {
  case: string;
  product: Details;
  bucket: string;
  valueJpy: number;
  salesInValue: number;
  sale: { source: string; priceJpy: number; date: string; title: string | null };
  otherSalesInBucket: { priceJpy: number; date: string; source: string }[];
}

export interface SearchCase {
  case: string;
  product: Details;
  source: string;
  keywords: string[];
  excludeKeywords: string[];
  kept: number;
  found: number;
  excludedSamples: { title: string | null; priceJpy: number; why: string | null }[];
  keptSamples: { title: string | null; priceJpy: number }[];
}

/** What the model sees, and what each case points to (kept out of the prompt). */
/** A comment the user left when deciding an earlier suggestion. */
export interface UserNote {
  product: string | null;
  /** What the suggestion proposed, and what the user did with it. */
  about: string;
  decision: string;
  note: string;
}

export interface ReviewCases {
  notes: UserNote[];
  sales: SaleCase[];
  searches: SearchCase[];
  targets: Map<
    string,
    {
      productId: string;
      product: Product;
      observationId?: string;
      /** The product's search the case came from (sales: its search on that site, if any). */
      search?: ProductSource;
      titles: string[];
      /** The sale's listing (sale cases). */
      url?: string | null;
    }
  >;
}

const titleOf = (raw: unknown) => ((raw ?? {}) as { name?: string }).name ?? null;
const day = (iso: string) => iso.slice(0, 10);

export async function buildReviewCases(
  db: Db,
  userId: string,
  now = new Date(),
  limits = LIMITS,
): Promise<ReviewCases> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')));
  const productIds = [...new Set(rows.map((r) => r.product.id))];
  const market = await loadMarketData(db, userId, productIds, now);
  const valued = rows.map((r) => ({ ...r, v: valueHolding(r.holding, r.product, market, now) }));
  const judged = await judgedTargets(db, userId, [
    'exclude_sale',
    'sale_ok',
    'search_ok',
    'exclude_word',
    'fix_product',
  ]);
  const searches = productIds.length
    ? await db
        .select()
        .from(productSources)
        .where(
          and(
            inArray(productSources.productId, productIds),
            eq(productSources.externalId, 'search'),
            eq(productSources.active, true),
          ),
        )
    : [];
  const out: ReviewCases = {
    notes: (await reviewNotes(db, userId, 40)).map((n) => ({
      product: n.productName,
      about: `${n.kind}: ${n.reason}`,
      decision: n.status,
      note: n.note!,
    })),
    sales: [],
    searches: [],
    targets: new Map(),
  };

  // Odd sales not judged before, newest first, a few per product.
  const perProduct = new Map<string, number>();
  const odd = oddSales(valued, market, now)
    .filter((o) => o.observationId)
    .filter(
      (o) =>
        !judged.has(`sale_ok|${o.observationId}`) && !judged.has(`exclude_sale|${o.observationId}`),
    )
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const picked: typeof odd = [];
  for (const o of odd) {
    if (picked.length >= limits.sales) break;
    const n = perProduct.get(o.product.id) ?? 0;
    if (n >= limits.salesPerProduct) continue;
    perProduct.set(o.product.id, n + 1);
    picked.push(o);
  }
  const raws = new Map<string, unknown>();
  const urls = new Map<string, string | null>();
  if (picked.length) {
    const found = await db
      .select({ id: priceObservations.id, raw: priceObservations.raw, url: priceObservations.url })
      .from(priceObservations)
      .where(
        inArray(
          priceObservations.id,
          picked.map((o) => o.observationId!),
        ),
      );
    for (const r of found) {
      raws.set(r.id, r.raw);
      urls.set(r.id, r.url);
    }
  }
  for (const [i, o] of picked.entries()) {
    const id = `s${i + 1}`;
    const v = valued.find((x) => x.holding.id === o.holding.id)!.v;
    const title = titleOf(raws.get(o.observationId!));
    out.sales.push({
      case: id,
      product: details(o.product),
      bucket: o.bucket,
      valueJpy: o.valueJpy,
      salesInValue: v.sampleSize,
      sale: { source: o.source, priceJpy: o.priceJpy, date: day(o.observedAt), title },
      otherSalesInBucket: (market.observations.get(o.product.id) ?? [])
        .filter(
          (x) => x.bucket === o.bucket && x.observationType === 'sold' && x.id !== o.observationId,
        )
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
        .slice(0, 12)
        .map((x) => ({ priceJpy: x.priceJpy, date: day(x.observedAt), source: x.source })),
    });
    out.targets.set(id, {
      productId: o.product.id,
      product: o.product,
      observationId: o.observationId,
      search: searches.find((s) => s.productId === o.product.id && s.source === o.source),
      titles: title ? [title] : [],
      url: urls.get(o.observationId!) ?? null,
    });
  }

  // Searches that keep little of what they find, unless judged fine lately. Sources whose terms
  // forbid giving their data to AI models are left out.
  const byId = new Map(rows.map((r) => [r.product.id, r.product]));
  const noAi = noAiSources(await loadSourceRegistry(db));
  for (const link of searches) {
    if (out.searches.length >= limits.searches) break;
    if (noAi.includes(link.source)) continue;
    if (!link.lastSuccessAt || !link.query?.keywords?.length) continue;
    const last = judged.get(`search_ok|${link.id}`);
    if (last && now.getTime() - Date.parse(last) < SEARCH_RECHECK_DAYS * DAY) continue;
    const obs = await db
      .select({
        excluded: priceObservations.excluded,
        excludedReason: priceObservations.excludedReason,
        priceJpy: priceObservations.priceJpy,
        raw: priceObservations.raw,
      })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.productId, link.productId),
          eq(priceObservations.source, link.source),
        ),
      )
      .orderBy(desc(priceObservations.observedAt));
    const kept = obs.filter((o) => !o.excluded);
    if (obs.length < 5 || kept.length / obs.length >= WEAK_SHARE) continue;
    const product = byId.get(link.productId)!;
    const id = `w${out.searches.length + 1}`;
    const excluded = obs.filter((o) => o.excluded && o.excludedReason !== 'manual').slice(0, 15);
    out.searches.push({
      case: id,
      product: details(product),
      source: link.source,
      keywords: link.query.keywords ?? [],
      excludeKeywords: link.query.excludeKeywords ?? [],
      kept: kept.length,
      found: obs.length,
      excludedSamples: excluded.map((o) => ({
        title: titleOf(o.raw),
        priceJpy: o.priceJpy,
        why: ((o.raw ?? {}) as { filter?: string }).filter ?? o.excludedReason,
      })),
      keptSamples: kept.slice(0, 5).map((o) => ({ title: titleOf(o.raw), priceJpy: o.priceJpy })),
    });
    out.targets.set(id, {
      productId: product.id,
      product,
      search: link,
      titles: [...excluded, ...kept.slice(0, 5)]
        .map((o) => titleOf(o.raw))
        .filter((t) => !!t) as string[],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The model's answer

export interface CaseVerdict {
  case: string;
  verdict: 'exclude' | 'keep' | 'fine' | 'unsure';
  confidence: number;
  reason: string;
}
export interface Fix {
  case: string;
  kind: 'exclude_word' | 'fix_product';
  word?: string;
  changes?: ProductFix;
  confidence: number;
  reason: string;
}
export interface ReviewAnswer {
  verdicts: CaseVerdict[];
  fixes: Fix[];
}

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          case: { type: 'string' },
          verdict: { type: 'string', enum: ['exclude', 'keep', 'fine', 'unsure'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['case', 'verdict', 'confidence', 'reason'],
      },
    },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          case: { type: 'string' },
          kind: { type: 'string', enum: ['exclude_word', 'fix_product'] },
          word: { type: 'string' },
          changes: {
            type: 'object',
            properties: Object.fromEntries(FIXABLE_FIELDS.map((f) => [f, { type: 'string' }])),
          },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['case', 'kind', 'confidence', 'reason'],
      },
    },
  },
  required: ['verdicts', 'fixes'],
};

export const SYSTEM_PROMPT = `You check data for a collectibles price tracker in Japan (trading cards, sealed boxes, video games). Sales are collected automatically from marketplaces by searching for each product, and a filter keeps the listings that look like the product. You judge only the cases given and reply with the requested JSON.`;

export const INSTRUCTIONS = `Below are cases flagged by automatic checks, as JSON.

"sales" cases: a kept sale whose price is over 3x or under 1/3 of the product's value in that condition bucket (raw:A = ungraded card in A condition, graded:PSA:10 = PSA 10 slab, sealed:shrink = sealed with shrink wrap, cond:good = used game in good condition). For each, decide:
- "exclude": the listing is not really this product in this condition: a different product, version, edition or platform; a bundle or several items; a graded card counted as raw or as a sealed product; an empty box or parts.
- "keep": a genuine sale of this product, even if cheap or expensive (a price trend, an eager buyer, a seller pricing low).
- "unsure": the data does not tell.

"searches" cases: a saved search whose filter keeps under 30% of what it finds. Look at the excluded and kept titles. Decide "fine" (the excluded listings really are other products), or "unsure", and add a fix when one would help.

Fixes (optional, in "fixes"; each refers to one case):
- "exclude_word": a word in titles of other products that the search should skip (e.g. a special edition with a different price). The word must not be part of this product's own name.
- "fix_product": product details that are missing or wrong, when the titles make them clear (fields: ${FIXABLE_FIELDS.join(', ')}). Give only the fields to change. For promo cards: cardNumber is the number before the slash ("208"), setCode the promo code ("S-P"), rarity "P".
Prefer one exclude_word fix over excluding many sales for the same reason.

Japanese title notes: "X様" or "X様専用" means the seller reserved the listing for a buyer who asked; it is still an ordinary sale, judge it by its title and price like any other. 未開封 = unopened; シュリンク = shrink wrap; PSA/BGS/ARS = graded; ソフト = game software (often disc or cartridge only); 箱説付き = with box and manual. SNKRDUNK sales have no title: they are sales of exactly the linked product; judge them only by price.

"notes": comments the collector (the user) left on earlier suggestions. They know these products: follow their notes over your own judgment, for the product named and for anything the note says in general.

confidence is 0 to 1. Keep each reason under 15 words. Give a verdict for every case.

Cases:
`;

/** Asks a model; returns its answer and what it cost. */
export type Judge = (
  model: 'haiku' | 'sonnet',
  input: { notes: UserNote[]; sales: SaleCase[]; searches: SearchCase[] },
) => Promise<{ answer: ReviewAnswer; costUsd: number; tokens: number; modelName: string }>;

export interface ReviewSummary {
  cases: number;
  escalated: number;
  filed: Record<string, number>;
  verdicts: number;
  costUsd: number;
  tokens: number;
  calls: { model: string; costUsd: number; tokens: number }[];
}

const sameText = (a: string, b: string) =>
  a.normalize('NFKC').toLowerCase().includes(b.normalize('NFKC').toLowerCase());

export async function runReview(
  db: Db,
  userId: string,
  judge: Judge,
  options: { now?: Date; limits?: typeof LIMITS; dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<ReviewSummary> {
  const log = options.log ?? (() => {});
  const cases = await buildReviewCases(db, userId, options.now, options.limits);
  const summary: ReviewSummary = {
    cases: cases.sales.length + cases.searches.length,
    escalated: 0,
    filed: {},
    verdicts: 0,
    costUsd: 0,
    tokens: 0,
    calls: [],
  };
  if (summary.cases === 0) return summary;

  const ask = async (model: 'haiku' | 'sonnet', input: Parameters<Judge>[1]) => {
    const r = await judge(model, input);
    summary.calls.push({ model: r.modelName, costUsd: r.costUsd, tokens: r.tokens });
    summary.costUsd += r.costUsd;
    summary.tokens += r.tokens;
    return { ...r.answer, modelName: r.modelName };
  };
  const first = await ask('haiku', {
    notes: cases.notes,
    sales: cases.sales,
    searches: cases.searches,
  });
  const verdicts = new Map<string, CaseVerdict & { model: string }>();
  for (const v of first.verdicts) {
    if (cases.targets.has(v.case)) verdicts.set(v.case, { ...v, model: first.modelName });
  }
  let fixes = first.fixes.map((f) => ({ ...f, model: first.modelName }));

  // What the cheap model was unsure about (or skipped) goes to the stronger one.
  const doubtful = new Set(
    [...cases.targets.keys()].filter((id) => {
      const v = verdicts.get(id);
      const fix = fixes.find((f) => f.case === id);
      return (
        !v || v.verdict === 'unsure' || v.confidence < SURE || (!!fix && fix.confidence < SURE)
      );
    }),
  );
  if (doubtful.size) {
    summary.escalated = doubtful.size;
    const second = await ask('sonnet', {
      notes: cases.notes,
      sales: cases.sales.filter((c) => doubtful.has(c.case)),
      searches: cases.searches.filter((c) => doubtful.has(c.case)),
    });
    for (const v of second.verdicts) {
      if (doubtful.has(v.case)) verdicts.set(v.case, { ...v, model: second.modelName });
    }
    fixes = [
      ...fixes.filter((f) => !doubtful.has(f.case)),
      ...second.fixes
        .filter((f) => doubtful.has(f.case))
        .map((f) => ({ ...f, model: second.modelName })),
    ];
  }
  log(`${verdicts.size} verdict(s), ${fixes.length} fix(es)`);
  if (options.dryRun) {
    for (const [id, v] of verdicts) log(`${id} ${v.verdict} ${v.confidence} ${v.reason}`);
    for (const f of fixes) log(`fix ${f.case} ${f.kind} ${f.word ?? JSON.stringify(f.changes)}`);
    return summary;
  }

  const count = (kind: string) => (summary.filed[kind] = (summary.filed[kind] ?? 0) + 1);
  // Words to skip, per search: sales they cover need no suggestion of their own.
  const skipWords = new Map<string, string[]>();
  for (const f of fixes) {
    const target = cases.targets.get(f.case);
    if (!target) continue;
    if (f.kind === 'exclude_word') {
      const word = f.word?.normalize('NFKC').trim() ?? '';
      const link = target.search;
      if (!link || !word || word.length > 30 || sameText(target.product.name, word)) continue;
      if ((link.query?.excludeKeywords ?? []).includes(word)) continue;
      // The titles behind the fix: every case of this product that has the word.
      const titles = [...cases.targets.values()]
        .filter((t) => t.productId === target.productId)
        .flatMap((t) => t.titles)
        .filter((t) => sameText(t, word));
      if (titles.length === 0) continue;
      skipWords.set(link.id, [...(skipWords.get(link.id) ?? []), word]);
      if (
        await fileSuggestion(db, {
          userId,
          kind: 'exclude_word',
          targetKey: `${link.id}|${word}`,
          productId: target.productId,
          payload: { sourceId: link.id, word, source: link.source },
          reason: f.reason,
          // Every collected listing the word would drop (kept ones first), with links to check.
          evidence: {
            listings: await suggestionListings(db, target.productId, { source: link.source, word }),
            keywords: link.query?.keywords,
          },
          model: f.model,
          confidence: f.confidence,
        })
      )
        count('exclude_word');
    } else if (f.kind === 'fix_product') {
      const changes: ProductFix = {};
      for (const field of FIXABLE_FIELDS) {
        const value = f.changes?.[field]?.normalize('NFKC').trim();
        if (value && value !== target.product[field]) changes[field] = value;
      }
      if (Object.keys(changes).length === 0) continue;
      if (
        await fileSuggestion(db, {
          userId,
          kind: 'fix_product',
          targetKey: `${target.productId}|${JSON.stringify(changes)}`,
          productId: target.productId,
          payload: { changes },
          reason: f.reason,
          evidence: {
            before: Object.fromEntries(
              Object.keys(changes).map((k) => [k, target.product[k as keyof ProductFix]]),
            ),
            listings: await suggestionListings(db, target.productId, { titles: target.titles }, 5),
          },
          model: f.model,
          confidence: f.confidence,
        })
      )
        count('fix_product');
    }
  }

  for (const c of cases.sales) {
    const v = verdicts.get(c.case);
    const target = cases.targets.get(c.case)!;
    if (!v) continue;
    summary.verdicts++;
    const words = target.search ? (skipWords.get(target.search.id) ?? []) : [];
    if (c.sale.title && words.some((w) => sameText(c.sale.title!, w))) continue;
    if (v.verdict === 'keep' && v.confidence >= SURE) {
      await fileSuggestion(db, {
        userId,
        kind: 'sale_ok',
        targetKey: target.observationId!,
        productId: target.productId,
        reason: v.reason,
        model: v.model,
        confidence: v.confidence,
      });
      continue;
    }
    if (v.verdict === 'keep') continue;
    // Exclude, or unsure even after the stronger model: the user decides.
    if (
      await fileSuggestion(db, {
        userId,
        kind: 'exclude_sale',
        targetKey: target.observationId!,
        productId: target.productId,
        payload: { observationId: target.observationId, unsure: v.verdict === 'unsure' },
        reason: v.reason,
        evidence: { ...c.sale, url: target.url, valueJpy: c.valueJpy, bucket: c.bucket },
        model: v.model,
        confidence: v.confidence,
      })
    )
      count('exclude_sale');
  }
  for (const c of cases.searches) {
    const v = verdicts.get(c.case);
    if (!v) continue;
    summary.verdicts++;
    if (v.verdict === 'fine' || fixes.some((f) => f.case === c.case)) {
      await fileSuggestion(db, {
        userId,
        kind: 'search_ok',
        targetKey: cases.targets.get(c.case)!.search!.id,
        productId: cases.targets.get(c.case)!.productId,
        reason: v.reason,
        model: v.model,
        confidence: v.confidence,
      });
    }
  }
  return summary;
}
