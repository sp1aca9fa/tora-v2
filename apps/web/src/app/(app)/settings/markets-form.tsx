'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { setMarketsAction } from './actions';

/** The primary and secondary markets (S11; admins). */
export function MarketsForm({
  markets,
  primary,
  secondary,
  editable,
}: {
  markets: { key: string; label: string }[];
  primary: string | null;
  secondary: string | null;
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
    </div>
  );
}
