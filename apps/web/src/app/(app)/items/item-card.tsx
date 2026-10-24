import type { Product } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { cn } from '@/lib/utils';

/**
 * What one item card shows, worked out on the server (`itemCardData`): the list draws cards as
 * they scroll in (S14), so it gets their texts rather than the lots.
 */
export interface ItemCardData {
  product: Pick<Product, 'id' | 'name' | 'category' | 'kind'>;
  version: string | null;
  details: string;
  lotsLine: string;
  /** The main amount (value, else spent), in bold when it is a value. */
  amount: { text: string; strong: boolean } | null;
  /** Gain or loss, with its share of the cost. */
  pl: { text: string; pct: string | null } | null;
  note: { text: string; nums: boolean } | null;
}

/**
 * One item of the portfolio (requirements S8): a row on phones (bigger picture, the name on up to
 * two lines), a vertical card from 768 px (picture on top, the name on up to three lines).
 */
export function ItemCard({ card }: { card: ItemCardData }) {
  const { product, amount, pl, note } = card;
  return (
    <li className="md:flex">
      <Link
        href={`/products/${product.id}`}
        className="flex w-full items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/50 md:flex-col md:items-stretch md:gap-2 md:rounded-xl md:border md:bg-card md:p-3"
      >
        <ProductImage
          product={product}
          version={card.version}
          className="size-[4.5rem] md:aspect-square md:size-auto md:w-full"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="line-clamp-2 text-[0.9375rem] leading-snug font-medium md:line-clamp-3">
            {product.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">{card.details}</p>
          <p className="truncate text-xs text-muted-foreground">{card.lotsLine}</p>
        </div>
        <div className="shrink-0 text-right text-sm md:mt-auto md:flex md:items-baseline md:justify-between md:gap-2 md:border-t md:pt-2 md:text-left">
          {amount && (
            <p className={amount.strong ? 'font-medium tabular-nums' : 'tabular-nums'}>
              {amount.text}
            </p>
          )}
          <div className="md:text-right">
            {pl && (
              <p className="text-xs tabular-nums">
                {pl.text}
                {pl.pct && <span className="text-muted-foreground"> ({pl.pct})</span>}
              </p>
            )}
            {note && (
              <p className={cn('text-xs text-muted-foreground', note.nums && 'tabular-nums')}>
                {note.text}
              </p>
            )}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground md:hidden" />
      </Link>
    </li>
  );
}
