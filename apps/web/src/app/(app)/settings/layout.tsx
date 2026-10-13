import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { authed } from '@/lib/auth/guard';
import { SETTINGS_SECTIONS } from './sections';
import { SettingsShell } from './settings-shell';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [{ user }, t] = await Promise.all([authed(), getTranslations('settings')]);
  const titles: Record<string, string> = { title: t('title') };
  for (const s of SETTINGS_SECTIONS) {
    for (const e of [s, ...(s.children ?? [])]) titles[e.key] = t(`section.${e.key}.title`);
  }
  return (
    <SettingsShell titles={titles} admin={user.role === 'admin'}>
      {children}
    </SettingsShell>
  );
}
