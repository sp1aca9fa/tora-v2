'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { type ReviewRow, type ReviewState, confirmReviewAction } from '../actions';
import type { ReviewItem } from './review-item';
import { ReviewRowFields, initialRow } from './review-row';

export type { ReviewItem };

/** One row per imported transaction: grade + cert for cards, shrink for sealed product. */
export function ReviewForm({ items }: { items: ReviewItem[] }) {
  const t = useTranslations();
  const [rows, setRows] = useState(() => new Map(items.map((i) => [i.id, initialRow(i)])));
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(
    confirmReviewAction,
    {},
  );
  const update = (id: string, patch: Partial<ReviewRow>) =>
    setRows((m) => new Map(m).set(id, { ...m.get(id)!, ...patch }));
  // Lots this one may be the same purchase as: the same item, or flagged as maybe the same in
  // the same import (e.g. one made from a cut-off title).
  const sameCandidates = (item: ReviewItem) =>
    items.filter(
      (o) =>
        o.id !== item.id &&
        !rows.get(o.id)?.mergeInto &&
        (o.productId === item.productId ||
          (item.reasons.includes('maybe_same') &&
            o.reasons.includes('maybe_same') &&
            o.importRunId === item.importRunId)),
    );
  // Rows confirmed by the last save disappear from `items` after revalidation.
  const payload = JSON.stringify(items.map((i) => rows.get(i.id) ?? initialRow(i)));
  const ungraded = items.filter(
    (i) =>
      i.cls === 'card' &&
      !rows.get(i.id)?.gradeType &&
      !rows.get(i.id)?.cancelled &&
      !rows.get(i.id)?.mergeInto,
  ).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item) => {
          const row = rows.get(item.id) ?? initialRow(item);
          const candidates = sameCandidates(item);
          return (
            <li key={item.id} className="space-y-2 px-4 py-3">
              <ReviewRowFields item={item} row={row} update={update} candidates={candidates} />
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 rounded-xl border bg-background/95 px-4 py-3 backdrop-blur md:bottom-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="mode" value="save" disabled={pending}>
            {t('imports.save')}
          </Button>
          {ungraded > 0 && (
            <Button type="submit" name="mode" value="all" variant="outline" disabled={pending}>
              {t('imports.confirmAll', { count: ungraded })}
            </Button>
          )}
          {state.done !== undefined && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('imports.done', { count: state.done })}
              {state.cancelled
                ? ` · ${t('imports.doneCancelled', { count: state.cancelled })}`
                : ''}
            </p>
          )}
          <FormError state={state} />
        </div>
      </div>
    </form>
  );
}
