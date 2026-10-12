'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Pages laid out for the whole width (grids of cards); the others keep a reading width. */
const WIDE = [/^\/$/, /^\/items$/, /^\/actions$/];

/** The page area: full width for wide pages, a centred reading column for the rest (S8). */
export function PageWidth({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wide = WIDE.some((re) => re.test(pathname));
  return (
    <main
      className={cn(
        'mx-auto px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10',
        wide ? 'max-w-[120rem]' : 'max-w-3xl',
      )}
    >
      {children}
    </main>
  );
}
