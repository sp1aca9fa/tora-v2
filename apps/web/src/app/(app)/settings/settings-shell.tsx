'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS, type SettingsEntry, sectionAt, sectionsFor } from './sections';

const ADMIN = SETTINGS_SECTIONS.find((s) => s.key === 'admin')!;

/**
 * A settings page's header. Phones: the menus (Settings, Admin preferences) are pages of their
 * own, and a section has a way back. From half-screen widths there is no menu page: a menu path
 * shows its first section, and the sections are a row of links on top; a group's pages
 * (Admin preferences) are a second row of tabs under it.
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
  // Phones.
  const at = pathname === '/settings' ? null : sectionAt(pathname);
  // Wider screens: a menu path stands for its first section.
  const wide: { entry: SettingsEntry; parent: SettingsEntry | null } =
    pathname === '/settings'
      ? { entry: SETTINGS_SECTIONS[0]!, parent: null }
      : at?.entry.key === 'admin'
        ? { entry: ADMIN.children![0]!, parent: ADMIN }
        : at!;
  const phoneTitle = at ? titles[at.entry.key] : titles.title;
  return (
    <div className="space-y-4">
      {at && (
        <Link
          href={at.parent?.href ?? '/settings'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
        >
          <ChevronLeft className="size-4" />
          {at.parent ? titles[at.parent.key] : titles.title}
        </Link>
      )}
      <div className="hidden space-y-3 md:block">
        <nav className="flex flex-wrap gap-1.5" aria-label={titles.title}>
          {sectionsFor(admin).map(({ key, href, icon: Icon }) => {
            const on = key === (wide.parent ?? wide.entry).key;
            return (
              <Link
                key={key}
                href={href}
                aria-current={on && !wide.parent ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {titles[key]}
              </Link>
            );
          })}
        </nav>
        {/* A group's own pages (Admin preferences): a second, tab-like row under the first. */}
        {wide.parent && (
          <nav className="flex flex-wrap gap-x-5 border-b" aria-label={titles[wide.parent.key]}>
            {wide.parent.children!.map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                aria-current={key === wide.entry.key ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 border-b-2 py-2 text-sm transition-colors',
                  key === wide.entry.key
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {titles[key]}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        <span className="md:hidden">{phoneTitle}</span>
        <span className="hidden md:inline">{titles[wide.entry.key]}</span>
      </h1>
      {children}
    </div>
  );
}
