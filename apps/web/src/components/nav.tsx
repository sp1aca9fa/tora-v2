'use client';

import { LayoutGrid, PlusCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', key: 'portfolio', icon: LayoutGrid },
  { href: '/add', key: 'add', icon: PlusCircle },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Bottom tab bar on mobile, side nav on desktop. */
export function Nav() {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-card px-3 py-6 md:flex">
        <div className="px-3 pb-6 text-lg font-semibold tracking-tight">{t('app.name')}</div>
        <nav className="flex flex-col gap-1">
          {ITEMS.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive(pathname, href) && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              <Icon className="size-4" />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-3">
          {ITEMS.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 text-xs text-muted-foreground',
                isActive(pathname, href) && 'font-medium text-foreground',
              )}
            >
              <Icon className="size-5" />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
