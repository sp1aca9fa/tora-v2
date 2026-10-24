'use client';

import type { AccountLoadResult } from '@tora/db';
import { Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Loads a downloaded JSON file into this empty account (requirements S15). */
export function LoadAccount() {
  const t = useTranslations('myData');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/import/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: file,
      });
      const result = (await response.json()) as AccountLoadResult | { error: string };
      if ('error' in result) {
        setMessage({ ok: false, text: t(`loadError.${result.error}` as never) });
      } else {
        setMessage({ ok: true, text: t('loaded', { ...result }) });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: t('loadError.failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <p className="font-medium">{t('loadTitle')}</p>
      <p className="text-muted-foreground">{t('loadInfo')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="application/json,.json"
          className="max-w-full text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button size="sm" variant="outline" disabled={!file || busy} onClick={load}>
          <Upload className="size-4" />
          {busy ? t('loading') : t('load')}
        </Button>
      </div>
      {message && (
        <p
          role="status"
          className={message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
