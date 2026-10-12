'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { type AmountsMode, AMOUNTS_COOKIE } from '@/lib/amounts';
import { cn } from '@/lib/utils';

const read = (): AmountsMode =>
  document.documentElement.dataset.amounts === 'shown' ? 'shown' : 'hidden';
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ['data-amounts'] });
  return () => observer.disconnect();
};

/** Whether amounts are hidden right now (charts drop their price labels then). */
export function useAmountsHidden() {
  return useSyncExternalStore(subscribe, read, () => 'hidden') === 'hidden';
}

/** The eye button: shows or hides amounts for the rest of this browser session. */
export function AmountsToggle({ className }: { className?: string }) {
  const t = useTranslations('amounts');
  const hidden = useAmountsHidden();
  const flip = () => {
    const next: AmountsMode = hidden ? 'shown' : 'hidden';
    document.documentElement.dataset.amounts = next;
    // A session cookie: gone when the browser closes; the server renders pages the same way.
    document.cookie = `${AMOUNTS_COOKIE}=${next}; path=/; samesite=lax`;
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={!hidden}
      aria-label={hidden ? t('show') : t('hide')}
      title={hidden ? t('show') : t('hide')}
      className={cn(
        'rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
