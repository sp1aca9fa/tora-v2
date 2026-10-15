'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { setCollectWindowAction } from './actions';

/** The nightly collect's time window (S16; admins). */
export function CollectWindowForm({ hours }: { hours: number }) {
  const t = useTranslations('settings');
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      {t('collectWindow')}
      <NativeSelect
        value={hours}
        disabled={pending}
        onChange={(e) => startTransition(() => setCollectWindowAction(Number(e.target.value)))}
        className="h-9 w-28"
      >
        {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {t('hours', { count: h })}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
