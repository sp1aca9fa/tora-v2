'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createStatusTokenAction, removeStatusTokenAction } from './actions';

/** The read-only status token: made (shown once), replaced or removed. */
export function StatusTokenForm({ since, url }: { since: string | null; url: string }) {
  const t = useTranslations('server');
  const [token, setToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        {since ? t('tokenSince', { date: since }) : t('noToken')}
      </p>
      {token && (
        <div className="space-y-1 rounded-md bg-muted px-3 py-2.5">
          <p className="font-medium">{t('tokenOnce')}</p>
          <code className="block break-all select-all">{token}</code>
          <code className="block break-all text-xs text-muted-foreground select-all">
            {`curl -H "Authorization: Bearer ${token}" ${url}`}
          </code>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => {
            if (since && !confirm(t('replaceConfirm'))) return;
            startTransition(async () => setToken(await createStatusTokenAction()));
          }}
        >
          {since ? t('replace') : t('create')}
        </Button>
        {since && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (!confirm(t('removeConfirm'))) return;
              startTransition(async () => {
                await removeStatusTokenAction();
                setToken(null);
              });
            }}
          >
            {t('remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
