import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { AccountSection } from './account/account-section';
import { sectionsFor } from './sections';
import { SettingsMenu } from './settings-menu';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

/** Settings: the menu on phones; from half-screen widths the first section, Account, at once. */
export default async function SettingsPage() {
  const { user } = await authed();
  return (
    <>
      <div className="md:hidden">
        <SettingsMenu entries={sectionsFor(user.role === 'admin')} />
      </div>
      <div className="hidden md:block">
        <AccountSection />
      </div>
    </>
  );
}
