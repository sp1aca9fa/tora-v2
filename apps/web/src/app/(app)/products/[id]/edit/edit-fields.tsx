'use client';

import type { Category, ProductKind } from '@tora/core';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ExistingSuggestions } from '@/components/existing-suggestions';
import { type ProductDefaults, ProductFields } from '@/components/product-fields';

/** Product fields, plus registered look-alikes this product may be a duplicate of (merge). */
export function EditProductFields({
  productId,
  category,
  kind,
  franchiseInput,
  defaults,
}: {
  productId: string;
  category: Category;
  kind: ProductKind;
  franchiseInput: boolean;
  defaults: ProductDefaults;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [typed, setTyped] = useState({
    name: String(defaults.name ?? ''),
    setCode: String(defaults.setCode ?? ''),
    cardNumber: String(defaults.cardNumber ?? ''),
  });
  return (
    <>
      <ProductFields
        category={category}
        kind={kind}
        franchiseInput={franchiseInput}
        defaults={defaults}
        onTyped={(field, value) => setTyped((v) => ({ ...v, [field]: value }))}
      />
      <ExistingSuggestions
        // The name alone finds look-alikes registered with other details (e.g. no set code).
        query={typed.name}
        category={category}
        kinds={[kind]}
        excludeId={productId}
        hint={t('merge.hint')}
        onSelect={(p) => router.push(`/products/${productId}/merge?into=${p.id}`)}
      />
    </>
  );
}
