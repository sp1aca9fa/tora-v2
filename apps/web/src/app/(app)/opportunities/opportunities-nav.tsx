'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  ['worthALook', '/opportunities'],
  ['popular', '/opportunities/popular'],
  ['signals', '/opportunities/signals'],
  ['plan', '/opportunities/plan'],
] as const;

/** The Opportunities sub pages (S26): Worth a look, Popular now, Signals, Buy plan; a search kept. */
export function OpportunitiesNav() {
  const t = useTranslations('opportunities.tab');
  const pathname = usePathname();
  const q = useSearchParams().get('q');
  return (
    <nav className="flex gap-1 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map(([name, href]) => (
        <Link
          key={name}
          href={q && name !== 'signals' ? `${href}?q=${encodeURIComponent(q)}` : href}
          aria-current={pathname === href ? 'page' : undefined}
          className={cn(
            '-mb-px shrink-0 border-b-2 px-2.5 py-2 sm:px-4 text-sm font-medium transition-colors',
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
