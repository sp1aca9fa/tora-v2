import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountSection } from './account-section';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.account.title') };
}

export default function Page() {
  return <AccountSection />;
}
