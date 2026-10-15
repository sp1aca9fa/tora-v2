'use client';

import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { changeTimeZoneAction } from './actions';

const noChange = () => () => {};

/** The app's time zone (S16 part 5; admins); a change rewrites the stored times. */
export function TimeZoneForm({
  current,
  zones,
  stored,
}: {
  current: string;
  zones: { name: string; offset: string }[];
  /** Lots, events and prices stored (none: no confirmation). */
  stored: number;
}) {
  const t = useTranslations('timeZone');
  const te = useTranslations('errors');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The device's zone (the server does not know it).
  const device = useSyncExternalStore(
    noChange,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );

  const change = (to: string) => {
    if (to === current) return false;
    if (stored > 0 && !window.confirm(t('confirm', { from: current, to }))) return false;
    setError(null);
    startTransition(async () => {
      const state = await changeTimeZoneAction(to);
      if (state.error) setError(te(state.error));
    });
    return true;
  };
  const known = (name: string | null) => !!name && zones.some((z) => z.name === name);

  return (
    <div className={cn('space-y-4 text-sm', pending && 'opacity-60')}>
      <div className="space-y-1.5">
        <label htmlFor="time-zone" className="font-medium">
          {t('zone')}
        </label>
        <NativeSelect
          id="time-zone"
          value={current}
          disabled={pending}
          onChange={(e) => {
            if (!change(e.target.value)) e.target.value = current;
          }}
          className="h-9 w-full sm:w-80"
        >
          {zones.map((z) => (
            <option key={z.name} value={z.name}>
              {z.name.replaceAll('_', ' ')} ({z.offset})
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {t('now', {
            time: format.dateTime(now, {
              timeZone: current,
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      {device && device !== current && known(device) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-3">
          <span className="min-w-0 flex-1">
            {t('device', { zone: device.replaceAll('_', ' ') })}
          </span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => change(device)}>
            {t('useDevice')}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {stored > 0 ? t('changeInfo') : t('setupInfo')}
      </p>
    </div>
  );
}
