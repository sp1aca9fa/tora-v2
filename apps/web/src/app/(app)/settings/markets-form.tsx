'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { setMarketOptionsAction, setMarketsAction } from './actions';

/** The primary and secondary markets (S11; admins) and what item pages compare (S16). */
export function MarketsForm({
  markets,
  primary,
  secondary,
  compare,
  editable,
}: {
  markets: { key: string; label: string }[];
  primary: string | null;
  secondary: string | null;
  compare: 'secondary' | 'all';
  editable: boolean;
}) {
  const t = useTranslations('markets');
  const [pending, startTransition] = useTransition();
  const save = (p: string, s: string | null) => startTransition(() => setMarketsAction(p, s));
  const label = (key: string | null) =>
    key ? (markets.find((m) => m.key === key)?.label ?? key) : t('none');
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', pending && 'opacity-60')}>
      {(['primary', 'secondary'] as const).map((which) => {
        const value = which === 'primary' ? primary : secondary;
        return (
          <div key={which} className="space-y-1.5 text-sm">
            <p className="font-medium">{t(which)}</p>
            {editable ? (
              <NativeSelect
                value={value ?? ''}
                disabled={pending}
                aria-label={t(which)}
                onChange={(e) => {
                  const v = e.target.value || null;
                  if (which === 'primary' && v) save(v, v === secondary ? primary : secondary);
                  if (which === 'secondary') save(primary!, v);
                }}
                className="h-9 w-full"
              >
                {markets
                  .filter((m) => which === 'primary' || m.key !== primary)
                  .map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                {which === 'secondary' && <option value="">{t('none')}</option>}
              </NativeSelect>
            ) : (
              <p>{label(value)}</p>
            )}
            <p className="text-xs text-muted-foreground">{t(`${which}Info`)}</p>
          </div>
        );
      })}
      {markets.length > 2 && (
        <div className="space-y-1.5 text-sm sm:col-span-2">
          <p className="font-medium">{t('compare')}</p>
          {editable ? (
            <NativeSelect
              value={compare}
              disabled={pending}
              aria-label={t('compare')}
              onChange={(e) =>
                startTransition(() =>
                  setMarketOptionsAction({ compare: e.target.value as 'secondary' | 'all' }),
                )
              }
              className="h-9 w-full sm:w-1/2"
            >
              <option value="secondary">{t('compareSecondary')}</option>
              <option value="all">{t('compareAll')}</option>
            </NativeSelect>
          ) : (
            <p>{t(compare === 'all' ? 'compareAll' : 'compareSecondary')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('compareInfo')}</p>
        </div>
      )}
    </div>
  );
}
