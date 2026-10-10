'use client';

import { GRADERS, RAW_GRADES } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { formatJpy } from '@/lib/utils';
import { type ReviewRow, type ReviewState, confirmReviewAction } from './actions';

export interface ReviewItem {
  id: string;
  cls: 'card' | 'sealed' | 'item';
  name: string;
  details: string;
  acquiredAt: string;
  orderId: string | null;
  costJpy: number;
  quantity: number;
  packagingState: string | null;
}

const initialRow = (item: ReviewItem): ReviewRow => ({
  id: item.id,
  cls: item.cls,
  gradeType: '',
  rawGrade: 'A',
  grade: '10',
  certNumber: '',
  packagingState:
    item.cls === 'sealed'
      ? item.packagingState === 'sealed_no_shrink'
        ? 'sealed_no_shrink'
        : 'sealed_shrink'
      : undefined,
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
  // Rows confirmed by the last save disappear from `items` after revalidation.
  const payload = JSON.stringify(items.map((i) => rows.get(i.id) ?? initialRow(i)));
  const ungraded = items.filter((i) => i.cls === 'card' && !rows.get(i.id)?.gradeType).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item) => {
          const row = rows.get(item.id) ?? initialRow(item);
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
              {item.cls === 'card' ? (
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
            </p>
          )}
          <FormError state={state} />
        </div>
      </div>
    </form>
  );
}
