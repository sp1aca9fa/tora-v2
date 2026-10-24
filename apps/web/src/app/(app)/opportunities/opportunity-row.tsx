import type { Product } from '@tora/db';
import { Binoculars, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const CHIP = {
  proven: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  unproven: 'bg-muted text-muted-foreground',
} as const;

/**
 * One item worth a look, as texts worked out on the server: the list draws rows as they scroll
 * in (S14), so it gets their texts rather than the item's numbers.
 */
export interface OpportunityRowData {
  productId: string;
  href: string;
  product: Pick<Product, 'id' | 'name' | 'category' | 'kind'>;
  version: string | null;
  /** Condition, owned, watching, candidate, ranking. */
  meta: string[];
  price: string | null;
  askUnder: string | null;
  buylistNear: string | null;
  signals: {
    key: string;
    style: keyof typeof CHIP;
    label: string;
    why: string;
    record: string | null;
  }[];
  watching: boolean;
}

/** The texts every row shares. */
export interface OpportunityLabels {
  price: string;
  watch: string;
}

export function OpportunityRow({
  o,
  labels,
}: {
  o: OpportunityRowData;
  labels: OpportunityLabels;
}) {
  return (
    <li className="rounded-xl border bg-card px-3 py-3">
      <Link href={o.href} className="flex items-center gap-3 rounded-md hover:bg-accent/50">
        <ProductImage product={o.product} version={o.version} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="line-clamp-2 text-sm leading-snug font-medium">{o.product.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {o.meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </p>
        </div>
        <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
          {o.price !== null && (
            <p className="font-medium tabular-nums">
              {o.price}
              {/* Not the market value: the signals' fair value. */}
              <span className="block text-xs font-normal text-muted-foreground">
                {labels.price}
              </span>
            </p>
          )}
          {o.askUnder && (
            <p className="text-xs font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
              {o.askUnder}
            </p>
          )}
          {o.buylistNear && (
            <p className="text-xs text-muted-foreground tabular-nums">{o.buylistNear}</p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      <ul className="mt-2 space-y-1.5 text-xs sm:pl-[68px]">
        {o.signals.map(({ key, style, label, why, record }) => (
          <li key={key} className="space-y-0.5">
            <span className={cn('rounded px-1.5 py-0.5 font-medium', CHIP[style])}>{label}</span>{' '}
            <span className="text-muted-foreground">{why}</span>
            {record !== null && <p className="text-muted-foreground">{record}</p>}
          </li>
        ))}
      </ul>
      {!o.watching && (
        <div className="mt-2 sm:pl-[68px]">
          <Button asChild size="sm" variant="outline">
            <Link href={`/watchlist/add?product=${o.productId}`}>
              <Binoculars /> {labels.watch}
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
}
