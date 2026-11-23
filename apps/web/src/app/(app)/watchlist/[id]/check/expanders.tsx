'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Children,
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

/** Phone shows this many rows of a sample; wider screens all of them (fix U5). */
const PHONE_ROWS = 10;

/** A section folded on a phone and open from a wide window (1280 px) on, as it loads. */
export function OpenOnWide({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia('(min-width: 1280px)').matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className="group">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

/** A list showing its first rows on a phone with "Show all N"; every row on a wide window. */
export function SampleRows({ children }: { children: ReactNode }) {
  const t = useTranslations('wish.check');
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  const more = rows.length > PHONE_ROWS;
  return (
    <>
      <ul className="divide-y text-xs">
        {rows.map((row, i) =>
          !all && i >= PHONE_ROWS && isValidElement<{ className?: string }>(row)
            ? cloneElement(row as ReactElement<{ className?: string }>, {
                className: cn(row.props.className, 'max-xl:hidden'),
              })
            : row,
        )}
      </ul>
      {more && !all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-9 text-xs font-medium text-primary underline-offset-2 hover:underline xl:hidden"
        >
          {t('showAll', { count: rows.length })}
        </button>
      )}
    </>
  );
}

/** The dropped rows behind a button-styled expander (fix U5). */
export function DroppedRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group text-xs">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md border bg-background px-3 font-medium shadow-xs hover:bg-accent [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-1 divide-y">{children}</ul>
    </details>
  );
}
