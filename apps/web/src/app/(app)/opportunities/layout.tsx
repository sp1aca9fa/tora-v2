import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { AmountsToggle } from '@/components/amounts-toggle';
import { OpportunitiesNav } from './opportunities-nav';
import { OpportunitySearch } from './opportunity-search';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('opportunities') };
}

/** Opportunities (S13, as sub pages S26): the title, the sub pages, a name search (S27). */
export default async function OpportunitiesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('opportunities');
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <AmountsToggle />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
      </header>
      <Suspense>
        <OpportunitiesNav />
        <OpportunitySearch />
      </Suspense>
      {children}
    </div>
  );
}
