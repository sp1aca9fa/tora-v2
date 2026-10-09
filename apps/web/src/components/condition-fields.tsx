'use client';

import {
  CONDITIONS,
  GRADERS,
  type Grading,
  PACKAGING_STATES,
  type ProductType,
  RAW_GRADES,
  holdingFieldsFor,
} from '@tora/core';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Field } from '@/components/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';

export interface ConditionDefaults {
  condition?: string | null;
  packagingState?: string | null;
  grading?: string | null;
  rawGrade?: string | null;
  grader?: string | null;
  grade?: string | null;
  certNumber?: string | null;
}

/** Condition / packaging / grading inputs relevant to the product type. */
export function ConditionFields({
  type,
  defaults = {},
}: {
  type: ProductType;
  defaults?: ConditionDefaults;
}) {
  const t = useTranslations();
  const show = holdingFieldsFor(type);
  const [grading, setGrading] = useState<Grading>(defaults.grading === 'graded' ? 'graded' : 'raw');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {show.condition && (
        <Field label={t('fields.condition')} htmlFor="c-condition">
          <NativeSelect
            id="c-condition"
            name="condition"
            required
            defaultValue={defaults.condition ?? 'new_unused'}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`condition.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {show.packaging && (
        <Field label={t('fields.packagingState')} htmlFor="c-packaging">
          <NativeSelect
            id="c-packaging"
            name="packagingState"
            required={type === 'sealed_tcg'}
            defaultValue={defaults.packagingState ?? (type === 'sealed_tcg' ? 'sealed_shrink' : '')}
          >
            {type !== 'sealed_tcg' && <option value="">{t('common.notSet')}</option>}
            {PACKAGING_STATES.filter(
              (p) => p !== 'n/a' && (type === 'sealed_tcg' || p !== 'box_opened_contents_sealed'),
            ).map((p) => (
              <option key={p} value={p}>
                {t(`packaging.${p}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {show.grading && (
        <>
          <Field label={t('fields.grading')} className="sm:col-span-2">
            <div role="radiogroup" className="inline-flex rounded-md border p-0.5">
              {(['raw', 'graded'] as const).map((g) => (
                <label
                  key={g}
                  className={cn(
                    'cursor-pointer rounded px-4 py-1.5 text-sm',
                    grading === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  <input
                    type="radio"
                    name="grading"
                    value={g}
                    checked={grading === g}
                    onChange={() => setGrading(g)}
                    className="sr-only"
                  />
                  {t(`grading.${g}`)}
                </label>
              ))}
            </div>
          </Field>
          {grading === 'raw' ? (
            <Field label={t('fields.rawGrade')} htmlFor="c-raw" hint={t('add.rawGradeHint')}>
              <NativeSelect id="c-raw" name="rawGrade" defaultValue={defaults.rawGrade ?? 'A'}>
                {RAW_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <>
              <Field label={t('fields.grader')} htmlFor="c-grader">
                <NativeSelect id="c-grader" name="grader" defaultValue={defaults.grader ?? 'PSA'}>
                  {GRADERS.map((g) => (
                    <option key={g} value={g}>
                      {g === 'other' ? t('common.other') : g}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('fields.grade')} htmlFor="c-grade">
                <Input
                  id="c-grade"
                  name="grade"
                  required
                  inputMode="decimal"
                  placeholder="10"
                  defaultValue={defaults.grade ?? ''}
                />
              </Field>
              <Field label={t('fields.certNumber')} htmlFor="c-cert">
                <Input
                  id="c-cert"
                  name="certNumber"
                  inputMode="numeric"
                  defaultValue={defaults.certNumber ?? ''}
                />
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}
