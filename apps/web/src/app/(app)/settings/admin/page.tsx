import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { adminOnly } from '@/lib/auth/guard';
import { SETTINGS_SECTIONS } from '../sections';
import { SettingsMenu } from '../settings-menu';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.admin.title') };
}

/** Admin preferences: settings for the whole app (every account). */
export default async function AdminSettingsPage() {
  await adminOnly();
  const t = await getTranslations('settings');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('adminInfo')}</p>
      <SettingsMenu entries={SETTINGS_SECTIONS.find((s) => s.key === 'admin')!.children!} />
    </div>
  );
}
