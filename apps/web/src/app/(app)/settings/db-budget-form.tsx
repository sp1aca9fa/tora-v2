'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { setDbBudgetAction } from './actions';

const CHOICES = [25, 50, 100, 150, 200, 300, 400];

/** Rows read a month before admins are alerted (S19), in millions. */
export function DbBudgetForm({ millions }: { millions: number }) {
  const t = useTranslations('database');
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex flex-wrap items-center gap-2">
      {t('budget')}
      <NativeSelect
        value={millions}
        disabled={pending}
        onChange={(e) => startTransition(() => setDbBudgetAction(Number(e.target.value)))}
        className="h-9 w-32"
      >
        {[...new Set([...CHOICES, millions])]
          .sort((a, b) => a - b)
          .map((m) => (
            <option key={m} value={m}>
              {t('millions', { m })}
            </option>
          ))}
      </NativeSelect>
    </label>
  );
}
