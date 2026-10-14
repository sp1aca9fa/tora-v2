'use client';

import type { LanguageSettings } from '@tora/core';
import { useLocale } from 'next-intl';
import { type ReactNode, createContext, useContext } from 'react';
import { setLocale } from '@/app/actions';
import { LANGUAGES, nativeName } from '@/i18n/locale';
import { cn } from '@/lib/utils';

const LanguagesContext = createContext<LanguageSettings | null>(null);

/** Given by the root layout: the admin's two languages (S16). */
export function LanguagesProvider({
  value,
  children,
}: {
  value: LanguageSettings;
  children: ReactNode;
}) {
  return <LanguagesContext.Provider value={value}>{children}</LanguagesContext.Provider>;
}

/** Always-visible switch between the app's primary and secondary language; none with one language. */
export function LocaleToggle({ className }: { className?: string }) {
  const current = useLocale();
  const languages = useContext(LanguagesContext);
  if (!languages?.secondary) return null;
  return (
    <form
      action={setLocale}
      className={cn('inline-flex rounded-full border bg-background p-0.5 text-xs', className)}
    >
      {[languages.primary, languages.secondary].map((locale) => (
        <button
          key={locale}
          name="locale"
          value={locale}
          title={nativeName(locale)}
          lang={locale}
          aria-pressed={current === locale}
          className={cn(
            'rounded-full px-2.5 py-1 font-medium text-muted-foreground transition-colors',
            current === locale ? 'bg-primary text-primary-foreground' : 'hover:text-foreground',
          )}
        >
          {LANGUAGES[locale]?.short ?? locale.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
