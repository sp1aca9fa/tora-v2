import { type CurrentSupplyRow, type SupplyOffer, supplyOffers } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { getMoney } from '@/lib/money-server';
import { sourceLabels } from '@/lib/sources';
import { markNotItemAction, unmarkNotItemAction } from './actions';

/** Listings shown per source (S36 A2, plan W7 "Web"). */
const PER_SOURCE = 5;

/**
 * A game's stored listings in one condition (S36 A2): per source the cheapest few, each with its
 * title, price and link, and for a person with a wish on the item (or an admin) a "not the item"
 * button. Marked ones are listed apart, muted, with an undo for their maker or an admin. Behind one
 * summary line that says what to do; open from the start when the viewer may mark and no source of
 * the condition has a checked price, since marking is then what confirms it. Nothing for cards and
 * sealed (their rows store no listings).
 */
export async function GameListings({
  productId,
  rows,
  canMark,
  mayUndo,
  checked,
}: {
  productId: string;
  /** The condition's rows of what is for sale now. */
  rows: CurrentSupplyRow[];
  canMark: boolean;
  /** Whether this person may take back the mark of `source|ref`. */
  mayUndo: ReadonlySet<string>;
  /** The sources whose listings for the item are confirmed (a checked price). */
  checked: ReadonlySet<string>;
}) {
  const groups = rows
    .map((r) => ({
      source: r.source,
      offers: (supplyOffers(r) ?? []).slice(0, PER_SOURCE),
      marked: r.markedOffers ?? [],
    }))
    .filter((g) => g.offers.length || g.marked.length);
  if (!groups.length) return null;
  const [t, money, sourceLabel] = await Promise.all([
    getTranslations('gameListings'),
    getMoney(),
    sourceLabels(),
  ]);
  const shown = groups.filter((g) => g.offers.length);
  const total = shown.reduce((n, g) => n + g.offers.length, 0);
  const marked = groups.flatMap((g) => g.marked.map((o) => ({ source: g.source, offer: o })));
  const unconfirmed = shown.some((g) => !checked.has(g.source));
  const noneChecked = groups.every((g) => !checked.has(g.source));
  const words = {
    count: total,
    state: unconfirmed ? 'open' : 'checked',
    mark: canMark && unconfirmed ? 'yes' : 'no',
  };
  const summary =
    shown.length === 1
      ? t('summary', { ...words, source: sourceLabel(shown[0]!.source) })
      : t('summaryMany', words);

  // Title, price and action in one compact grid: they stay close on a wide screen.
  const line = (source: string, o: SupplyOffer, isMarked: boolean) => (
    <li
      key={`${source}|${o.ref}`}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5"
    >
      <span className={isMarked ? 'min-w-0 text-muted-foreground line-through' : 'min-w-0'}>
        {o.url ? (
          <a
            href={o.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 break-words underline-offset-2 hover:underline"
          >
            {o.title || o.ref}
          </a>
        ) : (
          <span className="line-clamp-2 break-words">{o.title || o.ref}</span>
        )}
      </span>
      <span className="text-right tabular-nums">{money(o.priceBase)}</span>
      <span className="flex justify-end">
        {isMarked
          ? mayUndo.has(`${source}|${o.ref}`) && (
              <form action={unmarkNotItemAction.bind(null, productId, source, o.ref)}>
                <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  {t('undo')}
                </Button>
              </form>
            )
          : canMark && (
              <form action={markNotItemAction.bind(null, productId, source, o.ref)}>
                <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
                  {t('notItem')}
                </Button>
              </form>
            )}
      </span>
    </li>
  );

  return (
    <details className="mt-3 text-sm" open={canMark && noneChecked}>
      <summary className="flex min-h-11 w-full cursor-pointer items-center rounded-md text-sm md:min-h-9">
        {summary}
      </summary>
      <div className="mt-1 max-w-xl space-y-3">
        {shown.map((g) => (
          <div key={g.source}>
            {shown.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground">{sourceLabel(g.source)}</p>
            )}
            <ul className="divide-y text-xs">{g.offers.map((o) => line(g.source, o, false))}</ul>
          </div>
        ))}
        {marked.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {t('marked', { count: marked.length })}
            </p>
            <ul className="divide-y text-xs">{marked.map((m) => line(m.source, m.offer, true))}</ul>
          </div>
        )}
      </div>
    </details>
  );
}
