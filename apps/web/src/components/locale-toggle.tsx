'use client';

import { useLocale } from 'next-intl';
import { setLocale } from '@/app/actions';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { locale: 'en', label: 'EN', title: 'English' },
  { locale: 'ja', label: 'JP', title: '日本語' },
] as const;

/** Always-visible EN / JP switch. */
export function LocaleToggle({ className }: { className?: string }) {
  const current = useLocale();
  return (
    <form
      action={setLocale}
      className={cn('inline-flex rounded-full border bg-background p-0.5 text-xs', className)}
    >
      {OPTIONS.map(({ locale, label, title }) => (
        <button
          key={locale}
          name="locale"
          value={locale}
          title={title}
          lang={locale}
          aria-pressed={current === locale}
          className={cn(
            'rounded-full px-2.5 py-1 font-medium text-muted-foreground transition-colors',
            current === locale ? 'bg-primary text-primary-foreground' : 'hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </form>
  );
}
