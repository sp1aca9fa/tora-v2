'use client';

import { useTranslations } from 'next-intl';
import { useInParts } from '@/components/use-in-parts';
import { ItemCard, type ItemCardData } from './item-card';

/** Cards drawn with the page, and added each time the end of the list comes near. */
const FIRST = 60;
const MORE = 120;

export interface ItemGroup {
  key: string;
  label: string;
  /** Item count and, for groups counted in value, their value. */
  stats: string;
  value: string | null;
  cards: ItemCardData[];
}

type Mode = { mode: string; title: string | null; hint: string | null; groups: ItemGroup[] };

/** The groups up to `limit` cards, the last one cut. */
function upTo(modes: Mode[], limit: number): Mode[] {
  let left = limit;
  return modes
    .map((m) => ({
      ...m,
      groups: m.groups
        .map((g) => {
          const cards = g.cards.slice(0, Math.max(0, left));
          left -= cards.length;
          return { ...g, cards };
        })
        .filter((g) => g.cards.length),
    }))
    .filter((m) => m.groups.length);
}

/**
 * The Items list (S8) by tracking group, then kind, under sticky headers. Long lists come in
 * parts (S14): the first cards with the page, more as the end of the list scrolls near; the
 * headers' counts and values are for the whole group.
 */
export function ItemList({ modes }: { modes: Mode[] }) {
  const t = useTranslations('inventory');
  const total = modes.reduce((n, m) => n + m.groups.reduce((k, g) => k + g.cards.length, 0), 0);
  const { limit, end } = useInParts(total, FIRST, MORE);
  const shown = upTo(modes, limit);
  return (
    <div className="space-y-8">
      {shown.map(({ mode, title, hint, groups }) => (
        <div key={mode} className="space-y-5">
          {title && (
            <header className="space-y-0.5">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </header>
          )}
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              {/* Below the phone's top bar; at the top on desktop. */}
              <h3 className="sticky top-[calc(3.1rem+env(safe-area-inset-top))] z-[5] -mx-4 flex items-baseline gap-2 border-b bg-background/95 px-4 py-1.5 text-sm font-medium backdrop-blur md:top-0 md:mx-0 md:px-1">
                <span>{g.label}</span>
                <span className="text-xs text-muted-foreground">
                  {g.stats}
                  {g.value && (
                    <>
                      {' · '}
                      <span className="amount">{g.value}</span>
                    </>
                  )}
                </span>
              </h3>
              <ul className="divide-y rounded-xl border bg-card md:grid md:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] md:gap-3 md:divide-y-0 md:border-0 md:bg-transparent">
                {g.cards.map((card) => (
                  <ItemCard key={card.product.id} card={card} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ))}
      {limit < total && (
        <div ref={end} className="py-4 text-center text-sm text-muted-foreground">
          {t('more', { count: total - limit })}
        </div>
      )}
    </div>
  );
}
