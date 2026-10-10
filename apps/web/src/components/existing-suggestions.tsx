'use client';

import type { Category, ProductKind } from '@tora/core';
import { Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { type ProductSummary, searchProductsAction } from '@/app/(app)/add/actions';

/**
 * While a new item is being typed, the items already registered that match it ("is it one of
 * these?"). Picking one registers the purchase or pull under that item instead of a duplicate.
 */
export function ExistingSuggestions({
  query,
  category,
  kinds,
  onSelect,
}: {
  query: string;
  category?: Category;
  kinds?: ProductKind[];
  onSelect: (product: ProductSummary) => void;
}) {
  const t = useTranslations();
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [, startTransition] = useTransition();
  const q = query.trim();
  const filterKey = `${category ?? ''}|${kinds?.join(',') ?? ''}`;

  useEffect(() => {
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const [c, k] = filterKey.split('|');
        const found = await searchProductsAction(q, {
          category: (c || undefined) as Category | undefined,
          kinds: k ? (k.split(',') as ProductKind[]) : undefined,
        });
        // Linked items first: they come with prices.
        setResults(found.toSorted((a, b) => Number(b.linked) - Number(a.linked)).slice(0, 5));
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, filterKey]);

  if (q.length < 2 || results.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2">
      <p className="px-1 text-xs text-muted-foreground">{t('add.existingHint')}</p>
      <ul className="space-y-1">
        {results.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              className="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {p.name}
                {p.linked && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] font-normal text-muted-foreground">
                    <Link2 className="size-3" aria-hidden /> {t('add.linked')}
                  </span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">
                {[
                  t(`kind.${p.kind}`),
                  p.region && t(`region.${p.region}`),
                  [p.rarity, p.setCode, p.cardNumber].filter(Boolean).join(' '),
                  p.setName,
                  p.platform,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
