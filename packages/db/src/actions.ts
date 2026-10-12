// Everything waiting for the user, as cards for the Actions page (requirements S8): matches to
// confirm and price sources to link, lots without a grade or condition, and links to the import
// pages. Each card has a notice type and its level.
import {
  NOTICE_TYPES,
  type NoticeLevel,
  type NoticeLevels,
  type NoticeType,
  countsInBadge,
  noticeLevelsFor,
  noticeRank,
} from '@tora/core';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { linkedListingImages, imageVersions } from './images';
import { failedPurchaseLinkCount } from './purchase-links';
import { importReviewCount } from './queries';
import {
  type Holding,
  type Product,
  holdings,
  productSources,
  products,
  sourceCandidates,
} from './schema';
import { dismissedSourceWarnings, stableSourceFor } from './sources';
import { openSuggestionCount } from './suggestions';

export interface ListingSuggestion {
  id: string;
  title: string;
  url: string | null;
  /** The listing's own picture, else the stored one of a product already linked to it. */
  imageUrl: string | null;
  linkedImage: { productId: string; version: string } | null;
  priceJpy: number | null;
  score: number;
}

interface ActionBase {
  /** Stable per action (e.g. remembers whether its card is open). */
  key: string;
  type: NoticeType;
  level: NoticeLevel;
}

export type ActionItem = ActionBase &
  (
    | {
        kind: 'source';
        product: Product;
        imageVersion: string | null;
        source: string;
        /** The item's main source (SNKRDUNK for TCG, 駿河屋 for other items over ¥3,000). */
        main: boolean;
        /** What the user paid for the lots they own, and how many units. */
        costJpy: number;
        units: number;
        /** Best first; empty when nothing was found (paste a link). */
        candidates: ListingSuggestion[];
      }
    | { kind: 'lot'; product: Product; imageVersion: string | null; holding: Holding }
    | { kind: 'count'; count: number }
  );

/** Every pending action of the user, most urgent level first (levels: the user's choices). */
export async function pendingActions(
  db: Db,
  userId: string,
  chosen?: NoticeLevels | null,
): Promise<ActionItem[]> {
  const levels = noticeLevelsFor(chosen);
  const level = (type: NoticeType) => levels[type];
  const [owned, lots, toReview, failedLinks, dataReview, dismissed] = await Promise.all([
    db
      .select({
        product: products,
        cost: sql<number>`sum(${holdings.costTotalJpy})`,
        units: sql<number>`sum(${holdings.quantity})`,
      })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.status, 'owned'),
          eq(holdings.reviewPending, false),
        ),
      )
      .groupBy(products.id),
    // Lots not valued for want of a grade (cards) or condition (games); cards still in the
    // import review get theirs there.
    db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.status, 'owned'),
          eq(holdings.reviewPending, false),
          or(
            and(
              eq(products.category, 'tcg'),
              eq(products.kind, 'single'),
              or(
                isNull(holdings.grading),
                and(eq(holdings.grading, 'raw'), isNull(holdings.rawGrade)),
              ),
            ),
            and(eq(products.category, 'game'), isNull(holdings.condition)),
          ),
        ),
      )
      .orderBy(products.name),
    importReviewCount(db, userId),
    failedPurchaseLinkCount(db, userId),
    openSuggestionCount(db, userId),
    dismissedSourceWarnings(db, userId),
  ]);

  const ids = owned.map((o) => o.product.id);
  const [linked, pending] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ productId: productSources.productId, source: productSources.source })
            .from(productSources)
            .where(and(inArray(productSources.productId, ids), eq(productSources.active, true))),
          db
            .select()
            .from(sourceCandidates)
            .where(
              and(inArray(sourceCandidates.productId, ids), eq(sourceCandidates.status, 'pending')),
            ),
        ]);
  const has = new Set(linked.map((l) => `${l.productId}|${l.source}`));
  const known = await linkedListingImages(
    db,
    pending.filter((c) => !c.imageUrl).map((c) => ({ source: c.source, externalId: c.externalId })),
  );

  const items: ActionItem[] = [];
  const sourceItems: Extract<ActionItem, { kind: 'source' }>[] = [];
  for (const { product, cost, units } of owned) {
    const costJpy = Number(cost);
    const main = stableSourceFor(product, costJpy);
    // Suggestions of sources the item has no listing of yet (variants of a linked listing wait
    // on the item page).
    const bySource = new Map<string, typeof pending>();
    for (const c of pending) {
      if (c.productId !== product.id || has.has(`${product.id}|${c.source}`)) continue;
      bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
    }
    // The main source is missing: a card even without suggestions, unless the user said not to
    // warn about it.
    if (main && !has.has(`${product.id}|${main}`) && !dismissed.has(product.id)) {
      bySource.set(main, bySource.get(main) ?? []);
    }
    for (const [source, candidates] of bySource) {
      const isMain = source === main;
      const type: NoticeType = !isMain
        ? 'second_source'
        : product.category === 'tcg'
          ? 'tcg_main_source'
          : 'game_main_source';
      sourceItems.push({
        key: `source:${product.id}:${source}`,
        type,
        level: level(type),
        kind: 'source',
        product,
        imageVersion: null,
        source,
        main: isMain,
        costJpy,
        units: Number(units),
        candidates: candidates
          .toSorted((a, b) => b.score - a.score)
          .map((c) => ({
            id: c.id,
            title: c.title,
            url: c.url,
            imageUrl: c.imageUrl,
            linkedImage: c.imageUrl ? null : (known.get(`${c.source}|${c.externalId}`) ?? null),
            priceJpy: c.priceJpy,
            score: c.score,
          })),
      });
    }
  }
  items.push(...sourceItems);
  for (const { holding, product } of lots) {
    const type: NoticeType = product.category === 'tcg' ? 'card_grade' : 'game_condition';
    items.push({
      key: `lot:${holding.id}`,
      type,
      level: level(type),
      kind: 'lot',
      product,
      imageVersion: null,
      holding,
    });
  }
  for (const [type, count] of [
    ['import_review', toReview],
    ['failed_link', failedLinks],
    ['data_review', dataReview],
  ] as const) {
    if (count > 0) items.push({ key: type, type, level: level(type), kind: 'count', count });
  }

  const versions = await imageVersions(db, [
    ...new Set(items.flatMap((i) => (i.kind === 'count' ? [] : [i.product.id]))),
  ]);
  for (const i of items) {
    if (i.kind !== 'count') i.imageVersion = versions.get(i.product.id) ?? null;
  }
  const cost = (i: ActionItem) =>
    i.kind === 'source' ? i.costJpy : i.kind === 'lot' ? i.holding.costTotalJpy : 0;
  return items.sort(
    (a, b) =>
      noticeRank(a.level) - noticeRank(b.level) ||
      NOTICE_TYPES.indexOf(a.type) - NOTICE_TYPES.indexOf(b.type) ||
      cost(b) - cost(a),
  );
}

/**
 * How many things wait for the user (the nav badge): a count card counts its rows; quiet (grey)
 * notices are not counted.
 */
export const actionTotal = (items: ActionItem[]) =>
  items
    .filter((i) => countsInBadge(i.level))
    .reduce((n, i) => n + (i.kind === 'count' ? i.count : 1), 0);
