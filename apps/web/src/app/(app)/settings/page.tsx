import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { sectionsFor } from './sections';
import { SettingsMenu } from './settings-menu';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

/** Settings menu: one entry per section. */
export default async function SettingsPage() {
  const { user } = await authed();
  return <SettingsMenu entries={sectionsFor(user.role === 'admin')} />;
}
