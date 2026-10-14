'use client';

import type { Locale } from '@tora/core';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import { nativeName } from '@/i18n/locale';
import { cn } from '@/lib/utils';
import { setLanguagesAction } from './actions';

/** The app's primary and secondary language (S16; admins), from the installed ones. */
export function LanguagesForm({
  installed,
  primary,
  secondary,
}: {
  installed: Locale[];
  primary: Locale;
  secondary: Locale | null;
}) {
  const t = useTranslations('languages');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const save = (p: Locale, s: Locale | null) => startTransition(() => setLanguagesAction(p, s));
  const label = (code: Locale) => {
    const own = nativeName(code);
    let here = own;
    try {
      here = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? own;
    } catch {
      // An unknown code keeps its own name.
    }
    return here === own ? own : `${own} (${here})`;
  };
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', pending && 'opacity-60')}>
      {(['primary', 'secondary'] as const).map((which) => (
        <div key={which} className="space-y-1.5 text-sm">
          <label htmlFor={`language-${which}`} className="font-medium">
            {t(which)}
          </label>
          <NativeSelect
            id={`language-${which}`}
            value={(which === 'primary' ? primary : secondary) ?? ''}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value || null;
              if (which === 'primary' && v) save(v, v === secondary ? primary : secondary);
              if (which === 'secondary') save(primary, v);
            }}
            className="h-9 w-full"
          >
            {installed
              .filter((c) => which === 'primary' || c !== primary)
              .map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            {which === 'secondary' && <option value="">{t('none')}</option>}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t(`${which}Info`)}</p>
        </div>
      ))}
    </div>
  );
}
