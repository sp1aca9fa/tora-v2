// Everything waiting for the user, as cards for the Actions page (requirements S8): matches to
// confirm and price sources to link, lots without a grade or condition, imported lots to review,
// purchase links that failed and data review suggestions. Each card has a notice type and level.
import {
  NOTICE_TYPES,
  type NoticeLevel,
  type NoticeLevels,
  type NoticeType,
  type ProductClass,
  type SourceQuality,
  countsInBadge,
  noticeLevelsFor,
  noticeRank,
} from '@tora/core';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { linkedListingImages, imageVersions } from './images';
import { pendingImportReview } from './queries';
import {
  type Holding,
  type Product,
  type PurchaseLink,
  type Suggestion,
  holdings,
  productSources,
  products,
  purchaseLinks,
  sourceCandidates,
} from './schema';
import { loadSourceRegistry } from './registry';
import { dismissedSourceWarnings, identityFor } from './sources';
import { openSuggestions } from './suggestions';

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
        /** The source the item's identity link is looked for on (see `identityFor`). */
        main: boolean;
        /** What the user paid for the lots they own, and how many units. */
        costJpy: number;
        units: number;
        /** Best first; empty when nothing was found (paste a link). */
        candidates: ListingSuggestion[];
      }
    /** A lot without a grade or condition, or an imported lot to review. */
    | { kind: 'lot'; product: Product; imageVersion: string | null; holding: Holding }
    | { kind: 'link'; link: PurchaseLink }
    | {
        kind: 'suggestion';
        suggestion: Suggestion;
        product: Product | null;
        imageVersion: string | null;
      }
    /** A source the quality gate lowered to comparison for a class (admins). */
    | { kind: 'quality'; source: string; cls: ProductClass; quality: SourceQuality }
  );

/** Every pending action of the user, most urgent level first (levels: the user's choices). */
export async function pendingActions(
  db: Db,
  userId: string,
  chosen?: NoticeLevels | null,
  /** Admins also see what concerns the whole app (sources' quality). */
  options: { admin?: boolean } = {},
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
    pendingImportReview(db, userId),
    db
      .select()
      .from(purchaseLinks)
      .where(and(eq(purchaseLinks.userId, userId), eq(purchaseLinks.status, 'failed'))),
    openSuggestions(db, userId),
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
  const registry = await loadSourceRegistry(db);
  const known = await linkedListingImages(
    db,
    pending.filter((c) => !c.imageUrl).map((c) => ({ source: c.source, externalId: c.externalId })),
  );

  const items: ActionItem[] = [];
  const sourceItems: Extract<ActionItem, { kind: 'source' }>[] = [];
  for (const { product, cost, units } of owned) {
    const costJpy = Number(cost);
    const identity = identityFor(product, costJpy, registry);
    // No identity link yet: the preferred identity source is the one asked for.
    const main =
      identity && !identity.accepted.some((source) => has.has(`${product.id}|${source}`))
        ? identity.preferred
        : null;
    // Suggestions of sources the item has no listing of yet (variants of a linked listing wait
    // on the item page).
    const bySource = new Map<string, typeof pending>();
    for (const c of pending) {
      if (c.productId !== product.id || has.has(`${product.id}|${c.source}`)) continue;
      bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
    }
    // No identity link: a card even without suggestions, unless the user said not to warn
    // about it.
    if (main && !dismissed.has(product.id)) {
      bySource.set(main, bySource.get(main) ?? []);
    }
    // The same in the secondary market (S11), as its own notice type.
    const abroad = identityFor(product, costJpy, registry, registry.markets?.secondary ?? null);
    const second =
      registry.markets?.secondary &&
      abroad &&
      !abroad.accepted.some((source) => has.has(`${product.id}|${source}`))
        ? abroad.preferred
        : null;
    if (second && !dismissed.has(product.id)) {
      bySource.set(second, bySource.get(second) ?? []);
    }
    for (const [source, candidates] of bySource) {
      const isMain = source === main;
      const type: NoticeType = !isMain
        ? source === second
          ? 'secondary_identity'
          : 'second_source'
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
        // An identity link asked for (either market): the card stays until linked or dismissed.
        main: isMain || source === second,
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
  for (const { holding, product } of toReview) {
    items.push({
      key: `review:${holding.id}`,
      type: 'import_review',
      level: level('import_review'),
      kind: 'lot',
      product,
      imageVersion: null,
      holding,
    });
  }
  for (const link of failedLinks) {
    items.push({
      key: `link:${link.id}`,
      type: 'failed_link',
      level: level('failed_link'),
      kind: 'link',
      link,
    });
  }
  for (const { suggestion, product } of dataReview) {
    items.push({
      key: `suggestion:${suggestion.id}`,
      type: 'data_review',
      level: level('data_review'),
      kind: 'suggestion',
      suggestion,
      product,
      imageVersion: null,
    });
  }

  if (options.admin) {
    for (const [source, byClass] of Object.entries(registry.quality ?? {})) {
      for (const [cls, quality] of Object.entries(byClass)) {
        if (quality?.status !== 'disagrees' || quality.dismissedAt) continue;
        items.push({
          key: `quality:${source}:${cls}`,
          type: 'source_quality',
          level: level('source_quality'),
          kind: 'quality',
          source,
          cls: cls as ProductClass,
          quality,
        });
      }
    }
  }

  const productOf = (i: ActionItem) => ('product' in i ? i.product : null);
  const versions = await imageVersions(db, [
    ...new Set(items.flatMap((i) => (productOf(i) ? [productOf(i)!.id] : []))),
  ]);
  for (const i of items) {
    const product = productOf(i);
    if (product && 'imageVersion' in i) i.imageVersion = versions.get(product.id) ?? null;
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

/** How many things wait for the user (the nav badge); quiet (grey) notices are not counted. */
export const actionTotal = (items: ActionItem[]) =>
  items.filter((i) => countsInBadge(i.level)).length;
