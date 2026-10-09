import type { HoldingValuation } from '@tora/db';
import { useTranslations } from 'next-intl';
import { sourceLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';

/** Confidence as a label (never color alone) with a 3-dot meter. */
export function ConfidenceBadge({ confidence }: { confidence: HoldingValuation['confidence'] }) {
  const t = useTranslations('valuation');
  if (!confidence) return null;
  const filled = { high: 3, medium: 2, low: 1 }[confidence];
  return (
    <span className="inline-flex items-center gap-1" title={t(`confidenceHint.${confidence}`)}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'size-1.5 rounded-full',
              i <= filled ? 'bg-foreground/70' : 'bg-foreground/15',
            )}
          />
        ))}
      </span>
      {t(`confidence.${confidence}`)}
    </span>
  );
}

/** "SNKRDUNK · 12 sales / 30d · 5d old · ●●○ Medium" (or Manual / Retail price / No data). */
export function ValuationMeta({ v, className }: { v: HoldingValuation; className?: string }) {
  const t = useTranslations('valuation');
  const parts: React.ReactNode[] = [];
  if (v.method === 'manual') parts.push(t('manual'));
  else if (v.method === 'retail') parts.push(t('retail'));
  else if (v.method === 'none') parts.push(t('noData'));
  else {
    parts.push(sourceLabel(v.source ?? ''));
    parts.push(t('samples', { count: v.sampleSize, days: v.windowDays ?? 0 }));
  }
  if (v.ageDays !== null && v.method !== 'retail') parts.push(t('age', { days: v.ageDays }));
  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && '· '}
          {p}
        </span>
      ))}
      {v.confidence && (
        <>
          <span>·</span>
          <ConfidenceBadge confidence={v.confidence} />
        </>
      )}
    </span>
  );
}
