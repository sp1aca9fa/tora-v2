'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A tag whose details open under it on a tap or click (and close on a tap elsewhere or Escape):
 * phones have no hover (S26).
 */
export function InfoTag({
  label,
  className,
  icon: Icon,
  children,
}: {
  label: string;
  className?: string;
  /** Drawn before the label (a warning's triangle). */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <span ref={box} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'rounded px-1.5 py-0.5 text-xs font-medium underline decoration-dotted underline-offset-2',
          className,
        )}
      >
        {Icon && <Icon className="mr-1 inline size-3" aria-hidden />}
        {label}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1 block w-64 max-w-[80vw] space-y-1 rounded-md border bg-card p-2 text-xs font-normal text-card-foreground shadow-md"
        >
          {children}
        </span>
      )}
    </span>
  );
}
