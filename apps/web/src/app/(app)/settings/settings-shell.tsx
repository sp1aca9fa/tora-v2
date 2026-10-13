'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { sectionAt, sectionsFor } from './sections';

/**
 * A settings page's header: on phones a way back to the menu it was opened from; at half-screen
 * widths the sections as a row of links; on full screens the sidebar lists them instead.
 */
export function SettingsShell({
  titles,
  admin,
  children,
}: {
  /** "title" and each section's title. */
  titles: Record<string, string>;
  admin: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const at = sectionAt(pathname);
  const back = at?.parent ?? null;
  const row = at?.parent?.children ?? (at ? sectionsFor(admin) : []);
  return (
    <div className="space-y-4">
      {at && (
        <>
          <Link
            href={back?.href ?? '/settings'}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ChevronLeft className="size-4" />
            {back ? titles[back.key] : titles.title}
          </Link>
          <nav className="hidden flex-wrap gap-1.5 md:flex xl:hidden" aria-label={titles.title}>
            {back && (
              <Link
                href={back.href}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
                {titles[back.key]}
              </Link>
            )}
            {row.map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                aria-current={key === at.entry.key ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                  key === at.entry.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {titles[key]}
              </Link>
            ))}
          </nav>
        </>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">
        {at ? titles[at.entry.key] : titles.title}
      </h1>
      {children}
    </div>
  );
}
