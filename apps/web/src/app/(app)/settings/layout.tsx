import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SETTINGS_SECTIONS } from './sections';
import { SettingsShell } from './settings-shell';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings');
  const titles: Record<string, string> = { title: t('title') };
  for (const { key } of SETTINGS_SECTIONS) titles[key] = t(`section.${key}.title`);
  return <SettingsShell titles={titles}>{children}</SettingsShell>;
}
