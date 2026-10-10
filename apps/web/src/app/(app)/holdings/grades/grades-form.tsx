'use client';

import { GRADERS, type Grading, RAW_GRADES } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { type GradesState, setGradesAction } from './actions';

export interface GradeRow {
  id: string;
  name: string;
  details: string;
  quantity: number;
  acquiredAt: string;
  grade: string | null;
}

/** Tick cards, pick one grade, apply it to all of them. */
export function GradesForm({ cards }: { cards: GradeRow[] }) {
  const t = useTranslations();
  const [grading, setGrading] = useState<Grading>('graded');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState(
    async (prev: GradesState, formData: FormData) => {
      const result = await setGradesAction(prev, formData);
      if (result.done !== undefined) setSelected(new Set());
      return result;
    },
    {},
  );
  const [ungradedOnly, setUngradedOnly] = useState(cards.some((c) => !c.grade));
  const shown = ungradedOnly ? cards.filter((c) => !c.grade) : cards;
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((c) => selected.has(c.id));

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-4 rounded-xl border bg-card px-4 py-3">
        <div role="radiogroup" className="inline-flex rounded-md border p-0.5">
          {(['graded', 'raw'] as const).map((g) => (
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
        <div className="grid gap-4 sm:grid-cols-2">
          {grading === 'raw' ? (
            <Field label={t('fields.rawGrade')} htmlFor="g-raw">
              <NativeSelect id="g-raw" name="rawGrade" defaultValue="A">
                {RAW_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <>
              <Field label={t('fields.grader')} htmlFor="g-grader">
                <NativeSelect id="g-grader" name="grader" defaultValue="PSA">
                  {GRADERS.map((g) => (
                    <option key={g} value={g}>
                      {g === 'other' ? t('common.other') : g}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('fields.grade')} htmlFor="g-grade">
                <Input id="g-grade" name="grade" required inputMode="decimal" defaultValue="10" />
              </Field>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || selected.size === 0}>
            {t('grades.apply', { count: selected.size })}
          </Button>
          {state.done !== undefined && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('grades.done', { count: state.done })}
            </p>
          )}
        </div>
        <FormError state={state} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={allShown}
            onChange={() =>
              setSelected((s) => {
                const next = new Set(s);
                for (const c of shown) {
                  if (allShown) next.delete(c.id);
                  else next.add(c.id);
                }
                return next;
              })
            }
            className="size-4"
          />
          {t('grades.selectAll')}
        </label>
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={ungradedOnly}
            onChange={() => setUngradedOnly((v) => !v)}
            className="size-4"
          />
          {t('grades.ungradedOnly')}
        </label>
      </div>

      <ul className="divide-y rounded-xl border bg-card">
        {shown.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/50">
              <input
                type="checkbox"
                name="ids"
                value={c.id}
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="size-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.details, c.acquiredAt, c.quantity > 1 && `× ${c.quantity}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">
                {c.grade ?? t('grades.noGrade')}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {/* Ticked cards hidden by the filter are still submitted. */}
      {[...selected]
        .filter((id) => !shown.some((c) => c.id === id))
        .map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
    </form>
  );
}
