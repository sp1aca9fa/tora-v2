import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { adminOnly } from '@/lib/auth/guard';
import { SETTINGS_SECTIONS } from '../sections';
import { SettingsMenu } from '../settings-menu';
import { MarketsSection } from './markets/markets-section';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.admin.title') };
}

/** A market change rebuilds the value history after answering, within this time. */
export const maxDuration = 120;

/**
 * Admin preferences, settings for the whole app: the menu on phones; from half-screen widths
 * the first page, Markets, at once.
 */
export default async function AdminSettingsPage() {
  await adminOnly();
  const t = await getTranslations('settings');
  return (
    <>
      <div className="space-y-4 md:hidden">
        <p className="text-sm text-muted-foreground">{t('adminInfo')}</p>
        <SettingsMenu entries={SETTINGS_SECTIONS.find((s) => s.key === 'admin')!.children!} />
      </div>
      <div className="hidden md:block">
        <MarketsSection />
      </div>
    </>
  );
}
