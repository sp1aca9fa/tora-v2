import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { FeedPill } from './feed-pill';
import { StoresNav } from './stores-nav';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('stores'))('title') };
}

/** Store notices (S25): the title, the sub pages and the feed's status. */
export default async function StoresLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('stores');
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      </header>
      <StoresNav />
      {children}
      <FeedPill />
    </div>
  );
}
