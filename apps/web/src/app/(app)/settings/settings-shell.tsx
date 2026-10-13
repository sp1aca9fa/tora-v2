'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS } from './sections';

/**
 * Settings: the menu alone at /settings; a section with a way back on phones, and the menu
 * beside it on wide screens.
 */
export function SettingsShell({
  titles,
  children,
}: {
  /** "title" and each section's title. */
  titles: Record<string, string>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = SETTINGS_SECTIONS.find((s) => pathname.startsWith(`/settings/${s.key}`));
  if (!current) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{titles.title}</h1>
        {children}
      </div>
    );
  }
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
      <nav className="hidden lg:block" aria-label={titles.title}>
        <div className="sticky top-6 space-y-1">
          <Link href="/settings" className="mb-3 block text-2xl font-semibold tracking-tight">
            {titles.title}
          </Link>
          {SETTINGS_SECTIONS.map(({ key, icon: Icon }) => (
            <Link
              key={key}
              href={`/settings/${key}`}
              aria-current={key === current.key ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                key === current.key
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {titles[key]}
            </Link>
          ))}
        </div>
      </nav>
      <div className="min-w-0 space-y-4">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-4" />
          {titles.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{titles[current.key]}</h1>
        {children}
      </div>
    </div>
  );
}
