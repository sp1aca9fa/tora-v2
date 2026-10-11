'use client';

import { GRADERS, RAW_GRADES } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { formatJpy } from '@/lib/utils';
import { type ReviewRow, type ReviewState, confirmReviewAction } from '../actions';

export interface ReviewItem {
  id: string;
  productId: string;
  importRunId: string | null;
  cls: 'card' | 'sealed' | 'item';
  name: string;
  details: string;
  acquiredAt: string;
  orderId: string | null;
  costJpy: number;
  quantity: number;
  packagingState: string | null;
  /** Why it was flagged (e.g. `deadline_missed`, `no_delivery`). */
  reasons: string[];
  /** What is already recorded (a lot flagged again keeps its grade). */
  grading: string | null;
  rawGrade: string | null;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
}

const initialRow = (item: ReviewItem): ReviewRow => ({
  id: item.id,
  cls: item.cls,
  gradeType:
    item.grading === 'graded' && item.grader
      ? (item.grader as ReviewRow['gradeType'])
      : item.grading === 'raw' && item.rawGrade
        ? 'raw'
        : '',
  rawGrade: (item.rawGrade as ReviewRow['rawGrade']) ?? 'A',
  grade: item.grade ?? '10',
  certNumber: item.certNumber ?? '',
  cancelled: false,
  packagingState:
    item.cls === 'sealed'
      ? item.packagingState === 'sealed_no_shrink'
        ? 'sealed_no_shrink'
        : 'sealed_shrink'
      : undefined,
  acquiredAt: item.reasons.includes('date_approx') ? item.acquiredAt : undefined,
  quantity: item.quantity,
});

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
              <div className="min-w-0">
                <p className="truncate font-medium">{item.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    item.details,
                    item.acquiredAt,
                    item.orderId && `#${item.orderId}`,
                    formatJpy(item.costJpy),
                    item.quantity > 1 && `× ${item.quantity}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {item.reasons.map((r) => (
                <p
                  key={r}
                  className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300"
                >
                  {t.has(`imports.reason.${r}`) ? t(`imports.reason.${r}`) : r}
                </p>
              ))}
              {!row.cancelled && !row.mergeInto && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{t('fields.quantity')}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={row.quantity ?? item.quantity}
                      onChange={(e) =>
                        update(item.id, {
                          quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        })
                      }
                      className="w-20"
                    />
                  </label>
                  {row.acquiredAt !== undefined && (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{t('imports.purchasedOn')}</span>
                      <Input
                        type="date"
                        value={row.acquiredAt}
                        onChange={(e) => update(item.id, { acquiredAt: e.target.value })}
                        className="w-40"
                      />
                    </label>
                  )}
                </div>
              )}
              {(candidates.length > 0 || row.mergeInto) && (
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t('imports.sameAs')}</span>
                  <NativeSelect
                    value={row.mergeInto ?? ''}
                    onChange={(e) =>
                      update(item.id, { mergeInto: e.target.value || undefined, cancelled: false })
                    }
                    className="w-auto max-w-full"
                  >
                    <option value="">{t('imports.sameAsNone')}</option>
                    {candidates.map((o) => (
                      <option key={o.id} value={o.id}>
                        {[o.name, o.acquiredAt, o.orderId && `#${o.orderId}`, formatJpy(o.costJpy)]
                          .filter(Boolean)
                          .join(' · ')}
                      </option>
                    ))}
                  </NativeSelect>
                  {row.mergeInto && (
                    <span className="w-full text-xs text-muted-foreground">
                      {t('imports.sameAsHint')}
                    </span>
                  )}
                </label>
              )}
              {!row.mergeInto && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.cancelled ?? false}
                    onChange={(e) => update(item.id, { cancelled: e.target.checked })}
                    className="size-4"
                  />
                  <span className={row.cancelled ? 'text-destructive' : 'text-muted-foreground'}>
                    {t(item.orderId ? 'imports.cancelled' : 'imports.removeLot')}
                  </span>
                </label>
              )}
              {row.cancelled || row.mergeInto ? null : item.cls === 'card' ? (
                <div className="flex flex-wrap gap-2">
                  <NativeSelect
                    aria-label={t('fields.grading')}
                    value={row.gradeType}
                    onChange={(e) =>
                      update(item.id, { gradeType: e.target.value as ReviewRow['gradeType'] })
                    }
                    className="w-32"
                  >
                    <option value="">{t('imports.noGrade')}</option>
                    <option value="raw">{t('grading.raw')}</option>
                    {GRADERS.map((g) => (
                      <option key={g} value={g}>
                        {g === 'other' ? t('common.other') : g}
                      </option>
                    ))}
                  </NativeSelect>
                  {row.gradeType === 'raw' && (
                    <NativeSelect
                      aria-label={t('fields.rawGrade')}
                      value={row.rawGrade}
                      onChange={(e) =>
                        update(item.id, { rawGrade: e.target.value as ReviewRow['rawGrade'] })
                      }
                      className="w-20"
                    >
                      {RAW_GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                  {row.gradeType !== '' && row.gradeType !== 'raw' && (
                    <>
                      <Input
                        aria-label={t('fields.grade')}
                        inputMode="decimal"
                        value={row.grade}
                        onChange={(e) => update(item.id, { grade: e.target.value })}
                        className="w-20"
                      />
                      <Input
                        aria-label={t('fields.certNumber')}
                        placeholder={t('fields.certNumber')}
                        inputMode="numeric"
                        value={row.certNumber}
                        onChange={(e) => update(item.id, { certNumber: e.target.value })}
                        className="w-40"
                      />
                    </>
                  )}
                </div>
              ) : item.cls === 'sealed' ? (
                <NativeSelect
                  aria-label={t('fields.packagingState')}
                  value={row.packagingState}
                  onChange={(e) =>
                    update(item.id, {
                      packagingState: e.target.value as ReviewRow['packagingState'],
                    })
                  }
                  className="w-48"
                >
                  {(['sealed_shrink', 'sealed_no_shrink'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`packaging.${p}`)}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
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
