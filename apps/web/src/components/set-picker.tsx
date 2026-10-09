'use client';

import type { ProductKind, Region } from '@tora/core';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { type SetSummary, searchSetsAction } from '@/app/(app)/add/actions';
import { Input } from '@/components/ui/input';

/** Catalog set search; newest sets first when the box is empty. */
export function SetPicker({
  franchise,
  region,
  kind,
  onSelect,
}: {
  franchise: string;
  region: Region | null;
  kind: ProductKind | null;
  onSelect: (set: SetSummary) => void;
}) {
  const t = useTranslations();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SetSummary[] | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          setResults(await searchSetsAction(franchise, region, kind, q.trim()));
        }),
      q ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [franchise, region, kind, q]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('add.setSearchPlaceholder')}
          className="pl-9"
          aria-busy={pending}
        />
      </div>
      {results &&
        (results.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{t('add.noSets')}</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  className="w-full px-3 py-2.5 text-left hover:bg-accent"
                >
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[s.code, s.releaseDate, s.nameAlias !== s.name && s.nameAlias]
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
