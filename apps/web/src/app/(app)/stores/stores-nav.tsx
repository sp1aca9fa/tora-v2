'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const TABS = [
  ['now', '/stores'],
  ['byStore', '/stores/by-store'],
  ['byLocation', '/stores/by-location'],
  ['posts', '/stores/posts'],
  ['lotteries', '/stores/lotteries'],
  ['area', '/stores/area'],
  ['codes', '/stores/codes'],
  ['feed', '/stores/feed'],
] as const;

/** The Stores sub pages (S25): Now, By store, By location, All posts, Lotteries, Area, Codes, Feed. */
export function StoresNav() {
  const t = useTranslations('stores.tab');
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map(([name, href]) => (
        <Link
          key={name}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          className={cn(
            '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            pathname === href
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(name)}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Reloads the page when what it shows changed: asks every 20 s, and at once when the page is
 * looked at again (back to the tab, phone unlocked), for the newest post (`post`) or the feed's
 * last push (`feed`), a few rows read, and refreshes only on a change.
 */
export function AutoRefresh({ on }: { on: 'post' | 'feed' }) {
  const router = useRouter();
  useEffect(() => {
    let last: string | null | undefined;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const state = (await (await fetch('/api/stores/state')).json()) as Record<
          string,
          string | null
        >;
        if (last !== undefined && state[on] !== last) router.refresh();
        last = state[on];
      } catch {
        // Offline for a moment: the next check tries again.
      }
    };
    void check();
    const timer = setInterval(check, 20_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [router, on]);
  return null;
}
