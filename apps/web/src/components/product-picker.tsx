'use client';

import { type Locale, type ProductType, displayName } from '@tora/core';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { type ProductSummary, searchProductsAction } from '@/app/(app)/add/actions';
import { Input } from '@/components/ui/input';

/** Search-as-you-type over existing products. */
export function ProductPicker({
  types,
  onSelect,
  autoFocus,
  placeholder,
}: {
  types?: ProductType[];
  onSelect: (product: ProductSummary) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [searched, setSearched] = useState('');
  const [pending, startTransition] = useTransition();
  const typesKey = types?.join(',');

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchProductsAction(query, typesKey?.split(',') as ProductType[]));
        setSearched(query);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, typesKey]);

  const showResults = q.trim() !== '' && searched === q.trim();

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t('add.searchPlaceholder')}
          autoFocus={autoFocus}
          className="pl-9"
          aria-busy={pending}
        />
      </div>
      {showResults &&
        (results.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{t('add.noResults')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  className="w-full px-3 py-2.5 text-left hover:bg-accent"
                >
                  <span className="block text-sm font-medium">{displayName(p, locale)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[t(`productType.${p.type}`), p.setName, p.cardNumber]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
