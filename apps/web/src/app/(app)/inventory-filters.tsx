'use client';

import { HOLDING_STATUSES, PRODUCT_TYPES } from '@tora/core';
import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

/** Search + type + status filters, kept in the URL so they survive reloads and back. */
export function InventoryFilters() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if ((params.get('q') ?? '') === q) return;
    const timer = setTimeout(() => update('q', q.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('inventory.search')}
          className="pl-9"
          aria-label={t('inventory.search')}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:contents">
        <NativeSelect
          aria-label={t('fields.type')}
          value={params.get('type') ?? ''}
          onChange={(e) => update('type', e.target.value)}
        >
          <option value="">{t('inventory.allTypes')}</option>
          {PRODUCT_TYPES.map((p) => (
            <option key={p} value={p}>
              {t(`productType.${p}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('fields.status')}
          value={params.get('status') ?? 'owned'}
          onChange={(e) => update('status', e.target.value)}
        >
          {HOLDING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
          <option value="all">{t('inventory.allStatuses')}</option>
        </NativeSelect>
      </div>
    </div>
  );
}
