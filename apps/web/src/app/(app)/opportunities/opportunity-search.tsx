'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A name search for Opportunities' item lists (S27), kept in the URL (`?q=`) and across the
 * tabs; Signals lists signals, not items, so it has none.
 */
export function OpportunitySearch() {
  const t = useTranslations('opportunities.search');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => {
    if ((params.get('q') ?? '') === q.trim()) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (pathname === '/opportunities/signals') return null;
  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('placeholder')}
        className="pl-9"
        aria-label={t('label')}
      />
    </div>
  );
}
