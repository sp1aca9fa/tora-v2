import { pendingMatchesForUser } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { productMeta } from '@/lib/product-display';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('sources'))('matchesTitle') };
}

export default async function MatchesPage() {
  const { db, user } = await authed();
  const [rows, t] = await Promise.all([pendingMatchesForUser(db, user.id), getTranslations()]);
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('sources.matchesTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('sources.matchesInfo')}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sources.noMatches')}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map(({ product }) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.id}#sources`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {productMeta(product, t)}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
