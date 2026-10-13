import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SETTINGS_SECTIONS } from './sections';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

/** Settings menu: one entry per section. */
export default async function SettingsPage() {
  const t = await getTranslations('settings');
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {SETTINGS_SECTIONS.map(({ key, icon: Icon }) => (
        <li key={key}>
          <Link
            href={`/settings/${key}`}
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
