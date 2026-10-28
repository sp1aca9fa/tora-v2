import type { Product } from '@tora/db';
import { Binoculars, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { InfoTag } from './info-tag';

export const CHIP = {
  proven: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  unproven: 'bg-muted text-muted-foreground',
  pick: 'bg-violet-500/15 text-violet-800 dark:text-violet-300',
} as const;

const BAR = {
  at: 'bg-emerald-500',
  close: 'bg-sky-500',
  mid: 'bg-primary/60',
  over: 'bg-red-500',
  wait: 'bg-amber-500',
} as const;

/**
 * One item worth a look, as texts worked out on the server: the list loads rows in batches as it
 * is scrolled (S26), so it gets their texts rather than the item's numbers.
 */
export interface OpportunityRowData {
  productId: string;
  href: string;
  product: Pick<Product, 'id' | 'name' | 'category' | 'kind'>;
  version: string | null;
  /** Condition, owned, watching, suggested. */
  meta: string[];
  /** "#3" and its ranking's sentence. */
  ranks: { short: string; text: string; href: string }[];
  now: string | null;
  target: string | null;
  /** "11% to go" or "At target". */
  toGo: string | null;
  /** How close the price is to the target (lowered when a warning is on), 0-1 (1: at or under). */
  reach: number | null;
  /** The bar's color: at or under the target, close, between, far over it, or a warning's wait. */
  tone: keyof typeof BAR;
  /** A warning on: wait, or buy under a lower price, why, and whether prices got that low before. */
  wait: { label: string; why: string; past: string | null } | null;
  /** How the target is worked out. */
  targetWhy: string | null;
  /** Buy timing says a good price now. */
  good: boolean;
  askUnder: string | null;
  buylistNear: string | null;
  signals: {
    key: string;
    style: keyof typeof CHIP;
    label: string;
    why: string;
    record: string;
    /** Its row on the Signals page. */
    href: string;
  }[];
  watching: boolean;
}

/** The texts every row shares. */
export interface OpportunityLabels {
  now: string;
  target: string;
  good: string;
  watch: string;
  noSignal: string;
  seeRecord: string;
  seeRanking: string;
}

export function OpportunityRow({
  o,
  labels,
}: {
  o: OpportunityRowData;
  labels: OpportunityLabels;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card px-3 py-3">
      <div className="flex items-start gap-1">
        <Link
          href={o.href}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md hover:bg-accent/50"
        >
          <ProductImage product={o.product} version={o.version} className="size-16 shrink-0" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="line-clamp-2 text-sm leading-snug font-medium">{o.product.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {o.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          </div>
        </Link>
        {!o.watching && (
          <Button
            asChild
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground"
          >
            <Link
              href={`/watchlist/add?product=${o.productId}`}
              title={labels.watch}
              aria-label={labels.watch}
            >
              <Binoculars />
            </Link>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {o.good && (
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', CHIP.proven)}>
            {labels.good}
          </span>
        )}
        {o.ranks.map((r) => (
          <InfoTag
            key={r.text}
            label={r.short}
            className="bg-sky-500/15 text-sky-800 dark:text-sky-300"
          >
            <span className="block">{r.text}</span>
            <Link href={r.href} className="block underline">
              {labels.seeRanking}
            </Link>
          </InfoTag>
        ))}
        {o.signals.map((s) => (
          <InfoTag key={s.key} label={s.label} className={CHIP[s.style]}>
            <span className="block">{s.why}</span>
            <span className="block text-muted-foreground">{s.record}</span>
            <Link href={s.href} className="block underline">
              {labels.seeRecord}
            </Link>
          </InfoTag>
        ))}
        {!o.good && !o.ranks.length && !o.signals.length && (
          <span className="text-xs text-muted-foreground">{labels.noSignal}</span>
        )}
      </div>
      {o.now !== null && (
        <div className="space-y-1 text-sm tabular-nums">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              <span className="font-medium">{o.now}</span>{' '}
              <span className="text-xs text-muted-foreground">{labels.now}</span>
            </span>
            {o.target && (
              <span className="text-xs text-muted-foreground">
                {o.targetWhy ? (
                  <InfoTag
                    label={`${labels.target} ${o.target}`}
                    className="px-0 font-normal text-muted-foreground"
                  >
                    <span className="block">{o.targetWhy}</span>
                  </InfoTag>
                ) : (
                  <>
                    {labels.target} <span className="text-foreground">{o.target}</span>
                  </>
                )}
                {o.toGo && !o.wait && <> · {o.toGo}</>}
              </span>
            )}
          </div>
          {o.wait && (
            <div className="flex flex-wrap items-baseline justify-end gap-x-2 text-xs">
              <InfoTag label={o.wait.label} className={CHIP.warning} icon={TriangleAlert}>
                <span className="block">{o.wait.why}</span>
                {o.wait.past && <span className="block">{o.wait.past}</span>}
              </InfoTag>
              {o.toGo && <span className="text-muted-foreground">{o.toGo}</span>}
            </div>
          )}
          {o.reach !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('h-full rounded-full', BAR[o.tone])}
                style={{ width: `${Math.round(o.reach * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      {(o.askUnder || o.buylistNear) && (
        <p className="flex flex-wrap gap-x-3 text-xs tabular-nums">
          {o.askUnder && (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">{o.askUnder}</span>
          )}
          {o.buylistNear && <span className="text-muted-foreground">{o.buylistNear}</span>}
        </p>
      )}
    </li>
  );
}
