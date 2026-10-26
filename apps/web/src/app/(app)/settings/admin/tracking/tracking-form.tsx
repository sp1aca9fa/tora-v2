'use client';

import { MAX_TRACKING_DELAY, type TrackingHours, validTrackingHours } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { saveTrackingHoursAction } from '../../../stores/actions';

/** The board tracker's working hours (admins): on or around the clock, the hours, the delays. */
export function TrackingForm({
  hours,
  defaults,
}: {
  hours: TrackingHours | null;
  defaults: TrackingHours;
}) {
  const t = useTranslations('boardTracking');
  const [on, setOn] = useState(!!hours);
  const [form, setForm] = useState<TrackingHours>(hours ?? defaults);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<TrackingHours>) => {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  };
  const valid = !on || validTrackingHours(form);
  const save = () =>
    startTransition(async () => {
      const state = await saveTrackingHoursAction(on ? form : null);
      setMessage(state.error ? { ok: false, text: t('invalid') } : { ok: true, text: t('saved') });
    });

  return (
    <div className={cn('space-y-4 text-sm', pending && 'opacity-60')}>
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setMessage(null);
          }}
          className="size-4"
        />
        {t('enable')}
      </label>
      {!on && <p className="text-muted-foreground">{t('always')}</p>}
      {on && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="block font-medium">{t('from')}</span>
              <Input
                type="time"
                value={form.from}
                onChange={(e) => set({ from: e.target.value })}
                className="h-9 w-32"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block font-medium">{t('to')}</span>
              <Input
                type="time"
                value={form.to}
                onChange={(e) => set({ to: e.target.value })}
                className="h-9 w-32"
              />
            </label>
          </div>
          <div className="space-y-1.5">
            <span className="block font-medium">{t('delay')}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                max={MAX_TRACKING_DELAY}
                value={form.minDelay}
                onChange={(e) => set({ minDelay: Math.round(Number(e.target.value)) })}
                aria-label={t('minDelay')}
                className="h-9 w-24"
              />
              <span>{t('toSeconds')}</span>
              <Input
                type="number"
                min={0}
                max={MAX_TRACKING_DELAY}
                value={form.maxDelay}
                onChange={(e) => set({ maxDelay: Math.round(Number(e.target.value)) })}
                aria-label={t('maxDelay')}
                className="h-9 w-24"
              />
              <span>{t('seconds')}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t('delayInfo')}</p>
          </div>
          <p className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3">
            {t('warning', {
              from: form.from,
              to: form.to,
              min: form.minDelay,
              max: form.maxDelay,
            })}
          </p>
          <p className="text-xs text-muted-foreground">{t('outside')}</p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={pending || !valid} onClick={save}>
          {t('save')}
        </Button>
        {!valid && <span className="text-xs text-destructive">{t('invalid')}</span>}
        {message && (
          <span
            className={cn('text-xs', message.ok ? 'text-muted-foreground' : 'text-destructive')}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
