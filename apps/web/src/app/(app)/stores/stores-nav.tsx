'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const TABS = [
  ['posts', '/stores'],
  ['feed', '/stores/feed'],
  ['area', '/stores/area'],
] as const;

/** The Stores sub pages (S25): Posts, Feed, Area (set once, the least visited). */
export function StoresNav() {
  const t = useTranslations('stores.tab');
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
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

/** Reloads the page's data every so often: the feed keeps changing while the page is open. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
