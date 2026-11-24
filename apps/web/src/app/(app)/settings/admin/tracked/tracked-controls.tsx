'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FormState } from '@/lib/form';
import { submitWith } from '@/lib/submit-form';
import { cn } from '@/lib/utils';
import { onPcAction, trackedRestAction, untrackAction } from './actions';

/**
 * A tracked game's two actions: mark it "now on PC" from a day (or clear the mark), and remove it
 * (only its tracked row goes; the item and its history stay, said in the confirm).
 */
export function TrackedRowActions({
  productId,
  name,
  onPc,
  today,
}: {
  productId: string;
  name: string;
  onPc: boolean;
  today: string;
}) {
  const t = useTranslations('tracked');
  const [state, action, pending] = useActionState<FormState, FormData>(
    onPcAction.bind(null, productId),
    {},
  );
  const [removing, startRemove] = useTransition();
  const [failed, setFailed] = useState(false);
  const remove = () => {
    if (!window.confirm(t('removeConfirm', { name }))) return;
    setFailed(false);
    startRemove(async () => setFailed(!(await untrackAction(productId)).done));
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {onPc ? (
        <form onSubmit={submitWith(action)}>
          <button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            className="min-h-8 underline-offset-2 hover:underline"
          >
            {t('clearPc')}
          </button>
        </form>
      ) : (
        <details className="group">
          <summary className="flex min-h-8 cursor-pointer items-center text-primary">
            {t('markPc')}
          </summary>
          <form onSubmit={submitWith(action)} className="mt-1 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              name="day"
              max={today}
              defaultValue={today}
              aria-label={t('pcDay')}
              className="h-8 w-auto"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {t('save')}
            </Button>
          </form>
        </details>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        className="min-h-8 text-destructive underline-offset-2 hover:underline"
      >
        {t('remove')}
      </button>
      <FormError state={state} />
      {failed && (
        <p role="alert" className="text-destructive">
          {t('removeFailed')}
        </p>
      )}
    </div>
  );
}

/**
 * The switch for the rest's monthly pages (`trackedRestOn`, off until an admin turns it on), with
 * its rule in words. Saved at once; it takes effect at the next nightly collect.
 */
export function RestSwitch({ on }: { on: boolean }) {
  const t = useTranslations('tracked');
  const [checked, setChecked] = useState(on);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const change = (next: boolean) => {
    setChecked(next);
    setFailed(false);
    startTransition(async () => {
      if (!(await trackedRestAction(next)).saved) {
        setChecked(!next);
        setFailed(true);
      }
    });
  };
  return (
    <div className={cn('space-y-1 text-sm', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{t('rest')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={t('rest')}
          disabled={pending}
          onClick={() => change(!checked)}
          className="flex min-h-8 items-center gap-2"
        >
          <span
            className={cn(
              'relative inline-block h-5 w-9 rounded-full border transition-colors',
              checked ? 'border-primary bg-primary' : 'border-muted-foreground/60 bg-muted',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-3.5 rounded-full transition-all',
                checked ? 'left-[1.125rem] bg-primary-foreground' : 'left-0.5 bg-muted-foreground',
              )}
            />
          </span>
          <span className="w-6 text-left font-medium">{t(checked ? 'on' : 'off')}</span>
        </button>
      </div>
      <p className="text-muted-foreground">{t('restRule')}</p>
      {failed && (
        <p role="alert" className="text-destructive">
          {t('restFailed')}
        </p>
      )}
    </div>
  );
}
