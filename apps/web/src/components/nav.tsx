'use client';

import { Inbox, LayoutGrid, ListChecks, LogOut, PlusCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { Suspense, use } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { logout } from '@/app/actions';
import { LocaleToggle } from '@/components/locale-toggle';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/', key: 'portfolio', icon: LayoutGrid },
  { href: '/actions', key: 'actions', icon: ListChecks },
  { href: '/add', key: 'add', icon: PlusCircle },
  { href: '/imports', key: 'imports', icon: Inbox },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

type Counts = Partial<Record<(typeof ITEMS)[number]['key'], number>>;

/** A count of what needs the user, on a nav item (shown once counted: pages do not wait). */
function Badge({ counts, item }: { counts: Promise<Counts>; item: keyof Counts }) {
  return (
    <Suspense fallback={null}>
      <Count counts={counts} item={item} />
    </Suspense>
  );
}

function Count({ counts, item }: { counts: Promise<Counts>; item: keyof Counts }) {
  const count = use(counts)[item] ?? 0;
  if (count <= 0) return null;
  return (
    <span className="min-w-5 rounded-full bg-amber-500 px-1.5 text-center text-[10px] leading-5 font-medium text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Bottom tab bar on mobile, side nav on desktop. `badges`: counts per item key. */
export function Nav({ badges }: { badges: Promise<Counts> }) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: an icon rail at half-screen widths, a sidebar with labels from 1280 px. */}
      <aside className="fixed inset-y-0 left-0 hidden w-16 flex-col border-r bg-card px-2 py-6 md:flex xl:w-56 xl:px-3">
        <div className="flex items-center justify-center gap-2 pb-6 xl:justify-between xl:px-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            <span className="xl:hidden">{t('app.name').slice(0, 1)}</span>
            <span className="hidden xl:inline">{t('app.name')}</span>
          </Link>
          <LocaleToggle className="hidden xl:inline-flex" />
        </div>
        <nav className="flex flex-col gap-1">
          {ITEMS.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={t(`nav.${key}`)}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'relative flex items-center justify-center gap-3 rounded-md py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground xl:justify-start xl:px-3 xl:py-2',
                isActive(pathname, href) && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              <Icon className="size-5 xl:size-4" />
              <span className="sr-only flex-1 xl:not-sr-only">{t(`nav.${key}`)}</span>
              <span className="absolute top-0.5 right-0.5 xl:static">
                <Badge counts={badges} item={key} />
              </span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2 xl:items-stretch">
          <LocaleToggle className="flex-col xl:hidden" />
          <form action={logout}>
            <button
              type="submit"
              title={t('settings.logout')}
              className="flex w-full items-center justify-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground xl:justify-start"
            >
              <LogOut className="size-5 xl:size-4" />
              <span className="sr-only xl:not-sr-only">{t('settings.logout')}</span>
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <Link href="/" className="py-3 font-semibold tracking-tight">
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <form action={logout}>
            <button
              type="submit"
              aria-label={t('settings.logout')}
              className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
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
                  <Badge counts={badges} item={key} />
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
