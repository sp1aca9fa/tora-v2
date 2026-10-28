'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { pickSignalAction } from './actions';

/** Shows a signal plug-in's signal as the admin's pick while not proven, or stops (admins). */
export function PickSignal({ signal, picked }: { signal: string; picked: boolean }) {
  const t = useTranslations('opportunities');
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="ml-2 text-xs text-muted-foreground underline"
      disabled={pending}
      onClick={() => startTransition(() => pickSignalAction(signal, !picked))}
    >
      {t(picked ? 'pickOff' : 'pickOn')}
    </button>
  );
}
