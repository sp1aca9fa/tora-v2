'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type QueryFormState, addReferenceAction } from './source-actions';

/** Paste a listing link of this exact item (a sale counts as a price). */
export function ReferenceForm({ sourceId }: { sourceId: string }) {
  const t = useTranslations('sources.search');
  const [state, formAction, pending] = useActionState<QueryFormState, FormData>(
    addReferenceAction.bind(null, sourceId),
    {},
  );
  return (
    <form action={formAction} className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          name="url"
          type="url"
          required
          placeholder="https://jp.mercari.com/item/m…"
          aria-label={t('referenceUrl')}
        />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {t('addReference')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('referenceHint')}</p>
      <FormError state={state} />
    </form>
  );
}
