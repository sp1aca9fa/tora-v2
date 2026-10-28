'use client';

import type { PopularBy } from '@tora/db';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { morePopularAction } from './actions';
import { PopularRow } from './popular-row';
import type { PopularRowData } from './popular-rows';

/** Popular ranked by trades (S27): more rows asked from the server as the end comes near. */
export function PopularList({
  initial,
  total,
  type,
  by,
}: {
  initial: PopularRowData[];
  total: number;
  type: string;
  by: PopularBy;
}) {
  const t = useTranslations('opportunities');
  const [rows, setRows] = useState(initial);
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const more = rows.length < total;

  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || loading) return;
        setLoading(true);
        try {
          const next = await morePopularAction(type, by, rows.length);
          setRows((had) => [...had, ...next.filter((r) => !had.some((h) => h.key === r.key))]);
        } finally {
          setLoading(false);
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows.length, more, loading, type, by]);

  const labels = { tora: t('toraView'), worth: t('toraWorth') };
  return (
    <>
      <ul className="grid gap-x-6 rounded-xl border bg-card p-1 xl:grid-cols-2 [&>li]:border-b">
        {rows.map((r) => (
          <PopularRow key={r.key} r={r} labels={labels} />
        ))}
      </ul>
      <div ref={end} className="py-4 text-center text-sm text-muted-foreground">
        {more ? (loading ? t('loading') : t('more', { count: total - rows.length })) : ''}
      </div>
    </>
  );
}
