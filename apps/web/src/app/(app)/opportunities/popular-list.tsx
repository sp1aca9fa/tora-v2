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
  q,
}: {
  initial: PopularRowData[];
  total: number;
  type: string;
  by: PopularBy;
  q: string | null;
}) {
  const t = useTranslations('opportunities');
  const [rows, setRows] = useState(initial);
  const [loading, setLoading] = useState(false);
  // Set when the server had nothing new (or failed), so the list does not ask again forever.
  const [done, setDone] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const more = !done && rows.length < total;

  useEffect(() => {
    const el = end.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting || loading) return;
        setLoading(true);
        try {
          const next = await morePopularAction(type, by, rows.length, q);
          const fresh = next.filter((r) => !rows.some((h) => h.key === r.key));
          if (!fresh.length) setDone(true);
          setRows((had) => [...had, ...fresh.filter((r) => !had.some((h) => h.key === r.key))]);
        } catch {
          setDone(true);
        } finally {
          setLoading(false);
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows, more, loading, type, by, q]);

  const labels = { tora: t('toraView'), worth: t('toraWorth') };
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card p-1">
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
