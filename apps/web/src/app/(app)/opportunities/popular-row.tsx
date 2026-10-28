import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { cn } from '@/lib/utils';
import type { PopularRowData } from './popular-rows';

/** One ranked item on Popular (S27): its rank, numbers, Tora's view, and prices. */
export function PopularRow({
  r,
  labels,
}: {
  r: PopularRowData;
  labels: { tora: string; worth: string };
}) {
  const body = (
    <>
      <span className="w-7 shrink-0 text-right text-sm font-medium tabular-nums">{r.rank}</span>
      <ProductImage product={r.product} version={r.version} className="size-12" />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="line-clamp-2 block text-sm leading-snug">{r.product.name}</span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
          {r.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </span>
        {r.tora && (r.tora.text || r.tora.worth || r.tora.signals.length > 0) && (
          <span className="flex flex-wrap gap-x-2 text-xs tabular-nums">
            <span className="text-muted-foreground">{labels.tora}</span>
            {r.tora.worth && (
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {labels.worth}
              </span>
            )}
            {r.tora.text && (
              <span
                className={cn(
                  r.tora.tone === 'wait' && 'text-amber-700 dark:text-amber-300',
                  r.tora.tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
                )}
              >
                {r.tora.text}
              </span>
            )}
            {r.tora.signals.length > 0 && (
              <span className="text-muted-foreground">{r.tora.signals.join(' · ')}</span>
            )}
          </span>
        )}
      </span>
      <span className="shrink-0 space-y-0.5 text-right tabular-nums">
        {r.price && <span className="block text-sm">{r.price}</span>}
        {r.toraPrice && (
          <span className={cn('block', r.price ? 'text-xs text-muted-foreground' : 'text-sm')}>
            {r.toraPrice}
          </span>
        )}
      </span>
    </>
  );
  return (
    <li
      id={r.productId ? `rank-${r.productId}` : undefined}
      className="scroll-mt-24 rounded-md target:bg-sky-500/15 target:ring-1 target:ring-sky-500/50"
    >
      {r.href ? (
        <Link
          href={r.href}
          className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}
