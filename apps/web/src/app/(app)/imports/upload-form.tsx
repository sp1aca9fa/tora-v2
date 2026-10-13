'use client';

import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { finishUploadsAction, uploadFileAction } from './upload-actions';

/**
 * Purchase files to import through Claude (requirements S8 step 5): screenshots of orders, PDFs,
 * text. Sent one by one, then read by the app (with a Claude API key) or by the home PC.
 */
export function UploadForm({ maxFiles, maxMb }: { maxFiles: number; maxMb: number }) {
  const t = useTranslations('imports.upload');
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    | { step: 'idle' }
    | { step: 'sending'; done: number; total: number }
    | { step: 'sent'; readNow: boolean; failed: string[] }
  >({ step: 'idle' });
  const send = async () => {
    const files = [...(input.current?.files ?? [])].slice(0, maxFiles);
    if (files.length === 0) return;
    const batchId = crypto.randomUUID();
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setState({ step: 'sending', done: i, total: files.length });
      const form = new FormData();
      form.set('file', file);
      const result = await uploadFileAction(batchId, form);
      if (result.error) failed.push(`${file.name} (${t(`error.${result.error}`, { mb: maxMb })})`);
    }
    const { readNow } = await finishUploadsAction(batchId);
    if (input.current) input.current.value = '';
    setState({ step: 'sent', readNow, failed });
  };
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.csv,.html,.eml"
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        onChange={() => setState({ step: 'idle' })}
      />
      <Button size="sm" onClick={send} disabled={state.step === 'sending'}>
        <Upload className="size-4" />
        {state.step === 'sending'
          ? t('sending', { done: state.done + 1, total: state.total })
          : t('send')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('limits', { files: maxFiles, mb: maxMb })}</p>
      {state.step === 'sent' && (
        <p role="status" className="text-sm">
          {state.readNow ? t('readNow') : t('waiting')}
          {state.failed.length > 0 && (
            <span className="block text-destructive">
              {t('notSent', { files: state.failed.join(', ') })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
