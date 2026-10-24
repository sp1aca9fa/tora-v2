'use client';

import { RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { startTransition } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A page that failed (S15): the database or the server did not answer, or a save could not be
 * sent. Says so in the person's language and offers to try again, instead of the framework's
 * English error screen.
 */
export function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errorPage');
  const router = useRouter();
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 px-4 py-12 text-center">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('info')}</p>
      <div className="flex justify-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            startTransition(() => {
              // The page again from the server, then the failed part.
              router.refresh();
              reset();
            })
          }
        >
          <RotateCw className="size-4" />
          {t('retry')}
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/">{t('home')}</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground">{t('code', { code: error.digest })}</p>
      )}
    </div>
  );
}
