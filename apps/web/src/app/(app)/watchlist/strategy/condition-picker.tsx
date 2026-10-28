'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { saveConditionsAction } from '../actions';

export interface ConditionTypeView {
  type: string;
  label: string;
  /** The conditions items of this type are priced in, with how many items each. */
  buckets: { bucket: string; label: string; items: number }[];
  /** Those the person wants suggested; null: every one. */
  chosen: string[] | null;
}

/** Per item type, the conditions Opportunities and the Buy plan suggest (S27). */
export function ConditionPicker({ types }: { types: ConditionTypeView[] }) {
  const t = useTranslations('strategy');
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [chosen, setChosen] = useState(
    Object.fromEntries(
      types.map((v) => [v.type, new Set(v.chosen ?? v.buckets.map((b) => b.bucket))]),
    ),
  );
  const toggle = (type: string, bucket: string, on: boolean) => {
    const next = new Set(chosen[type]);
    if (on) next.add(bucket);
    else next.delete(bucket);
    setChosen({ ...chosen, [type]: next });
    setMessage(null);
  };

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h2 className="font-semibold">{t('conditionsTitle')}</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">{t('conditionsIntro')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((v) => (
          <fieldset key={v.type} className="space-y-1.5">
            <legend className="text-sm font-medium">{v.label}</legend>
            {v.buckets.map((b) => (
              <label key={b.bucket} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={chosen[v.type]?.has(b.bucket) ?? true}
                  onChange={(e) => toggle(v.type, b.bucket, e.target.checked)}
                />
                {b.label}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('conditionItems', { count: b.items })}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await saveConditionsAction(
                Object.fromEntries(types.map((v) => [v.type, [...(chosen[v.type] ?? [])]])),
              );
              setMessage(t('conditionsSaved'));
            })
          }
        >
          {t('conditionsSave')}
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </section>
  );
}
