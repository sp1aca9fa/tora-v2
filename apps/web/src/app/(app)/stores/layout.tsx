import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { authed } from '@/lib/auth/guard';
import { FeedPill } from './feed-pill';
import { StoresNav } from './stores-nav';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('stores'))('title') };
}

/**
 * Store notices (S25): the title, the feed's status (a red bar at the top when the tracker does
 * not run, a pill in a corner), the sub pages.
 */
export default async function StoresLayout({ children }: { children: ReactNode }) {
  const [t, { user }] = await Promise.all([getTranslations('stores'), authed()]);
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      </header>
      <FeedPill admin={user.role === 'admin'} />
      <StoresNav />
      {children}
    </div>
  );
}
