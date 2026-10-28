'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState } from 'react';
import { moreOpportunitiesAction } from './actions';
import type { CardsFilter } from './cards';
import { type OpportunityLabels, OpportunityRow, type OpportunityRowData } from './opportunity-row';

/**
 * The Worth a look list of a type (S26): the items with a proven signal, then apart those
 * without; more rows asked from the server as the end of the list comes near.
 */
export function OpportunityList({
  initial,
  total,
  proven,
  picked,
  filter,
  labels,
}: {
  initial: OpportunityRowData[];
  total: number;
  proven: number;
  picked: number;
  filter: CardsFilter;
  labels: OpportunityLabels;
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
          const next = await moreOpportunitiesAction(filter, rows.length);
          setRows((had) => [
            ...had,
            ...next.filter((r) => !had.some((h) => h.productId === r.productId)),
          ]);
        } finally {
          setLoading(false);
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows.length, more, loading, filter]);

  const heading = (title: string, note?: string) => (
    <li className="space-y-0.5 pt-2 first:pt-0 lg:col-span-2 2xl:col-span-3">
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>}
    </li>
  );
  if (!total) return <p className="text-sm text-muted-foreground">{t('noneWithSignals')}</p>;
  return (
    <>
      <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {proven > 0 && heading(t('provenTitle', { count: proven }))}
        {rows.map((o, i) => (
          <Fragment key={o.productId}>
            {i === proven &&
              picked > 0 &&
              heading(t('pickTitle', { count: picked }), t('pickNote'))}
            {i === proven + picked &&
              heading(
                t('restTitle', { count: total - proven - picked }),
                proven ? t('restNote') : `${t('noneProven')} ${t('restNote')}`,
              )}
            <OpportunityRow o={o} labels={labels} />
          </Fragment>
        ))}
      </ul>
      <div ref={end} className="py-4 text-center text-sm text-muted-foreground">
        {more ? (loading ? t('loading') : t('more', { count: total - rows.length })) : ''}
      </div>
    </>
  );
}
