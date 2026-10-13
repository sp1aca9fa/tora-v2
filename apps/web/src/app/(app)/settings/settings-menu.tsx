import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { SettingsEntry } from './sections';

/** A menu of settings sections (the Settings and Admin preferences pages). */
export async function SettingsMenu({ entries }: { entries: SettingsEntry[] }) {
  const t = await getTranslations('settings');
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(({ key, href, icon: Icon }) => (
        <li key={key}>
          <Link
            href={href}
            className="flex h-full items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
          >
            <Icon className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t(`section.${key}.title`)}</span>
              <span className="block text-sm text-muted-foreground">
                {t(`section.${key}.info`)}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
