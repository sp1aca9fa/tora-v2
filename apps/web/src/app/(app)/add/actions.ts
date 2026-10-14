'use server';

import {
  type Category,
  type ProductClass,
  SEALED_KINDS,
  type ProductKind,
  REGIONS,
  type Region,
  type SetType,
  TCG_FRANCHISES,
  itemTypeOf,
  kindsForSetType,
  productClass,
  tokyoDateToIso,
} from '@tora/core';
import {
  type ProductRef,
  createHolding,
  getProduct,
  getSet,
  linkedProductIds,
  searchProducts,
  searchSets,
  resolvePurchaseLink,
  suggestFromKnownProducts,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import {
  type FormState,
  dateText,
  optEnum,
  optText,
  optAmount,
  parseForm,
  qty,
  reqEnum,
  runDomain,
} from '@/lib/form';
import { getTaxonomy } from '@/lib/taxonomy';
import {
  conditionInputFrom,
  conditionSchema,
  productInputFrom,
  productSchema,
} from '@/lib/schemas';

export interface ProductSummary {
  id: string;
  category: Category;
  kind: ProductKind;
  name: string;
  region: Region | null;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  rarity: string | null;
  platform: string | null;
  releaseDate: string | null;
  retailPriceBase: number | null;
  /** Has an active price source (a listing). */
  linked: boolean;
}

export interface SetSummary {
  id: string;
  code: string | null;
  name: string;
  nameAlias: string | null;
  setType: SetType;
  releaseDate: string | null;
}

export async function searchProductsAction(
  q: string,
  filter: { category?: Category; kinds?: ProductKind[] } = {},
): Promise<ProductSummary[]> {
  const { db } = await authed();
  const rows = await searchProducts(db, q.slice(0, 100), {
    // Plain text matches only: unknown keys find nothing.
    category: filter.category?.slice(0, 40) || undefined,
    kinds: filter.kinds?.map((k) => k.slice(0, 40)),
    limit: 15,
  });
  const linked = await linkedProductIds(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((p) => ({
    id: p.id,
    category: p.category,
    kind: p.kind,
    name: p.name,
    region: p.region,
    setName: p.setName,
    setCode: p.setCode,
    cardNumber: p.cardNumber,
    rarity: p.rarity,
    platform: p.platform,
    releaseDate: p.releaseDate,
    retailPriceBase: p.retailPriceBase,
    linked: linked.has(p.id),
  }));
}

/** Catalog sets for the picker; only sets that offer `kind` (e.g. decks for "Deck"). */
export async function searchSetsAction(
  franchise: string,
  region: Region | null,
  kind: ProductKind | null,
  q: string,
): Promise<SetSummary[]> {
  const { db } = await authed();
  if (!TCG_FRANCHISES.includes(franchise as never)) return [];
  const rows = await searchSets(db, {
    franchise,
    region: region && REGIONS.includes(region) ? region : null,
    q: q.slice(0, 100) || undefined,
    limit: 60,
  });
  return rows
    .filter((s) => !kind || kindsForSetType(s.setType).includes(kind))
    .slice(0, 30)
    .map(({ id, code, name, nameAlias, setType, releaseDate }) => ({
      id,
      code,
      name,
      nameAlias,
      setType,
      releaseDate,
    }));
}

const holdingSchema = z.object({
  mode: reqEnum(['existing', 'new', 'catalog'] as const),
  productId: optText,
  catalogSetId: optText,
  catalogKind: optEnum(SEALED_KINDS),
  catalogVariant: optText,
  region: optEnum(REGIONS),
  acquiredAt: dateText,
  acquiredFrom: optText,
  acquisitionType: reqEnum(['purchase', 'gift', 'trade'] as const),
  orderId: optText,
  quantity: qty,
  /** Optional when a retail price is known: blank means retail price x quantity. */
  costTotalBase: optAmount,
  notes: optText,
});

export async function createHoldingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { db, user } = await authed();
  const base = await parseForm(holdingSchema, formData);
  if ('state' in base) return base.state;
  const d = base.data;

  let ref: ProductRef;
  let cls: ProductClass;
  let retailPriceBase: number | null = null;
  if (d.mode === 'existing') {
    const product = d.productId ? await getProduct(db, d.productId) : null;
    if (!product) return { error: 'not_found' };
    ref = { productId: product.id };
    cls = productClass(product);
    retailPriceBase = product.retailPriceBase;
  } else if (d.mode === 'catalog') {
    const set = d.catalogSetId ? await getSet(db, d.catalogSetId) : null;
    if (!set || !d.catalogKind) return { error: 'check', fields: ['setName'] };
    ref = {
      catalog: {
        setId: set.id,
        kind: d.catalogKind,
        variant: d.catalogVariant,
        region: d.region,
      },
    };
    cls = 'sealed';
  } else {
    const parsed = await parseForm(productSchema, formData);
    if ('state' in parsed) return parsed.state;
    const taxonomy = await getTaxonomy();
    const product = productInputFrom(parsed.data, taxonomy, formData);
    if (!product) return { error: 'check', fields: ['name'] };
    ref = { product };
    cls = itemTypeOf(taxonomy, product.category, product.kind) ?? productClass(product);
    retailPriceBase = product.retailPriceBase ?? null;
  }
  const costTotalBase =
    d.costTotalBase ?? (retailPriceBase !== null ? retailPriceBase * d.quantity : undefined);
  if (costTotalBase === undefined) return { error: 'check', fields: ['costTotalBase'] };

  const condition = await parseForm(conditionSchema, formData);
  if ('state' in condition) return condition.state;
  const { input, missing } = conditionInputFrom(cls, condition.data);
  if (missing.length) return { error: 'check', fields: missing };

  const result = await runDomain(() =>
    createHolding(db, user.id, ref, {
      quantity: d.quantity,
      costTotalBase,
      acquisitionType: d.acquisitionType,
      ...input,
      acquiredAt: tokyoDateToIso(d.acquiredAt),
      acquiredFrom: d.acquiredFrom ?? null,
      notes: d.notes ?? null,
      orderId: d.orderId ?? null,
      // Portfolio tracking (S8): both on unless unticked in the form.
      ...(formData.get('tracking') === 'shown'
        ? {
            countInCost: formData.get('countInCost') === 'on',
            countInValue: formData.get('countInValue') === 'on',
          }
        : {}),
    }),
  );
  if (!result.ok) return result.state;
  // Offer a linked look-alike's listing right away (no need to wait for the collector).
  await suggestFromKnownProducts(db, result.value.product.id);
  // Added by hand for a purchase link that could not be imported: that link is done.
  const linkId = String(formData.get('purchaseLinkId') ?? '');
  if (linkId) await resolvePurchaseLink(db, user.id, linkId, result.value.holding.id);
  revalidatePath('/', 'layout');
  redirect(linkId ? '/imports#failed' : `/holdings/${result.value.holding.id}`);
}
