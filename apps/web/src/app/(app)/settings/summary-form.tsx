'use client';

import { ROTATE_SECONDS, SUMMARY_PANELS, type SummaryPanel } from '@tora/core';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { type SummaryPrefsState, saveSummaryPrefsAction } from './actions';

/** Rotate the Summary's insights or show them side by side, how fast, and which ones. */
export function SummaryForm({
  rotate: initialRotate,
  seconds,
  panels,
}: {
  rotate: boolean;
  seconds: number;
  panels: SummaryPanel[];
}) {
  const t = useTranslations();
  const [rotate, setRotate] = useState(initialRotate);
  const [state, formAction, pending] = useActionState<SummaryPrefsState, FormData>(
    saveSummaryPrefsAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="rotate"
            checked={rotate}
            onChange={(e) => setRotate(e.target.checked)}
            className="size-4"
          />
          {t('summaryPrefs.rotate')}
        </label>
        <label className="inline-flex items-center gap-2">
          <span className="text-muted-foreground">{t('summaryPrefs.every')}</span>
          <NativeSelect name="seconds" defaultValue={seconds} disabled={!rotate} className="w-24">
            {ROTATE_SECONDS.map((s) => (
              <option key={s} value={s}>
                {t('summaryPrefs.seconds', { count: s })}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="pb-1 text-muted-foreground">
          {rotate ? t('summaryPrefs.panelsRotate') : t('summaryPrefs.panelsShown')}
        </legend>
        {SUMMARY_PANELS.map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="panels"
              value={p}
              defaultChecked={panels.includes(p)}
              className="size-4"
            />
            {t(`portfolio.insights.title.${p}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {t('common.save')}
        </Button>
        {state.saved && (
          <p role="status" className="text-muted-foreground">
            {t('notices.saved')}
          </p>
        )}
        <FormError state={state} />
      </div>
    </form>
  );
}
