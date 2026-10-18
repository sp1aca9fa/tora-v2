'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TABS = [
  ['market', ''],
  ['buy', '/buy'],
  ['details', '/details'],
] as const;

/** The item's sub pages (S22): Market, Buy timing, Lots & details, each its own address. */
export function ItemNav({ productId }: { productId: string }) {
  const t = useTranslations('product.tab');
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {TABS.map(([name, path]) => {
        const href = `/products/${productId}${path}`;
        const current = pathname === href;
        return (
          <Link
            key={name}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              current
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(name)}
          </Link>
        );
      })}
    </nav>
  );
}
