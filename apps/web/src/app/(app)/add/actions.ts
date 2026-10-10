'use server';

import {
  CATEGORIES,
  type Category,
  PRODUCT_KINDS,
  type ProductClass,
  type ProductKind,
  REGIONS,
  type Region,
  type SetType,
  TCG_FRANCHISES,
  kindsForSetType,
  productClass,
  tokyoDateToIso,
} from '@tora/core';
import {
  type ProductRef,
  createHolding,
  getProduct,
  getSet,
  searchProducts,
  searchSets,
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
  parseForm,
  qty,
  reqEnum,
  runDomain,
  yen,
} from '@/lib/form';
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
  cardNumber: string | null;
  platform: string | null;
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
    category: CATEGORIES.includes(filter.category as Category) ? filter.category : undefined,
    kinds: filter.kinds?.filter((k) => PRODUCT_KINDS.includes(k)),
    limit: 15,
  });
  return rows.map(({ id, category, kind, name, region, setName, cardNumber, platform }) => ({
    id,
    category,
    kind,
    name,
    region,
    setName,
    cardNumber,
    platform,
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
  catalogKind: optEnum(PRODUCT_KINDS),
  catalogVariant: optText,
  region: optEnum(REGIONS),
  acquiredAt: dateText,
  acquiredFrom: optText,
  acquisitionType: reqEnum(['purchase', 'gift', 'trade'] as const),
  orderId: optText,
  quantity: qty,
  costTotalJpy: yen,
  notes: optText,
});

export async function createHoldingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { db, user } = await authed();
  const base = parseForm(holdingSchema, formData);
  if ('state' in base) return base.state;
  const d = base.data;

  let ref: ProductRef;
  let cls: ProductClass;
  if (d.mode === 'existing') {
    const product = d.productId ? await getProduct(db, d.productId) : null;
    if (!product) return { error: 'not_found' };
    ref = { productId: product.id };
    cls = productClass(product);
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
    const parsed = parseForm(productSchema, formData);
    if ('state' in parsed) return parsed.state;
    const product = productInputFrom(parsed.data);
    if (!product) return { error: 'check', fields: ['name'] };
    ref = { product };
    cls = productClass(product);
  }

  const condition = parseForm(conditionSchema, formData);
  if ('state' in condition) return condition.state;
  const { input, missing } = conditionInputFrom(cls, condition.data);
  if (missing.length) return { error: 'check', fields: missing };

  const result = await runDomain(() =>
    createHolding(db, user.id, ref, {
      quantity: d.quantity,
      costTotalJpy: d.costTotalJpy,
      acquisitionType: d.acquisitionType,
      ...input,
      acquiredAt: tokyoDateToIso(d.acquiredAt),
      acquiredFrom: d.acquiredFrom ?? null,
      notes: d.notes ?? null,
      orderId: d.orderId ?? null,
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/');
  redirect(`/holdings/${result.value.holding.id}`);
}
