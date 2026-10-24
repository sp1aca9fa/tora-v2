'use client';

import { useTranslations } from 'next-intl';
import { useInParts } from '@/components/use-in-parts';
import { type OpportunityLabels, OpportunityRow, type OpportunityRowData } from './opportunity-row';

/** Rows drawn with the page, and added each time the end of the list comes near. */
const FIRST = 30;
const MORE = 60;

/** The items worth a look of one type (S13), in parts when there are many (S14). */
export function OpportunityList({
  rows,
  labels,
}: {
  rows: OpportunityRowData[];
  labels: OpportunityLabels;
}) {
  const t = useTranslations('inventory');
  const { limit, end } = useInParts(rows.length, FIRST, MORE);
  return (
    <>
      <ul className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {rows.slice(0, limit).map((o) => (
          <OpportunityRow key={o.productId} o={o} labels={labels} />
        ))}
      </ul>
      {limit < rows.length && (
        <div ref={end} className="py-4 text-center text-sm text-muted-foreground">
          {t('more', { count: rows.length - limit })}
        </div>
      )}
    </>
  );
}
