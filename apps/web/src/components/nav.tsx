'use client';

import { Inbox, LayoutGrid, PlusCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LocaleToggle } from '@/components/locale-toggle';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', key: 'portfolio', icon: LayoutGrid },
  { href: '/add', key: 'add', icon: PlusCircle },
  { href: '/imports', key: 'imports', icon: Inbox },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** A count of what needs the user, on a nav item. */
function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-[10px] leading-5 font-medium text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Bottom tab bar on mobile, side nav on desktop. `badges`: counts per item key. */
export function Nav({
  badges = {},
}: {
  badges?: Partial<Record<(typeof ITEMS)[number]['key'], number>>;
}) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r bg-card px-3 py-6 md:flex">
        <div className="flex items-center justify-between gap-2 px-3 pb-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {t('app.name')}
          </Link>
          <LocaleToggle />
        </div>
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
              <span className="flex-1">{t(`nav.${key}`)}</span>
              <Badge count={badges[key] ?? 0} />
            </Link>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <Link href="/" className="py-3 font-semibold tracking-tight">
          {t('app.name')}
        </Link>
        <LocaleToggle />
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
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
              <span className="relative">
                <Icon className="size-5" />
                <span className="absolute -top-1.5 left-3.5">
                  <Badge count={badges[key] ?? 0} />
                </span>
              </span>
              {t(`nav.${key}`)}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
