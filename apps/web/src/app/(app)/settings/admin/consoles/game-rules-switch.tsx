'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { setGameRulesAction } from './actions';

/**
 * The install's "Game rules" switch (S36 A1): one control, one line on what it does, and how many
 * items are held. Saved at once; it takes effect at the next nightly collect.
 */
export function GameRulesSwitch({ on, held }: { on: boolean; held: number }) {
  const t = useTranslations('consoles');
  const [checked, setChecked] = useState(on);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const change = (next: boolean) => {
    setChecked(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setGameRulesAction(next);
      if (!result?.saved) {
        setChecked(!next);
        setFailed(true);
      }
    });
  };
  return (
    <div
      className={cn('max-w-prose space-y-1 rounded-md border p-3 text-sm', pending && 'opacity-60')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-medium">{t('gameRules')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={t('gameRules')}
          disabled={pending}
          onClick={() => change(!checked)}
          className="flex items-center gap-2"
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
          <span className="w-6 text-left font-medium tabular-nums">
            {t(checked ? 'gameRulesOn' : 'gameRulesOff')}
          </span>
        </button>
      </div>
      <p className="text-muted-foreground">{t('gameRulesInfo')}</p>
      <p className="text-muted-foreground">
        {checked ? t('gameRulesHeld', { count: held }) : t('gameRulesStop')}
      </p>
      {failed && (
        <p role="alert" className="text-destructive">
          {t('gameRulesFailed')}
        </p>
      )}
    </div>
  );
}
