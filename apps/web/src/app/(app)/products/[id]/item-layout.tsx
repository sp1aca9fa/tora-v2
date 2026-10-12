'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

const TABS = ['overview', 'market', 'sources'] as const;
type Tab = (typeof TABS)[number];

// The tab lives in the URL hash (#market, #sources), so links such as "/products/x#sources" open
// it; changing tabs replaces the hash without scrolling.
const HASH_EVENT = 'tora-hash';
const readTab = (): Tab => {
  const hash = window.location.hash.slice(1);
  return (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'overview';
};
const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
};

/**
 * The item page's layout (requirements S8): on wide screens two columns, the item and its lots
 * on the left, its market and price sources on the right, all shown; on phones and half screens
 * the header, then one tab at a time (Overview / Market / Sources).
 */
export function ItemLayout({
  header,
  overview,
  market,
  sources,
}: {
  header: ReactNode;
  overview: ReactNode;
  market: ReactNode;
  sources: ReactNode;
}) {
  const t = useTranslations('product.tab');
  const tab = useSyncExternalStore(subscribe, readTab, () => 'overview' as Tab);
  const pick = (next: Tab) => {
    history.replaceState(null, '', next === 'overview' ? window.location.pathname : `#${next}`);
    window.dispatchEvent(new Event(HASH_EVENT));
  };
  const panel = (name: Tab) => cn('space-y-5', tab === name ? 'block' : 'hidden', 'lg:block');
  return (
    <div className="lg:grid lg:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="space-y-5">
        {header}
        <nav className="flex gap-1 border-b lg:hidden">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => pick(name)}
              aria-current={tab === name ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === name
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(name)}
            </button>
          ))}
        </nav>
        <div className={panel('overview')}>{overview}</div>
      </div>
      <div className="mt-5 space-y-5 lg:mt-0">
        <div className={panel('market')}>{market}</div>
        <div id="sources" className={cn(panel('sources'), 'scroll-mt-20')}>
          {sources}
        </div>
      </div>
    </div>
  );
}
